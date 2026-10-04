import { TAU, type Vec } from "../lib/geometry";

export interface Ripple extends Vec {
  /** performance.now() in seconds when the ripple started. */
  readonly born: number;
}

const RINGS = 3;

/** Concentric rings that spread and fade where the water was touched. */
export function drawRipples(
  ctx: CanvasRenderingContext2D,
  ripples: readonly Ripple[],
  now: number,
  scale: number,
  pixelRatio: number,
  lifetime: number,
  color = "244,237,224",
) {
  for (const r of ripples) {
    const age = (now - r.born) / lifetime;
    for (let k = 0; k < RINGS; k++) {
      const t = age - k * 0.12;
      if (t <= 0 || t >= 1) continue;
      const eased = 1 - Math.pow(1 - t, 3);
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, scale * 0.42 * eased, scale * 0.3 * eased, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${color},${0.55 * (1 - t)})`;
      ctx.lineWidth = Math.max(1 / pixelRatio, 1.5 * (1 - t));
      ctx.stroke();
    }
  }
}

/** How long uneaten food takes to sink out of sight, in seconds. */
export const SINK_SECONDS = 0.6;

/** A pellet floating at the surface; `left` is seconds until it sinks, and it fades as it goes. */
export function drawFood(ctx: CanvasRenderingContext2D, at: Vec, scale: number, color = "#f4ede0", left = Infinity) {
  const fade = Math.min(1, Math.max(0, left / SINK_SECONDS));
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  const r = Math.max(3, scale * 0.011);
  ctx.beginPath();
  ctx.arc(at.x + r * 0.5, at.y + r * 0.8, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** Food being taken: where the pellet was, and where the mouth was when it took it. */
export interface Gulp extends Vec {
  readonly mouth: Vec;
  /** performance.now() in seconds when it was eaten. */
  readonly born: number;
}

/** How long the little ring of a gulp lasts, and how long the pellet takes to slip into the mouth. */
export const GULP_SECONDS = 0.8;
const SWALLOW_SECONDS = 0.2;

/**
 * A koi taking food: the pellet slips into the mouth and shrinks away, and a small ring spreads
 * where the mouth broke the surface, so you see it eaten rather than vanish.
 */
export function drawGulps(
  ctx: CanvasRenderingContext2D,
  gulps: readonly Gulp[],
  now: number,
  scale: number,
  pixelRatio: number,
  ring = "244,237,224",
  food = "#f4ede0",
) {
  drawRipples(ctx, gulps.map((g) => ({ x: g.mouth.x, y: g.mouth.y, born: g.born })), now, scale * 0.3, pixelRatio, GULP_SECONDS, ring);
  for (const g of gulps) {
    const t = (now - g.born) / SWALLOW_SECONDS;
    if (t < 0 || t >= 1) continue;
    ctx.beginPath();
    ctx.arc(g.x + (g.mouth.x - g.x) * t, g.y + (g.mouth.y - g.y) * t, Math.max(3, scale * 0.011) * (1 - t), 0, TAU);
    ctx.fillStyle = food;
    ctx.fill();
  }
}
