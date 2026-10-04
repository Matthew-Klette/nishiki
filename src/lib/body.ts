/**
 * Koi body proportions, seen from above. `u` runs 0 (snout) → 1 (tail root),
 * `v` runs -1 → 1 across the back (left flank → right flank).
 */

/** Number of spine points the renderer bends. */
export const SPINE_POINTS = 24;

/** Widest half-width as a fraction of body length. A well-fed koi is broad behind the head. */
export const MAX_HALF_WIDTH = 0.118;

const profile = (u: number) => Math.pow(u + 0.02, 0.42) * (1.17 - u);

// The profile peaks where its log-derivative is zero: 0.42/(u+0.02) = 1/(1.17-u).
const PEAK_U = (0.42 * 1.17 - 0.02) / 1.42;
const PEAK = profile(PEAK_U);

/** Half-width at `u`, as a fraction of body length. */
export function halfWidth(u: number): number {
  const clamped = Math.min(1, Math.max(0, u));
  return (MAX_HALF_WIDTH * profile(clamped)) / PEAK;
}

/** Where the widest point sits, used by tests and by the fin placement. */
export const WIDEST_U = PEAK_U;

/** Fin anchors along the body. */
export const FINS = {
  pectoralU: 0.2,
  pelvicU: 0.56,
  dorsalStartU: 0.3,
  dorsalEndU: 0.66,
} as const;

/** Eyes sit just behind the snout, near the edge of the head. */
export const EYE = { u: 0.075, v: 0.74 } as const;
