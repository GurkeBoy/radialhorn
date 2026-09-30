/**
 * Geometrie bei anderen Öffnungswinkeln als dem Standard (140°).
 *
 * horn-math.test.js prüft die Invarianten bei 140°; hier laufen sie für 90°, 120° und
 * 160° über createHornMath. Dazu: die Funktionen verschiedener Winkel beeinflussen sich
 * nicht gegenseitig (kein globaler Zustand).
 */
import { describe, it, expect } from "vitest";
import {
  createHornMath, ALPHA2, PHI_TOTAL, solveHorn, zN, xN, computeFillet, hasTraktrix,
} from "./horn-math.js";

const RT = 25.4, DW = 120, DH = 100, L = 500, LT = 60;
const rad = deg => deg * Math.PI / 180;

describe("createHornMath", () => {
  it("Standard-Exporte gelten für 140°", () => {
    expect(ALPHA2).toBeCloseTo(rad(70), 12);
    expect(PHI_TOTAL).toBeCloseTo(rad(140), 12);
    expect(solveHorn(L, LT, RT, DW, DH).openingAngle).toBe(140);
  });

  it("Instanzen verschiedener Winkel sind unabhängig voneinander", () => {
    const a = createHornMath(100), b = createHornMath(160);
    const sa = a.solveHorn(L, LT, RT, DW, DH);
    const sb = b.solveHorn(L, LT, RT, DW, DH);
    expect(sa.arcLen / sa.arcR).toBeCloseTo(rad(100), 10);
    expect(sb.arcLen / sb.arcR).toBeCloseTo(rad(160), 10);
    // erneute Rechnung mit a nach Benutzung von b: unverändert
    expect(a.solveHorn(L, LT, RT, DW, DH)).toEqual(sa);
    expect(solveHorn(L, LT, RT, DW, DH).openingAngle).toBe(140);
  });

  it("die Lösung trägt ihren Winkel mit", () => {
    const s = createHornMath(120).solveHorn(L, LT, RT, DW, DH);
    expect(s.openingAngle).toBe(120);
    expect(s.alpha2).toBeCloseTo(rad(60), 12);
    expect(Math.tan(s.alpha2)).toBeCloseTo(1 / Math.sinh(s.tTrans), 10);
  });
});

describe.each([90, 120, 160])("Geometrie bei %i°", deg => {
  const math = createHornMath(deg);
  const s = math.solveHorn(L, LT, RT, DW, DH);

  it("Winkelgrößen: ALPHA2 = Winkel/2, Traktrix-Übergang tangential", () => {
    expect(math.ALPHA2).toBeCloseTo(rad(deg / 2), 12);
    // Steigung der Traktrix dx/dz = 1/sinh(t) muss am Übergang der Wand entsprechen
    expect(Math.tan(math.ALPHA2)).toBeCloseTo(1 / Math.sinh(math.T_TRANS), 10);
  });

  it("löst mit den Standardparametern", () => {
    expect(s).not.toBeNull();
  });

  it("Throat und Traktrix-Übergang", () => {
    expect(s.r0 * xN(s.tTh)).toBeCloseTo(RT, 6);
    expect(s.r0 * xN(math.T_TRANS)).toBeCloseTo(s.xTrans, 6);
    expect(s.r0 * (zN(s.tTh) - zN(math.T_TRANS))).toBeCloseTo(LT, 6);
  });

  it("gerade Wand zeigt auf den Fokus und endet am Mund", () => {
    expect(s.xTrans / (s.zTrans - s.zFocus)).toBeCloseTo(Math.tan(math.ALPHA2), 8);
    expect(s.xMouth).toBeCloseTo(s.xTrans + s.Ls * Math.tan(math.ALPHA2), 6);
    expect(s.zMouth).toBeCloseTo(s.zTrans + s.Ls, 6);
  });

  it("Mund und Übergang liegen auf Teilkreisen um den Fokus", () => {
    expect(Math.hypot(s.zMouth - s.zFocus, s.xMouth)).toBeCloseTo(s.arcR, 6);
    expect(Math.hypot(s.zTrans - s.zFocus, s.xTrans)).toBeCloseTo(s.rInner, 6);
    expect(s.zApex).toBeCloseTo(s.zFocus + s.arcR, 6);
    expect(s.zInnerApex).toBeCloseTo(s.zFocus + s.rInner, 6);
  });

  it("Gesamtlänge L = Hut-Spitze → Teilkreis-Scheitel", () => {
    expect(s.hatTipZ).toBeCloseTo(-DH - DW / 2, 10);
    expect(s.zApex - s.hatTipZ).toBeCloseTo(L, 6);
  });

  it("Bogenlänge = arcR · Öffnungswinkel", () => {
    expect(s.arcLen).toBeCloseTo(s.arcR * rad(deg), 6);
  });

  it("minL / maxLt: Grenzen sind lösbar, dahinter nicht", () => {
    expect(math.solveHorn(math.minL(LT, RT, DW, DH), LT, RT, DW, DH)).not.toBeNull();
    const ltMax = math.maxLt(L, RT, DW, DH);
    expect(math.solveHorn(L, ltMax * 0.99, RT, DW, DH)).not.toBeNull();
    expect(math.solveHorn(L, ltMax * 1.01, RT, DW, DH)).toBeNull();
  });

  it("maxLforRaumecke: an der Grenze sitzt die Mundkante auf der 45°-Raumecke", () => {
    const lMax = math.maxLforRaumecke(LT, RT, DW, DH);
    if (deg <= 90) {
      expect(lMax).toBeNull();   // Wand läuft nie aus der Raumecke
      return;
    }
    const sm = math.solveHorn(lMax, LT, RT, DW, DH);
    // Raumecke: 45°-Linie ab Treiberecke (dw/2, −dh) → x = dw/2 + (z + dh)
    expect(sm.xMouth).toBeCloseTo(DW / 2 + sm.zMouth + DH, 3);
  });

  it("minLtForRaumecke und maxLforRaumecke sind zueinander konsistent", () => {
    const lMax = math.maxLforRaumecke(LT, RT, DW, DH);
    if (lMax === null) return;
    const ltMin = math.minLtForRaumecke(lMax, RT, DW, DH);
    expect(ltMin).not.toBeNull();
    expect(ltMin).toBeLessThanOrEqual(LT + 1e-3);
  });

  it("Verrundung funktioniert auch bei diesem Winkel", () => {
    expect(hasTraktrix(s)).toBe(true);
    const f = computeFillet(s, RT, 200, "exponential", 0.5, 100);
    expect(f.zT1).toBeLessThan(s.zInnerApex);
    expect(f.zT2).toBeGreaterThan(s.zInnerApex);
  });
});

describe("Winkelabhängigkeit", () => {
  it("größerer Öffnungswinkel → breiterer Mund bei gleicher Länge", () => {
    const widths = [90, 120, 140, 160].map(deg => createHornMath(deg).solveHorn(L, LT, RT, DW, DH).xMouth);
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1]);
  });
});
