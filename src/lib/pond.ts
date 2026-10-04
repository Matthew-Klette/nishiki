import { clamp, distance, type Vec } from "./geometry";
import type { KoiPattern } from "./patterns";
import { between, type Rng } from "./rng";
import { inReach, MAX_STEP, mouthOf, stepSwimmer, type SwimParams, type Swimmer } from "./swim";

export interface PondFish {
  readonly swimmer: Swimmer;
  readonly pattern: KoiPattern;
  readonly params: SwimParams;
  /** The heading this fish has settled on. Koi hold a line for a while, then drift onto another. */
  readonly course: number;
  /** Seconds until it next changes its mind. */
  readonly ponder: number;
  /** The pellet it has set its sights on, if any: it sticks with it rather than flitting between. */
  readonly meal?: number;
}

export interface Pellet extends Vec {
  readonly id: number;
  /** Seconds in the water; uneaten food sinks out of reach at PELLET_LIFE. */
  readonly age: number;
}

export interface Bounds {
  readonly width: number;
  readonly height: number;
}

export interface PondState {
  readonly fish: readonly PondFish[];
  readonly pellets: readonly Pellet[];
  /** Food taken in the last step: where it was, and where the mouth that took it was. */
  readonly eaten?: readonly { readonly at: Vec; readonly mouth: Vec }[];
}

export const MAX_PELLETS = 10;
/** Seconds a koi holds a course, and how far (radians) it may veer when it picks a new one. */
const PONDER_MIN = 2.5;
const PONDER_MAX = 7;
const VEER = 1.1;
/** Seconds before uneaten food sinks, so the fish don't mill round it for ever. */
export const PELLET_LIFE = 4;
/** At most this many koi go for the same pellet; the rest take other food or carry on. */
const SHARE = 2;
/** Body lengths: another head this close and a koi soon decides to swim away from it. */
const CROWD = 0.6;
const CROWD_PONDER = 1.2;
const CROWD_PONDER_MIN = 0.2;
/** How widely (radians) a crowded koi's new line scatters around "straight away from its neighbour". */
const LEAVE_SPREAD = 0.6;
/** Koi with food in sight beat steadily toward it rather than beat-and-glide. */
const FEEDING_URGENCY = 1.7;
/** Body lengths within which heads nudge each other apart. */
const PERSONAL_SPACE = 0.7;

/** The closest pellet to the fish's head, or null when the water is empty. */
export function nearestPellet(fish: PondFish, pellets: readonly Pellet[]): Pellet | null {
  let best: Pellet | null = null;
  let bestDistance = Infinity;
  for (const p of pellets) {
    const d = distance(fish.swimmer, p);
    if (d < bestDistance) {
      best = p;
      bestDistance = d;
    }
  }
  return best;
}

/** A point ahead along the fish's course, and whether the edge of the pond pulled it back in. */
function roam(fish: PondFish, bounds: Bounds): { point: Vec; pulledBack: boolean } {
  const { swimmer, params, course } = fish;
  const reach = params.length * 1.4;
  const ahead = { x: swimmer.x + Math.cos(course) * reach, y: swimmer.y + Math.sin(course) * reach };
  const margin = params.length * 0.55;
  const center = { x: bounds.width / 2, y: bounds.height / 2 };
  const outside = ahead.x < margin || ahead.x > bounds.width - margin || ahead.y < margin || ahead.y > bounds.height - margin;
  if (!outside) return { point: ahead, pulledBack: false };
  return {
    point: {
      x: clamp((ahead.x + center.x) / 2, margin, Math.max(margin, bounds.width - margin)),
      y: clamp((ahead.y + center.y) / 2, margin, Math.max(margin, bounds.height - margin)),
    },
    pulledBack: true,
  };
}

/** A point ahead of the fish along its course, pulled back from the edges. */
export function wanderTarget(fish: PondFish, bounds: Bounds): Vec {
  return roam(fish, bounds).point;
}

/** Nudges a target away from other fish heads that are too close. */
function separate(target: Vec, self: PondFish, all: readonly PondFish[]): Vec {
  let push = { x: 0, y: 0 };
  for (const other of all) {
    if (other === self) continue;
    const d = distance(self.swimmer, other.swimmer);
    const near = self.params.length * PERSONAL_SPACE;
    if (d > 0 && d < near) {
      const k = ((near - d) / near) * self.params.length;
      push = { x: push.x + ((self.swimmer.x - other.swimmer.x) / d) * k, y: push.y + ((self.swimmer.y - other.swimmer.y) / d) * k };
    }
  }
  return { x: target.x + push.x, y: target.y + push.y };
}

