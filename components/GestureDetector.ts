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

export type Gesture = "open_palm" | "closed_fist" | "index_up" | "middle_finger" | "thumbs_up" | "shadow_clone" | "none";

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

  // --- Middle finger: only middle finger extended ---
  if (middle && !index && !ring && !pinky) {
    return "middle_finger";
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
// Two-hand gesture detection
// ---------------------------------------------------------------------------

/**
 * Check if a hand is in a "finger blade" pose — index and middle fingers
 * held together pointing outward, with the remaining fingers curled.
 *
 * Because the shadow-clone cross is viewed from the side profile, we can't
 * rely on individual finger-extension checks (they assume the palm faces
 * the camera). Instead we check:
 *  1. The index+middle fingertips are close together (held as one blade).
 *  2. The blade has meaningful length (tips are away from the knuckles).
 *  3. Ring and pinky tips are closer to the wrist than the index/middle tips
 *     (i.e. they're curled back, not extended).
 */
function isFingerBladePose(landmarks: Landmark[]): boolean {
  if (landmarks.length < 21) return false;

  const wrist = landmarks[0];
  const indexMcp = landmarks[5];
  const indexTip = landmarks[8];
  const middleMcp = landmarks[9];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];

  // Index and middle tips should be close together (held as one blade)
  const tipGap = dist(indexTip, middleTip);
  if (tipGap > 0.08) return false;

  // The blade midpoint (average of index+middle tips)
  const bladeTip: Landmark = {
    x: (indexTip.x + middleTip.x) / 2,
    y: (indexTip.y + middleTip.y) / 2,
    z: 0,
  };
  const bladeBase: Landmark = {
    x: (indexMcp.x + middleMcp.x) / 2,
    y: (indexMcp.y + middleMcp.y) / 2,
    z: 0,
  };

  // Blade should have real length (tips away from base)
  const bladeLen = dist(bladeTip, bladeBase);
  if (bladeLen < 0.05) return false;

  // Ring and pinky should be shorter (closer to wrist) than the blade tip
  const bladeTipDist = dist(bladeTip, wrist);
  const ringDist = dist(ringTip, wrist);
  const pinkyDist = dist(pinkyTip, wrist);

  // At least one of ring/pinky should be noticeably shorter than the blade.
  // Using a generous ratio since from the side the curled fingers may still
  // appear somewhat extended.
  if (ringDist > bladeTipDist * 0.95 && pinkyDist > bladeTipDist * 0.95) {
    return false;
  }

  return true;
}

/**
 * Detect the shadow-clone cross gesture (Naruto-style cross sign).
 *
 * Each hand forms a "finger blade" (index + middle held together, viewed
 * from the side so they appear as a single finger). The two blades cross
 * each other to form a "+" shape.
 *
 * Detection:
 *  1. Both hands are in finger-blade pose.
 *  2. Model each blade as a line segment from MCP-base to fingertip.
 *  3. The two segments either intersect or are very close to each other.
 *  4. The blades are roughly perpendicular (angle between ~30° and ~150°).
 *
 * Returns "shadow_clone" if detected, otherwise "none".
 */
export function detectTwoHandGesture(allLandmarks: Landmark[][]): Gesture {
  if (allLandmarks.length < 2) return "none";

  const hand1 = allLandmarks[0];
  const hand2 = allLandmarks[1];

  if (!isFingerBladePose(hand1) || !isFingerBladePose(hand2)) return "none";

  // Build blade segments: base (avg of index+middle MCP) → tip (avg of index+middle tip)
  const h1Base = midpoint(hand1[5], hand1[9]);
  const h1Tip = midpoint(hand1[8], hand1[12]);
  const h2Base = midpoint(hand2[5], hand2[9]);
  const h2Tip = midpoint(hand2[8], hand2[12]);

  // The blade tips / crossing area should be in proximity
  const crossCenter = midpoint(h1Tip, h2Tip);
  const proximityThreshold = 0.22;
  if (
    dist(h1Tip, crossCenter) > proximityThreshold ||
    dist(h2Tip, crossCenter) > proximityThreshold
  ) {
    return "none";
  }

  // Check angle between the two blade directions — should be roughly
  // perpendicular (cross sign is a "+"). Allow 30°–150° range.
  const angle = angleBetweenSegments(h1Base, h1Tip, h2Base, h2Tip);
  if (angle < 30 || angle > 150) return "none";

  // Check if the segments actually intersect or are very close
  if (segmentsIntersect(h1Base, h1Tip, h2Base, h2Tip)) {
    return "shadow_clone";
  }

  if (segmentMinDist(h1Base, h1Tip, h2Base, h2Tip) < 0.05) {
    return "shadow_clone";
  }

  return "none";
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Midpoint of two landmarks (2D). */
function midpoint(a: Landmark, b: Landmark): Landmark {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: 0 };
}

/** Angle in degrees between two line segments (0–180). */
function angleBetweenSegments(
  a1: Landmark, a2: Landmark,
  b1: Landmark, b2: Landmark,
): number {
  const dx1 = a2.x - a1.x;
  const dy1 = a2.y - a1.y;
  const dx2 = b2.x - b1.x;
  const dy2 = b2.y - b1.y;

  const dot = dx1 * dx2 + dy1 * dy2;
  const mag1 = Math.hypot(dx1, dy1);
  const mag2 = Math.hypot(dx2, dy2);

  if (mag1 === 0 || mag2 === 0) return 0;

  const cosAngle = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return Math.acos(cosAngle) * (180 / Math.PI);
}

/** 2D cross product of vectors (b-a) and (c-a). */
function cross2d(a: Landmark, b: Landmark, c: Landmark): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** True if 2D segments AB and CD intersect. */
function segmentsIntersect(
  a: Landmark, b: Landmark,
  c: Landmark, d: Landmark,
): boolean {
  const d1 = cross2d(c, d, a);
  const d2 = cross2d(c, d, b);
  const d3 = cross2d(a, b, c);
  const d4 = cross2d(a, b, d);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  return false;
}

/** Minimum distance between segments AB and CD (2D). */
function segmentMinDist(
  a: Landmark, b: Landmark,
  c: Landmark, d: Landmark,
): number {
  return Math.min(
    pointSegmentDist(a, c, d),
    pointSegmentDist(b, c, d),
    pointSegmentDist(c, a, b),
    pointSegmentDist(d, a, b),
  );
}

/** Distance from point P to segment AB (2D). */
function pointSegmentDist(p: Landmark, a: Landmark, b: Landmark): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return dist(p, a);

  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const proj: Landmark = { x: a.x + t * abx, y: a.y + t * aby, z: 0 };
  return dist(p, proj);
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
