import { describe, expect, test } from "vitest";
import { angleDelta, distance, type Vec } from "../src/lib/geometry";
import { PIVOT_U, STRIDE, WAVE_NUMBER, bendShare, waveEnvelope } from "../src/lib/locomotion";
import { holdingSpine } from "../src/lib/holding";
import { createSwimmer, inReach, motionOf, spineOf, stepSwimmer, type SwimParams, type Swimmer } from "../src/lib/swim";
import { bodyPoint, poseKoi } from "../src/render/koiFrame";

const L = 300;
const PARAMS: SwimParams = { length: L, cruise: 0.4, maxTurn: 1.6 };
const DT = 1 / 60;

/** Runs a swimmer for `seconds`, chasing whatever `target` returns each frame. */
function run(start: Swimmer, seconds: number, target: (s: Swimmer, t: number) => Vec, urgency = 1): Swimmer[] {
  const out: Swimmer[] = [];
  let s = start;
  for (let t = 0; t < seconds; t += DT) {
    s = stepSwimmer(s, target(s, t), DT, PARAMS, urgency);
    out.push(s);
  }
  return out;
}

/** A target that keeps running away along +x, so the fish cruises and never arrives. */
const farAhead = (s: Swimmer): Vec => ({ x: s.x + L * 10, y: 0 });

/** Signed turning angle at each interior spine point. */
function turns(points: readonly Vec[]): number[] {
  return points.slice(1, -1).map((p, i) => {
    const a = points[i];
    const b = points[i + 2];
    return angleDelta(Math.atan2(p.y - a.y, p.x - a.x), Math.atan2(b.y - p.y, b.x - p.x));
  });
}

describe("the body wave (subcarangiform, like a carp)", () => {
  const spine = spineOf(createSwimmer({ x: 0, y: 0 }, 0, PARAMS), PARAMS);
  const sway = (u: number) => {
    let most = 0;
    for (let beat = 0; beat < Math.PI * 2; beat += 0.05) {
      const frame = poseKoi(spine, L, { beat, time: 0, amplitude: 0.06, drive: 1 });
      most = Math.max(most, Math.abs(bodyPoint(frame, u, 0).y));
    }
    return most / L;
  };

  test("the tail root sweeps by the full amplitude", () => {
    expect(sway(1)).toBeCloseTo(0.06, 2);
  });

  test("the head only recoils a little, so it never leads a slither", () => {
    // Measured fish: the snout sways a quarter as far as the tail tip, about 0.38 of the tail root.
    expect(sway(0)).toBeLessThan(sway(1) * 0.42);
    expect(sway(0)).toBeGreaterThan(0);
  });

  test("the quietest point sits about a quarter of the way back, where the fish pivots", () => {
    const us = Array.from({ length: 41 }, (_, i) => i / 40);
    const quietest = us.reduce((best, u) => (sway(u) < sway(best) ? u : best), 0);
    expect(quietest).toBeGreaterThan(0.15);
    expect(quietest).toBeLessThan(0.42);
    expect(PIVOT_U).toBeGreaterThan(0.15);
    expect(PIVOT_U).toBeLessThan(0.42);
  });

  test("the envelope grows toward the tail and is 1 at the tail root", () => {
    expect(waveEnvelope(1)).toBeCloseTo(1, 5);
    expect(waveEnvelope(0.8)).toBeGreaterThan(waveEnvelope(0.6));
    expect(waveEnvelope(0.6)).toBeGreaterThan(waveEnvelope(0.4));
  });

  test("the wave outruns the fish (slip below 1); a snake's wave stands still on the ground", () => {
    const slip = (STRIDE * WAVE_NUMBER) / (Math.PI * 2);
    expect(slip).toBeGreaterThan(0.5);
    expect(slip).toBeLessThan(0.85);
  });

  test("with the drive off, the body is the plain midline (a glide)", () => {
    const frame = poseKoi(spine, L, { beat: 1.3, time: 0, amplitude: 0.06, drive: 0 });
    expect(Math.abs(bodyPoint(frame, 1, 0).y)).toBeLessThan(0.002 * L);
  });
});

