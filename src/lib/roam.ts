import { angleDelta, distance, type Vec } from "./geometry";
import type { Rng } from "./rng";
import { MAX_STEP, stepSwimmer, type SwimParams, type Swimmer } from "./swim";

/**
 * A roaming fish swims in legs: it turns onto a course (a coin toss for which way, mostly gentle,
 * now and then a full wheel), swims a stretch straight along it, then picks the next. Legs are
 * MIN_LEG to twice that long, in body lengths, and end anywhere, not just at the edge.
 */
const MIN_LEG = 1;
/** The leg's distance only counts down once the fish is this close to its course (radians). */
const ON_COURSE = 0.5;
/** A leg that can't be finished in this many seconds is abandoned. */
const PATIENCE = 10;
/**
 * With the course nearly astern (beyond ASTERN radians, ~150°) either way round is about as far, and
 * the short way flips from frame to frame; there the fish wheels the way it chose, aiming WHEEL
 * radians round until the course comes into view. Anything less it simply turns the short way.
 */
const ASTERN = 2.6;
const WHEEL = 1.75;
/** How far ahead (body lengths) the steering point sits, so roaming never triggers an arrival slow-down. */
const STEER_REACH = 3;
/** How far ahead (body lengths) a fish looks for the edge of its water. */
const LOOKAHEAD = 0.6;
/** Outside the area (in units of its radii), a fish whose course doesn't clearly lead back in turns for the middle. */
const STRAY = 1;
const HOMEWARD = 0.3;
/** An edge turn heads to the far half: CROSS_NEAR–CROSS_FAR of the long radius past the middle, within CROSS_TO across. */
const CROSS_NEAR = 0.2;
const CROSS_FAR = 0.7;
const CROSS_TO = 0.45;
const CROSS_SPREAD = 0.3;
/** How much of its current offset across the area a crossing keeps (so it runs roughly level). */
const CROSS_LEVEL = 0.4;
const CROSS_TRIES = 24;
/** A fresh leg holds for this long (seconds) before the edge can call another, so legs don't flap. */
const SETTLE = 0.8;

/** A fish roaming on its own. */
export interface Roamer {
  readonly swimmer: Swimmer;
  /** The heading of this leg. */
  readonly course: number;
  /** Which way round the fish turned onto it: +1 or -1. Held until the turn is done. */
  readonly side: number;
  /** Pixels of straight swimming left on this leg; at or below 0 the fish picks the next. */
  readonly legLeft: number;
  /** Seconds spent on this leg. */
  readonly age: number;
}

export const startRoaming = (swimmer: Swimmer): Roamer => ({ swimmer, course: swimmer.heading, side: 1, legLeft: 0, age: 0 });

/** Something that draws the fish off its route for now: a cursor to follow, food to dart at. */
export interface Lure {
  readonly target: Vec;
  readonly urgency: number;
}

/** Where a fish may roam: an ellipse around the middle of its water. */
export interface Ellipse {
  readonly center: Vec;
  readonly rx: number;
  readonly ry: number;
}

/**
 * The sharpest turn a waypoint asks for (radians, ~175°). Koi wheel right round; capping this
 * lower stops a fish near the edge from ever turning toward it, so it circulates one way.
 */
export const MAX_TURN_AWAY = 3.05;
const MIN_TURN = 0.15;
const FAN = 32;
/** Gentle turns are likelier than full wheels: weight e^(−turn / GENTLE). */
const GENTLE = 1.1;
/** Waypoints stay this share of the way to the edge; a course with MIN_HOP × ROOMY of room is fully roomy; hops run up to MAX_HOP × minHop. */
const EDGE_MARGIN = 0.8;
const ROOMY = 3;
const MAX_HOP = 2;
/** Fish tend to alternate: after a turn one way, the next goes the other way this often. */
const SWITCH = 0.7;

