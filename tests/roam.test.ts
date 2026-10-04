import { describe, expect, test } from "vitest";
import { angleDelta, distance, type Vec } from "../src/lib/geometry";
import { MAX_TURN_AWAY, nextWaypoint, roamStep, startRoaming, type Ellipse, type Roamer } from "../src/lib/roam";
import { mulberry32 } from "../src/lib/rng";
import { createSwimmer } from "../src/lib/swim";

// The hero's swim area and hop on a 1632×1060 screen, where the koi is about 440px long.
const AREA: Ellipse = { center: { x: 816, y: 519 }, rx: 620, ry: 286 };
const HOP = 350;
const inside = (p: Vec) => ((p.x - AREA.center.x) / AREA.rx) ** 2 + ((p.y - AREA.center.y) / AREA.ry) ** 2 <= 1 + 1e-9;

/** Follows the waypoints the way the hero does: arrive, look at where you're facing, pick the next. */
function tour(seed: number, legs: number): { turns: number[]; points: Vec[] } {
  const rng = mulberry32(seed);
  let at: Vec = AREA.center;
  let heading = 0;
  const turns: number[] = [];
  const points: Vec[] = [];
  for (let i = 0; i < legs; i++) {
    const next = nextWaypoint(rng, at, heading, AREA, HOP);
    const bearing = Math.atan2(next.y - at.y, next.x - at.x);
    turns.push(angleDelta(heading, bearing));
    points.push(next);
    heading = bearing;
    at = next;
  }
  return { turns, points };
}

describe("roaming waypoints", () => {
  test("every waypoint stays inside the swim area", () => {
    expect(tour(3, 300).points.every(inside)).toBe(true);
  });

  test("each hop is a real swim, not a shuffle on the spot", () => {
    const { points } = tour(5, 300);
    points.slice(1).forEach((p, i) => expect(distance(points[i], p)).toBeGreaterThanOrEqual(HOP));
  });

  test("turns go left and right at random, so the fish never settles into circling one way", () => {
    const { turns } = tour(7, 400);
    const left = turns.filter((t) => t > 0.05).length / turns.length;
    const right = turns.filter((t) => t < -0.05).length / turns.length;
    expect(left).toBeGreaterThan(0.35);
    expect(right).toBeGreaterThan(0.35);
    // No long runs of same-direction turns: a fair coin over 400 legs peaks around 8–9 in a row,
    // while a route circulating round the rim gives runs of 20 or more.
    let run = 1;
    let longest = 1;
    for (let i = 1; i < turns.length; i++) {
      run = Math.sign(turns[i]) === Math.sign(turns[i - 1]) ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThan(14);
  });

  test("after a turn one way, the next usually goes the other way (fish alternate)", () => {
    const rng = mulberry32(21);
    let at: Vec = AREA.center;
    let heading = 0;
    let last = 1;
    let switches = 0;
    const legs = 400;
    for (let i = 0; i < legs; i++) {
      const next = nextWaypoint(rng, at, heading, AREA, HOP, last);
      const bearing = Math.atan2(next.y - at.y, next.x - at.x);
      const side = Math.sign(angleDelta(heading, bearing)) || 1;
      if (side !== last) switches++;
      last = side;
      heading = bearing;
      at = next;
    }
    expect(switches / legs).toBeGreaterThan(0.55);
    expect(switches / legs).toBeLessThan(0.85);
  });

  test("the fish never has to reverse dead astern", () => {
    const { turns } = tour(11, 300);
    expect(turns.filter((t) => Math.abs(t) > MAX_TURN_AWAY + 1e-9)).toHaveLength(0);
  });
});

describe("the hero koi left to roam for two minutes (1632×1060 screen)", () => {
  const W = 1632;
  const H = 1060;
  const params = { length: 440, cruise: 0.42, maxTurn: 1.4 };
  const run = (seed: number) => {
    const rng = mulberry32(seed);
    let r: Roamer = startRoaming(createSwimmer({ x: W * 0.68, y: H * 0.47 }, Math.PI * 0.75, params));
    const frames: Roamer[] = [];
    for (let t = 0; t < 120; t += 1 / 60) {
      r = roamStep(r, rng, AREA, params, 1 / 60);
      frames.push(r);
    }
    return frames;
  };
  const spread = (r: Roamer) => ((r.swimmer.x - AREA.center.x) / AREA.rx) ** 2 + ((r.swimmer.y - AREA.center.y) / AREA.ry) ** 2;

  test.each([1, 2, 3])("stays over the word and on screen (seed %i)", (seed) => {
    const frames = run(seed);
    expect(frames.filter((r) => spread(r) <= 1.3).length / frames.length).toBeGreaterThan(0.9);
    expect(frames.every((r) => r.swimmer.x > 0 && r.swimmer.x < W && r.swimmer.y > 0 && r.swimmer.y < H)).toBe(true);
  });

  test.each([1, 2, 3])("beats and glides instead of rowing non-stop (seed %i)", (seed) => {
    const frames = run(seed);
    // Clean glides only (the stroke fully died away). The hero koi turns far more than one
    // cruising a straight line (that rhythm is tested in swim.test.ts), so the floor is lower here.
    const gliding = frames.filter((r) => r.swimmer.drive < 0.35).length / frames.length;
    expect(gliding).toBeGreaterThan(0.2);
    expect(gliding).toBeLessThan(0.85);
  });

  test.each([1, 2, 3])("swims in legs, not a constant spin (seed %i)", (seed) => {
    const frames = run(seed);
    // A big koi in a small pond wheels at each end, so it turns a lot; a fish that never settles
    // into a leg turns almost all the time (97% before legs were introduced).
    const turning = frames.filter((r) => Math.abs(r.swimmer.yawRate) > 0.5).length / frames.length;
    expect(turning).toBeLessThan(0.65);
  });

  test.each([1, 2, 3])("turns both ways, with no long spell of circling one way (seed %i)", (seed) => {
    const frames = run(seed);
    // Net heading change over each two-second window: + is one way round, - the other.
    const windows: number[] = [];
    for (let i = 120; i < frames.length; i += 120) windows.push(angleDelta(frames[i - 120].swimmer.heading, frames[i].swimmer.heading));
    const turning = windows.filter((w) => Math.abs(w) > 0.1);
    const oneWay = turning.filter((w) => w > 0).length / turning.length;
    expect(oneWay).toBeGreaterThan(0.25);
    expect(oneWay).toBeLessThan(0.75);
    let spell = 1;
    let longest = 1;
    for (let i = 1; i < turning.length; i++) {
      spell = Math.sign(turning[i]) === Math.sign(turning[i - 1]) ? spell + 1 : 1;
      longest = Math.max(longest, spell);
    }
    // Circling bugs gave 19–46 windows one way on end; random roaming switches every few, and three
    // same-way wheels in a row (~11 windows) is ordinary chance.
    expect(longest).toBeLessThanOrEqual(12);
  });
});
