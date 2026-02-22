"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HandTrackerEngine } from "./HandTracker";
import {
  detectGesture,
  detectTwoHandGesture,
  GestureCooldown,
  type Gesture,
  type Landmark,
} from "./GestureDetector";
import { AudioManager, type SoundId } from "./AudioManager";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GESTURE_LABELS: Record<Gesture, string> = {
  open_palm: "Open Palm",
  closed_fist: "Closed Fist",
  index_up: "Index Finger Up",
  thumbs_up: "Thumbs Up",
  shadow_clone: "Shadow Clone!",
  none: "No Gesture",
};

const GESTURE_COLORS: Record<Gesture, string> = {
  open_palm: "#22d3ee",
  closed_fist: "#f87171",
  index_up: "#a78bfa",
  thumbs_up: "#4ade80",
  shadow_clone: "#f59e0b",
  none: "#64748b",
};

// Hand landmark connections for drawing skeleton
const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // index
  [0, 9], [9, 10], [10, 11], [11, 12],  // middle
  [0, 13], [13, 14], [14, 15], [15, 16], // ring
  [0, 17], [17, 18], [18, 19], [19, 20], // pinky
  [5, 9], [9, 13], [13, 17],             // palm
];

// ---------------------------------------------------------------------------
// Particle effect
// ---------------------------------------------------------------------------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