/** How far a fish at `from` (inside the area) can swim along `bearing` before it reaches the edge. */
function room(from: Vec, bearing: number, area: Ellipse): number {
  const dx = Math.cos(bearing) / area.rx;
  const dy = Math.sin(bearing) / area.ry;
  const ox = (from.x - area.center.x) / area.rx;
  const oy = (from.y - area.center.y) / area.ry;
  const a = dx * dx + dy * dy;
  const b = 2 * (ox * dx + oy * dy);
  const c = ox * ox + oy * oy - 1;
  const disc = b * b - 4 * a * c;
  return disc < 0 ? 0 : Math.max(0, (-b + Math.sqrt(disc)) / (2 * a));
}

/** Picks one of `options` with probability proportional to its weight. */
function weighted<T>(rng: Rng, options: readonly { value: T; weight: number }[]): T {
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let pick = rng() * total;
  for (const o of options) {
    pick -= o.weight;
    if (pick <= 0) return o.value;
  }
  return options[options.length - 1].value;
}

/**
 * Picks where to swim next. The turn direction is a coin toss, decided first; then how sharply
 * (mostly gentle, now and then a full wheel) among the headings with room for a hop of at least
 * `minHop`; then how far. Picking random points inside the area instead makes a route that
 * circulates round the rim one way, because the inside is always on the same side.
 */
export function nextWaypoint(rng: Rng, from: Vec, heading: number, area: Ellipse, minHop: number, switchFrom = 0): Vec {
  const outside = ((from.x - area.center.x) / area.rx) ** 2 + ((from.y - area.center.y) / area.ry) ** 2 > 1;
  if (outside) return { x: area.center.x + (rng() - 0.5) * area.rx, y: area.center.y + (rng() - 0.5) * area.ry };

  // A fair coin, or — after a turn one way (`switchFrom`) — a coin weighted toward the other way.
  const first = switchFrom !== 0 ? (rng() < SWITCH ? -switchFrom : switchFrom) : rng() < 0.5 ? -1 : 1;
  for (const side of [first, -first]) {
    const options = Array.from({ length: FAN }, (_, i) => MIN_TURN + ((MAX_TURN_AWAY - MIN_TURN) * i) / (FAN - 1))
      .map((turn) => ({ turn, bearing: heading + side * turn }))
      .map((o) => ({ ...o, room: room(from, o.bearing, area) * EDGE_MARGIN }))
      .filter((o) => o.room >= minHop)
      .map((o) => ({ value: o, weight: Math.exp(-o.turn / GENTLE) * Math.min(1, o.room / (minHop * ROOMY)) }));
    if (options.length === 0) continue;
    const { bearing, room: space } = weighted(rng, options);
    const hop = minHop + (Math.min(space, minHop * MAX_HOP) - minHop) * rng();
    return { x: from.x + Math.cos(bearing) * hop, y: from.y + Math.sin(bearing) * hop };
  }
  return area.center;
}

const spread = (p: Vec, area: Ellipse) => ((p.x - area.center.x) / area.rx) ** 2 + ((p.y - area.center.y) / area.ry) ** 2;

/** Picks the next leg: a random course (see nextWaypoint) and how far to swim along it. */
function nextLeg(rng: Rng, s: Swimmer, area: Ellipse, L: number, lastSide: number): Omit<Roamer, "swimmer"> {
  const p = nextWaypoint(rng, s, s.heading, area, L * MIN_LEG, lastSide);
  const course = Math.atan2(p.y - s.y, p.x - s.x);
  return { course, side: Math.sign(angleDelta(s.heading, course)) || 1, legLeft: distance(s, p), age: 0 };
}

/**
 * At the edge: wheel round and swim back across the water to a random point in the far half.
 * Which way round comes first — the alternating coin (only a fish that has strayed out is told) —
 * and the target is then picked to suit it. Letting the target decide (the short way to it) would
 * turn the fish the same way at both ends of every crossing: one big loop, the very thing to avoid.
 * Koi slow almost to a hover for a big turn and pivot on their pectorals, so the wheel is tight and
 * safe either way round, even beside the edge.
 */
