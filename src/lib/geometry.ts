export interface Vec {
  readonly x: number;
  readonly y: number;
}

export const TAU = Math.PI * 2;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const distance = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y);

/** Shortest signed angle from `from` to `to`, in (-π, π]. */
export function angleDelta(from: number, to: number): number {
  const d = (((to - from) % TAU) + TAU) % TAU;
  return d > Math.PI ? d - TAU : d;
}

/**
 * Nudges points apart until every pair is at least `gap` apart (or iterations run out),
 * so overlapping tap targets get their own space. Returns new points.
 */
export function spreadApart(points: readonly Vec[], gap: number, iterations = 24): Vec[] {
  let pts = points.map((p) => ({ x: p.x, y: p.y }));
  for (let k = 0; k < iterations; k++) {
    let moved = false;
    pts = pts.map((p, i) => {
      let { x, y } = p;
      pts.forEach((q, j) => {
        if (i === j) return;
        const d = distance(p, q);
        if (d >= gap) return;
        moved = true;
        const nx = d > 1e-6 ? (p.x - q.x) / d : Math.cos(i);
        const ny = d > 1e-6 ? (p.y - q.y) / d : Math.sin(i);
        x += (nx * (gap - d)) / 2;
        y += (ny * (gap - d)) / 2;
      });
      return { x, y };
    });
    if (!moved) break;
  }
  return pts;
}
