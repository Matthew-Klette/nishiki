import { EYE, FINS } from "../lib/body";
import type { Vec } from "../lib/geometry";
import { PIGMENT, patchOutline, type KoiPattern } from "../lib/patterns";
import { add, FAR, fromAngle, perp, smoothThrough, softly, unit } from "./brush";
import { bodyPoint, traceBody, traceSides, type KoiFrame } from "./koiFrame";
import { inkFor, type Ink } from "./koiInk";
import { drawScales } from "./koiScales";
import { drawTailSheet } from "./koiTail";

export { bodyPoint, poseKoi, poseSwimmer, type KoiFrame } from "./koiFrame";

/**
 * Koi drawn as Japanese ink / linocut illustration: a crisp inked outline, flat pigment,
 * crescent scales cut in fine lines, and long flowing fins built from many hair-thin strands.
 */

export interface DrawOptions {
  /** devicePixelRatio of the target canvas: shadow blur is in device pixels. */
  readonly pixelRatio: number;
  readonly shadow?: { readonly dx: number; readonly dy: number; readonly blur: number; readonly alpha: number };
}

/* -------------------------------------------------------------- fins */

/**
 * One butterfly-fin petal: a leaf of fine lines that flare from the root and meet again at a
 * pointed, softly scalloped tip, following a flowing (curving, waving) centre line.
 */
interface PetalSpec {
  readonly root: Vec;
  /** Half-width of the petal where it meets the body. */
  readonly rootHalf: number;
  /** Start direction (radians). */
  readonly angle: number;
  readonly length: number;
  /** Widest half-width, reached around the middle of the petal. */
  readonly width: number;
  /** Extra turn of the centre line at distance t (0..1), for curl and flowing waves. */
  readonly bend: (t: number) => number;
  readonly strands: number;
}

const PETAL_STEPS = 18;

function petalStrands(spec: PetalSpec): Vec[][] {
  const axis: Vec[] = [spec.root];
  const dirs: Vec[] = [];
  let p = spec.root;
  for (let k = 0; k <= PETAL_STEPS; k++) {
    const d = fromAngle(spec.angle + spec.bend(k / PETAL_STEPS));
    dirs.push(d);
    if (k < PETAL_STEPS) {
      p = add(p, d, spec.length / PETAL_STEPS);
      axis.push(p);
    }
  }
  return Array.from({ length: spec.strands }, (_, i) => {
    const s = -1 + (2 * i) / (spec.strands - 1);
    return axis.map((a, k) => {
      const t = k / PETAL_STEPS;
      const edge = Math.abs(s) > 0.99 ? 1 + 0.07 * Math.sin(t * 17 + s * 2) : 1;
      const w = spec.rootHalf * (1 - t) * (1 - t) + spec.width * Math.pow(Math.sin(Math.PI * Math.min(t, 1)), 0.85) * edge;
      return add(a, perp(dirs[k]), s * w);
    });
  });
}

interface PetalPaint {
  readonly lineWidth: number;
  /** Colour the petal starts in at its root (e.g. the body's own pigment), fading to the fin colour. */
  readonly rootColor?: string;
  /** How far up the petal the root colour reaches (0–1). */
  readonly rootReach?: number;
  readonly bars?: boolean;
  /** Leave the root unlined (for the tail, whose root lies over the body), from this step on. */
  readonly openFrom?: number;
}

