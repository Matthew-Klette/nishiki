import { halfWidth } from "./body";
import { between, intBetween, mulberry32, type Rng } from "./rng";
import type { VarietyId } from "./varieties";

/** Skin colours, named the way breeders name them. */
export type Pigment = "hi" | "sumi" | "shiro" | "ai" | "sora" | "pale" | "kin";

export const PIGMENT: Record<Pigment, string> = {
  hi: "#d1361f", // red
  sumi: "#16130f", // black
  shiro: "#eee8dc", // white skin: slightly translucent cream, never paper-white
  ai: "#5c7d8f", // Asagi blue-grey
  sora: "#c4d9ec", // Shūsui back: pale sky / robin's-egg blue
  pale: "#e3e6de", // clear Asagi head
  kin: "#dcaa3c", // Ōgon gold
};

export type ScaleStyle = "fine" | "net" | "doitsu" | "metallic";
export type FinStyle = "clear" | "stripes" | "motoguro" | "hi-root" | "gold";

/**
 * One patch of colour in body coordinates. `ru` is a fraction of body length,
 * `rv` a fraction of the local half-width, so patches bend with the fish.
 */
export interface Patch {
  readonly pigment: Pigment;
  readonly u: number;
  readonly v: number;
  readonly ru: number;
  readonly rv: number;
  readonly angle: number;
  /** Edge wobble as [amplitude, frequency, phase] harmonics. */
  readonly wobble: readonly (readonly [number, number, number])[];
}

export interface KoiPattern {
  readonly variety: VarietyId;
  readonly seed: number;
  readonly base: Pigment;
  readonly patches: readonly Patch[];
  readonly scales: ScaleStyle;
  readonly fins: FinStyle;
  readonly metallic: boolean;
}

const wobble = (rng: Rng, strength = 1): Patch["wobble"] =>
  [2, 3, 5].map((f) => [between(rng, 0.03, 0.11) * strength, f, between(rng, 0, Math.PI * 2)] as const);

function patch(rng: Rng, pigment: Pigment, u: number, v: number, ru: number, rv: number, angle = 0, strength = 1): Patch {
  return { pigment, u, v, ru, rv, angle, wobble: wobble(rng, strength) };
}

/** A patch that stays round on screen: converts a radius in body lengths into both axes. */
function roundPatch(rng: Rng, pigment: Pigment, u: number, v: number, radius: number): Patch {
  return patch(rng, pigment, u, v, radius, radius / halfWidth(u), 0, 0.25);
}

/** Kohaku-style red steps from head to tail, leaving white gaps between them. */
function redSteps(rng: Rng): Patch[] {
  const steps = intBetween(rng, 3, 4);
  const spacing = 0.66 / steps;
  const head = patch(rng, "hi", between(rng, 0.075, 0.095), between(rng, -0.06, 0.06), between(rng, 0.05, 0.065), between(rng, 0.5, 0.62));
  const body = Array.from({ length: steps - 1 }, (_, i) =>
    patch(
      rng,
      "hi",
      0.24 + i * spacing + between(rng, -0.02, 0.03),
      between(rng, -0.3, 0.3),
      between(rng, 0.07, 0.1),
      between(rng, 0.95, 1.45),
      between(rng, -0.25, 0.25),
    ),
  );
  return [head, ...body];
}

function sumiIslands(rng: Rng, count: number, uMin: number): Patch[] {
  return Array.from({ length: count }, () =>
    patch(rng, "sumi", between(rng, uMin, 0.82), between(rng, -0.75, 0.75), between(rng, 0.018, 0.034), between(rng, 0.2, 0.42), between(rng, -0.6, 0.6)),
  );
}

/** Black lightning across the head that splits it in two (menware). */
function menware(rng: Rng): Patch {
  return patch(rng, "sumi", between(rng, 0.05, 0.08), between(rng, -0.12, 0.12), 0.055, 0.16, between(rng, -0.5, 0.5), 1.4);
}

/** Red bands that show along both flanks of Asagi-type fish. */
function flankRed(rng: Rng): Patch[] {
  return [-1, 1].flatMap((side) => [
    patch(rng, "hi", between(rng, 0.42, 0.5), side * 1.08, between(rng, 0.26, 0.32), 0.42, 0, 0.6),
    patch(rng, "hi", 0.09, side * 0.98, 0.045, 0.32, 0, 0.5),
  ]);
}

/** The same patch reflected across the back (v → -v), edge wobble included. */
function mirrored(p: Patch): Patch {
  return { ...p, v: -p.v, angle: -p.angle, wobble: p.wobble.map(([amp, freq, phase]) => [amp, freq, Math.PI - phase] as const) };
}

/**
 * Shūsui hi, mirrored left/right: broad smooth bands down both flanks from behind the shoulders to
 * the tail root, widest past mid-body where they come almost up to the scale rows, plus red
 * cheeks (hoho). The blue back between them stays clear.
 */
