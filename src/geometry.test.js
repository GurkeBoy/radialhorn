/**
 * Rechenkern der abgeleiteten Geometrie (Worker): gleiche Ergebnisse wie die direkte Rechnung,
 * nur betroffene Stufen rechnen neu, übertragbare Daten, Objekte bleiben bei gleicher Version.
 */
import { describe, it, expect } from "vitest";
import { createHornMath, computeFillet, makeProfile, throatMorph } from "./horn-math.js";
import { flangeLayout, shellPlanOutline } from "./horn-mesh.js";
import { createGeometryEngine, adoptGeometry, GEOMETRY_KEYS } from "./geometry.js";

const BASE = {
  throatDiam: 50.8, openingAngle: 140, L: 700, Lt: 132.3, dw: 182, dh: 90, hMouth: 200, curve: "hypex", hypexT: 0.7,
  showRaumecke: true, showWandstaerke: true, wandstaerke: 10, filletOn: true, filletR: 477, clothoidOn: true, clothoidLength: 30,
  morphOn: true, morphLength: 473, flangeOn: true, flangeD: 120, flangeT: 10, holeCount: 4, holeCircle: 101.6, holeD: 6.6,
  holeAngle: 0, edgeOn: true, edgeR: 10,
};

describe("createGeometryEngine", () => {
  it("kennt genau die Geometrie-Werte", () => {
    expect([...GEOMETRY_KEYS].sort()).toEqual(Object.keys(BASE).sort());
  });

  it("gleiche Ergebnisse wie die direkte Rechnung", () => {
    const { values: v } = createGeometryEngine()(BASE);
    const rt = BASE.throatDiam / 2, math = createHornMath(140, { clothoid: 30 });
    const extra = (Math.cos(math.ALPHA2) + Math.sin(math.ALPHA2)) * 10;
    const LtMax = math.maxLt(700, rt, 182, 90);
    const LtMin = Math.max(math.minLtForRaumecke(700, rt, 182, 90, extra) ?? 0, math.minLtForClothoid(rt));
    const Lt = Math.min(Math.max(132.3, LtMin), LtMax);
    const LMax = math.maxLforRaumecke(Lt, rt, 182, 90, extra);
    const L = Math.min(700, LMax);
    const s = math.solveHorn(L, Lt, rt, 182, 90);
    expect(v.LtClamped).toBe(Lt);
    expect(v.LClamped).toBe(L);
    expect(v.s).toEqual(s);
    const fillet = computeFillet(s, rt, 200, "hypex", 0.7, 477);
    expect(v.fillet).toEqual(fillet);
    const profile = makeProfile(s, rt, 200, "hypex", 0.7, fillet), morph = throatMorph(s, rt, 473);
    expect(v.morph).toEqual(morph);
    expect(v.flange).toEqual(flangeLayout(s, rt, profile, fillet, 10, {
      diameter: 120, fallback: 182, thickness: 10, holes: { count: 4, circle: 101.6, diameter: 6.6, angle: 0 },
    }, 10, morph));
    expect(v.shellOuter).toEqual(shellPlanOutline(s, rt, 10, 10));
  }, 30000);

  it("nur betroffene Stufen rechnen neu", () => {
    const compute = createGeometryEngine();
    let prev = compute(BASE);
    // geänderte Teile gegenüber dem vorigen Ergebnis
    const step = params => {
      const next = compute(params);
      const diff = Object.keys(next.versions).filter(k => next.versions[k] !== prev.versions[k]).sort();
      prev = next;
      return diff;
    };
    expect(step({ ...BASE })).toEqual([]);
    expect(step({ ...BASE, flangeD: 140 })).toEqual(["flange"]);
    expect(step({ ...BASE, flangeD: 140 })).toEqual([]);
    // Mundhöhe: Verrundung, Profil und alles daran – nicht die Lösung, nicht der Übergang, nicht der Grundriss
    expect(step({ ...BASE, flangeD: 140, hMouth: 210 })).toEqual(["fillet", "flange", "shellCut"]);
    expect(step({ ...BASE, flangeD: 140, hMouth: 210, L: 650 })).toContain("s");
  }, 30000);

  it("Ergebnis ist übertragbar (structuredClone, wie postMessage)", () => {
    const r = createGeometryEngine()(BASE);
    expect(structuredClone(r.values)).toEqual(r.values);
  }, 30000);
});

describe("adoptGeometry", () => {
  it("behält Objekte gleicher Version, übernimmt neue", () => {
    const compute = createGeometryEngine();
    const first = compute(BASE);
    const copy = structuredClone(compute({ ...BASE, flangeD: 140 }));   // wie aus dem Worker
    const next = adoptGeometry(first, copy);
    expect(next.values.s).toBe(first.values.s);
    expect(next.values.shellOuter).toBe(first.values.shellOuter);
    expect(next.values.flange).toBe(copy.values.flange);
    expect(next.values.flange.diameter).toBe(140);
    expect(next.params.flangeD).toBe(140);
  }, 30000);

  it("Versionen verschiedener Kerne verwechseln sich nicht", () => {
    const a = createGeometryEngine()(BASE), b = createGeometryEngine()(BASE);
    expect(adoptGeometry(a, b).values.s).toBe(b.values.s);
  }, 30000);
});