function crossLeg(rng: Rng, s: Swimmer, area: Ellipse, lastSide: number, forced = 0): Omit<Roamer, "swimmer"> {
  const side = forced !== 0 ? forced : rng() < SWITCH ? -lastSide : lastSide;
  const wide = area.rx >= area.ry;
  const along = wide ? (s.x - area.center.x) / area.rx : (s.y - area.center.y) / area.ry;
  const acrossNow = wide ? (s.y - area.center.y) / area.ry : (s.x - area.center.x) / area.rx;
  const to = Math.sign(along) || 1;
  let fallback: Vec | null = null;
  for (let i = 0; i < CROSS_TRIES; i++) {
    // The far half along the long axis, roughly level with where the fish is now: a long crossing
    // that meets the far end head-on, where either way round is safe.
    const far = -to * (CROSS_NEAR + (CROSS_FAR - CROSS_NEAR) * rng());
    const across = Math.max(-CROSS_TO, Math.min(CROSS_TO, acrossNow * CROSS_LEVEL + (rng() * 2 - 1) * CROSS_SPREAD));
    const p = wide
      ? { x: area.center.x + far * area.rx, y: area.center.y + across * area.ry }
      : { x: area.center.x + across * area.rx, y: area.center.y + far * area.ry };
    const error = angleDelta(s.heading, Math.atan2(p.y - s.y, p.x - s.x));
    fallback ??= p;
    // Beyond ASTERN the wheel is held to `side` anyway; short of it the target must lie that way.
    if (Math.abs(error) > ASTERN || Math.sign(error) === side) {
      return { course: Math.atan2(p.y - s.y, p.x - s.x), side, legLeft: distance(s, p), age: 0 };
    }
  }
  const p = fallback ?? area.center;
  const course = Math.atan2(p.y - s.y, p.x - s.x);
  return { course, side: Math.sign(angleDelta(s.heading, course)) || 1, legLeft: distance(s, p), age: 0 };
}

/**
 * One step of roaming. A lure takes over while it lasts, and the route starts afresh from
 * wherever it left the fish.
 */
export function roamStep(r: Roamer, rng: Rng, area: Ellipse, params: SwimParams, frameDt: number, lure: Lure | null = null): Roamer {
  const dt = Math.min(frameDt, MAX_STEP); // the same step the swimmer takes
  const s = r.swimmer;
  if (lure) return startRoaming(stepSwimmer(s, lure.target, dt, params, lure.urgency));
  const L = params.length;
  // Looking ahead: when the water a body length on runs out, start the next turn now, not at the edge.
  const ahead = { x: s.x + Math.cos(s.heading) * L * LOOKAHEAD, y: s.y + Math.sin(s.heading) * L * LOOKAHEAD };
  const settled = Math.abs(angleDelta(s.heading, r.course)) < ON_COURSE;
  const walled = settled && r.age > SETTLE && spread(ahead, area) > 1;
  // And if a wide turn has carried it out anyway, on a course that leads further out, head back in.
  const homeward = Math.atan2(area.center.y - s.y, area.center.x - s.x);
  const strayed = spread(s, area) > STRAY && Math.cos(r.course - homeward) < HOMEWARD;
  const leg =
    strayed
      ? crossLeg(rng, s, area, r.side, Math.sign(angleDelta(s.heading, homeward)) || 1)
      : walled
        ? crossLeg(rng, s, area, r.side)
        : r.legLeft <= 0 || r.age > PATIENCE
          ? nextLeg(rng, s, area, L, r.side)
          : r;
  const error = angleDelta(s.heading, leg.course);
  // A course almost astern sits right where a plain "turn the short way" would flip sides from
  // frame to frame; holding the chosen side until the turn is done keeps the coin toss honest.
  const bearing = Math.abs(error) > ASTERN && Math.sign(error) !== leg.side ? s.heading + leg.side * WHEEL : leg.course;
  const aim = { x: s.x + Math.cos(bearing) * L * STEER_REACH, y: s.y + Math.sin(bearing) * L * STEER_REACH };
  const swimmer = stepSwimmer(s, aim, dt, params);
  const straight = Math.abs(error) < ON_COURSE;
  return { swimmer, course: leg.course, side: leg.side, legLeft: straight ? leg.legLeft - swimmer.speed * dt : leg.legLeft, age: leg.age + dt };
}
