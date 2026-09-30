/**
 * Abtastung der Draufsicht, Querschnitt A(z) und abgeleitete Kennwerte.
 */
import { describe, it, expect } from "vitest";
import {
  solveHorn, traktrixPoints, linearWallPoints, makeProfile, computeFillet,
  crossSection, verticalMouthAngle, verticalHalfHeight,
} from "./horn-math.js";

const RT = 25.4, DW = 120, DH = 100, L = 500, LT = 60, H_MOUTH = 200;
const s  = solveHorn(L, LT, RT, DW, DH);
const s0 = solveHorn(L, 0, RT, DW, DH);   // ohne Traktrix

describe("traktrixPoints", () => {
  const pts = traktrixPoints(s, 50);

  it("n+1 Punkte vom Throat bis zum Übergang", () => {
    expect(pts).toHaveLength(51);
    expect(pts[0][0]).toBeCloseTo(RT, 9);
    expect(pts[0][1]).toBeCloseTo(0, 12);
    expect(pts[50][0]).toBeCloseTo(s.xTrans, 9);
    expect(pts[50][1]).toBeCloseTo(s.zTrans, 9);
  });

  it("Breite wächst, Position schreitet voran", () => {
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i][0]).toBeGreaterThan(pts[i - 1][0]);
      expect(pts[i][1]).toBeGreaterThan(pts[i - 1][1]);
    }
  });

  it("leer ohne Traktrix", () => {
    expect(traktrixPoints(s0, 50)).toEqual([]);
  });
});

describe("linearWallPoints", () => {
  const pts = linearWallPoints(s, 20);

  it("vom Übergang bis zum Mund", () => {
    expect(pts[0]).toEqual([s.xTrans, s.zTrans]);
    expect(pts[20][0]).toBeCloseTo(s.xMouth, 9);
    expect(pts[20][1]).toBeCloseTo(s.zMouth, 9);
  });

  it("alle Punkte liegen auf dem Strahl vom Fokus unter dem halben Öffnungswinkel", () => {
    for (const [x, z] of pts) expect(x / (z - s.zFocus)).toBeCloseTo(Math.tan(s.alpha2), 9);
  });
});

describe("crossSection", () => {
  const profile = makeProfile(s, RT, H_MOUTH, "exponential", 0.5);
  const pts = crossSection(s, profile);

  it("beginnt bei z = 0 und ist aufsteigend in z", () => {
    expect(pts[0].z).toBe(0);
    for (let i = 1; i < pts.length; i++) expect(pts[i].z).toBeGreaterThanOrEqual(pts[i - 1].z);
  });

  it("Sektionswechsel exakt am Traktrix-Ende (zInnerApex)", () => {
    const lastTrak = pts.filter(p => p.traktrix).pop();
    expect(lastTrak.z).toBeCloseTo(s.zInnerApex, 6);
    expect(pts.findIndex(p => !p.traktrix)).toBe(pts.indexOf(lastTrak) + 1);
  });

  it("am Mund: A = Bogenlänge × Mundhöhe", () => {
    const mouth = pts[pts.length - 1];
    expect(mouth.z).toBeCloseTo(s.zApex, 6);
    expect(mouth.A).toBeCloseTo(s.arcLen * H_MOUTH, 3);
  });

  it("Fläche ist positiv und wächst im geraden Bereich monoton", () => {
    const linear = pts.filter(p => !p.traktrix);
    for (const p of pts) expect(p.A).toBeGreaterThan(0);
    for (let i = 1; i < linear.length; i++) expect(linear[i].A).toBeGreaterThan(linear[i - 1].A);
  });

  it("Verrundung vergrößert den Querschnitt, verkleinert ihn nie", () => {
    const fillet = computeFillet(s, RT, H_MOUTH, "exponential", 0.5, 100);
    const withFillet = crossSection(s, makeProfile(s, RT, H_MOUTH, "exponential", 0.5, fillet));
    withFillet.forEach((p, i) => expect(p.A).toBeGreaterThanOrEqual(pts[i].A - 1e-9));
    expect(withFillet.some((p, i) => p.A > pts[i].A + 1)).toBe(true);
  });
});

describe("verticalMouthAngle", () => {
  it("lineare Aufweitung: 2·atan(Steigung)", () => {
    const profile = makeProfile(s, RT, H_MOUTH, "linear", 0.5);
    const slope = (H_MOUTH / 2 - RT) / (s.zApex - s.zInnerApex);
    expect(verticalMouthAngle(s, profile)).toBeCloseTo(2 * Math.atan(slope) * 180 / Math.PI, 6);
  });

  it("exponentiell öffnet am Mund weiter als linear", () => {
    const lin = verticalMouthAngle(s, makeProfile(s, RT, H_MOUTH, "linear", 0.5));
    const exp = verticalMouthAngle(s, makeProfile(s, RT, H_MOUTH, "exponential", 0.5));
    expect(exp).toBeGreaterThan(lin);
  });
});

describe("Hypex-Cache", () => {
  it("liefert nach Wechsel des Parameters T wieder den richtigen Wert", () => {
    const z = (s.zInnerApex + s.zApex) / 2;
    const a = verticalHalfHeight(z, s, RT, H_MOUTH, "hypex", 0.5);
    const b = verticalHalfHeight(z, s, RT, H_MOUTH, "hypex", 1.5);
    expect(b).not.toBeCloseTo(a, 3);
    expect(verticalHalfHeight(z, s, RT, H_MOUTH, "hypex", 0.5)).toBe(a);
  });

  it("erreicht an beiden Enden Throat- und Mundhöhe", () => {
    for (const T of [0, 0.5, 1, 2]) {
      expect(verticalHalfHeight(s.zInnerApex + 1e-9, s, RT, H_MOUTH, "hypex", T)).toBeCloseTo(RT, 5);
      expect(verticalHalfHeight(s.zApex - 1e-9, s, RT, H_MOUTH, "hypex", T)).toBeCloseTo(H_MOUTH / 2, 5);
    }
  });
});
