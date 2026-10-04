import { halfWidth } from "../lib/body";
import { WAVE_NUMBER } from "../lib/locomotion";
import { PIGMENT, type KoiPattern } from "../lib/patterns";
import type { Vec } from "../lib/geometry";
import { add, fromAngle, smoothThrough, softly, unit, withAlpha } from "./brush";
import { bodyPoint, type KoiFrame } from "./koiFrame";
import type { Ink } from "./koiInk";

/* -------------------------------------------------------------- tail */

/** Where the tail membrane starts, inside the peduncle (body coordinates). */
export const TAIL_ROOT_U = 0.9;
/** Root to the tips of the lobes, in body lengths. */
export const TAIL_LENGTH = 0.62;
/** Widest half-width of the spread tail, in body lengths. */
export const TAIL_SPAN = 0.24;
/** How deep the fork's notch cuts back into the fin, as a fraction of its length. */
const TAIL_FORK = 0.18;
/** Where across the fin each lobe comes to its point. */
const LOBE_TIP = 0.82;
const TAIL_STEPS = 48;

const smoothstep = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

export interface TailSheet {
  /** A point on the fin: t runs 0 (root, inside the peduncle) → 1 (lobe tips), s runs -1 → 1 across. */
  readonly point: (t: number, s: number) => Vec;
  /** Where the trailing edge sits for the ray at s. */
  readonly tEnd: (s: number) => number;
  /** The t at which the body ends and the fin is on its own. */
  readonly bodyEnd: number;
}

/**
 * The tail as one continuous membrane. Up to the end of the body it *is* the body: its centre
 * and edges are the body's own, so the silhouette cannot kink. Past that it carries on along a
 * flowing centre line and widens with an S-curve (no corners), then ends in a gently forked,
 * rippling trailing edge.
 */
export function tailSheet(frame: KoiFrame): TailSheet {
  const L = frame.length;
  const len = TAIL_LENGTH * L;
  const bodyEnd = ((1 - TAIL_ROOT_U) * L) / len;
  const hwEnd = halfWidth(1) * L;
  const extra = TAIL_SPAN * L - hwEnd;
  const { beat } = frame;
  // The fin carries the body wave on (a little further behind in phase) and flexes hardest while
  // the fish strokes; in a glide it trails, with only a slow ripple left in the membrane.
  const flex = 0.25 + 0.75 * frame.drive;
  const lag = beat - WAVE_NUMBER;

  const centers: Vec[] = [];
  const normals: Vec[] = [];
  const halves: number[] = [];
  const progress: number[] = [];
  let prev = bodyPoint(frame, 1, 0);
  const endFwd = frame.forward[frame.forward.length - 1];
  const back = Math.atan2(-endFwd.y, -endFwd.x);
  for (let k = 0; k <= TAIL_STEPS; k++) {
    const t = k / TAIL_STEPS;
    // The flare starts a little before the body ends, so the waist rolls smoothly into the spread.
    const flare = extra * smoothstep((t - 0.7 * bodyEnd) / 0.62);
    if (t <= bodyEnd) {
      const u = TAIL_ROOT_U + (t * len) / L;
      const c = bodyPoint(frame, u, 0);
      const edge = bodyPoint(frame, u, 1);
      centers.push(c);
      normals.push(unit({ x: edge.x - c.x, y: edge.y - c.y }));
      halves.push(halfWidth(u) * L + flare);
      progress.push(0);
    } else {
      const p = (t - bodyEnd) / (1 - bodyEnd);
      const angle = back + flex * p * (0.16 * Math.sin(lag - 0.5) + 0.3 * Math.sin(lag - 1 - p * 3));
      const dir = fromAngle(angle);
      // The first free point continues from the body's end; later ones step along the flowing line.
      const firstFree = progress[progress.length - 1] === 0;
      prev = firstFree ? add(bodyPoint(frame, 1, 0), dir, (t - bodyEnd) * len) : add(prev, dir, len / TAIL_STEPS);
      centers.push(prev);
      // perp(-forward) points to -v, so flip it to keep s = +1 on the body's +v flank.
      normals.push({ x: dir.y, y: -dir.x });
      halves.push(hwEnd + flare);
      progress.push(p);
    }
  }

  const sample = <T,>(arr: readonly T[], t: number, mix: (a: T, b: T, f: number) => T): T => {
    const f = Math.min(1, Math.max(0, t)) * TAIL_STEPS;
    const i = Math.min(TAIL_STEPS - 1, Math.floor(f));
    return mix(arr[i], arr[i + 1], f - i);
  };
  const mixVec = (a: Vec, b: Vec, f: number): Vec => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  const mixNum = (a: number, b: number, f: number) => a + (b - a) * f;

  return {
    bodyEnd,
    // A wide V between two lobes whose longest rays sit near the outside, so the tips taper.
    tEnd: (s) => {
      // Each lobe peaks at a cusp near the outside (|s| = LOBE_TIP) and falls away on both sides,
      // steeply toward the outer edge, so the tips come to a point instead of a rounded end.
      const d = Math.abs(s) - LOBE_TIP;
      const fall = (d < 0 ? 0.4 : 2.6) * Math.pow(Math.abs(d), 1.35);
      return 1 - TAIL_FORK * Math.exp(-(s * s) / 0.12) - fall + 0.008 * Math.sin(s * 19 + beat * 0.6);
    },
    point: (t, s) => {
      const c = sample(centers, t, mixVec);
      const n = unit(sample(normals, t, mixVec));
      const p = sample(progress, t, mixNum);
      // The long trailing membrane ripples as it trails behind.
      const ripple = (0.4 + 0.6 * frame.drive) * 0.022 * L * p * p * Math.sin(beat * 1.15 - p * 6 + s * 2.6);
      return add(c, n, s * sample(halves, t, mixNum) + ripple);
    },
  };
}

