import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clamp } from "../lib/geometry";
import { TAIL_AMPLITUDE } from "../lib/locomotion";
import { generatePattern } from "../lib/patterns";
import { choose, currentPick, currentRound, isFinished, newGame, next, score, type QuizState } from "../lib/quiz";
import { mulberry32, type Rng } from "../lib/rng";
import { createSwimmer, spineOf, stepSwimmer, type SwimParams, type Swimmer } from "../lib/swim";
import { varietyById, type VarietyId } from "../lib/varieties";
import { useCanvasLoop, type LoopFrame } from "../hooks/useCanvasLoop";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { drawKoi, poseKoi, poseSwimmer, type KoiFrame } from "../render/koi";
import { ArrowRight } from "./Icons";
import "./Quiz.css";

/** Seconds between coin tosses over which way to circle. */
const FLIP_MIN = 4;
const FLIP_SPREAD = 8;

const VERDICTS = [
  "Every expert started here. Spend a minute on the stage and try again.",
  "A start. Black is usually the giveaway: where it sits, and whether it is there at all.",
  "Getting there. Watch the head: red only, black on it, or one round mark?",
  "Good eye. You can already tell the three-colour fish apart.",
  "Sharp. You read patterns the way a judge does.",
] as const;

function verdictFor(points: number, total: number): string {
  return VERDICTS[Math.min(VERDICTS.length - 1, Math.floor((points / total) * (VERDICTS.length - 1) + 0.0001))];
}

const freshSeed = () => Math.floor(Math.random() * 2 ** 31);

export function Quiz() {
  const reduced = useReducedMotion();
  const [game, setGame] = useState<QuizState>(() => newGame(freshSeed()));
  const bowlRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const canvases = useMemo(() => [canvasRef], []);
  const round = currentRound(game);
  const pick = currentPick(game);
  const finished = isFinished(game);
  const pattern = useMemo(() => generatePattern(round.answer, round.seed), [round]);
  const answer = varietyById(round.answer);
  // Circling the bowl, and now and then (a coin toss every few seconds) wheeling round the other way.
  const swim = useRef<{ swimmer: Swimmer | null; angle: number; dir: number; flipIn: number; rng: Rng | null; size: string }>({
    swimmer: null,
    angle: 0,
    dir: 1,
    flipIn: FLIP_MIN,
    rng: null,
    size: "",
  });

  const draw = useCallback(
    ({ contexts: [ctx], size, dt, time }: LoopFrame) => {
      const radius = Math.min(size.width, size.height) / 2;
      // Circling close to the middle keeps the whole fish, tail included, inside the bowl.
      const length = clamp(radius * 0.7, 110, 700);
      const params: SwimParams = { length, cruise: 0.3, maxTurn: 2 };
      const cx = size.width / 2;
      const cy = size.height / 2;
      const orbit = radius * 0.5;
      const s = swim.current;
      let frame: KoiFrame;
      if (reduced) {
        const resting = createSwimmer({ x: cx + length * 0.5, y: cy }, Math.PI, params);
        frame = poseKoi(spineOf(resting, params), length, { beat: 1, time: 0, amplitude: TAIL_AMPLITUDE * 0.6 });
      } else {
        const key = `${size.width}x${size.height}`;
        if (!s.swimmer || s.size !== key) {
          s.swimmer = createSwimmer({ x: cx + orbit, y: cy }, Math.PI / 2, params);
          s.size = key;
        }
        const rng = (s.rng ??= mulberry32(freshSeed()));
        s.flipIn -= dt;
        if (s.flipIn <= 0) {
          s.dir = rng() < 0.5 ? -s.dir : s.dir;
          s.flipIn = FLIP_MIN + rng() * FLIP_SPREAD;
        }
        s.angle += (s.dir * dt * params.cruise * length) / orbit;
        const lead = s.angle + s.dir * 0.7;
        const target = { x: cx + Math.cos(lead) * orbit, y: cy + Math.sin(lead) * orbit };
        s.swimmer = stepSwimmer(s.swimmer, target, dt, params);
        frame = poseSwimmer(s.swimmer, params, time);
      }
      drawKoi(ctx, frame, pattern, {
        pixelRatio: size.dpr,
        shadow: { dx: length * 0.03, dy: length * 0.06, blur: length * 0.06, alpha: 0.5 },
      });
    },
    [pattern, reduced],
  );

  const redraw = useCanvasLoop(bowlRef, canvases, draw, { animate: !reduced });
  useEffect(() => redraw.current(), [pattern, redraw]);

  const onPick = (id: VarietyId) => {
    setGame((g) => choose(g, id));
    requestAnimationFrame(() => nextRef.current?.focus());
  };
  const onNext = () => {
    setGame((g) => next(g));
    requestAnimationFrame(() => firstOptionRef.current?.focus());
  };
  const onRestart = () => {
    setGame(newGame(freshSeed()));
    requestAnimationFrame(() => firstOptionRef.current?.focus());
  };

  const correct = pick === round.answer;
  const total = game.rounds.length;

  return (
    <section className="quiz section" id="play" aria-labelledby="quiz-title">
      <div className="quiz__head">
        <p className="label">04 — Play</p>
        <h2 id="quiz-title" className="quiz__title">
          Name that koi. Six fish, each drawn fresh, so no two games look alike.
        </h2>
      </div>

      <div className="quiz__grid">
        <div className="quiz__stage">
          <span className="quiz__glyph display" aria-hidden="true">
            ?
          </span>
          <div className="quiz__bowl" ref={bowlRef}>
            <canvas ref={canvasRef} className="quiz__canvas" role="img" aria-label="A koi swimming in a bowl. Which variety is it?" />
          </div>
        </div>

        <div className="quiz__panel">
          <p className="label quiz__progress">
            Round {game.index + 1} of {total} · {score(game)} right
          </p>
          <fieldset className="quiz__options" aria-describedby="quiz-feedback">
            <legend className="sr-only">Which variety is this?</legend>
            {round.options.map((id, i) => {
              const state = pick === null ? "open" : id === round.answer ? "answer" : id === pick ? "wrong" : "idle";
              return (
                <button
                  key={`${game.index}-${id}`}
                  ref={i === 0 ? firstOptionRef : undefined}
                  type="button"
                  className="quiz__option"
                  data-state={state}
                  disabled={pick !== null}
                  aria-pressed={pick === id}
                  onClick={() => onPick(id)}
                >
                  <span>{varietyById(id).name}</span>
                  {state === "answer" && <span aria-hidden="true">✓</span>}
                  {state === "wrong" && <span aria-hidden="true">✕</span>}
                </button>
              );
            })}
          </fieldset>

          <p className="quiz__feedback" id="quiz-feedback" aria-live="polite">
            {pick === null
              ? "Look at the head first, then the black."
              : correct
                ? `Right. ${answer.lookFor[0]}`
                : `Not quite: this is ${answer.name}. ${answer.lookFor[0]}`}
          </p>

          {pick !== null && !finished && (
            <button ref={nextRef} type="button" className="btn btn--signal" onClick={onNext}>
              Next fish
              <ArrowRight />
            </button>
          )}
          {finished && (
            <div className="quiz__result">
              <p>
                <strong>
                  You named {score(game)} of {total}.
                </strong>{" "}
                {verdictFor(score(game), total)}
              </p>
              <div className="quiz__result-actions">
                <button ref={nextRef} type="button" className="btn btn--signal" onClick={onRestart}>
                  Play again
                </button>
                <a className="text-link" href="#varieties">
                  Study the varieties
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