function drawPetal(ctx: CanvasRenderingContext2D, spec: PetalSpec, ink: Ink, paint: PetalPaint) {
  const strands = petalStrands(spec);
  const left = strands[0];
  const right = strands[strands.length - 1];

  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    smoothThrough(ctx, left);
    smoothThrough(ctx, [...right].reverse());
    ctx.closePath();
  };

  outline();
  if (paint.rootColor) {
    const reach = paint.rootReach ?? 0.3;
    const mid = Math.round(strands.length / 2);
    const end = strands[mid][Math.round(PETAL_STEPS * Math.min(1, reach + 0.25))];
    const g = ctx.createLinearGradient(spec.root.x, spec.root.y, end.x, end.y);
    const span = reach + 0.25;
    g.addColorStop(0, paint.rootColor);
    g.addColorStop(reach / span, paint.rootColor);
    g.addColorStop(1, ink.finFill);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = ink.finFill;
  }
  ctx.fill();

  if (paint.bars) {
    // Taishō Sanke: a soft band of sumi across the pectoral fin, fading in and out along it.
    const tip = strands[Math.floor(strands.length / 2)][PETAL_STEPS];
    const band = ctx.createLinearGradient(spec.root.x, spec.root.y, tip.x, tip.y);
    band.addColorStop(0.18, "rgba(18,14,10,0)");
    band.addColorStop(0.38, "rgba(18,14,10,0.62)");
    band.addColorStop(0.52, "rgba(18,14,10,0.62)");
    band.addColorStop(0.74, "rgba(18,14,10,0)");
    outline();
    ctx.fillStyle = band;
    ctx.fill();
  }

  const startAt = paint.openFrom ?? 2;
  ctx.beginPath();
  for (const line of strands.slice(1, -1)) {
    // Each line starts a little way out, so the root reads as solid and the rays fan from it.
    const from = line.slice(startAt);
    ctx.moveTo(from[0].x, from[0].y);
    smoothThrough(ctx, from);
  }
  ctx.strokeStyle = ink.finLine;
  ctx.lineWidth = paint.lineWidth;
  ctx.lineCap = "round";
  ctx.stroke();


  if (paint.openFrom) {
    // Only the free edge is inked; where the fin grows out of the body there is no line.
    ctx.beginPath();
    const l = left.slice(paint.openFrom);
    const r = [...right.slice(paint.openFrom)].reverse();
    ctx.moveTo(l[0].x, l[0].y);
    smoothThrough(ctx, l);
    smoothThrough(ctx, r);
  } else {
    outline();
  }
  ctx.strokeStyle = ink.line;
  ctx.globalAlpha = 0.72;
  ctx.lineWidth = paint.lineWidth * 1.2;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Pectoral sculling, in radians per second (big butterfly fins row slowly). */
const SCULL = 4.4;
/** How far the paired fins swing back in a fast glide, or out to hover and brake (radians). */
const FOLD = 0.5;
/** How much the fin on the inside of a turn flares, per radian of body bend. */
const TURN_FLARE = 0.35;

/**
 * Paired fins: a cluster of long petals on each side, sweeping back and rippling. They lie back
 * in a fast glide, fan out and scull when the fish hangs still or brakes, and the fin on the
 * inside of a turn flares like a brake while the outer one tucks in.
 */
function drawPairedFins(ctx: CanvasRenderingContext2D, frame: KoiFrame, pattern: KoiPattern, ink: Ink, lineWidth: number) {
  const { length: L, time, flare, turn } = frame;
  const scull = 0.03 + 0.1 * flare;
  const ripple = 0.1 + 0.2 * flare;
  const n = frame.points.length;
  const clusters = [
    // u, reach, petals as [extra splay, length, width]
    { u: FINS.pelvicU, phase: 1.7, splay: 1.25, petals: [[0.3, 0.17, 0.035], [0, 0.22, 0.042]] },
    { u: FINS.pectoralU, phase: 0, splay: 1.05, petals: [[0.36, 0.34, 0.058], [0, 0.44, 0.07]] },
  ] as const;
  for (const cluster of clusters) {
    const i = Math.round(cluster.u * (n - 1));
    const fwd = frame.forward[i];
    for (const side of [-1, 1] as const) {
      const across = { x: frame.normals[i].x * side, y: frame.normals[i].y * side };
      const root = bodyPoint(frame, cluster.u, side * 0.6);
      cluster.petals.forEach(([extra, len, width], k) => {
        const flap = scull * Math.sin(time * SCULL + side * 1.3 + cluster.phase + k * 0.7);
        const a = cluster.splay + extra + flap + FOLD * (0.5 - flare) - side * TURN_FLARE * turn;
        // Rotate from "straight out" toward the tail: positive turns go tailward on the +v side.
        const dir = unit(add({ x: across.x * Math.cos(a), y: across.y * Math.cos(a) }, fwd, -Math.sin(a)));
        drawPetal(
          ctx,
          {
            root,
            rootHalf: 0.018 * L,
            angle: Math.atan2(dir.y, dir.x),
            length: len * L,
            width: width * L,
            bend: (t) => side * (0.5 * t * t + ripple * t * Math.sin(time * SCULL + cluster.phase + k - t * 3.4)),
            strands: 11,
          },
          ink,
          {
            lineWidth,
            rootColor: ink.finRoot?.[0],
            rootReach: ink.finRoot?.[1],
            bars: pattern.fins === "stripes" && k === cluster.petals.length - 1 && cluster.u === FINS.pectoralU,
          },
        );
      });
    }
  }
}

