import { SPINE_POINTS } from "./body";
import { angleDelta, clamp, distance, TAU, type Vec } from "./geometry";
import { PIVOT_U, STRIDE, TAIL_AMPLITUDE, bendShare } from "./locomotion";

export interface SwimParams {
  /** Body length in CSS pixels. */
  readonly length: number;
  /** Cruising speed in body lengths per second. */
  readonly cruise: number;
  /** Fastest yaw in radians per second. */
  readonly maxTurn: number;
}

/**
 * A koi as a body, not a trail: where the snout is, which way it points, how fast it yaws, how far
 * the trunk is bent into the turn, and where it is in its beat-and-glide stroke.
 */
export interface Swimmer {
  /** The snout. */
  readonly x: number;
  readonly y: number;
  /** Where the head points, in radians. */
  readonly heading: number;
  /** Pixels per second along the heading. */
  readonly speed: number;
  /** Radians per second. */
  readonly yawRate: number;
  /** The C-bend from snout to tail root, in radians; positive bends into a positive turn. */
  readonly bend: number;
  /** Tail-beat phase in radians. */
  readonly phase: number;
  /** Tail beats per second right now. */
  readonly hz: number;
  /** 0 while gliding with the tail trailing, 1 at a full stroke. */
  readonly drive: number;
  /** True during a burst of tail beats. */
  readonly stroking: boolean;
  /** Tail beats left in this burst. */
  readonly beatsLeft: number;
  /** 0 → 1 as the pectoral fins flare out to brake. */
  readonly brake: number;
}

/** What the renderer needs to pose a swimmer. */
export interface SwimMotion {
  readonly beat: number;
  /** Half-amplitude of the sway at the tail root, in body lengths; grows with speed. */
  readonly amplitude: number;
  readonly drive: number;
  readonly turn: number;
  /** 0 = paired fins folded back for a fast glide, 1 = flared to hover or brake. */
  readonly flare: number;
}

/** Longest step simulated at once, in seconds: a long frame (tab switch) shouldn't teleport the fish. */
export const MAX_STEP = 0.05;
/** Body lengths: inside this, a target is "at the mouth" and steering toward it fades out. */
const NEAR_MOUTH = 0.15;
/**
 * The mouth is the tip of the drawn head, MOUTH_AHEAD body lengths in front of the spine's first
 * point. Food is eaten only when the mouth itself reaches it (within BITE), so you see the koi take it.
 */
const MOUTH_AHEAD = 0.055;
const BITE = 0.09;

/** Where the koi's mouth is. */
export function mouthOf(s: Swimmer, params: SwimParams): Vec {
  return { x: s.x + Math.cos(s.heading) * params.length * MOUTH_AHEAD, y: s.y + Math.sin(s.heading) * params.length * MOUTH_AHEAD };
}

/** Whether the koi's mouth has reached `food`. */
export function inReach(s: Swimmer, food: Vec, params: SwimParams): boolean {
  return distance(mouthOf(s, params), food) < params.length * BITE;
}

/**
 * Food further round than LOOP_ARC (radians, ~126°) and closer than LOOP_NEAR body lengths lies
 * under the fish's own pivot, where no turn on the spot brings the mouth to it; it is reached by
 * swimming clear (at LOOP_PACE × cruise) and wheeling back. Anything less far round, a turn reaches.
 */
const LOOP_ARC = 2.2;
const LOOP_NEAR = 0.45;
const LOOP_PACE = 0.7;
/** Beyond this (radians, ~150°) a target counts as astern; a fish yawing faster than YAW_HOLD keeps its side. */
const ASTERN_HOLD = 2.6;
const YAW_HOLD = 0.05;

/*
 * Steering. Koi turn with a quick C-flick of the tail and then glide straight on the new
 * heading; between strokes only the pectorals make small corrections.
 */
const TURN_GAIN = 2.4; // rad/s of yaw asked for per radian of heading error
const COAST_STEER = 0.3; // share of that yaw a fast glide can manage with its pectorals…
const SCULL_PACE = 0.8; // …rising to all of it as the fish slows below this many body lengths per second
const TURN_STROKE = 0.8; // a heading error this large (rad, ~46°) starts a turning flick; smaller ones the pectorals steer
const FLICK = 0.5; // a turning flick is a single half-beat…
const FLICK_REST = 0.15; // …and the next waits until this one has died away (flick, glide, flick)
const TURN_SLOWDOWN = 0.12; // with the target abeam or behind, it all but hovers and pivots on its pectorals
const FLICK_PACE = 1.6; // already this much faster than it wants, a fish glides round instead of flicking
const YAW_LAG = 0.15;
/*
 * Bending. In a turn the body lies along the arc it is swimming (the bend follows the path's
 * curvature, not the turn rate), so a turning koi curls into a C instead of swinging round like a
 * stick. The bend builds fast and relaxes slowly, so the tail follows through after the head.
 */
const BEND_FOLLOW = 0.8; // radians of bend per radian-per-body-length of path curvature
const BEND_PACE_FLOOR = 0.3; // body lengths per second: a near-hover turn bends as if swimming this fast
const MAX_BEND = 1.3; // about 75° from snout to tail root: a deep C
const BEND_IN = 0.14;
const BEND_OUT = 0.32;

