import { useEffect, useRef, type RefObject } from "react";

/** Longest step a single frame may report, in seconds. */
const MAX_DT = 0.1;

export interface CanvasSize {
  readonly width: number;
  readonly height: number;
  /** Full device pixel ratio: canvases are never upscaled. */
  readonly dpr: number;
}

export interface LoopFrame {
  readonly contexts: readonly CanvasRenderingContext2D[];
  readonly size: CanvasSize;
  /** Seconds since the previous frame (0 on a still redraw). */
  readonly dt: number;
  /** Seconds since the loop started. */
  readonly time: number;
}

interface Options {
  /** false draws a single still frame on every resize instead of looping. */
  readonly animate: boolean;
}

/**
 * Sizes one or more stacked canvases to their container at full devicePixelRatio and drives
 * a requestAnimationFrame loop that pauses when the container is off screen or the tab is hidden.
 * Returns a function that forces a redraw (for still mode after state changes).
 */
export function useCanvasLoop(
  container: RefObject<HTMLElement | null>,
  canvases: readonly RefObject<HTMLCanvasElement | null>[],
  draw: (frame: LoopFrame) => void,
  { animate }: Options,
) {
  const drawRef = useRef(draw);
  const redrawRef = useRef<() => void>(() => {});
  useEffect(() => {
    drawRef.current = draw;
  });

  useEffect(() => {
    const host = container.current;
    const elements = canvases.map((c) => c.current).filter((c): c is HTMLCanvasElement => c !== null);
    if (!host || elements.length !== canvases.length) return;
    const contexts = elements.map((el) => el.getContext("2d"));
    if (contexts.some((c) => c === null)) {
      console.error("Canvas 2D is unavailable; the koi can't be drawn.");
      return;
    }
    const ctxs = contexts as CanvasRenderingContext2D[];

    let size: CanvasSize = { width: 0, height: 0, dpr: 1 };
    let visible = false;
    let raf = 0;
    let last = 0;
    let start = 0;

    const render = (now: number) => {
      if (!size.width || !size.height) return;
      // A frame after a long gap (off-screen resize, tab switch, GC hitch) counts as a short one.
      const dt = last ? Math.min((now - last) / 1000, MAX_DT) : 0;
      last = now;
      if (!start) start = now;
      for (const ctx of ctxs) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      }
      drawRef.current({ contexts: ctxs, size, dt, time: (now - start) / 1000 });
    };

    const tick = (now: number) => {
      render(now);
      raf = requestAnimationFrame(tick);
    };

    const sync = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      const running = animate && visible && document.visibilityState === "visible";
      if (running) raf = requestAnimationFrame(tick);
      else render(performance.now());
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size = { width: rect.width, height: rect.height, dpr };
      for (const el of elements) {
        el.width = Math.max(1, Math.round(rect.width * dpr));
        el.height = Math.max(1, Math.round(rect.height * dpr));
      }
      if (!raf) render(performance.now());
    };

    redrawRef.current = () => {
      if (!raf) render(performance.now());
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    io.observe(host);
    document.addEventListener("visibilitychange", sync);
    resize();

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      redrawRef.current = () => {};
    };
  }, [container, canvases, animate]);

  return redrawRef;
}
