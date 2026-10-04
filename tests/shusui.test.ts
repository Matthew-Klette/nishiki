import { describe, expect, test } from "vitest";
import { halfWidth, MAX_HALF_WIDTH } from "../src/lib/body";
import { bladeHalfWidth, DOITSU_ZONES, PLATE_LAYERS, plateAxes, shusuiScaleLayout, type MirrorScale } from "../src/lib/doitsu";
import { generatePattern, patchOutline, pigmentsOf, type Patch } from "../src/lib/patterns";

/** Widest body width (both flanks), in body lengths: the "W" breeders' proportions are quoted in. */
const W = 2 * MAX_HALF_WIDTH;
const plates = shusuiScaleLayout();
const { fin, merge } = DOITSU_ZONES;

/** How far a tilted plate reaches across the body from its centre, in body lengths. */
const reach = (s: MirrorScale) => (s.w * Math.cos(s.tilt) + s.l * Math.abs(Math.sin(s.tilt))) / 2;
const innerEdge = (s: MirrorScale) => Math.abs(s.v) * halfWidth(s.u) - reach(s);
const outerEdge = (s: MirrorScale) => Math.abs(s.v) * halfWidth(s.u) + reach(s);

const shoulder = plates.filter((s) => s.u < fin);
const finRows = plates.filter((s) => s.u >= fin && s.u < merge);
const tail = plates.filter((s) => s.u >= merge);

