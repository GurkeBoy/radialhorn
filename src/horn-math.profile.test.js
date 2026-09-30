/**
 * Tests für das vertikale Profil (Seitenriss) und die Verrundung des
 * Übergangs Throat → Aufweitung.
 *
 * Geprüft wird die Geometrie der Verrundung unabhängig von ihrer Herleitung:
 * Tangentenpunkte liegen auf dem Kreis, die Tangenten stimmen überein (C¹),
 * und der Bogen liegt außerhalb der Wand (Querschnitt wird größer, nie kleiner).
 */
import { describe, it, expect } from "vitest";
import { solveHorn, verticalHalfHeight, computeFillet } from "./horn-math.js";

// ─── Standardparameter (wie horn-math.test.js) ────────────────────
const RT = 25.4, DW = 120, DH = 100, L = 500, LT = 60;
const H_MOUTH = 200, HYPEX_T = 0.5;
const CURVES = ["linear", "exponential", "hypex"];

const s = solveHorn(L, LT, RT, DW, DH);
const h  = (z, curve, fillet = null) => verticalHalfHeight(z, s, RT, H_MOUTH, curve, HYPEX_T, fillet);
const fl = (curve, R) => computeFillet(s, RT, H_MOUTH, curve, HYPEX_T, R);

// Einseitige numerische Ableitung von h an der Stelle z (links: dir = -1, rechts: +1)
const slope = (z, curve, fillet, dir, d = 1e-4) =>
  dir > 0 ? (h(z + d, curve, fillet) - h(z, curve, fillet)) / d
          : (h(z, curve, fillet) - h(z - d, curve, fillet)) / d;

