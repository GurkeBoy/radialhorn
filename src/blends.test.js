/**
 * Beide Verrundungsarten in beiden Profilen: Kreisbogen oder Klothoide im horizontalen Profil (Übergang Traktrix →
 * Gerade) und im vertikalen Profil (Übergang Throat → Aufweitung). Mathematik, Geometrie-Kern, Netze, DXF und PDF.
 */
import { describe, it, expect } from "vitest";
import {
  createHornMath, makeProfile, computeFillet, computeFilletClothoid, clothoidTable, clothoidPoints, hasClothoid, crossSection, entrancePoints,
} from "./horn-math.js";
import { createGeometryEngine } from "./geometry.js";
import { buildAir, buildShell } from "./bodies.js";
import { triangulate } from "./horn-mesh.js";
import { edgeCheck } from "./test-helpers.js";
import { buildDXF, ALL_LAYERS } from "./export/dxf.js";
import { buildDatasheet } from "./export/pdf.js";
import { buildBrep, hornPatches } from "./export/step.js";

const RT = 25.4, H_MOUTH = 200;
const deg = r => r * 180 / Math.PI;

describe("Horizontales Profil: Kreisbogen zwischen Traktrix und Gerade", () => {
  const CASES = [[140, 60, 0.5], [140, 120, 0.5], [90, 120, 0.5], [90, 250, 0.4], [60, 250, 0.5]];

  for (const [angle, R, at] of CASES) {
    it(`${angle}° Öffnungswinkel, r = ${R} mm: Schmiegekreis an die Traktrix, tangential in die Gerade, Lₜ stimmt`, () => {
      const m = createHornMath(angle, { arc: R });
      const lo = m.minLtForClothoid(RT), hi = m.maxLtForBlend(RT);
      expect(hi).toBeGreaterThan(lo);
      const Lt = lo + at * (hi - lo);
      const s = m.solveHorn(700, Lt, RT, 0, 0);
      expect(s).not.toBeNull();
      const c = s.clothoid;
      expect(c.kind).toBe("arc");
      // Krümmung: stetig an der Traktrix (1/(r0·sinh τ) = 1/R), danach konstant
      expect(c.kappa0).toBeCloseTo(1 / (s.r0 * Math.sinh(s.tEnd)), 12);
      expect(1 / c.kappa0).toBeCloseTo(R, 9);
      // Richtung: Anfang = Tangente der Traktrix, Ende = Winkel α (tangential in die Gerade)
      expect(c.theta0).toBeCloseTo(Math.atan(1 / Math.sinh(s.tEnd)), 12);
      const tab = clothoidTable(c, 200), end = tab.at(-1);
      expect(deg(end.theta)).toBeCloseTo(angle / 2, 9);
      expect(end.x).toBeCloseTo(s.xTrans, 6);
      expect(end.z).toBeCloseTo(s.zTrans, 6);
      // axial genau Lt (Traktrix + Bogen), die Länge des Bogens R·(α − θ0)
      expect(s.zTrans).toBeCloseTo(Lt, 6);
      expect(c.length).toBeCloseTo(R * (s.alpha2 - c.theta0), 9);
      // Punkte liegen auf dem Kreis um den Mittelpunkt
      const cx = c.start[0] + R * Math.cos(c.theta0), cz = c.start[1] - R * Math.sin(c.theta0);
      for (const p of tab) expect(Math.hypot(p.x - cx, p.z - cz)).toBeCloseTo(R, 6);
    });
  }

  it("Fenster der Lₜ: darunter beginnt der Bogen vor dem Throat, darüber ist er kürzer als 0; ohne Fenster keine Traktrix", () => {
    const m = createHornMath(140, { arc: 120 });
    const lo = m.minLtForClothoid(RT), hi = m.maxLtForBlend(RT);
    expect(m.solveHorn(700, lo - 1, RT, 0, 0)).toBeNull();
    expect(m.solveHorn(700, hi + 1, RT, 0, 0)).toBeNull();
    expect(m.solveHorn(700, lo + 1e-6, RT, 0, 0)).not.toBeNull();
    // maxLt (Obergrenze nach L) meldet höchstens das Fenster nicht mit
    expect(m.maxLt(700, RT, 0, 0)).toBeGreaterThan(lo);
    // Radius zu klein für den Winkel: kein Fenster
    const small = createHornMath(60, { arc: 60 });
    expect(small.maxLtForBlend(RT)).toBeLessThanOrEqual(0);
  });

  it("Klothoide hat Vorrang vor dem Kreisbogen; ohne beide keine Übergangsstücke", () => {
    const both = createHornMath(140, { clothoid: 30, arc: 120 }).solveHorn(700, 132.3, RT, 0, 0);
    expect(both.clothoid.kind).toBeUndefined();
    expect(both.clothoid.kappa1 ?? 0).toBe(0);
    expect(createHornMath(140).solveHorn(700, 132.3, RT, 0, 0).clothoid).toBeNull();
  });

  it("Querschnitt: stetig und monoton über den Kreisbogen; Eingang-Punkte folgen dem Bogen", () => {
    const s = createHornMath(90, { arc: 120 }).solveHorn(700, 70, RT, 0, 0);
    const profile = makeProfile(s, RT, H_MOUTH, "exponential", 0.5);
    const pts = crossSection(s, profile, 200);
    for (let i = 1; i < pts.length; i++) expect(pts[i].A).toBeGreaterThanOrEqual(pts[i - 1].A - 1e-9);
    expect(hasClothoid(s)).toBe(true);
    expect(pts.some(p => p.part === "klothoide")).toBe(true);
    expect(clothoidPoints(s, 20)).toHaveLength(21);
    expect(entrancePoints(s, 40, 20).length).toBe(41 + 20);
  });

  it("Netze mit Kreisbogen (Radial und Rund, Luft und Schale) sind geschlossen und gleichsinnig", () => {
    const sRadial = createHornMath(140, { arc: 120 }).solveHorn(700, 140, RT, 182, 90);
    const profile = makeProfile(sRadial, RT, H_MOUTH, "exponential", 0.5);
    const tris = geo => geo.surfaces.flatMap(triangulate);
    expect(edgeCheck(tris(buildAir(sRadial, RT, profile, null, null)))).toEqual({ open: 0, flipped: 0 });
    expect(edgeCheck(tris(buildShell(sRadial, RT, profile, null, 10, null, 0, null)))).toEqual({ open: 0, flipped: 0 });
    const sRound = { ...createHornMath(90, { arc: 120 }).solveHorn(500, 70, RT, 0, 0), round: true };
    expect(edgeCheck(tris(buildAir(sRound, RT, null, null, null)))).toEqual({ open: 0, flipped: 0 });
    expect(edgeCheck(tris(buildShell(sRound, RT, null, null, 8, null, 0, null)))).toEqual({ open: 0, flipped: 0 });
  });
});