function shusuiHi(rng: Rng): Patch[] {
  const band = patch(rng, "hi", between(rng, 0.62, 0.65), 1.08, between(rng, 0.34, 0.36), between(rng, 0.56, 0.6), 0, 0.2);
  const cheek = patch(rng, "hi", 0.13, 1, 0.038, 0.28, 0, 0.25);
  return [band, cheek].flatMap((p) => [p, mirrored(p)]);
}

type Builder = (rng: Rng) => Omit<KoiPattern, "variety" | "seed">;

const BUILDERS: Record<VarietyId, Builder> = {
  kohaku: (rng) => ({ base: "shiro", patches: redSteps(rng), scales: "fine", fins: "clear", metallic: false }),
  sanke: (rng) => ({
    base: "shiro",
    patches: [...redSteps(rng), ...sumiIslands(rng, intBetween(rng, 3, 5), 0.22)],
    scales: "fine",
    fins: "stripes",
    metallic: false,
  }),
  showa: (rng) => ({
    base: "sumi",
    patches: [
      patch(rng, "hi", 0.085, 0, 0.065, 0.7),
      patch(rng, "shiro", between(rng, 0.25, 0.3), between(rng, -0.5, 0.5), 0.07, 0.8, between(rng, -0.4, 0.4)),
      patch(rng, "hi", between(rng, 0.36, 0.42), between(rng, -0.25, 0.25), 0.09, 1.2, between(rng, -0.3, 0.3)),
      patch(rng, "shiro", between(rng, 0.55, 0.62), between(rng, -0.4, 0.4), 0.075, 0.9),
      patch(rng, "hi", between(rng, 0.7, 0.76), between(rng, -0.3, 0.3), 0.06, 1.0),
      menware(rng),
    ],
    scales: "fine",
    fins: "motoguro",
    metallic: false,
  }),
  tancho: (rng) => ({
    base: "shiro",
    patches: [roundPatch(rng, "hi", between(rng, 0.085, 0.095), between(rng, -0.04, 0.04), 0.04)],
    scales: "fine",
    fins: "clear",
    metallic: false,
  }),
  utsuri: (rng) => ({
    base: "sumi",
    patches: [
      patch(rng, "shiro", 0.07, 0, 0.06, 0.66),
      patch(rng, "shiro", between(rng, 0.26, 0.32), between(rng, -0.35, 0.35), 0.09, 1.15, between(rng, -0.3, 0.3)),
      patch(rng, "shiro", between(rng, 0.48, 0.54), between(rng, -0.35, 0.35), 0.085, 1.2, between(rng, -0.3, 0.3)),
      patch(rng, "shiro", between(rng, 0.7, 0.76), between(rng, -0.3, 0.3), 0.07, 1.0),
      menware(rng),
    ],
    scales: "fine",
    fins: "motoguro",
    metallic: false,
  }),
  asagi: (rng) => ({
    base: "ai",
    patches: [patch(rng, "pale", 0.06, 0, 0.075, 0.82, 0, 0.3), ...flankRed(rng)],
    scales: "net",
    fins: "hi-root",
    metallic: false,
  }),
  shusui: (rng) => ({
    base: "sora",
    // A clean pale head back to the gill covers, then hi only along the flanks.
    patches: [patch(rng, "pale", 0.085, 0, 0.105, 1.2, 0, 0.12), ...shusuiHi(rng)],
    scales: "doitsu",
    fins: "hi-root",
    metallic: false,
  }),
  ogon: () => ({ base: "kin", patches: [], scales: "metallic", fins: "gold", metallic: true }),
};

export function generatePattern(variety: VarietyId, seed: number): KoiPattern {
  const rng = mulberry32((seed * 2654435761) ^ variety.charCodeAt(0));
  return { variety, seed, ...BUILDERS[variety](rng) };
}

/** Which pigments show on a pattern, base included. */
export function pigmentsOf(pattern: KoiPattern): Set<Pigment> {
  return new Set([pattern.base, ...pattern.patches.map((p) => p.pigment)]);
}

/** Sample a patch's outline in (u, v) body coordinates. */
export function patchOutline(p: Patch, steps = 28): { u: number; v: number }[] {
  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  const k = halfWidth(p.u); // converts v units into body lengths, so rotation keeps its shape
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * Math.PI * 2;
    const r = 1 + p.wobble.reduce((sum, [amp, freq, phase]) => sum + amp * Math.sin(freq * a + phase), 0);
    const du = Math.cos(a) * p.ru * r;
    const dv = Math.sin(a) * p.rv * r * k;
    return { u: p.u + du * cos - dv * sin, v: p.v + (du * sin + dv * cos) / k };
  });
}
