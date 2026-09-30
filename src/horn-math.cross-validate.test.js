/**
 * Querverifikation der Horngeometrie anhand unabhängiger
 * analytischer Formeln und bekannter Referenzwerte.
 *
 * Methodik:
 *  1. Analytische Eigenschaften der Traktrix (beweisbar aus der Definition)
 *  2. Grenzfall konisches Horn (Lt=0): bekannte geschlossene Formel
 *  3. Numerische Integration als unabhängiger Solver
 *  4. Akustische Näherungsformeln (Olson/Beranek) als Plausibilitätscheck
 */

import { describe, it, expect } from "vitest";
import {
  ALPHA2, T_TRANS, SPEED_OF_SOUND, zN, xN,
  solveHorn, frequencyEstimates, mouthArea,
} from "./horn-math.js";

const RT  = 25.4;   // 1" Throat-Radius
const DW  = 120;
const DH  = 100;
const C   = SPEED_OF_SOUND;

// ──────────────────────────────────────────────────────────────────
// 1. DEFINIERENDE EIGENSCHAFT DER TRAKTRIX
//    Analytisch beweisbar, unabhängig vom Code.
// ──────────────────────────────────────────────────────────────────
describe("Traktrix – definierende Eigenschaft (Tangentensegment = r₀)", () => {
  /**
   * Die Traktrix ist die Kurve, bei der das Segment entlang der
   * Tangente von einem Kurvenpunkt bis zur Asymptote (x=0) konstant
   * die Länge r0 hat.
   *
   * Beweis für die normierte Form:
   *   Punkt P(t) = (zN(t), xN(t))
   *   Tangentenfuß auf x=0: z_foot = t  (analytisch ableitbar)
   *   Segmentlänge = sqrt(tanh²(t) + xN(t)²) = sqrt((sinh²+1)/cosh²) = 1
   *   → für r0-skalierte Kurve: Segmentlänge = r0  ∎
   */
  const s = solveHorn(500, 60, RT, DW, DH);

  it("Segmentlänge bei tTh (Throat) = r0", () => {
    const t = s.tTh;
    const segLen = s.r0 * Math.sqrt(Math.tanh(t) ** 2 + xN(t) ** 2);
    expect(segLen).toBeCloseTo(s.r0, 5);
  });

  it("Segmentlänge bei T_TRANS (Übergang) = r0", () => {
    const segLen = s.r0 * Math.sqrt(Math.tanh(T_TRANS) ** 2 + xN(T_TRANS) ** 2);
    expect(segLen).toBeCloseTo(s.r0, 5);
  });

  it("Segmentlänge in der Mitte der Traktrix = r0", () => {
    const t = (s.tTh + T_TRANS) / 2;
    const segLen = s.r0 * Math.sqrt(Math.tanh(t) ** 2 + xN(t) ** 2);
    expect(segLen).toBeCloseTo(s.r0, 5);
  });

  it("sqrt(tanh²(t) + xN²(t)) = 1 für alle t (normierte Form)", () => {
    [0.1, 0.5, T_TRANS, 1.0, 2.0, 3.0].forEach(t => {
      const val = Math.sqrt(Math.tanh(t) ** 2 + xN(t) ** 2);
      expect(val).toBeCloseTo(1.0, 10);
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// 2. GRENZFALL: KONISCHES HORN (Lt = 0)
//    Bekannte geschlossene Formel → Fokus bei -rt/tan(α)
// ──────────────────────────────────────────────────────────────────
describe("Grenzfall konisches Horn (Lt=0) – geschlossene Formel", () => {
  /**
   * Für Lt=0 (keine Traktrix) ist das Horn rein konisch.
   * Der virtuelle Scheitelpunkt (Fokus) liegt analytisch bei:
   *   zFocus = -rt / tan(α)
   *
   * Dies ergibt sich direkt aus:
   *   zFocus = zTrans - xTrans/tan(α) = 0 - rt/tan(α)
   */
  const throats = [12.7, 25.4, 38.1, 50.8];

  throats.forEach(rt => {
    it(`rt=${rt}mm: zFocus = -rt/tan(α) = ${(-rt / Math.tan(ALPHA2)).toFixed(2)} mm`, () => {
      const s = solveHorn(600, 0, rt, DW, DH);
      expect(s).not.toBeNull();
      const expected = -rt / Math.tan(ALPHA2);
      expect(s.zFocus).toBeCloseTo(expected, 4);
    });
  });

  it("Für Lt=0 liegt Fokus immer auf der negativen z-Achse", () => {
    const s = solveHorn(600, 0, RT, DW, DH);
    expect(s.zFocus).toBeLessThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────
// 3. NUMERISCHE INTEGRATION (unabhängiger Solver)
//    Verifiziert solveR0 durch direkte Runge-Kutta-Integration
//    der Traktrix-ODE.
// ──────────────────────────────────────────────────────────────────
describe("Numerische Integration – unabhängige Verifikation von solveR0", () => {
  /**
   * Die axiale Traktrix-Länge von t=tTh bis t=T_TRANS beträgt:
   *   Lt = r0 * (zN(tTh) - zN(T_TRANS))
   *
   * Alternativ numerisch integriert:
   *   ∫ dz/dt dt = ∫ tanh²(t) dt  von tTh bis T_TRANS
   *
   * Die Stammfunktion ist: ∫ tanh²(t) dt = t - tanh(t) = zN(t)
   * → Integral = [zN(t)]_tTh^T_TRANS = zN(T_TRANS) - zN(tTh)
   *
   * Wir verifizieren via numerischer Trapezregel (N=10000 Schritte).
   */

  function numericalIntegral(f, a, b, n = 10000) {
    const h = (b - a) / n;
    let sum = (f(a) + f(b)) / 2;
    for (let i = 1; i < n; i++) sum += f(a + i * h);
    return sum * h;
  }

  [25.4, 38.1, 50.8].forEach(rt => {
    it(`rt=${rt}mm: numerisches ∫tanh²dt stimmt mit r0·(zN(tTh)-zN(T_TRANS)) überein`, () => {
      const Lt = 60, s = solveHorn(500, Lt, rt, DW, DH);
      expect(s).not.toBeNull();

      const analytical  = s.r0 * (zN(s.tTh) - zN(T_TRANS));
      const numerical   = s.r0 * numericalIntegral(
        t => Math.tanh(t) ** 2, T_TRANS, s.tTh
      );
      expect(analytical).toBeCloseTo(Lt, 3);
      expect(numerical).toBeCloseTo(Lt, 2);   // Trapezregel: ~3 Stellen
    });
  });

  it("Numerische Mundbreite stimmt mit analytischer Formel überein", () => {
    // xMouth = xTrans + Ls·tan(α): unabhängig ausgerechnet
    const s = solveHorn(500, 60, RT, DW, DH);
    const xMouth_ref = s.xTrans + s.Ls * Math.tan(ALPHA2);
    expect(s.xMouth).toBeCloseTo(xMouth_ref, 8);
  });
});

// ──────────────────────────────────────────────────────────────────
// 4. BOGENLÄNGENFORMEL (unabhängige Ableitung)
// ──────────────────────────────────────────────────────────────────
describe("Bogenlänge und Winkelbeziehungen", () => {
  const s = solveHorn(500, 60, RT, DW, DH);

  it("arcLen / arcR = 2·ALPHA2 (Kreisbogen-Formel: s = r·θ)", () => {
    expect(s.arcLen / s.arcR).toBeCloseTo(2 * ALPHA2, 8);
  });

  it("Strahlwinkel Fokus→Mund = ALPHA2 (geometrische Konsistenz)", () => {
    // Der Strahl vom Fokus zum Mundpunkt schließt mit der Achse ALPHA2 ein.
    const angle = Math.atan2(s.xMouth, s.zMouth - s.zFocus);
    expect(angle).toBeCloseTo(ALPHA2, 5);
  });

  it("Strahlwinkel Fokus→Übergang = ALPHA2", () => {
    // Gilt auch für den Übergangspunkt (beide liegen auf demselben Strahl).
    const angle = Math.atan2(s.xTrans, s.zTrans - s.zFocus);
    expect(angle).toBeCloseTo(ALPHA2, 5);
  });

  it("Alle Wandpunkte im linearen Bereich liegen auf dem Fokus-Kegel", () => {
    // Jeder Punkt (zTrans + t·Ls, xTrans + t·Ls·tan(α)) für t∈[0,1]
    // hat denselben Winkel ALPHA2 zum Fokus.
    for (let f = 0; f <= 1; f += 0.2) {
      const z = s.zTrans + f * s.Ls;
      const x = s.xTrans + f * s.Ls * Math.tan(ALPHA2);
      const angle = Math.atan2(x, z - s.zFocus);
      expect(angle).toBeCloseTo(ALPHA2, 5);
    }
  });
});

// ──────────────────────────────────────────────────────────────────
// 5. AKUSTISCHE PLAUSIBILITÄTSCHECKS (Näherungsformeln)
//    Referenz: Olson "Acoustical Engineering" (1957),
//              Beranek "Acoustics" (1954)
// ──────────────────────────────────────────────────────────────────
describe("Akustische Plausibilitätschecks", () => {
  const LT = 60;
  const s  = solveHorn(500, LT, RT, DW, DH);
  const f  = frequencyEstimates(s, RT);

  it("frequencyEstimates entspricht den Näherungsformeln", () => {
    // fc_low: Mundumfang = Wellenlänge; fc_high: Throat-Durchmesser = halbe Wellenlänge;
    // fc_cut: Flare-Konstante m = ln(B_Mund / B_Throat) / L mit B = horizontale Breite
    const m = Math.log(s.arcLen / (2 * RT)) / (s.zApex - s.hatTipZ);
    expect(f.fcLow).toBeCloseTo(C / (2 * Math.PI * s.arcR), 9);
    expect(f.fcHigh).toBeCloseTo(C / (2 * RT), 9);
    expect(f.fcCut).toBeCloseTo(C * m / (4 * Math.PI), 9);
  });

  it("Mundbreite >> Throat-Durchmesser (Horn öffnet sich deutlich)", () => {
    expect((2 * s.xMouth) / (2 * RT)).toBeGreaterThan(2);
  });

  it("fc_low liegt für typische Radialhörner zwischen 50 und 300 Hz", () => {
    expect(f.fcLow).toBeLessThan(300);
    expect(f.fcLow).toBeGreaterThan(50);
  });

  it("fc_high liegt im kHz-Bereich (Treiber-Grenze)", () => {
    expect(f.fcHigh).toBeGreaterThan(1000);
    expect(f.fcHigh).toBeLessThan(20000);
  });

  it("Horn-Cutoff ist positiv und liegt nicht deutlich über fc_low", () => {
    expect(f.fcCut).toBeGreaterThan(0);
    expect(f.fcCut).toBeLessThan(f.fcLow * 1.5);   // Näherung, daher großzügige Toleranz
  });

  it("mouthArea = Bogenlänge × Mundhöhe", () => {
    expect(mouthArea(s, 200)).toBeCloseTo(s.arcLen * 200, 6);
  });

  it("Mundfläche (horiz.) / Throatfläche > 4 für guten Wirkungsgrad", () => {
    // Faustregel: Flächenverhältnis ≥ 4. Horizontal als Kreissektoren um den Fokus.
    expect((s.arcR ** 2 * ALPHA2) / (s.rInner ** 2 * ALPHA2)).toBeGreaterThan(4);
  });
});

// ──────────────────────────────────────────────────────────────────
// 6. SKALIERUNGSINVARIANZ
//    Wenn alle Längen skaliert werden, skaliert das Ergebnis mit.
// ──────────────────────────────────────────────────────────────────
describe("Skalierungsinvarianz", () => {
  it("Doppelte Abmessungen → doppelter arcR, arcLen, xMouth", () => {
    const k = 2;
    const s1 = solveHorn(500,      60,      RT,      DW,      DH);
    const s2 = solveHorn(500 * k,  60 * k,  RT * k,  DW * k,  DH * k);
    expect(s2).not.toBeNull();
    expect(s2.arcR   / s1.arcR  ).toBeCloseTo(k, 3);
    expect(s2.arcLen / s1.arcLen).toBeCloseTo(k, 3);
    expect(s2.xMouth / s1.xMouth).toBeCloseTo(k, 3);
    expect(s2.zApex  / s1.zApex ).toBeCloseTo(k, 3);
  });

  it("Skalierung ändert nicht tTh (dimensionslos)", () => {
    const k = 3;
    const s1 = solveHorn(500,      60,      RT,      DW,      DH);
    const s2 = solveHorn(500 * k,  60 * k,  RT * k,  DW * k,  DH * k);
    // tTh ist der Traktrix-Parameter, der nur vom Verhältnis r0/rt abhängt.
    expect(s2.tTh).toBeCloseTo(s1.tTh, 5);
  });
});
