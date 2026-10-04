import { useCallback, useMemo, useRef, type PointerEvent } from "react";
import { clamp, type Vec } from "../lib/geometry";
import { generatePattern } from "../lib/patterns";
import { addPellet, PELLET_LIFE, stepPond, type PondState } from "../lib/pond";
import { mulberry32 } from "../lib/rng";
import { createSwimmer, type SwimParams } from "../lib/swim";
import type { VarietyId } from "../lib/varieties";
import { useCanvasLoop, type LoopFrame } from "../hooks/useCanvasLoop";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { drawKoi, poseSwimmer } from "../render/koi";
import { drawFood, drawGulps, drawRipples, GULP_SECONDS, type Gulp, type Ripple } from "../render/water";
import { ArrowRight } from "./Icons";
import "./Pond.css";

const RESIDENTS: readonly VarietyId[] = ["kohaku", "showa", "ogon", "sanke", "asagi", "utsuri"];
const RIPPLE_SECONDS = 2;

interface Pad {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly turn: number;
}

/** Lily pads sit above the fish, so they slide underneath: one more plane of depth. */
function drawPads(ctx: CanvasRenderingContext2D, pads: readonly Pad[], pixelRatio: number) {
  for (const pad of pads) {
    ctx.save();
    ctx.translate(pad.x, pad.y);
    ctx.rotate(pad.turn);
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = pad.r * 0.25 * pixelRatio;
    ctx.shadowOffsetY = pad.r * 0.08 * pixelRatio;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, pad.r, 0.22, Math.PI * 2 - 0.05);
    ctx.closePath();
    const g = ctx.createRadialGradient(-pad.r * 0.3, -pad.r * 0.3, 0, 0, 0, pad.r);
    g.addColorStop(0, "#4d7a4f");
    g.addColorStop(1, "#2c5236");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.beginPath();
    for (let k = 0; k < 9; k++) {
      const a = 0.4 + (k / 8) * (Math.PI * 2 - 0.7);
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * pad.r * 0.88, Math.sin(a) * pad.r * 0.88);
    }
    ctx.strokeStyle = "rgba(190,220,170,0.18)";
    ctx.lineWidth = Math.max(1 / pixelRatio, pad.r * 0.012);
    ctx.stroke();
    ctx.restore();
  }
}

export function Pond() {
  const reduced = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const waterRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvases = useMemo(() => [canvasRef], []);
  const rng = useMemo(() => mulberry32(2026), []);
  const sim = useRef<{ state: PondState | null; size: string; ripples: readonly Ripple[]; gulps: readonly Gulp[]; nextId: number }>({
    state: null,
    size: "",
    ripples: [],
    gulps: [],
    nextId: 1,
  });

  const draw = useCallback(
    ({ contexts: [ctx], size, dt, time }: LoopFrame) => {
      const s = sim.current;
      const length = clamp(Math.min(size.width, size.height) * 0.24, 110, 420);
      const params: SwimParams = { length, cruise: 0.3, maxTurn: 1.2 };
      const key = `${size.width}x${size.height}`;
      if (!s.state || s.size !== key) {
        const place = mulberry32(7);
        s.state = {
          pellets: [],
          fish: RESIDENTS.map((id, i) => {
            const at = { x: size.width * (0.15 + 0.7 * place()), y: size.height * (0.2 + 0.6 * place()) };
            const heading = place() * Math.PI * 2;
            // Each fish starts at its own point in the stroke and its own speed, so they never beat in step.
            const swimmer = { ...createSwimmer(at, heading, params), phase: place() * 6, speed: length * params.cruise * (0.5 + place()) };
            return { swimmer, pattern: generatePattern(id, 40 + i), params, course: heading, ponder: place() * 4 };
          }),
        };
        s.size = key;
      }
      if (!reduced) s.state = stepPond(s.state, size, dt, rng);

      const now = performance.now() / 1000;
      s.ripples = s.ripples.filter((r) => now - r.born < RIPPLE_SECONDS);
      const fresh = (s.state.eaten ?? []).map((e) => ({ x: e.at.x, y: e.at.y, mouth: e.mouth, born: now }));
      s.gulps = [...s.gulps.filter((g) => now - g.born < GULP_SECONDS), ...fresh];
      for (const f of s.state.fish) {
        drawKoi(ctx, poseSwimmer(f.swimmer, f.params, reduced ? 0 : time), f.pattern, {
          pixelRatio: size.dpr,
          shadow: { dx: length * 0.07, dy: length * 0.14, blur: length * 0.08, alpha: 0.5 },
        });
      }
      // The surface sits above the fish: rings, floating food, then lily pads.
      drawRipples(ctx, s.ripples, now, length * 1.4, size.dpr, RIPPLE_SECONDS, "200,230,215");
      for (const p of s.state.pellets) drawFood(ctx, p, length, "#e9dcc1", PELLET_LIFE - p.age);
      drawGulps(ctx, s.gulps, now, length, size.dpr, "200,230,215", "#e9dcc1");
      const pads: Pad[] = [
        { x: size.width * 0.12, y: size.height * 0.78, r: length * 0.42, turn: 0.6 },
        { x: size.width * 0.86, y: size.height * 0.24, r: length * 0.5, turn: 2.4 },
        { x: size.width * 0.93, y: size.height * 0.42, r: length * 0.28, turn: 4.1 },
      ];
      drawPads(ctx, pads, size.dpr);
    },
    [reduced, rng],
  );

  useCanvasLoop(waterRef, canvases, draw, { animate: !reduced });

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const s = sim.current;
    if (reduced || !s.state) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const at: Vec = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const scatter = mulberry32(s.nextId);
    let state = s.state;
    for (let k = 0; k < 3; k++) {
      state = addPellet(state, { x: at.x + (scatter() - 0.5) * 40, y: at.y + (scatter() - 0.5) * 40 }, s.nextId++);
    }
    s.state = state;
    s.ripples = [...s.ripples, { x: at.x, y: at.y, born: performance.now() / 1000 }];
  };

  return (
    <section className="pond" id="pond" ref={sectionRef} aria-labelledby="pond-title">
      <div className="pond__water" ref={waterRef} onPointerDown={onPointerDown}>
        <span className="pond__kanji jp" aria-hidden="true">
          池
        </span>
        <canvas ref={canvasRef} className="pond__canvas" role="img" aria-label="Six koi from the guide swimming in a pond under lily pads" />
      </div>
      <div className="pond__copy">
        <p className="label">05 — The pond</p>
        <h2 id="pond-title" className="pond__title">
          {reduced ? "Six of the eight varieties, resting." : "Tap the water to scatter food."}
        </h2>
        <p className="pond__body">
          Kohaku, Shōwa, Ōgon, Sanke, Asagi and Shiro Utsuri share this pond. Koi soon learn who feeds them, and they can
          live for decades.
        </p>
        <a className="btn btn--ghost pond__cta" href="#play">
          Test yourself again
          <ArrowRight />
        </a>
      </div>
    </section>
  );
}
