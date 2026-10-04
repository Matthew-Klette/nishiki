import type { Vec } from "./geometry";

/**
 * A koi holding station in a gentle current, the pose of a specimen plate: the snout drifts a
 * little and the body sways slowly from side to side. `toTail` is a unit vector from snout to tail;
 * `sway` scales the movement (0 holds it still).
 */
export function holdingSpine(snout: Vec, toTail: Vec, length: number, time: number, count: number, sway = 1): Vec[] {
  const side = { x: toTail.y, y: -toTail.x };
  const drift = Math.sin(time * 0.55) * length * 0.018 * sway;
  const bend = Math.sin(time * 0.37) * 0.16 * sway;
  return Array.from({ length: count }, (_, i) => {
    const u = i / (count - 1);
    const off = drift * (1 - u) + Math.sin(u * Math.PI) * bend * length * 0.25;
    return { x: snout.x + toTail.x * u * length + side.x * off, y: snout.y + toTail.y * u * length + side.y * off };
  });
}
