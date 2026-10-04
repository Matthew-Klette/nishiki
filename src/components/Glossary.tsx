import { useCallback, useMemo, useRef, useState } from "react";
import { FINS, SPINE_POINTS } from "../lib/body";
import { clamp, spreadApart } from "../lib/geometry";
import { holdingSpine } from "../lib/holding";
import { generatePattern, type KoiPattern } from "../lib/patterns";
import type { VarietyId } from "../lib/varieties";
import { useCanvasLoop, type LoopFrame } from "../hooks/useCanvasLoop";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { koiExtent, shadowAt, type KoiExtent } from "../render/extent";
import { bodyPoint, drawKoi, poseKoi } from "../render/koi";
import "./Glossary.css";

const SPECIMEN_SEED = 4;
/** Marker centres stay at least one 44px target plus a hair apart. */
const MARKER_GAP = 46;

interface Term {
  readonly id: string;
  readonly term: string;
  readonly kanji: string;
  readonly meaning: string;
  /** Where the marker sits on the specimen, in body coordinates. */
  readonly at: (pattern: KoiPattern) => { u: number; v: number };
}

const TERMS: readonly Term[] = [
  { id: "hi", term: "Hi", kanji: "緋", meaning: "The red. Judges look for colour that is even, deep and solid right to its edge.", at: (p) => p.patches[2] },
  { id: "sumi", term: "Sumi", kanji: "墨", meaning: "The black. Glossy like lacquer, and it often deepens as the fish grows.", at: () => ({ u: 0.9, v: 0.05 }) },
  { id: "shiroji", term: "Shiroji", kanji: "白地", meaning: "The white skin. A clean white ground makes every other colour read.", at: (p) => p.patches[3] },
  { id: "kiwa", term: "Kiwa", kanji: "際", meaning: "The back edge of a patch, where colour meets white. Sharp is prized.", at: (p) => ({ u: p.patches[2].u + p.patches[2].ru * 0.92, v: p.patches[2].v }) },
  { id: "sashi", term: "Sashi", kanji: "差し", meaning: "The front edge, where white scales overlap the colour, so it looks soft.", at: (p) => ({ u: p.patches[2].u - p.patches[2].ru * 0.92, v: p.patches[2].v }) },
  { id: "menware", term: "Menware", kanji: "面割れ", meaning: "Black that splits the head like a crack. A Shōwa trait.", at: (p) => p.patches[5] },
  { id: "motoguro", term: "Motoguro", kanji: "元黒", meaning: "Solid black at the root of the pectoral fins.", at: () => ({ u: FINS.pectoralU + 0.02, v: 1.5 }) },
];

const ELSEWHERE: readonly { term: string; kanji: string; meaning: string; variety: VarietyId; label: string }[] = [
  { term: "Doitsu", kanji: "ドイツ", meaning: "Few or no scales; from the Japanese word for Germany.", variety: "shusui", label: "See it on Shūsui" },
  { term: "Fukurin", kanji: "覆輪", meaning: "Skin around each scale that catches light, so the body reads as a net.", variety: "ogon", label: "See it on Ōgon" },
  { term: "Tanchō", kanji: "丹頂", meaning: "A single red mark on the head and nowhere else.", variety: "tancho", label: "See it on Tanchō" },
];

interface Props {
  readonly onShowVariety: (id: VarietyId) => void;
}

/** The specimen holds station: a slow tail beat, pectorals fanned and sculling, a gentle sway. */
const POSE = { amplitude: 0.03, flare: 0.75 } as const;
const SHADOW = { dx: 0.03, dy: 0.05, blur: 0.05, alpha: 0.22 } as const;
/** How much of the body's movement the specimen makes (it is a plate, so less than the stage fish). */
const SWAY = 0.6;
/** Extra room for that sway, in body lengths, and clear space around the drawing, in pixels. */
const SWAY_ROOM = 0.06;
const PAD = 12;