/*
 * Thrust grows with (amplitude × frequency)², drag with speed², so a steady stroke settles at
 * STRIDE per beat. DRAG matches a koi's measured coast: U(t) = U0 / (1 + 1.22·U0·t).
 */
const DRAG = 1.22;
const THRUST = DRAG * STRIDE * STRIDE;

/* Beat and glide: speed comes from how often the fish beats, not from beating faster. */
const MIN_HZ = 1.5;
const MAX_HZ = 3;
const GLIDE_HZ = 0.45; // the trailing fin still ripples slowly
const RESUME_AT = 0.72; // beat again once the glide has slowed to this share of the wanted pace
const DART_URGENCY = 1.45; // at or above this the fish beats without gliding
const DART_MIN_HZ = 1; // a steady chase settles at the wanted pace instead of overshooting it
const DART_OVERSHOOT = 1.1; // a darting fish stops beating once it is this much faster than it wants
const RAMP_UP = 0.18;
const RAMP_DOWN = 0.32;
const HZ_LAG = 0.3;

/** Tail beats per second for a stroke at `pace` body lengths per second (koi bursts). */
const burstHz = (pace: number) => clamp(1.3 * (1 + pace), MIN_HZ, MAX_HZ);
/** Slow fish sweep a smaller tail: about 60% of full amplitude at 0.4 body lengths per second. */
const amplitudeGain = (pace: number) => clamp(0.33 + 0.67 * pace, 0.55, 1);

/* Arriving: ease off inside ARRIVE body lengths, and flare the pectorals to brake. */
const ARRIVE = 0.9;
const MIN_ARRIVE = 0.28; // a koi closing on food keeps some way on right up to it
const BRAKE_DRAG = 1.6;
const BRAKE_LAG = 0.25;
const BRAKE_ABOVE = 1.25; // arriving this much faster than it wants, the fish flares its pectorals
const FOLD_PACE = 1.1; // body lengths per second at which the paired fins lie right back

/** Eases `value` toward `target` with time constant `lag`, independent of frame rate. */
const approach = (value: number, target: number, step: number, lag: number) =>
  value + (target - value) * (1 - Math.exp(-step / lag));

/** One to two beats per burst, in half-beat flicks, varied by how far the tail has swung so far. */
const burstLength = (phase: number) => 1 + 0.5 * (Math.floor(phase / Math.PI) % 3);

export function createSwimmer(at: Vec, heading: number, params: SwimParams): Swimmer {
  return {
    x: at.x,
    y: at.y,
    heading,
    speed: params.cruise * params.length,
    yawRate: 0,
    bend: 0,
    phase: 0,
    hz: MIN_HZ,
    drive: 0.5,
    stroking: false,
    beatsLeft: 0,
    brake: 0,
  };
}

/** How far off the target is (body lengths) and how far round (radians), faded out at the mouth. */
function aim(s: Swimmer, target: Vec, L: number) {
  const gap = distance(s, target) / L;
  const raw = angleDelta(s.heading, Math.atan2(target.y - s.y, target.x - s.x));
  // Dead astern, "the short way round" flips side from frame to frame and the turn cancels itself
  // out; a fish already turning one way keeps on round that way.
  const astern = Math.abs(raw) > ASTERN_HOLD && s.yawRate * raw < 0 && Math.abs(s.yawRate) > YAW_HOLD;
  const error = astern ? raw - Math.sign(raw) * TAU : raw;
  // Close to the mouth the bearing swings wildly as the head moves past the target; a koi there
  // doesn't wrench round to face it, it drifts on and sucks it in. Close behind, the target
  // lies under the fish's own pivot, where no turn on the spot can reach it: it swims on until
  // clear, then wheels back.
  const behind = Math.abs(raw) > LOOP_ARC;
  const fade = behind && gap < LOOP_NEAR ? 0 : clamp(gap / NEAR_MOUTH, 0, 1);
  return { gap, behind, error: error * fade * fade * (3 - 2 * fade) };
}

/** Whether the tail is beating this step, and how many beats are left in the stroke. */
function strokeState(s: Swimmer, error: number, pace: number, wantedPace: number, continuous: boolean, step: number) {
  const turning = Math.abs(error) > TURN_STROKE;
  const slow = pace < wantedPace * (continuous ? 1 : RESUME_AT);
  const flick = turning && pace < wantedPace * FLICK_PACE && s.drive < FLICK_REST;
  const starting = !s.stroking && (slow || flick);
  // Turning, the stroke is a single flick, never a burst (a burst under way is cut short): koi slow
  // into a turn rather than sprint through it.
  const carryOn = Math.min(Math.max(0, s.beatsLeft - (s.stroking ? s.hz * step : 0)), turning ? FLICK : Infinity);
  const beatsLeft = starting ? (slow && !turning ? burstLength(s.phase) : FLICK) : carryOn;
  const stroking = starting || (s.stroking && (beatsLeft > 0 || (continuous && pace < wantedPace * DART_OVERSHOOT)));
  return { stroking, beatsLeft };
}

