import { useCallback, useLayoutEffect, useMemo, useRef, type PointerEvent, type RefObject } from "react";
import { SPINE_POINTS } from "../lib/body";
import { clamp, type Vec } from "../lib/geometry";
import { TAIL_AMPLITUDE } from "../lib/locomotion";
import { generatePattern } from "../lib/patterns";
import { mulberry32, type Rng } from "../lib/rng";
import { roamStep, startRoaming, type Ellipse, type Roamer } from "../lib/roam";
import { createSwimmer, inReach, mouthOf, type SwimParams, type Swimmer } from "../lib/swim";
import { useCanvasLoop, type LoopFrame } from "../hooks/useCanvasLoop";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { drawKoi, poseKoi, poseSwimmer } from "../render/koi";
import { drawFood, drawGulps, drawRipples, GULP_SECONDS, type Gulp, type Ripple } from "../render/water";
import { ArrowDown } from "./Icons";
import "./Hero.css";

const HERO_SEED = 11;
const FOLLOW_SECONDS = 1.8;
const FEED_SECONDS = 6;
/** A new tap within this many seconds of the last doesn't steal her attention from the food she's after. */
const FOOD_FOCUS = 0.35;
const DART_SECONDS = 0.9;
const RIPPLE_SECONDS = 2.2;
const WORD = "NISHIKI";
const KANJI = "錦鯉";
/**
 * Letters that sit in front of the fish; the rest sit behind it. Whole letters only, so the fish
 * always passes cleanly over or under a glyph and never appears to melt into one.
 */
const FRONT_LATIN = new Set([2, 5]); // S, K
const FRONT_KANJI = new Set([1]); // 鯉

function Letters({ text, front, layer }: { text: string; front: ReadonlySet<number>; layer: "back" | "front" }) {
  return (
    <>
      {[...text].map((ch, i) => (
        <span key={i} className={layer === "front" && !front.has(i) ? "hero__ghost" : undefined}>
          {ch}
        </span>
      ))}
    </>
  );
}

interface Sim {
  /** The koi and the leg of her route she is on when nobody is steering her. */
  roamer: Roamer | null;
  width: number;
  height: number;
  /** Seeded on the first frame, so every visit gets a new route. */
  rng: Rng | null;
  target: Vec | null;
  targetUntil: number;
  dartUntil: number;
  food: Vec | null;
  foodSince: number;
  foodUntil: number;
  ripples: readonly Ripple[];
  gulps: readonly Gulp[];
}

const nowSeconds = () => performance.now() / 1000;
const isPortrait = (width: number, height: number) => height > width * 1.1;

function swimParams(width: number, height: number): SwimParams {
  // With butterfly fins the whole fish is ~1.55 body lengths long, so the body itself stays modest.
  // Scales with the screen; the height term keeps it in proportion on ultrawide monitors.
  const length = isPortrait(width, height)
    ? clamp(Math.min(width * 0.5, height * 0.36), 170, 520)
    : clamp(Math.min(width * 0.27, height * 0.42), 220, 1100);
  return { length, cruise: 0.42, maxTurn: 1.4 };
}

/** The still pose for reduced motion: one gentle curve through the type. */
function stillSpine(width: number, height: number, length: number, count: number): Vec[] {
  const portrait = isPortrait(width, height);
  const head = portrait ? { x: width * 0.6, y: height * 0.3 } : { x: width * 0.68, y: height * 0.36 };
  const heading = portrait ? -Math.PI * 0.4 : -Math.PI * 0.1;
  const back = { x: -Math.cos(heading), y: -Math.sin(heading) };
  const side = { x: -back.y, y: back.x };
  return Array.from({ length: count }, (_, i) => {
    const d = (length * i) / (count - 1);
    const bend = Math.sin((d / length) * Math.PI) * length * 0.12;
    return { x: head.x + back.x * d + side.x * bend, y: head.y + back.y * d + side.y * bend };
  });
}

/** The word may take at most this share of the hero's height (keeps ultrawide screens composed). */
const WORD_MAX_HEIGHT = 0.46;

