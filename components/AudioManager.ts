/**
 * Lightweight audio manager built on the Web Audio API.
 *
 * Features:
 *  - Preloads all sound files into AudioBuffers for instant playback.
 *  - Exposes play / stop / volume controls per sound.
 *  - Prevents unintentional overlap for looping sounds (ambient).
 */

export type SoundId = "ambient" | "thumbsup" | "sparkle" | "shadow_clone" | "f_u";

interface SoundEntry {
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  loop: boolean;
  playing: boolean;
}

const SOUND_FILES: Record<SoundId, { path: string; loop: boolean }> = {
  ambient: { path: "/sounds/ambient.wav", loop: true },
  thumbsup: { path: "/sounds/thumbsup.wav", loop: false },
  sparkle: { path: "/sounds/sparkle.wav", loop: false },
  shadow_clone: { path: "/sounds/shadow-clone.mp3", loop: false },
  f_u: { path: "/sounds/f_u.m4a", loop: false },
};

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sounds: Map<SoundId, SoundEntry> = new Map();
  private loaded = false;

  // ------------------------------------------------------------------
  // Initialisation
  // ------------------------------------------------------------------

  /** Create the AudioContext and preload all sounds. */
  async init(): Promise<void> {
    if (this.loaded) return;

    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);

    const entries = Object.entries(SOUND_FILES) as [
      SoundId,
      { path: string; loop: boolean },
    ][];

    await Promise.all(
      entries.map(async ([id, { path, loop }]) => {
        const gain = this.ctx!.createGain();
        gain.connect(this.masterGain!);

        const entry: SoundEntry = {
          buffer: null,
          source: null,
          gain,
          loop,
          playing: false,
        };

        try {
          const res = await fetch(path);
          const arrayBuf = await res.arrayBuffer();
          entry.buffer = await this.ctx!.decodeAudioData(arrayBuf);
        } catch (err) {
          console.warn(`[AudioManager] Failed to load ${path}:`, err);
        }

        this.sounds.set(id, entry);
      }),
    );

    this.loaded = true;
  }

  // ------------------------------------------------------------------
  // Playback
  // ------------------------------------------------------------------

  /** Play a sound. Looping sounds won't restart if already playing. */
  play(id: SoundId): void {
    const entry = this.sounds.get(id);
    if (!entry?.buffer || !this.ctx) return;

    // For looping sounds, don't restart if already playing
    if (entry.loop && entry.playing) return;

    // For one-shot sounds, stop previous instance first
    if (entry.source) {
      try {
        entry.source.stop();
      } catch {
        /* already stopped */
      }
    }

    const source = this.ctx.createBufferSource();
    source.buffer = entry.buffer;
    source.loop = entry.loop;
    source.connect(entry.gain);

    source.onended = () => {
      entry.playing = false;
      entry.source = null;
    };

    source.start();
    entry.source = source;
    entry.playing = true;
  }

  /** Stop a specific sound. */
  stop(id: SoundId): void {
    const entry = this.sounds.get(id);
    if (!entry?.source) return;

    try {
      entry.source.stop();
    } catch {
      /* already stopped */
    }
    entry.playing = false;
    entry.source = null;
  }

  /** Stop all sounds. */
  stopAll(): void {
    for (const id of this.sounds.keys()) {
      this.stop(id);
    }
  }

  // ------------------------------------------------------------------
  // Volume
  // ------------------------------------------------------------------

  /** Set master volume (0 – 1). */
  setVolume(value: number): void {
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(
        Math.max(0, Math.min(1, value)),
        this.ctx!.currentTime,
      );
    }
  }

  /** Check if a sound is currently playing. */
  isPlaying(id: SoundId): boolean {
    return this.sounds.get(id)?.playing ?? false;
  }

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------

  dispose(): void {
    this.stopAll();
    if (this.ctx && this.ctx.state !== "closed") {
      void this.ctx.close();
    }
    this.sounds.clear();
    this.loaded = false;
  }
}
