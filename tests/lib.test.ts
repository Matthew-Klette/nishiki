import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { halfWidth, MAX_HALF_WIDTH, WIDEST_U } from "../src/lib/body";
import { contrastRatio } from "../src/lib/contrast";
import { angleDelta, distance, spreadApart } from "../src/lib/geometry";
import { generatePattern, patchOutline, pigmentsOf } from "../src/lib/patterns";
import { addPellet, assignMeals, MAX_PELLETS, nearestPellet, PELLET_LIFE, stepPond, wanderTarget, type PondFish, type PondState } from "../src/lib/pond";
import { choose, currentRound, isFinished, newGame, next, OPTIONS_PER_ROUND, score } from "../src/lib/quiz";
import { mulberry32, shuffled } from "../src/lib/rng";
import { createSwimmer, type SwimParams } from "../src/lib/swim";
import { VARIETIES, varietyById, type VarietyId } from "../src/lib/varieties";

const PARAMS: SwimParams = { length: 200, cruise: 0.4, maxTurn: 1 };

describe("rng", () => {
  test("same seed gives the same sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  test("shuffled returns a permutation and leaves the input alone", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffled(mulberry32(1), input);
    expect(out.slice().sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("geometry", () => {
  test("angleDelta takes the short way round", () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
  });

  test("spreadApart separates crowded tap targets and leaves spaced ones alone", () => {
    const crowded = spreadApart([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }], 46);
    for (let i = 0; i < crowded.length; i++)
      for (let j = i + 1; j < crowded.length; j++) expect(distance(crowded[i], crowded[j])).toBeGreaterThanOrEqual(45.5);
    expect(spreadApart([{ x: 0, y: 0 }, { x: 100, y: 0 }], 46)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });

});

describe("body", () => {
  test("widest point is behind the head and matches the configured width", () => {
    expect(WIDEST_U).toBeGreaterThan(0.25);
    expect(WIDEST_U).toBeLessThan(0.4);
    expect(halfWidth(WIDEST_U)).toBeCloseTo(MAX_HALF_WIDTH);
  });

  test("the tail root is much narrower than the shoulders", () => {
    expect(halfWidth(1)).toBeLessThan(halfWidth(WIDEST_U) / 3);
  });
});

describe("patterns", () => {
  test("generation is deterministic per seed", () => {
    expect(generatePattern("kohaku", 7)).toEqual(generatePattern("kohaku", 7));
    expect(generatePattern("kohaku", 7)).not.toEqual(generatePattern("kohaku", 8));
  });

  test.each([1, 2, 3, 4, 5])("each variety keeps its defining colours (seed %i)", (seed) => {
    const of = (id: VarietyId) => pigmentsOf(generatePattern(id, seed));
    expect(of("kohaku")).toEqual(new Set(["shiro", "hi"]));
    expect(of("sanke")).toEqual(new Set(["shiro", "hi", "sumi"]));
    expect(of("showa")).toEqual(new Set(["sumi", "hi", "shiro"]));
    expect(of("utsuri")).toEqual(new Set(["sumi", "shiro"]));
    expect(of("ogon")).toEqual(new Set(["kin"]));
  });

  test("tanchō has exactly one red mark, on the head", () => {
    const p = generatePattern("tancho", 3);
    expect(p.patches).toHaveLength(1);
    expect(p.patches[0].pigment).toBe("hi");
    expect(p.patches[0].u).toBeLessThan(0.12);
  });

  test("sanke keeps black off the head", () => {
    for (let seed = 1; seed < 20; seed++) {
      const sumi = generatePattern("sanke", seed).patches.filter((p) => p.pigment === "sumi");
      sumi.forEach((p) => expect(p.u - p.ru).toBeGreaterThan(0.15));
    }
  });

  test("patch outlines close around their centre", () => {
    const patch = generatePattern("kohaku", 2).patches[1];
    const outline = patchOutline(patch, 40);
    const meanU = outline.reduce((s, o) => s + o.u, 0) / outline.length;
    expect(meanU).toBeCloseTo(patch.u, 1);
  });
});

describe("quiz", () => {
  test("every round has four distinct options including the answer", () => {
    const game = newGame(99, 30);
    for (const round of game.rounds) {
      expect(new Set(round.options).size).toBe(OPTIONS_PER_ROUND);
      expect(round.options).toContain(round.answer);
    }
  });

  test("distractors start with the varieties people confuse", () => {
    const game = newGame(5, 30);
    for (const round of game.rounds) {
      varietyById(round.answer).confusedWith.forEach((c) => expect(round.options).toContain(c));
    }
  });

  test("the same answer never comes up twice in a row", () => {
    const { rounds } = newGame(3, 40);
    rounds.slice(1).forEach((r, i) => expect(r.answer).not.toBe(rounds[i].answer));
  });

  test("scoring counts first answers only and the game ends on the last round", () => {
    const wrongOf = (g: ReturnType<typeof newGame>) => currentRound(g).options.find((o) => o !== currentRound(g).answer) as VarietyId;
    let game = newGame(11, 2);
    game = choose(game, currentRound(game).answer);
    game = choose(game, wrongOf(game));
    expect(score(game)).toBe(1);
    expect(isFinished(game)).toBe(false);
    game = next(game);
    game = choose(game, wrongOf(game));
    expect(score(game)).toBe(1);
    expect(isFinished(game)).toBe(true);
  });

  test("next() waits for an answer", () => {
    const game = newGame(1);
    expect(next(game)).toBe(game);
  });

  test("choosing something that is not an option throws", () => {
    const game = newGame(1);
    const missing = VARIETIES.map((v) => v.id).find((id) => !currentRound(game).options.includes(id)) as VarietyId;
    expect(() => choose(game, missing)).toThrow();
  });
});

describe("pond", () => {
  const fishAt = (x: number, y: number, heading = 0): PondFish => ({
    swimmer: createSwimmer({ x, y }, heading, PARAMS),
    pattern: generatePattern("kohaku", 1),
    params: PARAMS,
    course: heading,
    ponder: 5,
  });
  const bounds = { width: 1000, height: 600 };

  test("a pellet draws at most two koi; the rest take other food or carry on", () => {
    const fish = Array.from({ length: 6 }, (_, i) => fishAt(100 + i * 60, 300));
    const one = assignMeals(fish, [{ id: 1, x: 300, y: 320, age: 0 }]);
    expect(one.filter((p) => p !== null)).toHaveLength(2);
    const three = assignMeals(fish, [1, 2, 3].map((id) => ({ id, x: 100 + id * 120, y: 320, age: 0 })));
    expect(three.every((p) => p !== null)).toBe(true);
  });

  test("food nobody eats sinks after a while, so fish don't mill round it for ever", () => {
    let state: PondState = addPellet({ fish: [], pellets: [] }, { x: 500, y: 300 }, 1);
    const rng = mulberry32(3);
    for (let t = 0; t < PELLET_LIFE + 0.2; t += 1 / 60) state = stepPond(state, bounds, 1 / 60, rng);
    expect(state.pellets).toHaveLength(0);
  });

  test("after a feeding frenzy the koi spread out again instead of leaving as one clump", () => {
    const big = { width: 1600, height: 1000 };
    const clump = Array.from({ length: 6 }, (_, i) => fishAt(800 + (i % 3) * 25, 500 + Math.floor(i / 3) * 25, 0.3));
    let state: PondState = { fish: clump, pellets: [] };
    const rng = mulberry32(9);
    for (let t = 0; t < 8; t += 1 / 60) state = stepPond(state, big, 1 / 60, rng);
    const nearest = state.fish.map((f) => Math.min(...state.fish.filter((g) => g !== f).map((g) => distance(f.swimmer, g.swimmer))));
    const mean = nearest.reduce((a, b) => a + b, 0) / nearest.length;
    expect(mean).toBeGreaterThan(PARAMS.length * 0.6);
  });

  test("nearestPellet picks the closest food", () => {
    const f = fishAt(100, 100);
    const p = nearestPellet(f, [
      { id: 1, x: 900, y: 500, age: 0 },
      { id: 2, x: 150, y: 120, age: 0 },
    ]);
    expect(p?.id).toBe(2);
    expect(nearestPellet(f, [])).toBeNull();
  });

  test("wander targets near a wall are pulled back into the water", () => {
    const t = wanderTarget(fishAt(980, 300, 0), bounds);
    expect(t.x).toBeLessThan(bounds.width - PARAMS.length * 0.5);
  });

  test("a fish that reaches a pellet eats it", () => {
    let state: PondState = addPellet({ fish: [fishAt(100, 300)], pellets: [] }, { x: 140, y: 300 }, 1);
    const rng = mulberry32(1);
    for (let i = 0; i < 120 && state.pellets.length; i++) state = stepPond(state, bounds, 1 / 60, rng);
    expect(state.pellets).toHaveLength(0);
  });

  test("the pond holds a limited number of pellets", () => {
    let state: PondState = { fish: [], pellets: [] };
    for (let i = 0; i < MAX_PELLETS + 5; i++) state = addPellet(state, { x: i, y: i }, i);
    expect(state.pellets).toHaveLength(MAX_PELLETS);
    expect(state.pellets[0].id).toBe(5);
  });
});

describe("palette meets WCAG AA", () => {
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const token = (name: string) => {
    const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{3,6})`, "i"));
    if (!match) throw new Error(`Missing token --${name}`);
    return match[1];
  };

  test.each([
    ["washi", "vermilion"],
    ["washi", "vermilion-hi"],
    ["washi", "vermilion-lo"],
    ["washi", "slate"],
    ["washi", "slate-hi"],
    ["washi-muted", "slate"],
    ["washi-muted", "sumi"],
    ["washi-muted", "pond"],
    ["washi", "pond"],
    ["sumi", "washi"],
    ["ink-muted", "washi"],
    ["sumi", "kin"],
    ["sumi", "kin-press"],
  ])("text %s on %s is at least 4.5:1", (fg, bg) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  test.each([
    ["kin", "vermilion"],
    ["kin", "vermilion-hi"],
    ["kin", "slate"],
    ["kin", "pond"],
  ])("the tap colour %s stands out from %s by at least 3:1", (fg, bg) => {
    expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(3);
  });
});
