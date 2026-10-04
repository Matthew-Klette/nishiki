import type { FinStyle, KoiPattern } from "../lib/patterns";

/* ------------------------------------------------------------------ ink */

export interface Ink {
  /** Outline and detail lines. */
  readonly line: string;
  /** Scale crescents: a dark cut and a pale lip. */
  readonly scaleDark: string;
  readonly scaleLight: string;
  readonly finFill: string;
  readonly finLine: string;
  /** Colour at the root of the paired fins, and how far up it reaches (0–1). */
  readonly finRoot?: readonly [string, number];
}

const INK = "#24170f";

export function inkFor(pattern: KoiPattern): Ink {
  const base = {
    line: INK,
    scaleDark: "rgba(36,23,15,0.34)",
    scaleLight: "rgba(255,250,238,0.4)",
    finFill: "rgba(246,240,228,0.86)",
    finLine: "rgba(36,23,15,0.45)",
  };
  const byFins: Record<FinStyle, Ink> = {
    clear: base,
    stripes: base,
    motoguro: { ...base, finRoot: ["rgba(18,14,10,0.95)", 0.42] },
    "hi-root": { ...base, line: "#1c2a31", finRoot: ["rgba(205,62,34,0.9)", 0.36] },
    gold: {
      line: "#5a3a0c",
      scaleDark: "rgba(98,62,10,0.4)",
      scaleLight: "rgba(255,240,190,0.55)",
      finFill: "rgba(230,184,84,0.86)",
      finLine: "rgba(98,62,10,0.5)",
    },
  };
  return byFins[pattern.fins];
}