// ──────────────────────────────────────────────────────────────────
// 1. PROFIL OHNE VERRUNDUNG
// ──────────────────────────────────────────────────────────────────
describe("verticalHalfHeight – Profil ohne Verrundung", () => {
  it.each(CURVES)("%s: Throat-Höhe bis zInnerApex, Mund-Höhe ab zApex", curve => {
    expect(h(0, curve)).toBe(RT);
    expect(h(s.zInnerApex, curve)).toBe(RT);
    expect(h(s.zApex, curve)).toBeCloseTo(H_MOUTH / 2, 9);
    expect(h(s.zApex + 50, curve)).toBe(H_MOUTH / 2);
  });

  it.each(CURVES)("%s: streng monoton steigend zwischen Throat und Mund", curve => {
    let prev = h(s.zInnerApex, curve);
    for (let i = 1; i <= 100; i++) {
      const z = s.zInnerApex + (s.zApex - s.zInnerApex) * i / 100;
      const cur = h(z, curve);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });

  it("exponential: in der Mitte das geometrische Mittel von Throat und Mund", () => {
    const zMid = (s.zInnerApex + s.zApex) / 2;
    expect(h(zMid, "exponential")).toBeCloseTo(Math.sqrt(RT * H_MOUTH / 2), 9);
  });

  it.each(CURVES)("%s: ohne Verrundung Knick am Übergang (Steigung links 0, rechts > 0)", curve => {
    expect(slope(s.zInnerApex, curve, null, -1)).toBeCloseTo(0, 9);
    expect(slope(s.zInnerApex, curve, null, +1)).toBeGreaterThan(0.01);
  });
});

// ──────────────────────────────────────────────────────────────────
// 2. VERRUNDUNG – GEOMETRIE
// ──────────────────────────────────────────────────────────────────
describe.each(CURVES)("computeFillet – Geometrie (%s, R = 100)", curve => {
  const f = fl(curve, 100);

  it("wird berechnet und ist nicht begrenzt", () => {
    expect(f).not.toBeNull();
    expect(f.limited).toBe(false);
    expect(f.R).toBe(100);
  });

  it("Tangentenpunkte umschließen den Übergang: 0 ≤ zT1 < zInnerApex < zT2 ≤ zApex", () => {
    expect(f.zT1).toBeGreaterThanOrEqual(0);
    expect(f.zT1).toBeLessThan(s.zInnerApex);
    expect(f.zT2).toBeGreaterThan(s.zInnerApex);
    expect(f.zT2).toBeLessThanOrEqual(s.zApex);
  });

  it("Mittelpunkt liegt senkrecht über T1 im Abstand R (tangential an den Throat)", () => {
    expect(f.zc).toBe(f.zT1);
    expect(f.hc).toBeCloseTo(RT + 100, 9);
  });

  it("T2 liegt auf der Aufweitungskurve und auf dem Kreis", () => {
    expect(f.hT2).toBeCloseTo(h(f.zT2, curve), 9);
    expect(Math.hypot(f.zT2 - f.zc, f.hT2 - f.hc)).toBeCloseTo(100, 4);
  });

  it("Kreistangente in T2 = Steigung der Aufweitungskurve (tangential)", () => {
    // Steigung des unteren Kreisbogens in T2: (z2 − zc) / (hc − h2)
    const circleSlope = (f.zT2 - f.zc) / (f.hc - f.hT2);
    const curveSlope  = slope(f.zT2, curve, null, +1, 1e-6);
    expect(circleSlope).toBeCloseTo(curveSlope, 4);
  });
});

// ──────────────────────────────────────────────────────────────────
// 3. VERRUNDETES PROFIL – STETIGKEIT UND LAGE
// ──────────────────────────────────────────────────────────────────
describe.each(CURVES)("verticalHalfHeight mit Verrundung (%s, R = 100)", curve => {
  const f = fl(curve, 100);

  it("stetig an T1 und T2 (kein Sprung)", () => {
    for (const z of [f.zT1, f.zT2]) {
      expect(h(z - 1e-7, curve, f)).toBeCloseTo(h(z + 1e-7, curve, f), 5);
    }
  });

  it("stetig differenzierbar an T1 und T2 (kein Knick)", () => {
    for (const z of [f.zT1, f.zT2]) {
      expect(slope(z, curve, f, -1, 1e-5)).toBeCloseTo(slope(z, curve, f, +1, 1e-5), 3);
    }
  });

  it("kein Knick mehr am ursprünglichen Übergang zInnerApex", () => {
    expect(slope(s.zInnerApex, curve, f, -1)).toBeCloseTo(slope(s.zInnerApex, curve, f, +1), 3);
  });

  it("Bogen liegt außerhalb der Wand: h mit Verrundung ≥ h ohne (Querschnitt wird größer)", () => {
    for (let i = 1; i < 50; i++) {
      const z = f.zT1 + (f.zT2 - f.zT1) * i / 50;
      expect(h(z, curve, f)).toBeGreaterThanOrEqual(h(z, curve) - 1e-9);
    }
    expect(h(s.zInnerApex, curve, f)).toBeGreaterThan(RT);
  });

  it("außerhalb von [zT1, zT2] unverändert", () => {
    for (const z of [0, f.zT1 - 1, f.zT2 + 1, s.zApex]) {
      expect(h(z, curve, f)).toBe(h(z, curve));
    }
  });
});

// ──────────────────────────────────────────────────────────────────
// 4. RADIUS: GRÖSSE, BEGRENZUNG, SONDERFÄLLE
// ──────────────────────────────────────────────────────────────────
describe("computeFillet – Radius", () => {
  it("größerer Radius → längerer Bogen (T1 früher, T2 später)", () => {
    const a = fl("exponential", 50), b = fl("exponential", 200);
    expect(b.zT1).toBeLessThan(a.zT1);
    expect(b.zT2).toBeGreaterThan(a.zT2);
  });

  it("zu großer Radius wird auf den größten machbaren begrenzt", () => {
    const f = fl("exponential", 5000);
    expect(f).not.toBeNull();
    expect(f.limited).toBe(true);
    expect(f.R).toBeLessThan(5000);
    // begrenzter Bogen ist gültig …
    expect(f.zT1).toBeGreaterThanOrEqual(0);
    expect(f.zT2).toBeLessThanOrEqual(s.zApex);
    // … und praktisch maximal: 1 % mehr geht nicht mehr unbegrenzt
    expect(fl("exponential", f.R * 1.01).limited).toBe(true);
    // ein Radius knapp darunter wird unverändert übernommen
    const below = fl("exponential", f.R * 0.99);
    expect(below.limited).toBe(false);
  });

  it("keine Verrundung ohne Traktrix-Eingang (Lt = 0)", () => {
    const s0 = solveHorn(L, 0, RT, DW, DH);
    expect(computeFillet(s0, RT, H_MOUTH, "exponential", HYPEX_T, 100)).toBeNull();
  });

  it("keine Verrundung bei Radius ≤ 0 oder ungültiger Geometrie", () => {
    expect(fl("exponential", 0)).toBeNull();
    expect(fl("exponential", -10)).toBeNull();
    expect(computeFillet(null, RT, H_MOUTH, "exponential", HYPEX_T, 100)).toBeNull();
  });
});
