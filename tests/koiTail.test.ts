import { describe, expect, test } from "vitest";
import { halfWidth } from "../src/lib/body";
import { distance } from "../src/lib/geometry";
import { createSwimmer, spineOf } from "../src/lib/swim";
import { bodyPoint, poseKoi } from "../src/render/koiFrame";
import { TAIL_LENGTH, TAIL_ROOT_U, TAIL_SPAN, tailSheet } from "../src/render/koiTail";

const L = 400;
const params = { length: L, cruise: 0.3, maxTurn: 1 };
const spine = spineOf(createSwimmer({ x: 0, y: 0 }, 0, params), params);
const frame = poseKoi(spine, L, { beat: 0, time: 0, amplitude: 0 });
const sheet = tailSheet(frame);
const width = (t: number) => distance(sheet.point(t, -1), sheet.point(t, 1)) / 2;

describe("tail membrane", () => {
  test("starts exactly on the body's own edges, so the silhouette cannot kink at the join", () => {
    for (const s of [-1, 0, 1]) {
      expect(distance(sheet.point(0, s), bodyPoint(frame, TAIL_ROOT_U, s))).toBeLessThan(0.5);
    }
  });

  test("the body ends where the membrane says it does", () => {
    expect(sheet.bodyEnd).toBeCloseTo((1 - TAIL_ROOT_U) / TAIL_LENGTH);
  });

  test("has no jump where it leaves the body", () => {
    const e = 1e-3;
    for (const s of [-1, 0, 1]) {
      expect(distance(sheet.point(sheet.bodyEnd - e, s), sheet.point(sheet.bodyEnd + e, s))).toBeLessThan(L * 0.01);
    }
  });

  test("narrows to a waist before flaring out to its full span", () => {
    expect(width(sheet.bodyEnd * 0.5)).toBeLessThan(halfWidth(TAIL_ROOT_U) * L);
    expect(width(0.85)).toBeGreaterThan(TAIL_SPAN * L * 0.9);
  });

  test("widens smoothly: no step in width between neighbouring samples", () => {
    for (let t = 0; t < 0.95; t += 0.02) {
      expect(Math.abs(width(t + 0.02) - width(t))).toBeLessThan(L * 0.03);
    }
  });

  test("is forked: the middle rays are shorter than the lobes", () => {
    expect(sheet.tEnd(0)).toBeLessThan(sheet.tEnd(0.75) - 0.2);
    expect(sheet.tEnd(-0.75)).toBeGreaterThan(sheet.tEnd(0) + 0.2);
  });

  test("every ray ends well past the body", () => {
    for (let s = -1; s <= 1; s += 0.1) expect(sheet.tEnd(s)).toBeGreaterThan(sheet.bodyEnd + 0.3);
  });
});

describe("tail membrane on a swimming fish", () => {
  test("stays attached to the body's edges on a bent body mid-stroke", () => {
    const turning = { ...createSwimmer({ x: 0, y: 0 }, 0, params), bend: 0.8 };
    for (const beat of [0, 1.6, 3.1, 4.7]) {
      const bent = poseKoi(spineOf(turning, params), L, { beat, time: 0, amplitude: 0.08, drive: 1 });
      const fin = tailSheet(bent);
      for (const s of [-1, 0, 1]) expect(distance(fin.point(0, s), bodyPoint(bent, TAIL_ROOT_U, s))).toBeLessThan(0.5);
    }
  });
});