/**
 * Scales the latin word so it spans its parent's content box exactly, and never more; the mirror
 * copy follows. On very wide screens the height limit wins and the word sits centred instead.
 */
function useFitWidth(ref: RefObject<HTMLElement | null>, mirror: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const fit = () => {
      if (getComputedStyle(el).display === "none") return;
      const styles = getComputedStyle(parent);
      const available = parent.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
      el.style.fontSize = "100px";
      const natural = el.getBoundingClientRect();
      if (natural.width > 0 && natural.height > 0) {
        const byWidth = (100 * available) / natural.width;
        const byHeight = (100 * parent.clientHeight * WORD_MAX_HEIGHT) / natural.height;
        el.style.fontSize = `${Math.floor(Math.min(byWidth, byHeight) * 100) / 100}px`;
      }
      if (mirror.current) mirror.current.style.fontSize = el.style.fontSize;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    // Reveal only after measuring with the real face, so the word never jumps size (no layout shift).
    const reveal = () => {
      fit();
      el.dataset.fitted = "true";
      if (mirror.current) mirror.current.dataset.fitted = "true";
    };
    document.fonts.ready.then(reveal).catch((error: unknown) => {
      console.error("Font loading failed", error);
      reveal();
    });
    return () => observer.disconnect();
  }, [ref, mirror]);
}

/** Where the koi roams on its own: over and under the word, tall on phones (the vertical kanji). */
function swimArea(width: number, height: number): Ellipse {
  const center = { x: width / 2, y: height * 0.49 };
  return isPortrait(width, height) ? { center, rx: width * 0.28, ry: height * 0.27 } : { center, rx: width * 0.38, ry: height * 0.27 };
}