describe("beat and glide", () => {
  test("a cruising koi alternates a few tail beats with long glides", () => {
    const states = run(createSwimmer({ x: 0, y: 0 }, 0, PARAMS), 40, farAhead);
    const gliding = states.filter((s) => s.drive < 0.35).length / states.length;
    const bursts = states.filter((s, i) => i > 0 && s.stroking && !states[i - 1].stroking).length;
    expect(gliding).toBeGreaterThan(0.2);
    expect(gliding).toBeLessThan(0.75);
    expect(bursts).toBeGreaterThanOrEqual(5);
  });

  test("cruising speed averages out near the asked-for cruise", () => {
    const states = run(createSwimmer({ x: 0, y: 0 }, 0, PARAMS), 40, farAhead).slice(600);
    const mean = states.reduce((sum, s) => sum + s.speed, 0) / states.length / L;
    expect(mean).toBeGreaterThan(PARAMS.cruise * 0.7);
    expect(mean).toBeLessThan(PARAMS.cruise * 1.4);
  });

  test("a glide slows the way a koi's does: U(t) = U0 / (1 + 1.22·U0·t)", () => {
    const fast: Swimmer = { ...createSwimmer({ x: 0, y: 0 }, 0, PARAMS), speed: L * 0.9, drive: 0, stroking: false };
    const later = run(fast, 0.5, farAhead).at(-1) as Swimmer;
    const law = 0.9 / (1 + 1.22 * 0.9 * 0.5);
    expect(later.speed / L).toBeGreaterThan(law * 0.9);
    expect(later.speed / L).toBeLessThan(law * 1.1);
  });

  test("a fish darting for food keeps beating and never glides", () => {
    const states = run(createSwimmer({ x: 0, y: 0 }, 0, PARAMS), 4, farAhead, 2.3).slice(60);
    expect(states.every((s) => s.drive > 0.7)).toBe(true);
  });

  test("a steady stroke covers about STRIDE body lengths per tail beat", () => {
    const states = run(createSwimmer({ x: 0, y: 0 }, 0, PARAMS), 12, farAhead, 2.3);
    const a = states[300];
    const b = states.at(-1) as Swimmer;
    const beats = (b.phase - a.phase) / (Math.PI * 2);
    const stride = (b.x - a.x) / L / beats;
    expect(stride).toBeGreaterThan(STRIDE * 0.85);
    expect(stride).toBeLessThan(STRIDE * 1.15);
  });
});

describe("turning", () => {
  const turning = () => run(createSwimmer({ x: 0, y: 0 }, 0, PARAMS), 0.45, () => ({ x: 0, y: L * 5 }));

  test("a turn bends the body into one C, never an S", () => {
    const s = turning().at(-1) as Swimmer;
    const bends = turns(spineOf(s, PARAMS)).filter((a) => Math.abs(a) > 1e-4);
    expect(bends.length).toBeGreaterThan(5);
    expect(bends.every((a) => Math.sign(a) === Math.sign(bends[0]))).toBe(true);
    expect(Math.abs(s.bend)).toBeGreaterThan(0.15);
  });

  test("the head stays stiff and the bend lives in the trunk", () => {
    for (const u of [0, 0.06, 0.12]) expect(bendShare(u)).toBe(0);
    expect(bendShare(1)).toBeCloseTo(1, 5);
    expect(bendShare(0.5)).toBeLessThan(0.4);
  });

  test("a routine quarter turn takes about a second", () => {
    const states = run(createSwimmer({ x: 0, y: 0 }, 0, PARAMS), 4, () => ({ x: 0, y: L * 20 }));
    const done = states.findIndex((s) => Math.abs(angleDelta(s.heading, Math.PI / 2)) < 0.1);
    expect(done * DT).toBeGreaterThan(0.4);
    expect(done * DT).toBeLessThan(2);
  });

  test("the body does not retrace the head's path the way a snake does", () => {
    const heads: Vec[] = [];
    let widest = 0;
    let s = createSwimmer({ x: 0, y: 0 }, 0, PARAMS);
    for (let t = 0; t < 8; t += DT) {
      const side = Math.floor(t / 1.2) % 2 ? 1 : -1;
      s = stepSwimmer(s, { x: s.x + L * 2, y: side * L * 2 }, DT, PARAMS);
      heads.push({ x: s.x, y: s.y });
      if (t < 3) continue;
      const tail = spineOf(s, PARAMS).at(-1) as Vec;
      widest = Math.max(widest, Math.min(...heads.map((h) => distance(h, tail))));
    }
    expect(widest).toBeGreaterThan(L * 0.2);
  });
});