/** Strokes turn the fish; in a glide the pectorals steer, and they manage more the slower it goes. */
function steer(s: Swimmer, error: number, stroking: boolean, pace: number, maxYaw: number, step: number) {
  const authority = stroking ? 1 : COAST_STEER + (1 - COAST_STEER) * clamp(1 - pace / SCULL_PACE, 0, 1);
  const wantedYaw = clamp(error * TURN_GAIN, -maxYaw, maxYaw) * authority;
  const yawRate = approach(s.yawRate, wantedYaw, step, YAW_LAG);
  // The bend follows the turn being asked for, so the head leads into it; a glide runs straight.
  const curvature = wantedYaw / Math.max(pace, BEND_PACE_FLOOR);
  const wantedBend = clamp(curvature * BEND_FOLLOW, -MAX_BEND, MAX_BEND);
  const bend = approach(s.bend, wantedBend, step, Math.abs(wantedBend) > Math.abs(s.bend) ? BEND_IN : BEND_OUT);
  return { yawRate, bend, heading: s.heading + yawRate * step };
}

/** One step of pursuit toward `target`. `urgency` > 1 makes the fish dart; it beats without gliding. */
export function stepSwimmer(s: Swimmer, target: Vec, dt: number, params: SwimParams, urgency = 1): Swimmer {
  const step = clamp(dt, 0, MAX_STEP);
  const L = params.length;
  const pace = s.speed / L;
  const { gap, behind, error } = aim(s, target, L);
  // Koi slow down to turn: with the target off to one side they ease off, so the turn stays tight.
  const facing = clamp(Math.cos(error), TURN_SLOWDOWN, 1);
  // But with food close behind it keeps swimming, to get clear and come round to it.
  const looping = behind && gap < LOOP_NEAR ? params.cruise * LOOP_PACE : 0;
  const wantedPace = Math.max(params.cruise * urgency * clamp(gap / ARRIVE, MIN_ARRIVE, 1) * facing, looping);
  // A darting fish keeps beating while it is slower than it wants to be; arriving, it coasts and brakes.
  const continuous = urgency >= DART_URGENCY;
  const { stroking, beatsLeft } = strokeState(s, error, pace, wantedPace, continuous, step);
  const { yawRate, bend, heading } = steer(s, error, stroking, pace, params.maxTurn * Math.sqrt(urgency), step);

  const strokeHz = continuous ? clamp(wantedPace / STRIDE, DART_MIN_HZ, MAX_HZ) : burstHz(wantedPace);
  const hz = approach(s.hz, stroking ? strokeHz : GLIDE_HZ, step, HZ_LAG);
  const drive = approach(s.drive, stroking ? 1 : 0, step, stroking ? RAMP_UP : RAMP_DOWN);
  // Arriving or wheeling round it flares the pectorals to brake; a straight glide just coasts down.
  const braking = !stroking && (gap < ARRIVE || Math.abs(error) > TURN_STROKE) && pace > wantedPace * BRAKE_ABOVE;
  const brake = approach(s.brake, braking ? 1 : 0, step, BRAKE_LAG);
  const sweep = drive * amplitudeGain(pace) * hz;
  const accel = THRUST * sweep * sweep - DRAG * pace * pace - BRAKE_DRAG * brake * pace;
  const speed = Math.max(0, pace + accel * step) * L;

  // The fish yaws about its pivot, about a quarter of the way back, so the head swings into the turn.
  const reach = PIVOT_U * L;
  const mid = s.heading + (yawRate * step) / 2;
  const x = s.x - Math.cos(s.heading) * reach + Math.cos(mid) * speed * step + Math.cos(heading) * reach;
  const y = s.y - Math.sin(s.heading) * reach + Math.sin(mid) * speed * step + Math.sin(heading) * reach;
  const phase = s.phase + TAU * hz * step;
  return { x, y, heading, speed, yawRate, bend, phase, hz, drive, stroking, beatsLeft, brake };
}

/**
 * Evenly spaced midline points, snout first, built from the body itself: straight through the
 * stiff head, then curving into the turn. The travelling wave is added later by the renderer.
 */
export function spineOf(s: Swimmer, params: SwimParams, count = SPINE_POINTS): Vec[] {
  const segment = params.length / (count - 1);
  const points: Vec[] = [{ x: s.x, y: s.y }];
  for (let i = 1; i < count; i++) {
    const angle = s.heading - s.bend * bendShare((i - 0.5) / (count - 1));
    const prev = points[i - 1];
    points.push({ x: prev.x - Math.cos(angle) * segment, y: prev.y - Math.sin(angle) * segment });
  }
  return points;
}

export function motionOf(s: Swimmer, params: SwimParams): SwimMotion {
  const pace = s.speed / params.length;
  const slow = clamp(1 - pace / FOLD_PACE, 0, 1);
  return {
    beat: s.phase,
    amplitude: TAIL_AMPLITUDE * amplitudeGain(pace),
    drive: s.drive,
    turn: s.bend,
    flare: Math.max(slow, s.brake),
  };
}