describe("Vertikales Profil: Klothoide zwischen Throat und Aufweitung", () => {
  const s = createHornMath(140).solveHorn(700, 132.3, RT, 182, 90);
  const flare = curve => makeProfile(s, RT, H_MOUTH, curve, 0.7);
  const slope = (g, z, d = 1e-3) => (g(z + d) - g(z - d)) / (2 * d);

  for (const curve of ["linear", "exponential", "hypex"]) {
    for (const length of [20, 60, 150]) {
      it(`${curve}, ℓ = ${length}: Lage, Richtung und Krümmung stetig an beiden Enden`, () => {
        const c = computeFilletClothoid(s, RT, H_MOUTH, curve, 0.7, length);
        expect(c).toMatchObject({ kind: "clothoid", limited: false });
        expect(c.length).toBe(length);
        const f = flare(curve), p = makeProfile(s, RT, H_MOUTH, curve, 0.7, c);
        // Throat: waagerecht in der Höhe rt
        expect(p(c.zT1 - 1)).toBe(RT);
        expect(p(c.zT1 + 1e-6) - RT).toBeLessThan(1e-6);
        expect(Math.abs(slope(p, c.zT1 + 0.02, 0.01))).toBeLessThan(2e-3);
        // Aufweitung: Anschluss in Höhe und Steigung
        expect(Math.abs(p(c.zT2 - 1e-4) - f(c.zT2))).toBeLessThan(1e-3);
        expect(Math.abs(slope(p, c.zT2 - 0.05, 0.02) - slope(f, c.zT2 + 0.05, 0.02))).toBeLessThan(2e-3);
        // Krümmung an T2: Kreis durch drei Tabellenpunkte (10 mm Abstand) gegen die Krümmung der Aufweitung
        const k = z => { const a = z - 10, b = z, e = z + 10, A = [a, p(a)], B = [b, p(b)], E = [e, p(e)]; return curvatureOf(A, B, E); };
        const kf = z => { const d = 3; return (f(z + d) - 2 * f(z) + f(z - d)) / (d * d) / Math.pow(1 + slope(f, z, 0.5) ** 2, 1.5); };
        const z = c.zT2 + 12;
        expect(Math.abs(k(z) - kf(z))).toBeLessThan(2e-4 + 0.15 * Math.abs(kf(z)));   // glatt weiter in die Aufweitung
      });
    }
  }

  it("Länge: Mittelstück, T1 liegt vor dem Knick, T2 dahinter; die Kurve ist über den ganzen Bereich ohne Sprung und steigend", () => {
    const c = computeFilletClothoid(s, RT, H_MOUTH, "exponential", 0.7, 60);
    expect(c.zT1).toBeLessThan(s.zInnerApex);
    expect(c.zT2).toBeGreaterThan(s.zInnerApex);
    const p = makeProfile(s, RT, H_MOUTH, "exponential", 0.7, c);
    let prev = p(0);
    for (let z = 1; z <= s.zApex; z += 1) { const h = p(z); expect(h).toBeGreaterThanOrEqual(prev - 1e-9); expect(h - prev).toBeLessThan(1.5); prev = h; }
    // der Knick ist weg: Steigung links und rechts von zInnerApex nahe beieinander (ohne Verrundung springt sie)
    const jump = (g, z) => Math.abs(slope(g, z + 0.5, 0.2) - slope(g, z - 0.5, 0.2));
    expect(jump(p, s.zInnerApex)).toBeLessThan(0.01);
    expect(jump(makeProfile(s, RT, H_MOUTH, "exponential", 0.7), s.zInnerApex)).toBeGreaterThan(jump(p, s.zInnerApex));
  });

  it("zu lang für den Platz: begrenzt auf die größte machbare Länge; ohne Traktrix und bei ℓ ≤ 0 null", () => {
    const c = computeFilletClothoid(s, RT, H_MOUTH, "exponential", 0.7, 5000);
    expect(c.limited).toBe(true);
    expect(c.length).toBeLessThan(5000);
    expect(c.zT1).toBeGreaterThanOrEqual(0);
    expect(computeFilletClothoid(createHornMath(140).solveHorn(700, 0, RT, 182, 90), RT, H_MOUTH, "exponential", 0.7, 60)).toBeNull();
    expect(computeFilletClothoid(s, RT, H_MOUTH, "exponential", 0.7, 0)).toBeNull();
  });

  it("zum Kreisbogen (computeFillet) verglichen: Klothoide braucht mehr Platz, ändert die Mundhöhe nicht", () => {
    const arc = computeFillet(s, RT, H_MOUTH, "exponential", 0.7, 477);
    const clo = computeFilletClothoid(s, RT, H_MOUTH, "exponential", 0.7, 150);
    const pc = makeProfile(s, RT, H_MOUTH, "exponential", 0.7, clo), pa = makeProfile(s, RT, H_MOUTH, "exponential", 0.7, arc);
    expect(pc(s.zApex)).toBeCloseTo(H_MOUTH / 2, 6);
    expect(pa(s.zApex)).toBeCloseTo(H_MOUTH / 2, 6);
  });

  it("Netze: Luft und Schale mit Klothoiden-Verrundung geschlossen und gleichsinnig, STEP-B-Rep geschlossen", () => {
    const c = computeFilletClothoid(s, RT, H_MOUTH, "exponential", 0.7, 100);
    const profile = makeProfile(s, RT, H_MOUTH, "exponential", 0.7, c);
    const tris = geo => geo.surfaces.flatMap(triangulate);
    expect(edgeCheck(tris(buildAir(s, RT, profile, c, null)))).toEqual({ open: 0, flipped: 0 });
    expect(edgeCheck(tris(buildShell(s, RT, profile, c, 10, null, 0, null)))).toEqual({ open: 0, flipped: 0 });
    const design = { s, rt: RT, profile, fillet: c, wall: 10, edgeR: 0, morph: null, flange: null };
    expect(buildBrep(hornPatches(design)).problems).toEqual([]);
  });
});