describe("swimmer basics", () => {
  test("a swimmer moves toward its target", () => {
    const s = run(createSwimmer({ x: 0, y: 0 }, 0, PARAMS), 1, () => ({ x: 5000, y: 0 })).at(-1) as Swimmer;
    expect(s.x).toBeGreaterThan(L * 0.15);
    expect(Math.abs(s.y)).toBeLessThan(1);
  });

  test("a long frame is clamped, so the fish never teleports", () => {
    const s = createSwimmer({ x: 0, y: 0 }, 0, PARAMS);
    const after = stepSwimmer(s, { x: 5000, y: 0 }, 5, PARAMS);
    expect(after.x).toBeLessThan(L * PARAMS.cruise * 0.1);
  });

  test("the spine is one body length long, head first", () => {
    const spine = spineOf(createSwimmer({ x: 0, y: 0 }, 0, PARAMS), PARAMS, 24);
    const length = spine.slice(1).reduce((sum, p, i) => sum + distance(spine[i], p), 0);
    expect(length).toBeCloseTo(L, 0);
    expect(spine[0].x).toBeGreaterThan(spine[23].x);
  });

  test("fins flare when the fish hangs still and fold back when it glides fast", () => {
    const base = createSwimmer({ x: 0, y: 0 }, 0, PARAMS);
    expect(motionOf({ ...base, speed: 0 }, PARAMS).flare).toBeGreaterThan(0.7);
    expect(motionOf({ ...base, speed: L * 1.2 }, PARAMS).flare).toBeLessThan(0.3);
  });

  test("every number stays finite through a long, busy swim", () => {
    const states = run(createSwimmer({ x: 0, y: 0 }, 0, PARAMS), 20, (_, t) => ({ x: Math.cos(t * 1.7) * L, y: Math.sin(t * 2.3) * L }), 1.6);
    for (const s of states) {
      for (const v of [s.x, s.y, s.heading, s.speed, s.yawRate, s.bend, s.phase, s.hz, s.drive, s.beatsLeft, s.brake]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(s.beatsLeft).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("feeding frenzy", () => {
  /**
   * A visitor spam-clicks round the fish's head. The hero keeps one food in mind for at least
   * FOCUS seconds, so a new pellet takes over at most that often; food the mouth reaches is eaten.
   */
  const FOCUS = 0.35;
  const frenzy = () => {
    let seed = 5;
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let s = createSwimmer({ x: 0, y: 0 }, 0, PARAMS);
    let food: Vec | null = null;
    const states: Swimmer[] = [];
    for (let t = 0; t < 3; t += DT) {
      if (Math.abs(t % FOCUS) < DT * 0.5 || food === null) {
        const a = r() * Math.PI * 2;
        const d = L * (0.15 + r() * 0.35);
        food = { x: s.x + Math.cos(a) * d, y: s.y + Math.sin(a) * d };
      }
      s = stepSwimmer(s, food, DT, PARAMS, 2.3);
      if (inReach(s, food, PARAMS)) food = null;
      states.push(s);
    }
    return states;
  };

  test("chasing spam-clicked food, the body never flaps from side to side", () => {
    const states = frenzy();
    let lastFlip = -Infinity;
    states.forEach((s, i) => {
      if (i === 0 || Math.abs(s.bend) < 0.05 || Math.sign(s.bend) === Math.sign(states[i - 1].bend)) return;
      expect((i - lastFlip) * DT).toBeGreaterThan(0.2);
      lastFlip = i;
    });
  });

  test("once the food is gone it settles back into a calm swim within two seconds", () => {
    let s = frenzy().at(-1) as Swimmer;
    const ahead = (f: Swimmer): Vec => ({ x: f.x + Math.cos(f.heading) * L * 10, y: f.y + Math.sin(f.heading) * L * 10 });
    for (let i = 0; i < 120; i++) s = stepSwimmer(s, ahead(s), DT, PARAMS);
    expect(Math.abs(s.yawRate)).toBeLessThan(0.2);
    expect(Math.abs(s.bend)).toBeLessThan(0.15);
  });
});

describe("eating", () => {
  const lcg = (seed: number) => {
    let x = seed;
    return () => (x = (x * 16807) % 2147483647) / 2147483647;
  };
  /** A pellet dropped `rel` radians off the fish's nose, a short way from the mouth. */
  const drop = (r: () => number, rel: number) => {
    const s = createSwimmer({ x: 0, y: 0 }, r() * Math.PI * 2, PARAMS);
    const angle = s.heading + rel;
    const d = L * (0.15 + r() * 0.2);
    return { s, food: { x: Math.cos(angle) * d, y: Math.sin(angle) * d } };
  };

  const reaches = (spread: number, seconds: number, seed: number) => {
    const r = lcg(seed);
    for (let k = 0; k < 40; k++) {
      const rel = (r() * 2 - 1) * spread;
      let { s, food } = drop(r, rel);
      let eaten = false;
      for (let t = 0; t < seconds && !eaten; t += DT) {
        s = stepSwimmer(s, food, DT, PARAMS, 1.7);
        eaten = inReach(s, food, PARAMS);
      }
      expect(eaten, `pellet ${k}: ${rel.toFixed(2)} rad off the nose`).toBe(true);
    }
  };

  test("the mouth reaches food ahead within three seconds", () => reaches(1, 3, 7));

  test("food beside the head is reached too: turned onto, or circled back to like a real koi", () => reaches(1.6, 6, 8));

  test("food is only eaten when the mouth reaches it, not from across the water", () => {
    const s = createSwimmer({ x: 0, y: 0 }, 0, PARAMS);
    expect(inReach(s, { x: L * 0.06, y: 0 }, PARAMS)).toBe(true);
    expect(inReach(s, { x: 0, y: L * 0.15 }, PARAMS)).toBe(false);
    expect(inReach(s, { x: L * 0.2, y: 0 }, PARAMS)).toBe(false);
  });

  test("food close behind doesn't make the fish spin on the spot; it swims on and comes round", () => {
    const r = lcg(11);
    for (let k = 0; k < 20; k++) {
      let { s, food } = drop(r, (r() < 0.5 ? -1 : 1) * (2.2 + r() * 0.9));
      let turned = 0;
      for (let t = 0; t < 4 && !inReach(s, food, PARAMS); t += DT) {
        const next = stepSwimmer(s, food, DT, PARAMS, 1.7);
        turned += Math.abs(angleDelta(s.heading, next.heading));
        s = next;
      }
      expect(turned).toBeLessThan(Math.PI * 1.5);
    }
  });
});

describe("posing", () => {
  test("fin state and the turn pass through to the frame", () => {
    const spine = spineOf(createSwimmer({ x: 0, y: 0 }, 0, PARAMS), PARAMS);
    const frame = poseKoi(spine, L, { beat: 0, time: 0, amplitude: 0.05, drive: 0.4, turn: -0.3, flare: 0.9 });
    expect([frame.drive, frame.turn, frame.flare]).toEqual([0.4, -0.3, 0.9]);
    const plain = poseKoi(spine, L, { beat: 0, time: 0, amplitude: 0.05 });
    expect([plain.drive, plain.turn, plain.flare]).toEqual([1, 0, 0.5]);
  });

  test("a koi holding station is one body length long, and dead straight with no sway", () => {
    const still = holdingSpine({ x: 10, y: 20 }, { x: 0, y: 1 }, L, 3.7, 24, 0);
    expect(still.every((p) => Math.abs(p.x - 10) < 1e-9)).toBe(true);
    const swaying = holdingSpine({ x: 10, y: 20 }, { x: 1, y: 0 }, L, 3.7, 24);
    expect(swaying.at(-1)!.x - swaying[0].x).toBeCloseTo(L, 0);
    expect(swaying.some((p) => Math.abs(p.y - 20) > 1)).toBe(true);
  });
});
