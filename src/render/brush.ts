import type { Vec } from "../lib/geometry";

/** Small vector and canvas helpers shared by the koi renderer. */

export const add = (a: Vec, b: Vec, k = 1): Vec => ({ x: a.x + b.x * k, y: a.y + b.y * k });
export const unit = (v: Vec): Vec => {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
};
export const perp = (f: Vec): Vec => ({ x: -f.y, y: f.x });
export const fromAngle = (a: number): Vec => ({ x: Math.cos(a), y: Math.sin(a) });

export function smoothThrough(ctx: CanvasRenderingContext2D, pts: readonly Vec[]) {
  for (let i = 1; i < pts.length - 1; i++) {
    const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

/** "#rrggbb" → "rgba(r,g,b,a)". */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export const FAR = 100000;

/** Paints only the blurred shadow of whatever `paint` draws: a soft brush. */
export function softly(ctx: CanvasRenderingContext2D, pixelRatio: number, color: string, blur: number, paint: () => void) {
  ctx.save();
  ctx.translate(-FAR, 0);
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * pixelRatio;
  ctx.shadowOffsetX = FAR * pixelRatio;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  paint();
  ctx.restore();
}