describe("Geometrie-Kern: beide Verrundungsarten in beiden Profilen", () => {
  const BASE = {
    hornShape: "radial", arcOn: false, arcRadius: 120, filletClothoidOn: false, filletClothoidLength: 60,
    throatDiam: 50.8, openingAngle: 140, L: 700, Lt: 132.3, dw: 182, dh: 90, hMouth: 200, curve: "hypex", hypexT: 0.7,
    showRaumecke: true, showWandstaerke: false, wandstaerke: 10, filletOn: false, filletR: 477, clothoidOn: false, clothoidLength: 30,
    morphOn: false, morphLength: null, mouthRoundOn: false, mouthRoundR: 20, flangeOn: false, flangeD: null, flangeT: 10, holeCount: 4,
    holeCircle: null, holeD: 6.6, holeAngle: 0, ribsOn: false, ribThickness: 4, ribLength: 30, roundOn: false, roundR: 2, edgeOn: false, edgeR: 10,
  };

  it("Vertikal: Kreisbogen (filletOn) oder Klothoide (filletClothoidOn); der Kreisbogen hat Vorrang", () => {
    const run = extra => createGeometryEngine()({ ...BASE, ...extra }).values;
    expect(run({}).fillet).toBeNull();
    expect(run({ filletOn: true }).fillet.R).toBeGreaterThan(0);
    expect(run({ filletClothoidOn: true }).fillet).toMatchObject({ kind: "clothoid", length: 60 });
    expect(run({ filletOn: true, filletClothoidOn: true }).fillet.kind).toBeUndefined();
  });

  it("Horizontal: Kreisbogen setzt Grenzen für Lₜ (Fenster), Klothoide hat Vorrang; nur Kreisbogen ohne Fenster: Lₜ = 0 und Warnung", () => {
    const run = extra => createGeometryEngine()({ ...BASE, ...extra }).values;
    const arc = run({ arcOn: true, arcRadius: 120, Lt: 5000 });
    expect(arc.s.clothoid.kind).toBe("arc");
    expect(arc.LtMax).toBeLessThan(5000);
    expect(arc.LtClamped).toBeLessThanOrEqual(arc.LtMax);
    expect(arc.warnings.ltMax).toBe(true);
    const low = run({ arcOn: true, arcRadius: 120, Lt: 1 });
    expect(low.LtClamped).toBeGreaterThanOrEqual(low.LtMinClothoid);
    expect(low.warnings.clothoid).toBe("Lt");
    expect(run({ arcOn: true, clothoidOn: true }).s.clothoid.kind).toBeUndefined();
    const none = run({ arcOn: true, arcRadius: 10, openingAngle: 60, L: 500, Lt: 60 });
    expect(none.warnings.arcNone).toBe(true);
    expect(none.LtClamped).toBe(0);
    expect(none.s).not.toBeNull();
  });

  it("Rundes Horn: Kreisbogen im Profil wirkt, vertikale Klothoide wird ignoriert", () => {
    const v = createGeometryEngine()({ ...BASE, hornShape: "round", openingAngle: 90, L: 400, Lt: 70, arcOn: true, filletClothoidOn: true }).values;
    expect(v.s.round).toBe(true);
    expect(v.s.clothoid.kind).toBe("arc");
    expect(v.fillet).toBeNull();
  });
});