export function drawTailSheet(ctx: CanvasRenderingContext2D, frame: KoiFrame, pattern: KoiPattern, ink: Ink, lineWidth: number, pixelRatio: number) {
  const L = frame.length;
  const sheet = tailSheet(frame);
  const { bodyEnd } = sheet;
  const ray = (s: number, from: number, to: number, steps = 26) =>
    Array.from({ length: steps + 1 }, (_, i) => sheet.point(from + ((to - from) * i) / steps, s));
  const leftEdge = ray(-1, 0, sheet.tEnd(-1));
  const rightEdge = ray(1, 0, sheet.tEnd(1));
  const trailing = Array.from({ length: 61 }, (_, i) => {
    const s = -1 + (2 * i) / 60;
    return sheet.point(sheet.tEnd(s), s);
  });

  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(leftEdge[0].x, leftEdge[0].y);
    smoothThrough(ctx, leftEdge);
    smoothThrough(ctx, trailing);
    smoothThrough(ctx, [...rightEdge].reverse());
    ctx.closePath();
  };

  // Fill: clear over the body (so its scales show), then the body's own colour, fully opaque,
  // carried well past the tail root so no shadow or backdrop shows through where the fin begins;
  // only then does it soften into the translucent fin.
  const from = sheet.point(0, 0);
  const span = bodyEnd + 0.34;
  const to = sheet.point(span, 0);
  const body = PIGMENT[pattern.base];
  const fill = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  fill.addColorStop(0, withAlpha(body, 0));
  fill.addColorStop((0.55 * bodyEnd) / span, body);
  fill.addColorStop((bodyEnd + 0.08) / span, body);
  fill.addColorStop(1, ink.finFill);
  outline();
  ctx.fillStyle = fill;
  ctx.fill();

  // Soft folds give the long membrane the layered look of butterfly fins, without separate pieces.
  ctx.save();
  outline();
  ctx.clip();
  ctx.beginPath();
  for (const s of [-0.62, -0.22, 0.22, 0.62]) {
    const fold = ray(s, bodyEnd + 0.06, sheet.tEnd(s));
    ctx.moveTo(fold[0].x, fold[0].y);
    smoothThrough(ctx, fold);
  }
  ctx.strokeStyle = "rgba(40,18,10,0.07)";
  ctx.lineWidth = L * 0.02;
  ctx.lineCap = "round";
  ctx.stroke();

  // Rays fan from the root and fade in as the fin leaves the body.
  const rayStart = bodyEnd * 0.8;
  const a = sheet.point(rayStart, 0);
  const b = sheet.point(bodyEnd + 0.14, 0);
  const fadeIn = (color: string) => {
    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    g.addColorStop(0, color.replace(/[\d.]+\)$/, "0)"));
    g.addColorStop(1, color);
    return g;
  };
  const rays = 27;
  const fine = new Path2D();
  const bold = new Path2D();
  for (let i = 0; i < rays; i++) {
    const s = -0.96 + (1.92 * i) / (rays - 1);
    const line = ray(s, rayStart, sheet.tEnd(s) - 0.006, 22);
    const path = i % 5 === 2 ? bold : fine;
    path.moveTo(line[0].x, line[0].y);
    for (let k = 1; k < line.length - 1; k++) {
      const mid = { x: (line[k].x + line[k + 1].x) / 2, y: (line[k].y + line[k + 1].y) / 2 };
      path.quadraticCurveTo(line[k].x, line[k].y, mid.x, mid.y);
    }
    path.lineTo(line[line.length - 1].x, line[line.length - 1].y);
  }
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = fadeIn(ink.finLine);
  ctx.stroke(fine);
  ctx.lineWidth = lineWidth * 1.35;
  ctx.stroke(bold);

  // The same soft shade the body has at its flanks, so the form carries on into the fin.
  softly(ctx, pixelRatio, "rgba(40,18,10,0.24)", L * 0.035, () => {
    ctx.beginPath();
    ctx.rect(from.x - L * 2, from.y - L * 2, L * 4, L * 4);
    ctx.moveTo(leftEdge[0].x, leftEdge[0].y);
    smoothThrough(ctx, leftEdge);
    smoothThrough(ctx, trailing);
    smoothThrough(ctx, [...rightEdge].reverse());
    ctx.closePath();
    ctx.fill("evenodd");
  });
  ctx.restore();

  // The body's outline simply carries on along both edges of the fin; the trailing edge is lighter.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (const edge of [leftEdge, rightEdge]) {
    ctx.moveTo(edge[0].x, edge[0].y);
    smoothThrough(ctx, edge);
  }
  ctx.strokeStyle = ink.line;
  ctx.lineWidth = lineWidth * 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(trailing[0].x, trailing[0].y);
  smoothThrough(ctx, trailing);
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = lineWidth * 1.2;
  ctx.stroke();
  ctx.globalAlpha = 1;
}
