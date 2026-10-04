import { intBetween, mulberry32, pick, shuffled, type Rng } from "./rng";
import { VARIETIES, varietyById, type VarietyId } from "./varieties";

export const OPTIONS_PER_ROUND = 4;
export const ROUNDS_PER_GAME = 6;

export interface Round {
  readonly answer: VarietyId;
  readonly options: readonly VarietyId[];
  /** Seed for the fish's pattern, so every round draws a new individual. */
  readonly seed: number;
}

export interface QuizState {
  readonly rounds: readonly Round[];
  readonly picks: readonly (VarietyId | null)[];
  readonly index: number;
}

/** Distractors favour the varieties people actually confuse, then fill at random. */
export function makeRound(rng: Rng, answer: VarietyId): Round {
  const confusers = shuffled(rng, varietyById(answer).confusedWith);
  const others = shuffled(
    rng,
    VARIETIES.map((v) => v.id).filter((id) => id !== answer && !confusers.includes(id)),
  );
  const distractors = [...confusers, ...others].slice(0, OPTIONS_PER_ROUND - 1);
  return { answer, options: shuffled(rng, [answer, ...distractors]), seed: intBetween(rng, 1, 2 ** 30) };
}

export function newGame(seed: number, rounds = ROUNDS_PER_GAME): QuizState {
  const rng = mulberry32(seed);
  const ids = VARIETIES.map((v) => v.id);
  const list: Round[] = [];
  for (let i = 0; i < rounds; i++) {
    const previous = list[i - 1]?.answer;
    const answer = pick(rng, ids.filter((id) => id !== previous));
    list.push(makeRound(rng, answer));
  }
  return { rounds: list, picks: list.map(() => null), index: 0 };
}

export const currentRound = (s: QuizState): Round => s.rounds[s.index];
export const currentPick = (s: QuizState): VarietyId | null => s.picks[s.index];
export const isFinished = (s: QuizState): boolean => s.index >= s.rounds.length - 1 && currentPick(s) !== null;

/** Records the first answer for the current round; later taps on the same round are ignored. */
export function choose(s: QuizState, choice: VarietyId): QuizState {
  if (currentPick(s) !== null) return s;
  if (!currentRound(s).options.includes(choice)) throw new Error(`${choice} is not an option this round`);
  return { ...s, picks: s.picks.map((p, i) => (i === s.index ? choice : p)) };
}

export function next(s: QuizState): QuizState {
  if (currentPick(s) === null || s.index >= s.rounds.length - 1) return s;
  return { ...s, index: s.index + 1 };
}

export function score(s: QuizState): number {
  return s.picks.filter((p, i) => p === s.rounds[i].answer).length;
}