function createParticleBurst(x: number, y: number): Particle[] {
  const colors = ["#a78bfa", "#c084fc", "#e879f9", "#f0abfc", "#818cf8"];
  const particles: Particle[] = [];
  for (let i = 0; i < 24; i++) {
    const angle = (Math.PI * 2 * i) / 24 + (Math.random() - 0.5) * 0.5;
    const speed = 1.5 + Math.random() * 3;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      maxLife: 0.6 + Math.random() * 0.4,
      size: 2 + Math.random() * 3,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
  return particles;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Camera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const trackerRef = useRef<HandTrackerEngine | null>(null);
  const audioRef = useRef<AudioManager | null>(null);
  const cooldownRef = useRef(new GestureCooldown(600));
  const particlesRef = useRef<Particle[]>([]);
  const particleRafRef = useRef<number | null>(null);

  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentGesture, setCurrentGesture] = useState<Gesture>("none");
  const [rawGesture, setRawGesture] = useState<Gesture>("none");
  const [soundStatus, setSoundStatus] = useState<string>("Ready");
  const [fps, setFps] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [flashGesture, setFlashGesture] = useState<Gesture | null>(null);
  const [handsCount, setHandsCount] = useState(0);

  // Refs for latest state in callbacks
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  // -----------------------------------------------------------------------
  // Draw hand landmarks on canvas
  // -----------------------------------------------------------------------
  const drawLandmarks = useCallback(
    (ctx: CanvasRenderingContext2D, landmarks: Landmark[], w: number, h: number) => {
      // Draw connections
      ctx.strokeStyle = "rgba(34, 211, 238, 0.5)";
      ctx.lineWidth = 2;
      for (const [a, b] of CONNECTIONS) {
        const la = landmarks[a];
        const lb = landmarks[b];
        ctx.beginPath();
        ctx.moveTo(la.x * w, la.y * h);
        ctx.lineTo(lb.x * w, lb.y * h);
        ctx.stroke();
      }

      // Draw landmark points
      for (const lm of landmarks) {
        ctx.fillStyle = "#22d3ee";
        ctx.beginPath();
        ctx.arc(lm.x * w, lm.y * h, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#0e7490";
        ctx.beginPath();
        ctx.arc(lm.x * w, lm.y * h, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Particle animation loop (on overlay canvas)
  // -----------------------------------------------------------------------
  const animateParticles = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const dt = 1 / 60;
    particlesRef.current = particlesRef.current.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05; // gravity
      p.life -= dt / p.maxLife;

      if (p.life <= 0) return false;

      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      return true;
    });

    ctx.globalAlpha = 1;

    if (particlesRef.current.length > 0) {
      particleRafRef.current = requestAnimationFrame(animateParticles);
    } else {
      particleRafRef.current = null;
    }
  }, []);

  // -----------------------------------------------------------------------
  // Handle a newly-detected gesture (after cooldown)
  // -----------------------------------------------------------------------
  const handleGesture = useCallback(
    (gesture: Gesture, landmarks: Landmark[][]) => {
      if (gesture === "none") return;

      setFlashGesture(gesture);
      setTimeout(() => setFlashGesture(null), 400);

      const audio = audioRef.current;
      if (!audio) return;

      switch (gesture) {
        case "open_palm":
          audio.play("ambient");
          setSoundStatus("Ambient playing");
          break;
        case "closed_fist":
          audio.stopAll();
          setSoundStatus("Stopped");
          break;
        case "index_up": {
          audio.play("sparkle");
          setSoundStatus("Sparkle!");
          // Trigger particle burst at index fingertip
          if (landmarks[0] && canvasRef.current) {
            const tip = landmarks[0][8];
            const canvas = canvasRef.current;
            particlesRef.current.push(
              ...createParticleBurst(tip.x * canvas.width, tip.y * canvas.height),
            );
            if (!particleRafRef.current) {
              particleRafRef.current = requestAnimationFrame(animateParticles);
            }
          }
          break;
        }
        case "thumbs_up":
          audio.play("thumbsup");
          setSoundStatus("Thumbs up chime!");
          break;
        case "shadow_clone":
          audio.play("shadow_clone");
          setSoundStatus("Shadow Clone Jutsu!");
          break;
      }
    },
    [animateParticles],
  );

  // -----------------------------------------------------------------------
  // Start / Stop camera + tracking
  // -----------------------------------------------------------------------
  const startCamera = useCallback(async () => {
    setLoading(true);

    try {
      // Init audio (must be in response to user gesture for autoplay policy)
      if (!audioRef.current) {
        audioRef.current = new AudioManager();
        await audioRef.current.init();
        audioRef.current.setVolume(volumeRef.current);
      }

      // Init tracker
      if (!trackerRef.current) {
        trackerRef.current = new HandTrackerEngine();
        await trackerRef.current.init();
      }

      // Get webcam stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      // Size canvases to match video
      const w = video.videoWidth;
      const h = video.videoHeight;
      canvasRef.current!.width = w;
      canvasRef.current!.height = h;
      overlayCanvasRef.current!.width = w;
      overlayCanvasRef.current!.height = h;

      // Start tracking loop
      trackerRef.current.start(video, (landmarks) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        setHandsCount(landmarks.length);

        if (landmarks.length > 0) {
          // Draw all detected hands
          for (const hand of landmarks) {
            drawLandmarks(ctx, hand, canvas.width, canvas.height);
          }

          // Check two-hand gesture first (requires 2 hands)
          let gesture: Gesture = "none";
          if (landmarks.length >= 2) {
            gesture = detectTwoHandGesture(landmarks);
          }
          // Fall back to single-hand gesture on the first hand
          if (gesture === "none") {
            gesture = detectGesture(landmarks[0]);
          }

          setRawGesture(gesture);

          const triggered = cooldownRef.current.process(gesture);
          if (triggered !== "none") {
            setCurrentGesture(triggered);
            handleGesture(triggered, landmarks);
          }
        } else {
          setRawGesture("none");
        }

        setFps(trackerRef.current?.fps ?? 0);
      });

      setActive(true);
    } catch (err) {
      console.error("Failed to start camera:", err);
      alert("Could not access camera. Please grant permission and try again.");
    } finally {
      setLoading(false);
    }
  }, [drawLandmarks, handleGesture]);

  const stopCamera = useCallback(() => {
    trackerRef.current?.stop();
    cooldownRef.current.reset();

    const video = videoRef.current;
    if (video?.srcObject) {
      const stream = video.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }

    audioRef.current?.stopAll();

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }

    const overlay = overlayCanvasRef.current;
    if (overlay) {
      const ctx = overlay.getContext("2d");
      ctx?.clearRect(0, 0, overlay.width, overlay.height);
    }

    particlesRef.current = [];
    setActive(false);
    setCurrentGesture("none");
    setRawGesture("none");
    setSoundStatus("Ready");
    setFps(0);
    setHandsCount(0);
  }, []);

  // Volume sync
  useEffect(() => {
    audioRef.current?.setVolume(volume);
  }, [volume]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      trackerRef.current?.dispose();
      audioRef.current?.dispose();
      if (particleRafRef.current) cancelAnimationFrame(particleRafRef.current);
    };
  }, []);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-black">
      {/* Video feed (hidden but used as source) */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover -scale-x-100"
        playsInline
        muted
      />

      {/* Hand landmark canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full object-cover -scale-x-100 pointer-events-none"
      />

      {/* Particle overlay canvas */}
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 h-full w-full object-cover -scale-x-100 pointer-events-none"
      />

      {/* Gesture flash overlay */}
      {flashGesture && (
        <div
          className="absolute inset-0 pointer-events-none animate-flash"
          style={{
            background: `radial-gradient(circle at center, ${GESTURE_COLORS[flashGesture]}20 0%, transparent 70%)`,
          }}
        />
      )}

      {/* Top-left: Gesture status */}
      <div className="absolute top-6 left-6 z-10 flex flex-col gap-2">
        <div
          className="flex items-center gap-3 rounded-xl bg-black/60 px-4 py-3 backdrop-blur-md border border-white/10 transition-all duration-300"
          style={{
            borderColor:
              rawGesture !== "none"
                ? `${GESTURE_COLORS[rawGesture]}80`
                : "rgba(255,255,255,0.1)",
          }}
        >
          <div
            className="h-3 w-3 rounded-full transition-colors duration-200"
            style={{
              backgroundColor: GESTURE_COLORS[rawGesture],
              boxShadow:
                rawGesture !== "none"
                  ? `0 0 8px ${GESTURE_COLORS[rawGesture]}`
                  : "none",
            }}
          />
          <span className="text-sm font-medium text-white/90">
            {GESTURE_LABELS[rawGesture]}
          </span>
        </div>
      </div>

      {/* Top-right: FPS + Hands count + Sound status */}
      <div className="absolute top-6 right-6 z-10 flex flex-col items-end gap-2">
        {active && (
          <div className="rounded-lg bg-black/60 px-3 py-1.5 backdrop-blur-md border border-white/10 text-xs font-mono text-white/60">
            {fps} FPS
          </div>
        )}
        {active && (
          <div className={`rounded-lg bg-black/60 px-3 py-1.5 backdrop-blur-md border text-xs font-mono ${
            handsCount >= 2
              ? "border-amber-500/50 text-amber-400"
              : handsCount === 1
                ? "border-cyan-500/50 text-cyan-400"
                : "border-white/10 text-white/60"
          }`}>
            {handsCount} {handsCount === 1 ? "hand" : "hands"}
          </div>
        )}
        <div className="rounded-lg bg-black/60 px-3 py-1.5 backdrop-blur-md border border-white/10 text-xs text-white/70">
          {soundStatus}
        </div>
      </div>

      {/* Bottom: Controls */}
      <div className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 items-center gap-4">
        <button
          onClick={active ? stopCamera : startCamera}
          disabled={loading}
          className={`group relative rounded-full px-8 py-3 text-sm font-semibold transition-all duration-300 ${
            loading
              ? "cursor-wait bg-white/10 text-white/40"
              : active
                ? "bg-red-500/80 text-white hover:bg-red-500 shadow-lg shadow-red-500/20"
                : "bg-white/90 text-black hover:bg-white shadow-lg shadow-white/20"
          }`}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Loading model...
            </span>
          ) : active ? (
            "Stop Camera"
          ) : (
            "Start Camera"
          )}
        </button>

        {active && (
          <div className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 backdrop-blur-md border border-white/10">
            <svg
              className="h-4 w-4 text-white/60"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
            </svg>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="h-1 w-20 cursor-pointer accent-cyan-400"
            />
          </div>
        )}
      </div>

      {/* Splash screen when inactive */}
      {!active && !loading && (
        <div className="absolute inset-0 z-5 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-cyan-400 to-purple-500 flex items-center justify-center">
                <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-white tracking-tight">
                Hand Gestures
              </h1>
            </div>
            <p className="max-w-sm text-sm text-white/50 leading-relaxed">
              Control sounds and visuals with your hands. Open your palm, point,
              give a thumbs up, make a fist, or cross your fingers for a shadow clone.
            </p>
            <div className="grid grid-cols-2 gap-3 mt-2">
              {(
                [
                  ["open_palm", "Play ambient sound"],
                  ["closed_fist", "Stop all sounds"],
                  ["index_up", "Particle burst"],
                  ["thumbs_up", "Play chime"],
                  ["shadow_clone", "Cross fingers (both hands)"],
                ] as [Gesture, string][]
              ).map(([g, desc]) => (
                <div
                  key={g}
                  className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 border border-white/10"
                >
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: GESTURE_COLORS[g] }}
                  />
                  <div className="text-left">
                    <div className="text-xs font-medium text-white/80">
                      {GESTURE_LABELS[g]}
                    </div>
                    <div className="text-[10px] text-white/40">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
