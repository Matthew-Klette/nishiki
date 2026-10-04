import { SPINE_POINTS } from "../lib/body";
import type { KoiPattern } from "../lib/patterns";
import { drawKoi } from "./koi";
import { poseKoi, type Pose } from "./koiFrame";

/**
 * How far a drawn koi reaches around a straight spine, in body lengths: ahead of the snout
 * (barbels), behind it (to the tail tips) and out to either side (fins), shadow included.
 */
export interface KoiExtent {
  readonly ahead: number;
  readonly behind: number;
  readonly side: number;
}

/** Used if a canvas can't be read: generous enough for any fin style. */
const FALLBACK: KoiExtent = { ahead: 0.16, behind: 1.66, side: 0.5 };
const PROBE_LENGTH = 200;
const cache = new WeakMap<KoiPattern, Map<string, KoiExtent>>();

/** A drop shadow with its offset and blur in body lengths. */
export interface ShadowSpec {
  readonly dx: number;
  readonly dy: number;
  readonly blur: number;
  readonly alpha: number;
}

/** The shadow scaled to a fish `length` pixels long, for drawKoi. */
export const shadowAt = (shadow: ShadowSpec, length: number) => ({
  dx: shadow.dx * length,
  dy: shadow.dy * length,
  blur: shadow.blur * length,
  alpha: shadow.alpha,
});

/**
 * Measures the koi by drawing it offscreen through a full tail beat and a fin stroke and reading
 * back the pixels, so a plate can fit the real drawing instead of a guessed span. Cached per pattern and pose.
 */
export function koiExtent(pattern: KoiPattern, pose: Omit<Pose, "beat" | "time">, shadow: ShadowSpec): KoiExtent {
  const key = JSON.stringify([pose, shadow]);
  const byPose = cache.get(pattern) ?? new Map<string, KoiExtent>();
  cache.set(pattern, byPose);
  const cached = byPose.get(key);
  if (cached) return cached;
  const L = PROBE_LENGTH;
  const canvas = document.createElement("canvas");
  canvas.width = L * 3;
  canvas.height = L * 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return FALLBACK;
  const x0 = L * 0.5;
  const y0 = L;
  const spine = Array.from({ length: SPINE_POINTS }, (_, i) => ({ x: x0 + (i / (SPINE_POINTS - 1)) * L, y: y0 }));
  for (const beat of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    for (const time of [0, 0.4, 0.8, 1.2]) drawKoi(ctx, poseKoi(spine, L, { ...pose, beat, time }), pattern, { pixelRatio: 1, shadow: shadowAt(shadow, L) });
  }
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] < 8) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX <= minX) return FALLBACK;
  const extent = { ahead: (x0 - minX) / L, behind: (maxX - x0) / L, side: Math.max(y0 - minY, maxY - y0) / L };
  byPose.set(key, extent);
  return extent;
}
