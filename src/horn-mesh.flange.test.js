/**
 * Flansch am Throat: geschlossen mit der Schale, Bohrungen, Gültigkeit.
 */
import { describe, it, expect } from "vitest";
import { solveHorn, makeProfile, createHornMath, throatMorph } from "./horn-math.js";
import { DEFAULT_RES, buildShellGeometry, flangeLayout, boltHoleCenters, triangulate } from "./horn-mesh.js";
import { edgeCheck, cross, signedVolume as volume } from "./test-helpers.js";

const RT = 25.4, T = 15;
const s = solveHorn(500, 60, RT, 120, 100);
const profile = makeProfile(s, RT, 200, "exponential", 0.5);
const flange = (over = {}) => ({
  diameter: 180, thickness: 10,
  holes: { count: 4, circle: 150, diameter: 6.5, angle: 45 },
  ...over,
});

const tris = geo => geo.surfaces.flatMap(triangulate);

describe("Flansch", () => {
  it("Bohrbild: gleichmäßig auf dem Lochkreis, erste Bohrung unter dem Winkel", () => {
    const c = boltHoleCenters({ count: 4, circle: 100, angle: 45 });
    expect(c).toHaveLength(4);
    for (const [x, h] of c) expect(Math.hypot(x, h)).toBeCloseTo(50, 9);
    expect(c[0][0]).toBeCloseTo(50 * Math.SQRT1_2, 9);
    expect(c[0][1]).toBeCloseTo(50 * Math.SQRT1_2, 9);
  });

  it("Schale mit Flansch ist geschlossen und konsistent orientiert", () => {
    for (const f of [flange(), flange({ holes: { count: 0, circle: 150, diameter: 6.5, angle: 0 } }), flange({ thickness: 25 })]) {
      expect(edgeCheck(tris(buildShellGeometry(s, RT, profile, null, T, f)))).toEqual({ open: 0, flipped: 0 });
    }
  });

  it("auch mit Klothoide und ohne Traktrix geschlossen", () => {
    const sk = createHornMath(140, { clothoid: 30 }).solveHorn(500, 80, RT, 120, 100);
    const pk = makeProfile(sk, RT, 200, "exponential", 0.5);
    expect(edgeCheck(tris(buildShellGeometry(sk, RT, pk, null, T, flange())))).toEqual({ open: 0, flipped: 0 });
    const s0 = solveHorn(500, 0, RT, 120, 100);
    const p0 = makeProfile(s0, RT, 200, "exponential", 0.5);
    expect(edgeCheck(tris(buildShellGeometry(s0, RT, p0, null, T, flange({ diameter: 250 })))))
      .toEqual({ open: 0, flipped: 0 });
  });

  it("dickerer Flansch: Zuwachs = Fläche der Flansch-Vorderseite × Dickenzuwachs", () => {
    // In der Zwischenschicht ersetzt die Platte (ohne Öffnung und Bohrungen) den Außenkörper:
    // Zuwachs = Plattenfläche − Querschnitt des Außenkörpers = Fläche der Vorderseite
    const geo = d => buildShellGeometry(s, RT, profile, null, T, flange({ thickness: d }));
    const frontArea = d => triangulate(geo(d).surfaces.find(f => f.name === "flangeFront"))
      .reduce((A, [a, b, c]) => A + Math.hypot(...cross([b[0] - a[0], b[1] - a[1], 0], [c[0] - a[0], c[1] - a[1], 0])) / 2, 0);
    const dV = volume(tris(geo(12))) - volume(tris(geo(10)));
    expect(dV / ((frontArea(10) + frontArea(12)) / 2 * 2)).toBeCloseTo(1, 2);
  });

  it("Mindestdurchmesser umschließt den Außenkörper; Bohrungen in der Schale fallen weg", () => {
    const c = flangeLayout(s, RT, profile, null, T, flange());
    expect(c.minDiameter).toBeGreaterThan(2 * Math.SQRT2 * (RT + T) - 1);
    expect(c.centers).toHaveLength(4);
    expect(c.limited).toBe(false);
    expect(c.invalidHoles).toBe(0);
    const inShell = flangeLayout(s, RT, profile, null, T, flange({ holes: { count: 4, circle: 70, diameter: 6.5, angle: 0 } }));
    expect(inShell.invalidHoles).toBe(4);
    expect(inShell.conflicts).toHaveLength(4);
    expect(inShell.centers).toHaveLength(0);
    const outside = flangeLayout(s, RT, profile, null, T, flange({ holes: { count: 6, circle: 178, diameter: 6.5, angle: 0 } }));
    expect(outside.invalidHoles).toBe(6);
  });

  it("zu kleiner Ø wird auf das Minimum angehoben, Lochkreis ohne Vorgabe mittig", () => {
    const c = flangeLayout(s, RT, profile, null, T, flange({ diameter: 50, holes: { count: 4, circle: null, diameter: 6.5, angle: 45 } }));
    expect(c.limited).toBe(true);
    expect(c.diameter).toBe(c.minDiameter);
    expect(c.holes.circle).toBeCloseTo(c.minDiameter, 9);
    const big = flangeLayout(s, RT, profile, null, T, flange({ holes: { count: 4, circle: null, diameter: 6.5, angle: 45 } }));
    expect(big.holes.circle).toBeCloseTo((big.minDiameter + 180) / 2, 9);
    expect(big.centers).toHaveLength(4);
    expect(edgeCheck(tris(buildShellGeometry(s, RT, profile, null, T, big)))).toEqual({ open: 0, flipped: 0 });
  });

  it("ohne Ø: Treiberbreite, mindestens Schale + Ring für die Bohrungen – alle Bohrungen passen", () => {
    const auto = (fallback, count = 4) => flangeLayout(s, RT, profile, null, 20, flange({
      diameter: null, fallback, holes: { count, circle: null, diameter: 6.5, angle: 45 } }));
    const small = auto(120);
    expect(small.diameter).toBeCloseTo(small.minDiameter + 30, 9);
    expect(small.limited).toBe(false);
    expect(small.centers).toHaveLength(4);
    expect(auto(250).diameter).toBe(250);
    expect(auto(10, 0).diameter).toBe(auto(10, 0).minDiameter);
  });

  it("Mindest-Ø aus grob gerechnetem Außenkörper = Umkreis des fein gerechneten Randzugs am Throat", () => {
    // flangeLayout rechnet den Außenkörper in Längsrichtung grob (nur Zeile 0 wird gebraucht)
    for (const [t, edgeR, round] of [[T, 0, false], [12, 12, false], [12, 6, false], [12, 12, true], [12, 0, true]]) {
      const morph = round ? throatMorph(s, RT) : null;
      const layout = flangeLayout(s, RT, profile, null, t, flange({ diameter: null, fallback: 120 }), edgeR, morph);
      const geo = buildShellGeometry(s, RT, profile, null, t, layout, edgeR, morph);
      let max = 0;
      for (const f of geo.surfaces.filter(x => x.name.startsWith("outer.") && x.grid)) {
        for (const row of f.grid) for (const [x, h, z] of row) if (Math.abs(z - layout.thickness) < 1e-9) max = Math.max(max, Math.hypot(x, h));
      }
      expect(layout.minDiameter).toBeCloseTo(2 * (max + 1) / Math.cos(Math.PI / DEFAULT_RES.flange), 9);
    }
  });
});
