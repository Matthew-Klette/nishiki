/**
 * How a koi swims, seen from above. Carp are subcarangiform swimmers: the head barely moves,
 * the side-to-side wave grows toward the tail and runs backward faster than the fish moves
 * forward, and koi beat the tail a few times and then glide. A snake is the opposite: every
 * point follows the head's path and the wave stands still on the ground.
 * Sources and ranges: docs/koi-motion.md.
 */

/**
 * The body (snout to tail root) as a share of the whole fish to the tip of a real koi's tail.
 * Published envelopes and wavelengths are measured on the whole fish, so they map through this.
 */
const BODY_SHARE = 0.82;

/**
 * Peak-to-peak sway along the whole fish, pooled over 44 species (Di Santo et al. 2021):
 * a small recoil at the snout, a quiet point about a quarter of the way back, growth to the tail.
 */
const SWAY_C0 = 0.05;
const SWAY_C1 = -0.13;
const SWAY_C2 = 0.28;
const envelopeAt = (x: number) => SWAY_C0 + SWAY_C1 * x + SWAY_C2 * x * x;
const ENVELOPE_END = envelopeAt(BODY_SHARE);

/** Where the sway is smallest (the envelope's minimum); the fish also yaws about this point. */
export const PIVOT_U = -SWAY_C1 / (2 * SWAY_C2) / BODY_SHARE;

/** One wave per 0.93 fish lengths (subcarangiform median), in radians per body length. */
export const WAVE_NUMBER = ((Math.PI * 2) / 0.93) * BODY_SHARE;

/** Body lengths travelled per tail beat while stroking steadily (about 0.7 fish lengths). */
export const STRIDE = 0.7 / BODY_SHARE;

/** Half-amplitude of the sway at the tail root at full speed, in body lengths (tail tip ≈ 0.1 fish lengths). */
export const TAIL_AMPLITUDE = (0.5 * ENVELOPE_END) / BODY_SHARE;

/** Lateral amplitude along the body, 1 at the tail root. */
export function waveEnvelope(u: number): number {
  return envelopeAt(Math.min(1, Math.max(0, u)) * BODY_SHARE) / ENVELOPE_END;
}

/**
 * How a turn is shared along the body: 0 at the snout, 1 at the tail root. Koi hold the front of
 * the body nearly straight (it sets the heading) and bend the rest into an even arc: no bend at all
 * up to RIGID_UNTIL, curvature easing in over the next EASE, then constant to the tail.
 */
const RIGID_UNTIL = 0.12;
const EASE = 0.2;
const curvatureArea = (u: number) => {
  if (u <= RIGID_UNTIL) return 0;
  const x = (u - RIGID_UNTIL) / EASE;
  // ∫ smoothstep = x³ − x⁴/2 across the ease, then a constant curvature.
  return x < 1 ? EASE * (x * x * x - (x * x * x * x) / 2) : EASE / 2 + (u - RIGID_UNTIL - EASE);
};
const TOTAL_CURVATURE = curvatureArea(1);

export function bendShare(u: number): number {
  return curvatureArea(Math.min(1, Math.max(0, u))) / TOTAL_CURVATURE;
}