export function Hero() {
  const reduced = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const fishRef = useRef<HTMLCanvasElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);
  const frontWordRef = useRef<HTMLSpanElement>(null);
  const canvases = useMemo(() => [fishRef], []);
  const pattern = useMemo(() => generatePattern("kohaku", HERO_SEED), []);
  const sim = useRef<Sim>({
    roamer: null,
    width: 0,
    height: 0,
    rng: null,
    target: null,
    targetUntil: 0,
    dartUntil: 0,
    food: null,
    foodSince: 0,
    foodUntil: 0,
    ripples: [],
    gulps: [],
  });

  useFitWidth(wordRef, frontWordRef);

  const step = useCallback((s: Sim, params: SwimParams, width: number, height: number, dt: number): Swimmer => {
    const now = nowSeconds();
    const center = { x: width / 2, y: height * 0.47 };
    if (!s.roamer || Math.abs(s.width - width) > 40 || Math.abs(s.height - height) > 120) {
      s.roamer = startRoaming(createSwimmer({ x: center.x + width * 0.18, y: center.y }, Math.PI * 0.75, params));
      s.width = width;
      s.height = height;
    }
    // Left alone she roams in random legs (no fixed loop, no favourite direction); a cursor or food draws her off.
    s.rng ??= mulberry32(Math.floor(Math.random() * 2 ** 32));
    const following = s.target !== null && now < s.targetUntil;
    const lureAt = s.food ?? (following ? s.target : null);
    const lure = lureAt ? { target: lureAt, urgency: now < s.dartUntil ? 2.3 : s.food ? 1.5 : 1 } : null;
    s.roamer = roamStep(s.roamer, s.rng, swimArea(width, height), params, dt, lure);
    const swimmer = s.roamer.swimmer;
    if (s.food && inReach(swimmer, s.food, params)) {
      s.gulps = [...s.gulps, { x: s.food.x, y: s.food.y, mouth: mouthOf(swimmer, params), born: now }];
      s.food = null;
    } else if (s.food && now > s.foodUntil) {
      s.food = null;
    }
    return swimmer;
  }, []);

  const draw = useCallback(
    ({ contexts: [ctx], size, dt, time }: LoopFrame) => {
      const s = sim.current;
      const params = swimParams(size.width, size.height);
      const { length } = params;
      const frame = reduced
        ? poseKoi(stillSpine(size.width, size.height, length, SPINE_POINTS), length, { beat: 1.2, time: 0, amplitude: TAIL_AMPLITUDE * 0.6 })
        : poseSwimmer(step(s, params, size.width, size.height, dt), params, time);
      const now = nowSeconds();
      s.ripples = s.ripples.filter((r) => now - r.born < RIPPLE_SECONDS);
      s.gulps = s.gulps.filter((g) => now - g.born < GULP_SECONDS);
      drawRipples(ctx, s.ripples, now, length, size.dpr, RIPPLE_SECONDS);
      drawKoi(ctx, frame, pattern, {
        pixelRatio: size.dpr,
        shadow: { dx: length * 0.035, dy: length * 0.075, blur: length * 0.05, alpha: 0.42 },
      });
      // Food floats at the surface, above her, so you see her mouth reach it and take it in.
      if (s.food) drawFood(ctx, s.food, length, undefined, s.foodUntil - now);
      drawGulps(ctx, s.gulps, now, length, size.dpr);
    },
    [pattern, reduced, step],
  );

  useCanvasLoop(sectionRef, canvases, draw, { animate: !reduced });

  const localPoint = (e: PointerEvent<HTMLElement>): Vec => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    sim.current.target = localPoint(e);
    sim.current.targetUntil = nowSeconds() + FOLLOW_SECONDS;
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (reduced || (e.target as HTMLElement).closest("a, button")) return;
    const point = localPoint(e);
    const now = nowSeconds();
    const s = sim.current;
    s.ripples = [...s.ripples, { x: point.x, y: point.y, born: now }];
    // Rapid taps scatter ripples, but she keeps after the food she's already going for.
    if (s.food && now - s.foodSince < FOOD_FOCUS) return;
    s.food = point;
    s.foodSince = now;
    s.foodUntil = now + FEED_SECONDS;
    s.dartUntil = now + DART_SECONDS;
  };

  return (
    <section
      className="hero"
      id="top"
      ref={sectionRef}
      aria-labelledby="hero-title"
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
    >
      <h1 id="hero-title" className="hero__title">
        <span className="sr-only">Nishiki: a field guide to koi</span>
        <span className="hero__word hero__word--latin display" ref={wordRef} aria-hidden="true">
          <Letters text={WORD} front={FRONT_LATIN} layer="back" />
        </span>
        <span className="hero__word hero__word--kanji jp" aria-hidden="true">
          <Letters text={KANJI} front={FRONT_KANJI} layer="back" />
        </span>
      </h1>
      <canvas className="hero__canvas" ref={fishRef} aria-hidden="true" />
      {/* The same word again, above the fish, with only the "front" letters visible. */}
      <div className="hero__title hero__title--front" aria-hidden="true">
        <span className="hero__word hero__word--latin display" ref={frontWordRef}>
          <Letters text={WORD} front={FRONT_LATIN} layer="front" />
        </span>
        <span className="hero__word hero__word--kanji jp">
          <Letters text={KANJI} front={FRONT_KANJI} layer="front" />
        </span>
      </div>

      <div className="hero__front">
        <div className="hero__intro">
          <p className="label">A field guide to living colour · Vol. 01</p>
          <p className="hero__lede">
            Eight koi varieties, drawn live in code. Learn to read a pattern the way judges do, then test your eye.
          </p>
          <div className="hero__actions">
            <a className="btn btn--signal" href="#varieties">
              Open the guide
              <ArrowDown />
            </a>
            <a className="btn btn--ghost" href="#play">
              Name that koi
            </a>
          </div>
        </div>
        <p className="hero__aside vertical">
          <span className="jp">錦鯉</span>
          <span className="label">nishikigoi · brocade carp</span>
        </p>
        <p className="hero__hint label">{reduced ? "Motion paused: your system asks for less" : "Tap the water to feed her"}</p>
      </div>
    </section>
  );
}
