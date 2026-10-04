import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { SPINE_POINTS } from "../lib/body";
import { clamp } from "../lib/geometry";
import { holdingSpine } from "../lib/holding";
import { generatePattern, type KoiPattern } from "../lib/patterns";
import { VARIETIES, varietyById, type VarietyId } from "../lib/varieties";
import { useCanvasLoop, type LoopFrame } from "../hooks/useCanvasLoop";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { drawKoi, poseKoi } from "../render/koi";
import { ArrowLeft, ArrowRight, Pause, Play } from "./Icons";
import "./Stage.css";

const STAGE_SEED = 21;
const AUTOPLAY_MS = 2600;
const MORPH_SECONDS = 0.7;

interface Props {
  readonly selected: VarietyId;
  readonly onSelect: (id: VarietyId) => void;
}


const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function Stage({ selected, onSelect }: Props) {
  const reduced = useReducedMotion();
  const [autoplay, setAutoplay] = useState(true);
  const [inView, setInView] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvases = useMemo(() => [canvasRef], []);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const patterns = useMemo(
    () => Object.fromEntries(VARIETIES.map((v) => [v.id, generatePattern(v.id, STAGE_SEED)])) as Record<VarietyId, KoiPattern>,
    [],
  );
  const layer = useRef<HTMLCanvasElement | null>(null);
  const morph = useRef<{ from: VarietyId; to: VarietyId; start: number }>({ from: selected, to: selected, start: 0 });

  const index = VARIETIES.findIndex((v) => v.id === selected);
  const variety = varietyById(selected);
  const playing = autoplay && !reduced && inView;

  // The variety the parade itself last stepped to. A pick from anywhere else (a "See it on…" link
  // in the guide) pauses the parade, so the fish the reader asked for stays on the stage.
  const paraded = useRef<VarietyId>(selected);

  useEffect(() => {
    const m = morph.current;
    if (m.to === selected) return;
    morph.current = { from: m.to, to: selected, start: performance.now() / 1000 };
    if (selected !== paraded.current) setAutoplay(false);
  }, [selected]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.intersectionRatio > 0.35), { threshold: [0, 0.35, 0.6] });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => {
      paraded.current = VARIETIES[(index + 1) % VARIETIES.length].id;
      onSelect(paraded.current);
    }, AUTOPLAY_MS);
    return () => window.clearTimeout(id);
  }, [playing, index, onSelect]);

  const draw = useCallback(
    ({ contexts: [ctx], size, time }: LoopFrame) => {
      // Snout to the tip of the butterfly tail is about 1.55 body lengths; keep it clear of the nameplate.
      const length = clamp(Math.min((size.height - 80) / 1.6, size.width * 1.05), 150, 1100);
      const top = (size.height - 48 - length * 1.55) / 2 + length * 0.03;
      const t = reduced ? 0 : time;
      // Head-up, holding station in a gentle current: the locked-off camera of a specimen plate.
      const spine = holdingSpine({ x: size.width / 2, y: top }, { x: 0, y: 1 }, length, t, SPINE_POINTS);
      // Holding station: a slow, small tail beat while the pectorals fan out and scull.
      const frame = poseKoi(spine, length, { beat: reduced ? 1.4 : t * 3.1, time: t, amplitude: 0.035, flare: 0.85 });
      const shadow = { dx: length * 0.05, dy: length * 0.1, blur: length * 0.07, alpha: 0.55 };
      const m = morph.current;
      const progress = reduced ? 1 : clamp((performance.now() / 1000 - m.start) / MORPH_SECONDS, 0, 1);
      const opts = { pixelRatio: size.dpr, shadow };
      if (progress >= 1 || m.from === m.to) {
        drawKoi(ctx, frame, patterns[m.to], opts);
        return;
      }
      // Cross-dissolve: the incoming fish is drawn whole on its own layer, then faded in,
      // so the two fishes' translucent fins never stack into a double exposure.
      drawKoi(ctx, frame, patterns[m.from], opts);
      const off = (layer.current ??= document.createElement("canvas"));
      if (off.width !== ctx.canvas.width || off.height !== ctx.canvas.height) {
        off.width = ctx.canvas.width;
        off.height = ctx.canvas.height;
      }
      const octx = off.getContext("2d");
      if (!octx) return;
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, off.width, off.height);
      octx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      drawKoi(octx, frame, patterns[m.to], opts);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = easeInOut(progress);
      ctx.drawImage(off, 0, 0);
      ctx.restore();
    },
    [patterns, reduced],
  );

  const redraw = useCanvasLoop(plateRef, canvases, draw, { animate: !reduced });
  useEffect(() => redraw.current(), [selected, redraw]);

  const choose = (id: VarietyId) => {
    setAutoplay(false);
    onSelect(id);
  };
  const step = (delta: number) => choose(VARIETIES[(index + delta + VARIETIES.length) % VARIETIES.length].id);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let target: number | null = null;
    if (e.key in keys) target = (index + keys[e.key] + VARIETIES.length) % VARIETIES.length;
    if (e.key === "Home") target = 0;
    if (e.key === "End") target = VARIETIES.length - 1;
    if (target === null) return;
    e.preventDefault();
    choose(VARIETIES[target].id);
    tabRefs.current[target]?.focus();
  };

  return (
    <section className="stage section" id="varieties" ref={sectionRef} aria-labelledby="stage-title">
      <div className="stage__grid">
        <div className="stage__head">
          <p className="label">02 — The varieties</p>
          <h2 id="stage-title" className="stage__title">
            Eight fish, one stage. Watch the pattern change and the body stay the same.
          </h2>
        </div>
        <div className="stage__tabs" role="tablist" aria-label="Koi varieties" aria-orientation="vertical">
          {VARIETIES.map((v, i) => (
            <button
              key={v.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              id={`tab-${v.id}`}
              role="tab"
              type="button"
              className="stage__tab"
              aria-selected={v.id === selected}
              aria-controls="variety-panel"
              tabIndex={v.id === selected ? 0 : -1}
              onClick={() => choose(v.id)}
              onKeyDown={onTabKey}
            >
              <span className="label stage__tab-index">{String(i + 1).padStart(2, "0")}</span>
              <span className="stage__tab-name">{v.name}</span>
            </button>
          ))}
        </div>

        <div className="stage__plate" ref={plateRef}>
          <span className="stage__kanji jp" aria-hidden="true" style={{ ["--chars" as string]: variety.kanji.length }}>
            {variety.kanji}
          </span>
          <canvas ref={canvasRef} className="stage__canvas" role="img" aria-label={`A ${variety.name} koi seen from above`} />
          <p className="stage__nameplate label label--tracked" aria-hidden="true">
            {variety.name}
          </p>
        </div>

        <div className="stage__panel" id="variety-panel" role="tabpanel" aria-labelledby={`tab-${selected}`} aria-live={playing ? "off" : "polite"}>
          <p className="label stage__count">
            {String(index + 1).padStart(2, "0")} / {String(VARIETIES.length).padStart(2, "0")}
          </p>
          <h3 className="stage__name">
            {variety.name} <span className="jp">{variety.kanji}</span>
          </h3>
          <p className="stage__gloss">
            <span className="label">{variety.reading}</span> “{variety.gloss}”
          </p>
          <p className="label stage__lookfor-label">Look for</p>
          <ol className="stage__lookfor">
            {variety.lookFor.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <p className="stage__confused">
            <span className="label">Often confused with</span>
            {variety.confusedWith.map((id) => (
              <button key={id} type="button" className="text-link stage__confused-link" onClick={() => choose(id)}>
                {varietyById(id).name}
              </button>
            ))}
          </p>
          <div className="stage__controls">
            <button type="button" className="btn btn--ghost stage__icon" onClick={() => step(-1)} aria-label="Previous variety">
              <ArrowLeft />
            </button>
            <button type="button" className="btn btn--ghost stage__icon" onClick={() => step(1)} aria-label="Next variety">
              <ArrowRight />
            </button>
            {!reduced && (
              <button
                type="button"
                className="btn btn--ghost stage__autoplay"
                onClick={() => setAutoplay((on) => !on)}
                aria-pressed={autoplay}
              >
                {autoplay ? <Pause /> : <Play />}
                {autoplay ? "Pause the parade" : "Play the parade"}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
