/**
 * Pure gesture detection logic from MediaPipe hand landmarks.
 *
 * MediaPipe Hands returns 21 landmarks per hand. Each landmark has x, y, z
 * coordinates normalised to [0, 1] relative to the image dimensions.
 *
 * Landmark indices used here:
 *   0  - Wrist
 *   4  - Thumb tip
 *   8  - Index finger tip
 *   12 - Middle finger tip
 *   16 - Ring finger tip
 *   20 - Pinky tip
 *   2  - Thumb IP joint (for thumb-up check)
 *   5  - Index MCP
 *   6  - Index PIP
 *   9  - Middle MCP
 *   13 - Ring MCP
 *   17 - Pinky MCP
 */

export type Gesture = "open_palm" | "closed_fist" | "index_up" | "thumbs_up" | "none";

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Euclidean distance between two landmarks (2D, ignoring z). */
function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Returns true when a fingertip is extended (tip is farther from the wrist
 * than the corresponding MCP joint).
 */
function isFingerExtended(
  wrist: Landmark,
  mcp: Landmark,
  tip: Landmark,
): boolean {
  return dist(tip, wrist) > dist(mcp, wrist) * 1.05;
}

/**
 * Thumb extension uses a different heuristic because the thumb moves
 * laterally. We compare the thumb-tip to the index MCP instead.
 */
function isThumbExtended(
  thumbTip: Landmark,
  thumbIp: Landmark,
  indexMcp: Landmark,
): boolean {
  return dist(thumbTip, indexMcp) > dist(thumbIp, indexMcp) * 1.1;
}

// ---------------------------------------------------------------------------
// Main detector
// ---------------------------------------------------------------------------

/**
 * Detect the current gesture from a set of 21 hand landmarks.
 * Returns the detected Gesture or "none".
 */
export function detectGesture(landmarks: Landmark[]): Gesture {
  if (landmarks.length < 21) return "none";

  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[2];
  const indexTip = landmarks[8];
  const indexPip = landmarks[6];
  const indexMcp = landmarks[5];
  const middleTip = landmarks[12];
  const middleMcp = landmarks[9];
  const ringTip = landmarks[16];
  const ringMcp = landmarks[13];
  const pinkyTip = landmarks[20];
  const pinkyMcp = landmarks[17];

  const thumb = isThumbExtended(thumbTip, thumbIp, indexMcp);
  const index = isFingerExtended(wrist, indexMcp, indexTip);
  const middle = isFingerExtended(wrist, middleMcp, middleTip);
  const ring = isFingerExtended(wrist, ringMcp, ringTip);
  const pinky = isFingerExtended(wrist, pinkyMcp, pinkyTip);

  // --- Thumbs up: thumb extended, all other fingers curled ---
  if (thumb && !index && !middle && !ring && !pinky) {
    // Extra check: thumb tip should be above index PIP (higher = lower y)
    if (thumbTip.y < indexPip.y) {
      return "thumbs_up";
    }
  }

  // --- Index finger up: only index extended ---
  if (index && !middle && !ring && !pinky) {
    return "index_up";
  }

  // --- Open palm: all five digits extended ---
  if (thumb && index && middle && ring && pinky) {
    return "open_palm";
  }

  // --- Closed fist: no fingers extended ---
  if (!thumb && !index && !middle && !ring && !pinky) {
    return "closed_fist";
  }

  return "none";
}

// ---------------------------------------------------------------------------
// Cooldown wrapper (prevents rapid re-triggering)
// ---------------------------------------------------------------------------

export class GestureCooldown {
  private lastGesture: Gesture = "none";
  private lastTriggerTime = 0;
  private cooldownMs: number;

  constructor(cooldownMs = 600) {
    this.cooldownMs = cooldownMs;
  }

  /**
   * Returns the gesture only if it's new or the cooldown has elapsed.
   * Otherwise returns "none" to suppress duplicate triggers.
   */
  process(gesture: Gesture): Gesture {
    const now = performance.now();

    if (gesture === this.lastGesture) {
      return "none"; // same gesture held – don't re-trigger
    }

    if (now - this.lastTriggerTime < this.cooldownMs) {
      return "none"; // within cooldown window
    }

    this.lastGesture = gesture;
    this.lastTriggerTime = now;
    return gesture;
  }

  /** Reset state (e.g. when tracking is stopped). */
  reset(): void {
    this.lastGesture = "none";
    this.lastTriggerTime = 0;
  }
}
