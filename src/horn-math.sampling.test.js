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
    const lastTrak = pts.filter(p => p.part === "traktrix").pop();
    expect(lastTrak.z).toBeCloseTo(s.zInnerApex, 6);
    expect(pts.findIndex(p => p.part !== "traktrix")).toBe(pts.indexOf(lastTrak) + 1);
  });

  it("am Mund: A = Bogenlänge × Mundhöhe", () => {
    const mouth = pts[pts.length - 1];
    expect(mouth.z).toBeCloseTo(s.zApex, 6);
    expect(mouth.A).toBeCloseTo(s.arcLen * H_MOUTH, 3);
  });

  it("Fläche ist positiv und wächst im geraden Bereich monoton", () => {
    const linear = pts.filter(p => p.part !== "traktrix");
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

describe("crossSection – Höhe entlang der Wellenfront (wie der 3D-Körper)", () => {
  const fillet = computeFillet(s, RT, H_MOUTH, "exponential", 0.5, 300);
  const prof = makeProfile(s, RT, H_MOUTH, "exponential", 0.5, fillet);
  const pts = crossSection(s, prof, 400);
  const trak = pts.slice(1).filter(p => p.part === "traktrix");

  /** Unabhängige Referenz: Wellenfront zum Achspunkt z über die Traktrix-Eigenschaft rekonstruieren
   *  (Mittelpunkt z − r0, Radius r0) und die Höhe über 20 000 Bogenpunkte aufsummieren. */
  function referenceArea(z) {
    const zc = z - s.r0;
    // Halbwinkel: Bogen trifft die Traktrix-Wand – dort steht die Tangente senkrecht auf dem Radius
    const wall = traktrixPoints(s, 20000);
    let best = null;
    for (const [x, zw] of wall) {
      const d = Math.abs(Math.hypot(x, zw - zc) - s.r0);
      if (!best || d < best.d) best = { d, psi: Math.atan2(x, zw - zc) };
    }
    const n = 20000, step = best.psi / n;
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const psi = (k + 0.5) * step;
      const x = s.r0 * Math.sin(psi), zq = zc + s.r0 * Math.cos(psi);
      sum += 2 * prof(s.zFocus + Math.hypot(x, zq - s.zFocus)) * s.r0 * step;
    }
    return 2 * sum;
  }

  it("ohne Verrundung: Traktrix-Fläche = Bogenlänge × 2·rt (eben)", () => {
    const flatProfile = makeProfile(s, RT, H_MOUTH, "exponential", 0.5);
    const flat = crossSection(s, flatProfile, 50).slice(1).filter(p => p.part === "traktrix");
    for (const p of flat) expect(p.A / (2 * RT) / (2 * s.r0)).toBeLessThanOrEqual(s.alpha2 + 1e-9);
    expect(flat[flat.length - 1].A).toBeCloseTo(2 * s.alpha2 * s.r0 * 2 * RT, 6);   // am Übergang θ = α
  });

  it("mit Verrundung: stimmt mit unabhängiger Integration über die Bogenpunkte überein", () => {
    for (const p of trak.filter((_, i) => i % 40 === 0).concat(trak[trak.length - 1])) {
      expect(p.A / referenceArea(p.z)).toBeCloseTo(1, 4);
    }
  });

  it("im Verrundungsband größer als die alte Näherung Breite × Höhe auf der Achse", () => {
    // Bogenpunkte abseits der Achse liegen weiter vom Fokus entfernt → höher im ansteigenden Band
    // ohne den Übergangspunkt selbst: dort liegt der Bogen um den Fokus, h ist konstant
    const band = trak.filter(p => p.z > fillet.zT1 + 2 && p.z < s.zInnerApex - 0.5);
    expect(band.length).toBeGreaterThan(0);
    for (const p of band) {
      const flatProfile = makeProfile(s, RT, H_MOUTH, "exponential", 0.5);
      const width = crossSection(s, flatProfile, 400).find(q => q.z === p.z).A / (2 * RT);
      expect(p.A).toBeGreaterThan(width * 2 * prof(p.z));
    }
  });

  it("am Übergang stetig, mit dem erklärten Knick in der Steigung", () => {
    const i = pts.findIndex(p => p.part !== "traktrix");
    const [a, b, c] = [pts[i - 2], pts[i - 1], pts[i + 1]];
    expect(Math.abs(pts[i].A - b.A) / b.A).toBeLessThan(0.02);    // kein Sprung
    const left = (b.A - a.A) / (b.z - a.z), right = (c.A - b.A) / (c.z - b.z);
    // ohne Höhenänderung wäre das Verhältnis 2·sin α / 2·α; hier steigt h zusätzlich leicht
    expect(right / left).toBeGreaterThan(1.1);
  });
});
