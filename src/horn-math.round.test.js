/**
 * Rundes Horn (Rotationskörper): das Draufsicht-Profil um die Achse gedreht. Die Wellenfront ist eine Kugelkappe
 * (capArea), die Querschnittsfläche kommt ohne Höhenprofil aus, Mundfläche und Kennwerte folgen.
 */
import { describe, it, expect } from "vitest";
import { createHornMath, makeProfile, crossSection, crossSectionRound, capArea, mouthArea, frequencyEstimates } from "./horn-math.js";
import { areaCurve } from "./simulation.js";

const RT = 25.4;
const solve = (Lt, clothoid = 0, angle = 70) => ({ ...createHornMath(angle, { clothoid }).solveHorn(500, Lt, RT, 0, 0), round: true });
const profileOf = s => makeProfile(s, RT, 200, "exponential", 0.5);

describe("capArea", () => {
  it("Halbkugel 2π·R²; sehr flache Kappe auf großer Kugel = Kreisscheibe π·x²; θ = 0: keine Fläche", () => {
    expect(capArea(100, Math.PI / 2)).toBeCloseTo(2 * Math.PI * 1e4, 6);
    expect(capArea(1e6, 100 / 1e6)).toBeCloseTo(Math.PI * 100 ** 2, 2);       // Grundkreis Radius 100 auf einer riesigen Kugel
    expect(capArea(50, 0)).toBe(0);
  });

  it("entspricht 2π·R²·(1 − cos θ)", () => {
    for (const [R, th] of [[10, 0.3], [200, 1.1], [1e5, 0.01]]) {
      expect(capArea(R, th) / (2 * Math.PI * R * R * (1 - Math.cos(th)))).toBeCloseTo(1, 6);
    }
  });
});

describe("Querschnitt des runden Horns", () => {
  it("crossSection leitet bei s.round an crossSectionRound weiter, ohne Profil und ohne Ecken", () => {
    const s = solve(60);
    expect(crossSection(s, undefined, 40)).toEqual(crossSectionRound(s, 40));
    expect(crossSectionRound(s, 40).every(p => p.cornerR === 0)).toBe(true);
  });

  it("gerader Bereich ohne Traktrix: Fläche = Kugelkappe 2π·R²(1 − cos α) um den Fokus", () => {
    const s = solve(0);
    for (const p of crossSectionRound(s, 30).slice(1)) {
      const R = p.z - s.zFocus;
      expect(p.A).toBeCloseTo(2 * Math.PI * R * R * (1 - Math.cos(s.alpha2)), 4);
    }
  });

  it("wächst monoton und endet in der Mundfläche (Kappe des Mundbogens)", () => {
    for (const s of [solve(60), solve(60, 30), solve(0), solve(200, 0, 40)]) {
      const pts = crossSectionRound(s, 80);
      for (let i = 1; i < pts.length; i++) expect(pts[i].A).toBeGreaterThanOrEqual(pts[i - 1].A - 1e-9);
      expect(pts.at(-1).A).toBeCloseTo(mouthArea(s, 0), 3);
    }
  });

  it("am Throat ist die Fläche die Kreisscheibe π·rt² (Flächenkurve der Simulation); Radial hat das Rechteck", () => {
    const s = solve(60);
    expect(areaCurve(s, RT, profileOf(s)).S[0]).toBeCloseTo(Math.PI * RT * RT * 1e-6, 12);
    expect(areaCurve({ ...s, round: false }, RT, profileOf(s)).S[0]).toBeCloseTo(4 * RT * RT * 1e-6, 12);
  });

  it("Flächenkurve der Simulation endet in der Mundfläche", () => {
    const s = solve(60), curve = areaCurve(s, RT, profileOf(s));
    expect(curve.S.at(-1) * 1e6).toBeCloseTo(mouthArea(s, 0), 3);
  });
});

describe("Kennwerte des runden Horns", () => {
  it("Mundfläche ist die Kugelkappe; fcLow aus dem flächengleichen Kreis, Throat als Kreis", () => {
    const s = solve(60);
    expect(mouthArea(s, 999)).toBeCloseTo(capArea(s.arcR, s.alpha2), 6);                 // Mundhöhe spielt keine Rolle
    const f = frequencyEstimates(s, RT, 999);
    expect(f.fcLow).toBeCloseTo(343000 / (2 * Math.PI * Math.sqrt(mouthArea(s, 0) / Math.PI)), 6);
    const m = Math.log(mouthArea(s, 0) / (Math.PI * RT * RT)) / (s.zApex - s.hatTipZ);
    expect(f.fcCut).toBeCloseTo(343000 * m / (4 * Math.PI), 6);
  });
});
