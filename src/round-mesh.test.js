/**
 * Rundes Horn (Rotationskörper, round-mesh.js): Luftvolumen und Schale geschlossen und gleichsinnig orientiert, Volumen
 * gegen die Rotation des Profils, Flansch und Rippen, Weiche in bodies.js, Umrisse und Auflösung.
 */
import { describe, it, expect } from "vitest";
import { createHornMath, entrancePoints, linearWallPoints } from "./horn-math.js";
import { buildAir, buildShell, layoutFlange } from "./bodies.js";
import { buildRoundHornGeometry, buildRoundShellGeometry } from "./round-mesh.js";
import { triangulate, DRAFT_RES, EXPORT_RES } from "./horn-mesh.js";
import { edgeCheck, signedVolume } from "./test-helpers.js";

const RT = 25.4;
const solve = (Lt, { clothoid = 0, angle = 70, L = 500 } = {}) => ({ ...createHornMath(angle, { clothoid }).solveHorn(L, Lt, RT, 0, 0), round: true });
const tris = geo => geo.surfaces.flatMap(triangulate);
const FLANGE = { diameter: null, fallback: 120, thickness: 10, holes: { count: 4, circle: null, diameter: 6.6, angle: 0 } };
const CASES = {
  "Traktrix + gerade Wand": solve(60),
  "mit Klothoide": solve(60, { clothoid: 30 }),
  "nur Kegel": solve(0, { L: 400 }),
  "kurze Traktrix": solve(20, { angle: 60, L: 300 }),
  "kleines Hochtonhorn": solve(20, { angle: 40, L: 100 }),
};

/** Rauminhalt des Rotationskörpers aus dem Profil: ∫ π·x² dz entlang der Wand plus Kugelkappe am Mund. */
function analyticAirVolume(s) {
  const pts = [...entrancePoints(s, 4000, 4000), ...linearWallPoints(s, 4000)].filter((p, i, a) => i === 0 || p[1] > a[i - 1][1]);
  let wall = 0;
  for (let i = 1; i < pts.length; i++) wall += Math.PI * (pts[i][0] ** 2 + pts[i][0] * pts[i - 1][0] + pts[i - 1][0] ** 2) / 3 * (pts[i][1] - pts[i - 1][1]);
  const h = s.zApex - s.zMouth, a = s.xMouth;
  return wall + Math.PI * h * (3 * a * a + h * h) / 6;
}

describe("Luftvolumen des runden Horns", () => {
  for (const [name, s] of Object.entries(CASES)) {
    it(`${name}: geschlossen, gleichsinnig; Volumen = Rotation des Profils (Vieleck mit 64 Seiten: −0,17 %)`, () => {
      const air = buildAir(s, RT, null, null, null);
      expect(edgeCheck(tris(air))).toEqual({ open: 0, flipped: 0 });
      // 64-Eck statt Kreis: Fläche (sin(2π/n)·n/2π) = 0,9984 – hier die 64 Spalten (4 · res.round)
      expect(signedVolume(tris(air)) / analyticAirVolume(s)).toBeCloseTo(0.99836, 3);
    });
  }

  it("Mundkappe liegt auf der Kugel um den Fokus, die Wand an der Mündung berührt sie; Pol auf der Achse", () => {
    const s = CASES["Traktrix + gerade Wand"];
    const cap = buildRoundHornGeometry(s, RT).surfaces.filter(f => f.name.startsWith("capMouth"));
    expect(cap).toHaveLength(4);
    const pts = cap.flatMap(f => f.grid.flat());
    for (const [x, h, z] of pts) expect(Math.hypot(x, h, z - s.zFocus)).toBeCloseTo(s.arcR, 6);
    expect(pts.some(p => Math.abs(p[0]) < 1e-9 && Math.abs(p[1]) < 1e-9 && Math.abs(p[2] - s.zApex) < 1e-9)).toBe(true);
  });

  it("die Auflösung folgt res.round: Entwurf < Standard < Export Dreiecke, alle geschlossen", () => {
    const s = CASES["Traktrix + gerade Wand"];
    const counts = [DRAFT_RES, undefined, EXPORT_RES].map(res => {
      const t = tris(buildAir(s, RT, null, null, null, res));
      expect(edgeCheck(t)).toEqual({ open: 0, flipped: 0 });
      return t.length;
    });
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
  });

  it("buildAir wählt nach s.round: ohne Kennzeichen das Radialhorn (Rechteck am Throat), mit Kennzeichen den Rotationskörper", () => {
    const s = CASES["Traktrix + gerade Wand"];
    expect(buildAir(s, RT, null, null, null).surfaces.some(f => f.name.startsWith("capMouth"))).toBe(true);
    expect(buildAir(s, RT, null, null, null).surfaces.some(f => f.name === "trakTop")).toBe(false);
  });
});

