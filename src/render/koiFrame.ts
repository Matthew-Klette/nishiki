import { halfWidth } from "../lib/body";
import type { Vec } from "../lib/geometry";
import { WAVE_NUMBER, waveEnvelope } from "../lib/locomotion";
import { motionOf, spineOf, type SwimParams, type Swimmer } from "../lib/swim";
import { add, perp, smoothThrough, unit } from "./brush";

/** A posed fish, ready to draw: spine points with the swimming wave already applied. */
export interface KoiFrame {
  readonly length: number;
  readonly points: readonly Vec[];
  /** Unit normals pointing to the fish's +v flank. */
  readonly normals: readonly Vec[];
  /** Unit vectors pointing toward the head. */
  readonly forward: readonly Vec[];
  /** Tail-beat phase in radians. */
  readonly beat: number;
  /** Seconds, for fin sculling. */
  readonly time: number;
  /** 0 while gliding (tail trailing), 1 at a full stroke. */
  readonly drive: number;
  /** The body's C-bend in radians; positive turns toward the +v flank. */
  readonly turn: number;
  /** 0 = paired fins folded back, 1 = flared out to hover or brake. */
  readonly flare: number;
}

/** How to pose a midline: where the stroke is and how hard the fish is swimming. */
export interface Pose {
  /** Tail-beat phase in radians. */
  readonly beat: number;
  /** Seconds, for fin sculling. */
  readonly time: number;
  /** Half-amplitude of the sway at the tail root, in body lengths, at a full stroke. */
  readonly amplitude: number;
  readonly drive?: number;
  readonly turn?: number;
  readonly flare?: number;
}

function tangents(points: readonly Vec[]): Vec[] {
  return points.map((_, i) => {
    const ahead = points[Math.max(0, i - 1)];
    const behind = points[Math.min(points.length - 1, i + 1)];
    return unit({ x: ahead.x - behind.x, y: ahead.y - behind.y });
  });
}

/**
 * Lays the travelling body wave over a midline: a little recoil at the snout, quiet a quarter of
 * the way back, sweeping widest at the tail, and running tailward faster than the fish swims.
 */
export function poseKoi(spine: readonly Vec[], length: number, pose: Pose): KoiFrame {
  const drive = pose.drive ?? 1;
  const n = spine.length;
  const baseForward = tangents(spine);
  const sway = pose.amplitude * drive * length;
  const points = spine.map((p, i) => {
    const u = i / (n - 1);
    return add(p, perp(baseForward[i]), sway * waveEnvelope(u) * Math.sin(pose.beat - u * WAVE_NUMBER));
  });
  const forward = tangents(points);
  return {
    length,
    points,
    forward,
    normals: forward.map(perp),
    beat: pose.beat,
    time: pose.time,
    drive,
    turn: pose.turn ?? 0,
    flare: pose.flare ?? 0.5,
  };
}

/** Poses a live swimmer: its own midline, where it is in the stroke, and what its fins are doing. */
export function poseSwimmer(s: Swimmer, params: SwimParams, time: number): KoiFrame {
  return poseKoi(spineOf(s, params), params.length, { ...motionOf(s, params), time });
}

/** Body coordinates → canvas point. `u` may run a little past the snout (negative). */
export function bodyPoint(frame: KoiFrame, u: number, v: number): Vec {
  const { points, normals, forward, length } = frame;
  const n = points.length;
  if (u <= 0) {
    const tip = add(points[0], forward[0], -u * length);
    return add(tip, normals[0], v * halfWidth(0) * length);
  }
  const f = Math.min(u, 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const t = f - i;
  const p = { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
  const nn = unit({ x: normals[i].x + (normals[i + 1].x - normals[i].x) * t, y: normals[i].y + (normals[i + 1].y - normals[i].y) * t });
  return add(p, nn, v * halfWidth(u) * length);
}

/** Direction toward the head at `u`. */
export function forwardAt(frame: KoiFrame, u: number): Vec {
  const n = frame.forward.length;
  const i = Math.min(n - 1, Math.max(0, Math.round(u * (n - 1))));
  return frame.forward[i];
}

/**
 * Traces the body outline (no fins) as the current path. `tailReach` (in body lengths) carries
 * the peduncle on past the tail root, so shading clipped to the body has no edge there: the
 * tail fin grows out of it seamlessly instead of meeting a shaded cut.
 */
export function traceBody(ctx: CanvasRenderingContext2D, frame: KoiFrame, tailReach = 0) {
  const { points, normals, forward, length } = frame;
  const n = points.length;
  const w = (i: number) => halfWidth(i / (n - 1)) * length;
  const right = points.map((p, i) => add(p, normals[i], w(i)));
  const left = points.map((p, i) => add(p, normals[i], -w(i)));
  const w0 = w(0);
  const tip = add(points[0], forward[0], w0 * 0.95);
  ctx.moveTo(left[0].x, left[0].y);
  const c1 = add(left[0], forward[0], w0 * 0.6);
  const c2 = add(tip, normals[0], -w0 * 0.62);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, tip.x, tip.y);
  const c3 = add(tip, normals[0], w0 * 0.62);
  const c4 = add(right[0], forward[0], w0 * 0.6);
  ctx.bezierCurveTo(c3.x, c3.y, c4.x, c4.y, right[0].x, right[0].y);
  smoothThrough(ctx, right);
  if (tailReach > 0) {
    const beyondRight = add(right[n - 1], forward[n - 1], -tailReach * length);
    const beyondLeft = add(left[n - 1], forward[n - 1], -tailReach * length);
    ctx.lineTo(beyondRight.x, beyondRight.y);
    ctx.lineTo(beyondLeft.x, beyondLeft.y);
  }
  ctx.lineTo(left[n - 1].x, left[n - 1].y);
  smoothThrough(ctx, [...left].reverse());
  ctx.closePath();
}

/** The outline without the cut at the tail root, so the inked edge flows straight into the tail fin. */
export function traceSides(ctx: CanvasRenderingContext2D, frame: KoiFrame) {
  const { points, normals, forward, length } = frame;
  const n = points.length;
  const w = (i: number) => halfWidth(i / (n - 1)) * length;
  const right = points.map((p, i) => add(p, normals[i], w(i)));
  const left = points.map((p, i) => add(p, normals[i], -w(i)));
  const w0 = w(0);
  const tip = add(points[0], forward[0], w0 * 0.95);
  ctx.moveTo(right[n - 1].x, right[n - 1].y);
  smoothThrough(ctx, [...right].reverse());
  const c4 = add(right[0], forward[0], w0 * 0.6);
  const c3 = add(tip, normals[0], w0 * 0.62);
  ctx.bezierCurveTo(c4.x, c4.y, c3.x, c3.y, tip.x, tip.y);
  const c2 = add(tip, normals[0], -w0 * 0.62);
  const c1 = add(left[0], forward[0], w0 * 0.6);
  ctx.bezierCurveTo(c2.x, c2.y, c1.x, c1.y, left[0].x, left[0].y);
  smoothThrough(ctx, left);
}
