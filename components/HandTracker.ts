/**
 * Wrapper around MediaPipe HandLandmarker from @mediapipe/tasks-vision.
 *
 * Handles model loading and per-frame detection via requestAnimationFrame.
 * Emits landmarks through a callback so consumers can render / detect gestures.
 */

import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { Landmark } from "./GestureDetector";

export type HandTrackerCallback = (
  landmarks: Landmark[][],
  result: HandLandmarkerResult,
) => void;

export class HandTrackerEngine {
  private handLandmarker: HandLandmarker | null = null;
  private animFrameId: number | null = null;
  private running = false;
  private lastVideoTime = -1;
  private fpsCounter = { frames: 0, lastTime: performance.now(), fps: 0 };

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------

  /** Load the MediaPipe hand-landmark model (WASM + model bundle). */
  async init(): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
    );

    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.3,
      minHandPresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
  }

  // ------------------------------------------------------------------
  // Detection loop
  // ------------------------------------------------------------------

  /**
   * Start the rAF detection loop. Calls `onResult` each frame with the
   * detected hand landmarks.
   */
  start(video: HTMLVideoElement, onResult: HandTrackerCallback): void {
    if (this.running) return;
    this.running = true;

    const tick = () => {
      if (!this.running || !this.handLandmarker) return;

      if (video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = video.currentTime;

        const result = this.handLandmarker.detectForVideo(
          video,
          performance.now(),
        );

        // Map to our Landmark type
        const landmarks: Landmark[][] = result.landmarks.map((hand) =>
          hand.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z })),
        );

        onResult(landmarks, result);

        // FPS tracking
        this.fpsCounter.frames++;
        const now = performance.now();
        if (now - this.fpsCounter.lastTime >= 1000) {
          this.fpsCounter.fps = this.fpsCounter.frames;
          this.fpsCounter.frames = 0;
          this.fpsCounter.lastTime = now;
        }
      }

      this.animFrameId = requestAnimationFrame(tick);
    };

    this.animFrameId = requestAnimationFrame(tick);
  }

  /** Stop the detection loop. */
  stop(): void {
    this.running = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  /** Get current detection FPS. */
  get fps(): number {
    return this.fpsCounter.fps;
  }

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------

  dispose(): void {
    this.stop();
    if (this.handLandmarker) {
      this.handLandmarker.close();
      this.handLandmarker = null;
    }
  }
}
