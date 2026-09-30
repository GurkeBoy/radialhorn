/**
 * Tests für einstellbare Öffnungswinkel.
 *
 * horn-math.test.js prüft die Geometrie beim Standardwinkel 140°. Hier laufen
 * dieselben Invarianten für andere Winkel, dazu der Mechanismus, auf den sich
 * App.jsx verlässt: setOpeningAngle ändert die exportierten Winkelgrößen als
 * ES-Modul-"live bindings".
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ALPHA2, T_TRANS, PHI_TOTAL, setOpeningAngle,
  zN, xN, solveHorn, minL, maxLt, maxLforRaumecke, minLtForRaumecke,
  computeFillet,
} from "./horn-math.js";

const RT = 25.4, DW = 120, DH = 100, L = 500, LT = 60;
const rad = deg => deg * Math.PI / 180;

// ──────────────────────────────────────────────────────────────────
// 1. MECHANISMUS: setOpeningAngle + live bindings
// ──────────────────────────────────────────────────────────────────
describe("setOpeningAngle", () => {
  afterAll(() => setOpeningAngle(140));

  it("Standard ist 140°", () => {
    expect(ALPHA2).toBeCloseTo(rad(70), 12);
    expect(PHI_TOTAL).toBeCloseTo(rad(140), 12);
  });

  it("importierte Winkelgrößen folgen der Änderung (live binding)", () => {
    setOpeningAngle(120);
    expect(ALPHA2).toBeCloseTo(rad(60), 12);
    expect(PHI_TOTAL).toBeCloseTo(rad(120), 12);
    expect(Math.tan(ALPHA2)).toBeCloseTo(1 / Math.sinh(T_TRANS), 10);
    setOpeningAngle(140);
    expect(ALPHA2).toBeCloseTo(rad(70), 12);
  });

  it("solveHorn rechnet mit dem aktuell gesetzten Winkel", () => {
    setOpeningAngle(100);
    const a = solveHorn(L, LT, RT, DW, DH);
    setOpeningAngle(160);
    const b = solveHorn(L, LT, RT, DW, DH);
    expect(a.arcLen / a.arcR).toBeCloseTo(rad(100), 10);
    expect(b.arcLen / b.arcR).toBeCloseTo(rad(160), 10);
  });
});

// ──────────────────────────────────────────────────────────────────
// 2. GEOMETRIE-INVARIANTEN FÜR VERSCHIEDENE WINKEL
// ──────────────────────────────────────────────────────────────────
describe.each([90, 120, 160])("Geometrie bei %i°", deg => {
  let s;
  beforeAll(() => { setOpeningAngle(deg); s = solveHorn(L, LT, RT, DW, DH); });
  afterAll(() => setOpeningAngle(140));

  it("Winkelgrößen: ALPHA2 = Winkel/2, Traktrix-Übergang tangential", () => {
    expect(ALPHA2).toBeCloseTo(rad(deg / 2), 12);
    // Steigung der Traktrix dx/dz = 1/sinh(t) muss am Übergang der Wand entsprechen
    expect(Math.tan(ALPHA2)).toBeCloseTo(1 / Math.sinh(T_TRANS), 10);
  });

  it("löst mit den Standardparametern", () => {
    expect(s).not.toBeNull();
  });

  it("Throat und Traktrix-Übergang", () => {
    expect(s.r0 * xN(s.tTh)).toBeCloseTo(RT, 6);
    expect(s.r0 * xN(T_TRANS)).toBeCloseTo(s.xTrans, 6);
    expect(s.r0 * (zN(s.tTh) - zN(T_TRANS))).toBeCloseTo(LT, 6);
  });

  it("lineare Wand zeigt auf den Fokus und endet am Mund", () => {
    expect(s.xTrans / (s.zTrans - s.zFocus)).toBeCloseTo(Math.tan(ALPHA2), 8);
    expect(s.xMouth).toBeCloseTo(s.xTrans + s.Ls * Math.tan(ALPHA2), 6);
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
    expect(solveHorn(minL(LT, RT, DW, DH), LT, RT, DW, DH)).not.toBeNull();
    const ltMax = maxLt(L, RT, DW, DH);
    expect(solveHorn(L, ltMax * 0.99, RT, DW, DH)).not.toBeNull();
    expect(solveHorn(L, ltMax * 1.01, RT, DW, DH)).toBeNull();
  });

  it("maxLforRaumecke: an der Grenze sitzt die Mundkante auf der 45°-Raumecke", () => {
    const lMax = maxLforRaumecke(LT, RT, DW, DH);
    if (lMax === null) return;   // Winkel ≤ 90°: Wand läuft nie aus der Raumecke
    const sm = solveHorn(lMax, LT, RT, DW, DH);
    // Raumecke: 45°-Linie ab Treiberecke (dw/2, −dh) → x = dw/2 + (z + dh)
    expect(sm.xMouth).toBeCloseTo(DW / 2 + sm.zMouth + DH, 3);
  });

  it("minLtForRaumecke und maxLforRaumecke sind zueinander konsistent", () => {
    const lMax = maxLforRaumecke(LT, RT, DW, DH);
    if (lMax === null) return;
    const ltMin = minLtForRaumecke(lMax, RT, DW, DH);
    expect(ltMin).not.toBeNull();
    expect(ltMin).toBeLessThanOrEqual(LT + 1e-3);
  });

  it("Verrundung funktioniert auch bei diesem Winkel", () => {
    const f = computeFillet(s, RT, 200, "exponential", 0.5, 100);
    expect(f).not.toBeNull();
    expect(f.zT1).toBeLessThan(s.zInnerApex);
    expect(f.zT2).toBeGreaterThan(s.zInnerApex);
  });
});

// ──────────────────────────────────────────────────────────────────
// 3. PLAUSIBILITÄT ÜBER DEN WINKEL
// ──────────────────────────────────────────────────────────────────
describe("Winkelabhängigkeit", () => {
  afterAll(() => setOpeningAngle(140));

  it("größerer Öffnungswinkel → breiterer Mund bei gleicher Länge", () => {
    const widths = [90, 120, 140, 160].map(deg => {
      setOpeningAngle(deg);
      return solveHorn(L, LT, RT, DW, DH).xMouth;
    });
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1]);
  });
});