/* -------------------------------------------------------------- body */

const outlineCache = new WeakMap<KoiPattern, { u: number; v: number }[][]>();
function outlinesOf(pattern: KoiPattern) {
  let cached = outlineCache.get(pattern);
  if (!cached) {
    cached = pattern.patches.map((p) => patchOutline(p, 40));
    outlineCache.set(pattern, cached);
  }
  return cached;
}

function drawPatches(ctx: CanvasRenderingContext2D, frame: KoiFrame, pattern: KoiPattern) {
  outlinesOf(pattern).forEach((outline, k) => {
    const pts = outline.map((o) => bodyPoint(frame, o.u, o.v));
    ctx.beginPath();
    const first = { x: (pts[0].x + pts[pts.length - 1].x) / 2, y: (pts[0].y + pts[pts.length - 1].y) / 2 };
    ctx.moveTo(first.x, first.y);
    for (let i = 0; i < pts.length; i++) {
      const next = pts[(i + 1) % pts.length];
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + next.x) / 2, (pts[i].y + next.y) / 2);
    }
    ctx.closePath();
    ctx.fillStyle = PIGMENT[pattern.patches[k].pigment];
    ctx.fill();
  });
}

/** A gentle wash of shade at the flanks, so the flat print still reads as a rounded body. */
function drawWash(ctx: CanvasRenderingContext2D, frame: KoiFrame, pixelRatio: number) {
  const xs = frame.points.map((p) => p.x);
  const ys = frame.points.map((p) => p.y);
  const pad = frame.length;
  softly(ctx, pixelRatio, "rgba(40,18,10,0.32)", frame.length * 0.05, () => {
    ctx.beginPath();
    ctx.rect(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad);
    // Open past the tail root, so the shade runs down the flanks but never across the peduncle.
    traceBody(ctx, frame, 0.3);
    ctx.fill("evenodd");
  });
}