export function addPellet(state: PondState, at: Vec, id: number): PondState {
  const pellets = [...state.pellets, { x: at.x, y: at.y, id, age: 0 }];
  return { ...state, pellets: pellets.slice(-MAX_PELLETS) };
}

/** The nearest other fish's head and how far away it is, or null in an empty pond. */
function nearestFish(self: PondFish, all: readonly PondFish[]): { at: Vec; gap: number } | null {
  let best: { at: Vec; gap: number } | null = null;
  for (const other of all) {
    if (other === self) continue;
    const gap = distance(self.swimmer, other.swimmer);
    if (!best || gap < best.gap) best = { at: other.swimmer, gap };
  }
  return best;
}

/**
 * Who goes for which pellet: each koi keeps the one it already chose, or takes the nearest one
 * that fewer than SHARE others are after, or none. Spreads a feeding frenzy out instead of piling every fish onto the same mouthful.
 */
export function assignMeals(fish: readonly PondFish[], pellets: readonly Pellet[]): (Pellet | null)[] {
  const claims = new Map<number, number>();
  return fish.map((f) => {
    const open = pellets.filter((p) => (claims.get(p.id) ?? 0) < SHARE);
    const meal = open.find((p) => p.id === f.meal) ?? nearestPellet(f, open);
    if (meal) claims.set(meal.id, (claims.get(meal.id) ?? 0) + 1);
    return meal;
  });
}

/** Which way a koi heads next, given what just happened to it. */
function chooseCourse(
  f: PondFish,
  swimmer: Swimmer,
  now: { ate: boolean; food: boolean; decide: boolean; crowded: boolean; neighbour: { at: Vec } | null; wander: { point: Vec; pulledBack: boolean } },
  rng: Rng,
): number {
  // After a mouthful it veers off on its own line; chasing food it just follows its nose.
  if (now.ate) return swimmer.heading + between(rng, -VEER, VEER);
  if (now.food) return swimmer.heading;
  if (now.decide) {
    if (now.crowded && now.neighbour) {
      const away = Math.atan2(swimmer.y - now.neighbour.at.y, swimmer.x - now.neighbour.at.x);
      return away + between(rng, -LEAVE_SPREAD, LEAVE_SPREAD);
    }
    return swimmer.heading + between(rng, -VEER, VEER);
  }
  // At a wall it commits to turning away.
  if (now.wander.pulledBack) return Math.atan2(now.wander.point.y - swimmer.y, now.wander.point.x - swimmer.x);
  return f.course;
}

export function stepPond(state: PondState, bounds: Bounds, frameDt: number, rng: Rng): PondState {
  const dt = Math.min(frameDt, MAX_STEP); // the same step the swimmers take
  let pellets = state.pellets.map((p) => ({ ...p, age: p.age + dt })).filter((p) => p.age < PELLET_LIFE);
  const meals = assignMeals(state.fish, pellets);
  const eaten: { at: Vec; mouth: Vec }[] = [];
  const fish = state.fish.map((f, i) => {
    // Skip a meal another koi has already eaten this frame.
    const meal = meals[i];
    const food = meal && pellets.some((p) => p.id === meal.id) ? meal : null;
    const wander = roam(f, bounds);
    const target = separate(food ?? wander.point, f, state.fish);
    const swimmer = stepSwimmer(f.swimmer, target, dt, f.params, food ? FEEDING_URGENCY : 1);
    const ate = food !== null && inReach(swimmer, food, f.params);
    if (ate) {
      pellets = pellets.filter((p) => p.id !== food.id);
      eaten.push({ at: { x: food.x, y: food.y }, mouth: mouthOf(swimmer, f.params) });
    }
    const neighbour = nearestFish(f, state.fish);
    const crowded = !food && neighbour !== null && neighbour.gap < f.params.length * CROWD;
    // Crowded, a koi soon makes up its mind to leave; it then heads away from its neighbour.
    const ponder = crowded && f.ponder > CROWD_PONDER ? between(rng, CROWD_PONDER_MIN, CROWD_PONDER) : f.ponder - dt;
    const decide = ponder <= 0;
    const course = chooseCourse(f, swimmer, { ate, food: food !== null, decide, crowded, neighbour, wander }, rng);
    return { ...f, swimmer, course, ponder: decide || ate ? between(rng, PONDER_MIN, PONDER_MAX) : ponder, meal: ate ? undefined : food?.id };
  });
  return { fish, pellets, eaten };
}