describe("Shūsui mirror scales", () => {
  test("the layout is mirror-symmetric across the back", () => {
    for (const s of plates) {
      const partner = plates.find((p) => p.u === s.u && p.v === -s.v && p.w === s.w && p.l === s.l && p.tilt === -s.tilt);
      expect(partner, `no partner for plate at u=${s.u.toFixed(3)} v=${s.v.toFixed(3)}`).toBeDefined();
    }
  });

  test("beside the dorsal fin the plates run in two rows, never on the midline", () => {
    expect(finRows.length).toBeGreaterThan(20);
    finRows.forEach((s) => expect(Math.abs(s.v)).toBeGreaterThan(0.1));
    // A clear gap for the folded fin: 6–10% of the body's width at the front of the fin.
    finRows.filter((s) => s.u < 0.6).forEach((s) => {
      expect((2 * innerEdge(s)) / W).toBeGreaterThan(0.06);
      expect((2 * innerEdge(s)) / W).toBeLessThan(0.1);
    });
  });

  test("the rows close into a single file behind the fin", () => {
    expect(tail.length).toBeGreaterThanOrEqual(4);
    tail.forEach((s) => {
      expect(s.v).toBe(0);
      expect(s.tilt).toBe(0);
    });
    const offsets = finRows.filter((s) => s.v > 0).map((s) => s.v);
    expect(offsets.at(-1)).toBeLessThan(offsets[0] * 0.7);
  });

  test("everything sits between the shoulders and the tail membrane", () => {
    plates.forEach((s) => {
      expect(s.u - s.l / 2).toBeGreaterThan(0.26);
      expect(s.u + s.l / 2).toBeLessThanOrEqual(0.94);
    });
  });

  test("the shoulder block is a symmetric patch 35–45% of the body wide, three plates across", () => {
    const span = (2 * Math.max(...shoulder.map(outerEdge))) / W;
    expect(span).toBeGreaterThan(0.35);
    expect(span).toBeLessThan(0.45);
    expect(new Set(shoulder.map((s) => s.v))).toEqual(new Set([-0.26, 0, 0.26]));
    expect(shoulder.filter((s) => s.v === 0).every((s) => s.tilt === 0)).toBe(true);
  });

  test("plates are largest over the shoulders and shrink to about half by the tail", () => {
    const shoulderMin = Math.min(...shoulder.map((s) => s.w));
    const shoulderMax = Math.max(...shoulder.map((s) => s.w));
    expect(shoulderMax / W).toBeGreaterThan(0.12);
    expect(shoulderMax / W).toBeLessThan(0.16);
    expect(Math.max(...finRows.map((s) => s.w))).toBeLessThan(shoulderMin);
    const last = finRows.at(-1) as MirrorScale;
    expect(last.w / shoulderMax).toBeGreaterThan(0.4);
    expect(last.w / shoulderMax).toBeLessThan(0.6);
    plates.forEach((s) => expect(s.w).toBeGreaterThan(s.l)); // crosswise ovals
  });

  test("each fin row is about 15% of the body wide, swept back in a herringbone", () => {
    finRows.filter((s) => s.u < 0.55).forEach((s) => {
      expect((2 * reach(s)) / W).toBeGreaterThan(0.13);
      expect((2 * reach(s)) / W).toBeLessThan(0.18);
    });
    finRows.forEach((s) => expect(Math.sign(s.tilt)).toBe(Math.sign(s.v)));
  });

  test("plates overlap like shingles, with no gaps along a row", () => {
    const columns = [plates.filter((s) => s.v > 0), plates.filter((s) => s.v === 0 && s.u < fin), tail];
    for (const column of columns) {
      column.slice(1).forEach((s, i) => {
        const ahead = column[i];
        expect(s.u - ahead.u).toBeLessThan((s.l + ahead.l) / 2);
      });
    }
  });

  test("the folded dorsal fin fits in the gap between the rows", () => {
    expect(bladeHalfWidth(fin + 0.02)).toBeGreaterThan(0);
    expect(bladeHalfWidth(merge)).toBe(0);
    finRows.filter((s) => s.u < 0.76).forEach((s) => expect(bladeHalfWidth(s.u) * halfWidth(s.u)).toBeLessThan(innerEdge(s)));
  });

  test("each painted layer stays inside its plate's outline", () => {
    for (const { across, along, shift } of PLATE_LAYERS) {
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * Math.PI * 2;
        // In units of the plate's semi-axes: a shift of one plate length is two semi-axes.
        const x = across * Math.cos(a);
        const y = -2 * shift + along * Math.sin(a);
        expect(x * x + y * y).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  test("plate axes follow the body: tilt sweeps the +v end back toward the tail", () => {
    const forward = { x: 0, y: -1 };
    const across = { x: -forward.y, y: forward.x };
    expect(plateAxes(forward, 0).rotation).toBeCloseTo(0);
    expect(plateAxes(forward, 0).headward).toEqual(forward);
    const { rotation, headward } = plateAxes(forward, 0.3);
    const axis = { x: Math.cos(rotation), y: Math.sin(rotation) };
    expect(axis.x * across.x + axis.y * across.y).toBeGreaterThan(0.9);
    expect(axis.x * forward.x + axis.y * forward.y).toBeLessThan(0);
    expect(axis.x * headward.x + axis.y * headward.y).toBeCloseTo(0);
  });
});

describe("Shūsui pattern", () => {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);
  const flankHi = (p: Patch) => p.pigment === "hi" && p.u > 0.3;
  /** How close to the midline a patch's outline comes, in v units. */
  const innerReach = (p: Patch) => Math.min(...patchOutline(p, 40).map((o) => Math.abs(o.v)));

  test.each([1, 2, 3])("keeps a pale head, a sky-blue back and red flanks (seed %i)", (seed) => {
    const pattern = generatePattern("shusui", seed);
    expect(pigmentsOf(pattern)).toEqual(new Set(["sora", "pale", "hi"]));
    const head = pattern.patches.find((p) => p.pigment === "pale") as Patch;
    expect(head.u - head.ru).toBeLessThan(0);
    expect(head.u + head.ru).toBeGreaterThan(0.17);
  });

  test("the hi is exactly mirrored left and right, edge wobble included", () => {
    for (const seed of seeds) {
      const hi = generatePattern("shusui", seed).patches.filter((p) => p.pigment === "hi");
      expect(hi.length % 2).toBe(0);
      for (const p of hi.filter((h) => h.v > 0)) {
        const twin = hi.find((h) => h.u === p.u && h.v === -p.v) as Patch;
        expect(twin).toBeDefined();
        const a = patchOutline(p, 40);
        const b = patchOutline(twin, 40);
        a.forEach((o, i) => {
          const m = b[(40 - i) % 40];
          expect(m.u).toBeCloseTo(o.u, 9);
          expect(m.v).toBeCloseTo(-o.v, 9);
        });
      }
    }
  });

  test("the flank bands are broader than Asagi's and run from the shoulders to the tail root", () => {
    for (const seed of seeds) {
      const shusui = generatePattern("shusui", seed).patches.filter(flankHi);
      const asagi = generatePattern("asagi", seed).patches.filter(flankHi);
      expect(Math.min(...shusui.map(innerReach))).toBeLessThan(Math.min(...asagi.map(innerReach)) - 0.05);
      shusui.forEach((p) => {
        expect(p.u - p.ru).toBeLessThan(0.32);
        expect(p.u + p.ru).toBeGreaterThan(0.95);
      });
    }
  });

  test("the hi comes close to the scale rows but leaves the blue back clear", () => {
    const rowsEdge = Math.max(...plates.map((s) => outerEdge(s) / halfWidth(s.u)));
    for (const seed of seeds) {
      const bands = generatePattern("shusui", seed).patches.filter(flankHi);
      bands.forEach((p) => {
        expect(innerReach(p)).toBeGreaterThan(rowsEdge);
        expect(innerReach(p)).toBeLessThan(0.56);
      });
    }
  });
});