function drawHead(ctx: CanvasRenderingContext2D, frame: KoiFrame, ink: Ink, lineWidth: number) {
  const { length: L, forward, normals, time } = frame;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Gill covers: a curved line on each side of the head.
  ctx.beginPath();
  for (const side of [-1, 1]) {
    const a = bodyPoint(frame, 0.205, side * 0.98);
    const b = bodyPoint(frame, 0.175, side * 0.55);
    const c = bodyPoint(frame, 0.15, side * 0.2);
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(b.x, b.y, c.x, c.y);
  }
  ctx.strokeStyle = ink.line;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Nostrils: two small comma strokes.
  ctx.beginPath();
  for (const side of [-1, 1]) {
    const p = bodyPoint(frame, 0.032, side * 0.34);
    const q = add(p, forward[0], -L * 0.008);
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
  }
  ctx.lineWidth = lineWidth * 1.4;
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Eyes: a pale ring, a dark pupil and a glint.
  for (const side of [-1, 1]) {
    const e = bodyPoint(frame, EYE.u, side * EYE.v);
    ctx.beginPath();
    ctx.arc(e.x, e.y, L * 0.0125, 0, Math.PI * 2);
    ctx.fillStyle = "#efe6d6";
    ctx.fill();
    ctx.strokeStyle = ink.line;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(e.x, e.y, L * 0.0092, 0, Math.PI * 2);
    ctx.fillStyle = "#140d08";
    ctx.fill();
    const g = add(add(e, forward[0], L * 0.004), normals[0], side * L * 0.003);
    ctx.beginPath();
    ctx.arc(g.x, g.y, Math.max(lineWidth, L * 0.0028), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fill();
  }

  // Barbels: long whiskers that drift with the water.
  ctx.beginPath();
  for (const side of [-1, 1]) {
    const root = bodyPoint(frame, -0.02, side * 0.5);
    const out = { x: normals[0].x * side, y: normals[0].y * side };
    const drift = Math.sin(time * 1.6 + side) * 0.02 * L;
    const c1 = add(add(root, forward[0], L * 0.035), out, L * 0.02);
    const c2 = add(add(root, forward[0], L * 0.04), out, L * 0.07 + drift);
    const tip = add(add(root, forward[0], L * 0.012), out, L * 0.1 + drift);
    ctx.moveTo(root.x, root.y);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, tip.x, tip.y);
  }
  ctx.strokeStyle = ink.line;
  ctx.lineWidth = lineWidth * 1.15;
  ctx.globalAlpha = 0.8;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Seen from above, the dorsal fin is a fine line down the back. */
function drawSpine(ctx: CanvasRenderingContext2D, frame: KoiFrame, ink: Ink, lineWidth: number) {
  const n = frame.points.length;
  const ridge = frame.points.slice(Math.round(0.22 * (n - 1)), Math.round(0.86 * (n - 1)));
  ctx.beginPath();
  ctx.moveTo(ridge[0].x, ridge[0].y);
  smoothThrough(ctx, ridge);
  ctx.strokeStyle = ink.line;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Soft drop shadow of the body only, cast onto whatever is underneath. */
export function drawKoiShadow(ctx: CanvasRenderingContext2D, frame: KoiFrame, opts: Required<DrawOptions>["shadow"], pixelRatio: number) {
  ctx.save();
  ctx.translate(-FAR, 0);
  ctx.shadowColor = `rgba(20,4,2,${opts.alpha})`;
  ctx.shadowBlur = opts.blur * pixelRatio;
  ctx.shadowOffsetX = (FAR + opts.dx) * pixelRatio;
  ctx.shadowOffsetY = opts.dy * pixelRatio;
  ctx.beginPath();
  traceBody(ctx, frame);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();
}

export function drawKoi(ctx: CanvasRenderingContext2D, frame: KoiFrame, pattern: KoiPattern, opts: DrawOptions) {
  const ink = inkFor(pattern);
  // Line weight scales with the fish but never drops below one device pixel.
  const lineWidth = Math.max(1 / opts.pixelRatio, Math.min(3, frame.length * 0.0024));
  if (opts.shadow) drawKoiShadow(ctx, frame, opts.shadow, opts.pixelRatio);
  ctx.save();
  ctx.lineJoin = "round";
  drawPairedFins(ctx, frame, pattern, ink, lineWidth);

  ctx.beginPath();
  traceBody(ctx, frame);
  ctx.fillStyle = PIGMENT[pattern.base];
  ctx.fill();
  ctx.save();
  ctx.clip();
  drawPatches(ctx, frame, pattern);
  drawScales(ctx, frame, pattern, ink, lineWidth);
  drawWash(ctx, frame, opts.pixelRatio);
  drawSpine(ctx, frame, ink, lineWidth);
  ctx.restore();

  ctx.beginPath();
  traceSides(ctx, frame);
  ctx.strokeStyle = ink.line;
  ctx.lineWidth = lineWidth * 1.5;
  ctx.stroke();

  // Laid over the body's end: it starts clear, so the peduncle flows straight into the fin.
  drawTailSheet(ctx, frame, pattern, ink, lineWidth, opts.pixelRatio);

  drawHead(ctx, frame, ink, lineWidth);
  ctx.restore();
}