/** Snout position, direction and size that fit the whole drawn fish (barbels to tail tips) in the plate. */
function placeSpecimen(width: number, height: number, extent: KoiExtent) {
  const upright = width < 600;
  const along = extent.ahead + extent.behind + SWAY_ROOM * 2;
  const across = (extent.side + SWAY_ROOM) * 2;
  const [long, short] = upright ? [height, width] : [width, height];
  const length = clamp(Math.min((long - PAD * 2) / along, (short - PAD * 2) / across), 120, 1400);
  const lead = (long - along * length) / 2 + (extent.ahead + SWAY_ROOM) * length;
  return upright
    ? { length, snout: { x: width / 2, y: lead }, toTail: { x: 0, y: 1 } }
    : { length, snout: { x: lead, y: height / 2 }, toTail: { x: 1, y: 0 } };
}

export function Glossary({ onShowVariety }: Props) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState<string | null>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const canvases = useMemo(() => [canvasRef], []);
  const pattern = useMemo(() => generatePattern("showa", SPECIMEN_SEED), []);

  const draw = useCallback(
    ({ contexts: [ctx], size, time }: LoopFrame) => {
      const fit = koiExtent(pattern, POSE, SHADOW); // measured once per pattern, then cached
      const { length, snout, toTail } = placeSpecimen(size.width, size.height, fit);
      const t = reduced ? 0.6 : time;
      const spine = holdingSpine(snout, toTail, length, t, SPINE_POINTS, reduced ? 0 : SWAY);
      const frame = poseKoi(spine, length, { ...POSE, beat: reduced ? 1.1 : t * 2.8, time: t });
      drawKoi(ctx, frame, pattern, { pixelRatio: size.dpr, shadow: shadowAt(SHADOW, length) });
      // The numbered markers ride on the body; moved directly, so React doesn't re-render every frame.
      const points = spreadApart(
        TERMS.map((term) => {
          const { u, v } = term.at(pattern);
          return bodyPoint(frame, u, v);
        }),
        MARKER_GAP,
      );
      points.forEach((p, i) => {
        const el = markerRefs.current[i];
        if (!el) return;
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        el.dataset.placed = "true";
      });
    },
    [pattern, reduced],
  );

  useCanvasLoop(plateRef, canvases, draw, { animate: !reduced });

  return (
    <section className="reading section" id="reading" aria-labelledby="reading-title">
      <div className="reading__head">
        <p className="label">03 — Reading a koi</p>
        <h2 id="reading-title" className="reading__title">
          Judges speak a small, exact vocabulary. Here it is on one Shōwa.
        </h2>
      </div>

      <div className="reading__grid">
        <div className="reading__plate" ref={plateRef}>
          <canvas ref={canvasRef} className="reading__canvas" role="img" aria-label="A Shōwa Sanshoku koi with seven numbered points of interest" />
          {TERMS.map((term, i) => (
            <button
              key={term.id}
              ref={(el) => {
                markerRefs.current[i] = el;
              }}
              type="button"
              className="reading__marker"
              aria-label={`${i + 1}: ${term.term}`}
              aria-describedby={`term-${term.id}`}
              data-active={active === term.id}
              onPointerEnter={() => setActive(term.id)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(term.id)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(term.id)}
            >
              <span aria-hidden="true">{i + 1}</span>
            </button>
          ))}
        </div>

        <div className="reading__terms">
          <ol className="reading__list">
            {TERMS.map((t, i) => (
              <li
                key={t.id}
                className="reading__term"
                data-active={active === t.id}
                onPointerEnter={() => setActive(t.id)}
                onPointerLeave={() => setActive(null)}
              >
                <span className="reading__num label" aria-hidden="true">
                  {i + 1}
                </span>
                <p id={`term-${t.id}`}>
                  <strong>{t.term}</strong> <span className="jp">{t.kanji}</span> — {t.meaning}
                </p>
              </li>
            ))}
          </ol>
          <p className="label reading__elsewhere-label">Elsewhere in the guide</p>
          <ul className="reading__elsewhere">
            {ELSEWHERE.map((e) => (
              <li key={e.term}>
                <p>
                  <strong>{e.term}</strong> <span className="jp">{e.kanji}</span> — {e.meaning}
                </p>
                <a
                  className="text-link"
                  href="#varieties"
                  onClick={() => onShowVariety(e.variety)}
                >
                  {e.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