describe("DXF und PDF mit den neuen Verrundungen", () => {
  const count = (dxf, type, layer) => (dxf.match(new RegExp(`0\\n${type}\\n8\\n${layer}\\n`, "g")) || []).length;

  it("DXF: Kreisbogen als ARC auf eigenem Layer (kein SPLINE), Winkel passen zur Wand", () => {
    const s = createHornMath(90, { arc: 120 }).solveHorn(700, 70, RT, 120, 100);
    const dxf = buildDXF({ s, rt: RT, hMouth: H_MOUTH, curve: "exponential", hypexT: 0.5, fillet: null }, ALL_LAYERS);
    expect(count(dxf, "ARC", "Draufsicht_Kreisbogen")).toBe(2);
    expect(count(dxf, "SPLINE", "Draufsicht_Klothoide")).toBe(0);
    const c = s.clothoid, R = 1 / c.kappa0;
    // Winkel des Bogens: von θ0 − 90° bis α − 90° (rechte Seite), der Radius steht im Eintrag
    const entry = dxf.split("0\nARC\n").find(e => e.startsWith("8\nDraufsicht_Kreisbogen"));
    expect(parseFloat(entry.match(/\n40\n([\d.]+)/)[1])).toBeCloseTo(R, 3);
    expect(parseFloat(entry.match(/\n50\n(-?[\d.]+)/)[1])).toBeCloseTo(deg(c.theta0) - 90, 3);
    expect(parseFloat(entry.match(/\n51\n(-?[\d.]+)/)[1])).toBeCloseTo(deg(s.alpha2) - 90, 3);
  });

  it("DXF: vertikale Klothoide als SPLINE auf dem Verrundungs-Layer (zwei Seiten), Kreisbogen weiter als ARC", () => {
    const s = createHornMath(140).solveHorn(700, 132.3, RT, 182, 90);
    const clo = computeFilletClothoid(s, RT, H_MOUTH, "exponential", 0.5, 80);
    const dxfClo = buildDXF({ s, rt: RT, hMouth: H_MOUTH, curve: "exponential", hypexT: 0.5, fillet: clo }, ALL_LAYERS);
    expect(count(dxfClo, "SPLINE", "Seitenprofil_Verrundung")).toBe(2);
    expect(count(dxfClo, "ARC", "Seitenprofil_Verrundung")).toBe(0);
    const arc = computeFillet(s, RT, H_MOUTH, "exponential", 0.5, 477);
    const dxfArc = buildDXF({ s, rt: RT, hMouth: H_MOUTH, curve: "exponential", hypexT: 0.5, fillet: arc }, ALL_LAYERS);
    expect(count(dxfArc, "ARC", "Seitenprofil_Verrundung")).toBe(2);
  });

  it("PDF: Kennwerte nennen Klothoide bzw. Kreisbogen mit ihren Maßen", () => {
    const s = createHornMath(140, { arc: 120 }).solveHorn(700, 140, RT, 182, 90);
    const clo = computeFilletClothoid(s, RT, H_MOUTH, "exponential", 0.5, 80);
    const design = {
      s, rt: RT, L: 700, hMouth: H_MOUTH, curve: "exponential", hypexT: 0.5, fillet: clo,
      profile: makeProfile(s, RT, H_MOUTH, "exponential", 0.5, clo), showRaumecke: true, showWandstaerke: false, wandstaerke: 10,
    };
    const html = buildDatasheet(design, { ...ALL_LAYERS, bemassung: true }, new Date(2026, 9, 1));
    expect(html).toContain("Klothoide ℓ 80.0 mm");
    expect(html).toContain("Kreisbogen r 120.0 mm");
  });
});

/** Krümmung des Kreises durch drei Punkte [x, y]. */
function curvatureOf(a, b, c) {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const area2 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return 2 * area2 / (ab * bc * ca);
}
