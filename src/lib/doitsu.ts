import { halfWidth } from "./body";
import type { Vec } from "./geometry";

/**
 * Doitsu (mirror) scales of a show-quality Shūsui seen from above, in body coordinates.
 * Front to back: a symmetric block over the shoulders, one row either side of the folded dorsal
 * fin (the "zipper"), and a single file once the rows close behind the fin. Plates are crosswise
 * ovals sized to the local body width, so they shrink toward the tail and bend with the fish.
 */

export interface MirrorScale {
  readonly u: number;
  /** Across the back, as a fraction of the local half-width (see body.ts). */
  readonly v: number;
  /** Width across the body and length along it, in body lengths. */
  readonly w: number;
  readonly l: number;
  /** Turn of the long axis in radians: positive sweeps the +v end back toward the tail. */
  readonly tilt: number;
}

/** Where each part of the layout sits along the body (u). */
export const DOITSU_ZONES = {
  /** Front edge of the shoulder block. */
  shoulder: 0.27,
  /** The dorsal fin starts here and the block parts into two rows. */
  fin: 0.44,
  /** The rows start closing in as the fin base narrows. */
  closing: 0.6,
  /** The rows meet behind the fin and carry on as one file. */
  merge: 0.855,
  /** No plate reaches past this: the tail membrane covers the body from about 0.955. */
  end: 0.935,
} as const;

/** Slate plates with a paler margin and a fine light rim on the free edge; the fin is translucent cream. */
export const PLATE_TONES = {
  core: "#26334a",
  body: "#34455f",
  margin: "#7f9bb5",
  rim: "#c5d3e0",
  fin: "rgba(236,228,216,0.55)",
} as const;

/**
 * A plate is painted as stacked ovals: the pale margin, a slate body set toward the head so the
 * margin shows mostly along the free rear edge, then a darker core. `across` and `along` scale the
 * plate's width and length; `shift` moves the oval toward the head, in plate lengths.
 */
export const PLATE_LAYERS = [
  { tone: PLATE_TONES.margin, across: 1, along: 1, shift: 0 },
  { tone: PLATE_TONES.body, across: 0.9, along: 0.78, shift: 0.1 },
  { tone: PLATE_TONES.core, across: 0.55, along: 0.45, shift: 0.18 },
] as const;

/** Plate widths as fractions of the local half-width: largest over the shoulders. */
const SHOULDER_WIDTH = 0.3;
const ROW_WIDTH = 0.28;
/** Length over width: plates are crosswise ovals. */
const ASPECT = 0.78;
/** Rank spacing as a fraction of plate length; below 1, so plates overlap like shingles. */
const PITCH = 0.84;
/** Centre of the side columns and fin rows (v), and where the rows have closed to at the merge. */
const ROW_V = 0.26;
const MERGED_ROW_V = 0.155;
/** Herringbone: outer ends swept back. */
const SHOULDER_TILT = 0.15;
const ROW_TILT = 0.3;
/** The folded dorsal fin: where it lies, and its widest half-width in body lengths. */
const BLADE_FROM = 0.435;
const BLADE_TO = 0.82;
const BLADE_HALF = 0.0075;

const smoothstep = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

function plate(u: number, v: number, width: number, tilt: number): MirrorScale {
  const w = width * halfWidth(u);
  return { u, v, w, l: w * ASPECT, tilt };
}

const pairAt = (u: number, v: number, width: number, tilt: number) => [plate(u, -v, width, -tilt), plate(u, v, width, tilt)];

/** Centre of each fin row (v): steady along the fin, then easing in to meet behind it. */
function rowOffset(u: number): number {
  const { closing, merge } = DOITSU_ZONES;
  return ROW_V - (ROW_V - MERGED_ROW_V) * smoothstep((u - closing) / (merge - closing));
}

/** One rank of plates at `u`: the shoulder block's side columns, the two fin rows, or the single file. */
function rankAt(u: number): MirrorScale[] {
  if (u < DOITSU_ZONES.fin) return pairAt(u, ROW_V, SHOULDER_WIDTH, SHOULDER_TILT);
  if (u < DOITSU_ZONES.merge) return pairAt(u, rowOffset(u), ROW_WIDTH, ROW_TILT);
  return [plate(u, 0, ROW_WIDTH, 0)];
}

/** Every plate, front to back. Mirror-symmetric, with no plate on the midline beside the fin. */
export function shusuiScaleLayout(): readonly MirrorScale[] {
  const { shoulder, fin, end } = DOITSU_ZONES;
  const lead = plate(shoulder, 0, SHOULDER_WIDTH, 0).l;
  const scales: MirrorScale[] = [];
  // A centre column sits half a step ahead of each shoulder rank, so the block interlocks and
  // its front edge comes to a rounded point; it stops where the dorsal fin begins.
  for (let u = shoulder + (lead * (1 + PITCH)) / 2; ; ) {
    const rank = rankAt(u);
    const { l } = rank[0];
    if (u + l / 2 > end) break;
    if (u < fin) scales.push(plate(u - (PITCH * l) / 2, 0, SHOULDER_WIDTH, 0));
    scales.push(...rank);
    u += PITCH * l;
  }
  return scales.toSorted((a, b) => a.u - b.u);
}

/** Half-width of the folded dorsal fin at `u` (v units): widest near its front, tapering to a point. */
export function bladeHalfWidth(u: number): number {
  const t = (u - BLADE_FROM) / (BLADE_TO - BLADE_FROM);
  if (t <= 0 || t >= 1) return 0;
  const half = BLADE_HALF * Math.sin((Math.PI / 2) * Math.min(1, t / 0.12)) * (1 - t);
  return half / halfWidth(u);
}

/** The folded dorsal fin as a closed (u, v) outline: down the +v side, back up the -v side. */
export function dorsalBladeOutline(steps = 28): { u: number; v: number }[] {
  const side = Array.from({ length: steps + 1 }, (_, i) => {
    const u = BLADE_FROM + ((BLADE_TO - BLADE_FROM) * i) / steps;
    return { u, v: bladeHalfWidth(u) };
  });
  return [...side, ...side.toReversed().map((p) => ({ u: p.u, v: -p.v }))];
}

/**
 * A plate's orientation on the canvas, from the head-ward direction where it sits: the rotation
 * of its long axis (for `ctx.ellipse`) and the unit vector toward the head along its short axis.
 */
export function plateAxes(forward: Vec, tilt: number): { readonly rotation: number; readonly headward: Vec } {
  const across = { x: -forward.y, y: forward.x }; // toward +v
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const axis = { x: across.x * cos - forward.x * sin, y: across.y * cos - forward.y * sin };
  return {
    rotation: Math.atan2(axis.y, axis.x),
    headward: { x: forward.x * cos + across.x * sin, y: forward.y * cos + across.y * sin },
  };
}
