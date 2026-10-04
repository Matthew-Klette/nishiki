import { halfWidth } from "../lib/body";
import { dorsalBladeOutline, PLATE_LAYERS, PLATE_TONES, plateAxes, shusuiScaleLayout } from "../lib/doitsu";
import type { Vec } from "../lib/geometry";
import type { KoiPattern } from "../lib/patterns";
import { add, smoothThrough } from "./brush";
import { bodyPoint, forwardAt, type KoiFrame } from "./koiFrame";
import type { Ink } from "./koiInk";

/* -------------------------------------------------------------- scales */

/** Crescent scales in staggered rows, each a dark cut with a pale lip, like carved linework. */
export function drawScales(ctx: CanvasRenderingContext2D, frame: KoiFrame, pattern: KoiPattern, ink: Ink, lineWidth: number) {
  const L = frame.length;
  if (L < 120) return;
  if (pattern.scales === "doitsu") {
    drawMirrorScales(ctx, frame, ink, lineWidth);
    return;
  }
  const step = 0.042;
  const dark = new Path2D();
  const light = new Path2D();
  let row = 0;
  for (let u = 0.2; u < 0.93; u += step, row++) {
    const hw = halfWidth(u);
    const r = L * step * 0.62;
    const count = Math.max(2, Math.round((hw * L * 1.8) / (r * 1.75)));
    const f = forwardAt(frame, u);
    const back = Math.atan2(-f.y, -f.x);
    for (let j = 0; j <= count; j++) {
      const v = -0.86 + (1.72 * (j + (row % 2) * 0.5)) / (count + 0.5);
      if (Math.abs(v) > 0.88) continue;
      const c = bodyPoint(frame, u, v);
      const rr = r * (0.85 + 0.15 * (1 - Math.abs(v)));
      dark.moveTo(c.x + Math.cos(back - 1.2) * rr, c.y + Math.sin(back - 1.2) * rr);
      dark.arc(c.x, c.y, rr, back - 1.2, back + 1.2);
      const lr = rr * 0.78;
      light.moveTo(c.x + Math.cos(back - 0.85) * lr, c.y + Math.sin(back - 0.85) * lr);
      light.arc(c.x, c.y, lr, back - 0.85, back + 0.85);
    }
  }
  ctx.lineCap = "round";
  ctx.strokeStyle = ink.scaleDark;
  ctx.lineWidth = lineWidth * 1.1;
  ctx.stroke(dark);
  ctx.strokeStyle = ink.scaleLight;
  ctx.lineWidth = lineWidth * 0.85;
  ctx.stroke(light);
}

/** Back to front, so each plate's free rear edge lies over the front of the one behind it. */
const MIRROR_PLATES = shusuiScaleLayout().toReversed();
const DORSAL_BLADE = dorsalBladeOutline();

/** Doitsu (Shūsui): a block of mirror plates over the shoulders, then a row each side of the folded dorsal fin. */
function drawMirrorScales(ctx: CanvasRenderingContext2D, frame: KoiFrame, ink: Ink, lineWidth: number) {
  const L = frame.length;
  const oval = (at: Vec, rx: number, ry: number, rotation: number, from = 0, to = Math.PI * 2) => {
    ctx.beginPath();
    ctx.ellipse(at.x, at.y, rx, ry, rotation, from, to);
  };
  ctx.lineCap = "round";
  for (const s of MIRROR_PLATES) {
    const c = bodyPoint(frame, s.u, s.v);
    const { rotation, headward } = plateAxes(forwardAt(frame, s.u), s.tilt);
    const rx = (s.w * L) / 2;
    const ry = (s.l * L) / 2;
    for (const { tone, across, along, shift } of PLATE_LAYERS) {
      oval(add(c, headward, shift * s.l * L), rx * across, ry * along, rotation);
      ctx.fillStyle = tone;
      ctx.fill();
    }
    // The ellipse's local +y points tailward, so this arc is a fine light rim along the free edge.
    oval(c, rx * 0.88, ry * 0.84, rotation, Math.PI / 2 - 1.1, Math.PI / 2 + 1.1);
    ctx.strokeStyle = PLATE_TONES.rim;
    ctx.lineWidth = lineWidth * 0.8;
    ctx.stroke();
    oval(c, rx, ry, rotation);
    ctx.strokeStyle = ink.line;
    ctx.lineWidth = lineWidth * 0.9;
    ctx.stroke();
  }
  // The folded dorsal fin lies between the rows as a narrow translucent blade.
  const blade = DORSAL_BLADE.map((p) => bodyPoint(frame, p.u, p.v));
  ctx.beginPath();
  ctx.moveTo(blade[0].x, blade[0].y);
  smoothThrough(ctx, blade);
  ctx.fillStyle = PLATE_TONES.fin;
  ctx.fill();
  ctx.strokeStyle = ink.line;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = lineWidth * 0.8;
  ctx.stroke();
  ctx.globalAlpha = 1;
}