describe("Schale des runden Horns", () => {
  const WALL = 10;
  for (const [name, s] of Object.entries(CASES)) {
    for (const [label, flange] of [["bündig", null], ["Flansch", FLANGE], ["Flansch + Rippen", { ...FLANGE, ribs: { thickness: 4, length: 30 } }], ["Flansch + Rippen + Randverrundung", { ...FLANGE, ribs: { thickness: 4, length: 30 }, round: 3 }]]) {
      it(`${name}, ${label}: geschlossen und gleichsinnig`, () => {
        const wall = name.startsWith("kleines") ? 3 : WALL;
        const layout = flange && layoutFlange(s, RT, null, null, wall, flange, 0, null);
        expect(edgeCheck(tris(buildShell(s, RT, null, null, wall, layout, 0, null)))).toEqual({ open: 0, flipped: 0 });
      });
    }
  }

  it("Wandmaterial einer dünnen Schale ≈ Mantelfläche · t; wird die Wand dicker, wächst es", () => {
    const s = CASES["Traktrix + gerade Wand"];
    const shell = t => signedVolume(tris(buildShell(s, RT, null, null, t, null, 0, null)));
    expect(shell(10)).toBeGreaterThan(shell(5));
    // Mantelfläche des Profils: Σ π·(x₁ + x₂)·ds
    const pts = [...entrancePoints(s, 4000, 4000), ...linearWallPoints(s, 4000)].filter((p, i, a) => i === 0 || p[1] > a[i - 1][1]);
    let area = 0;
    for (let i = 1; i < pts.length; i++) area += Math.PI * (pts[i][0] + pts[i - 1][0]) * Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    expect(shell(1) / area).toBeGreaterThan(0.97);
    expect(shell(1) / area).toBeLessThan(1.03);
  });

  it("Wandstärke senkrecht zur Wand: Außenkontur im Abstand t", () => {
    const s = CASES["Traktrix + gerade Wand"], t = 10;
    const geo = buildRoundShellGeometry(s, RT, t, null);
    const inner = geo.surfaces.filter(f => f.name.startsWith("inner.")).flatMap(triangulate).flat();
    const outer = geo.surfaces.filter(f => f.name.startsWith("outer.")).flatMap(f => f.grid.flat());
    // jeder Punkt der geraden Außenwand hat zur Innenwand genau t Abstand (Kegel: Abstand zu den Innenpunkten ≥ t − Rundung)
    const lin = outer.filter(p => p[2] > s.zTrans + 20).slice(0, 400);
    for (const p of lin) {
      const d = Math.min(...inner.map(q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])));
      expect(d).toBeGreaterThan(t - 0.35);
      expect(d).toBeLessThan(t + 0.2);
    }
  });

  it("Rippen: je Loch eine, wo die Wand es zulässt; Überlapp gemeldet", () => {
    const s = CASES["Traktrix + gerade Wand"];
    const layout = layoutFlange(s, RT, null, null, 10, { ...FLANGE, ribs: { thickness: 4, length: 30 } }, 0, null);
    const ribs = buildShell(s, RT, null, null, 10, layout, 0, null).ribs;
    expect(ribs.count).toBe(4);
    expect(ribs.overlap).toBeGreaterThan(0);
    expect(ribs.thickness).toBe(4);
  });

  it("alle Rippen gleich lang (Rotationssymmetrie), auch wenn der Strahl genau durch einen Eckpunkt des Netzes läuft", () => {
    // Rippenwinkel auf Vielfachen von 5,625° (Spalten des 64-Ecks): der Strahl trifft die Eckpunkte genau
    for (const [angle, L] of [[50, 500], [30, 300], [70, 500]]) {
      const s = solve(60, { angle, L });
      for (const [count, holeAngle] of [[4, 0], [4, 45], [3, 0], [6, 11.25], [8, 0]]) {
        const flange = { ...FLANGE, holes: { count, circle: null, diameter: 6.6, angle: holeAngle }, ribs: { thickness: 4, length: 30 } };
        const layout = layoutFlange(s, RT, null, null, 8, flange, 0, null);
        const { shapes } = buildShell(s, RT, null, null, 8, layout, 0, null).ribs;
        expect(shapes.length, `${angle}°, ${count} Löcher, ${holeAngle}°`).toBe(count);
        const top = shapes.map(sh => Math.max(...sh.poly.map(q => q[1])));
        expect(Math.max(...top) - Math.min(...top), `${angle}°, ${count} Löcher, ${holeAngle}°`).toBeLessThan(1.5);   // höchstens eine Schnittebene Unterschied
      }
    }
  });

  it("Flansch umschließt die Schale (Mindestdurchmesser aus dem Kreis des Außenkörpers)", () => {
    const s = CASES["Traktrix + gerade Wand"];
    const layout = layoutFlange(s, RT, null, null, 10, { ...FLANGE, diameter: 40 }, 0, null);
    expect(layout.limited).toBe(true);
    expect(layout.diameter).toBeGreaterThanOrEqual(layout.minDiameter);
    expect(layout.loop.every(([x, h]) => Math.hypot(x, h) < layout.diameter / 2)).toBe(true);
  });
});
