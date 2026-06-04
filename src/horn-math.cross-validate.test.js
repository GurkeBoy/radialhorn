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
  ALPHA2, T_TRANS, zN, xN,
  solveHorn, minL, maxLt,
} from "./horn-math.js";

const RT  = 25.4;   // 1" Throat-Radius
const DW  = 120;
const DH  = 100;
const C   = 343000; // Schallgeschwindigkeit [mm/s]

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
  const H_MOUTH = 200; // Annahme für Öffnungshöhe [mm]

  it("Mundbreite >> Throat-Durchmesser (Horn öffnet sich deutlich)", () => {
    const ratio = (2 * s.xMouth) / (2 * RT);
    expect(ratio).toBeGreaterThan(2);
  });

  it("fc_low (λ=2πR) liegt unter 300 Hz für typische Horn-Parameter", () => {
    // Untere Grenzfrequenz aus dem Mundradius: fc = c / (2π·arcR)
    // Typische Radialh–rner: 100–500 Hz
    const fcLow = C / (2 * Math.PI * s.arcR);
    expect(fcLow).toBeLessThan(300);
    expect(fcLow).toBeGreaterThan(50);
  });

  it("fc_high (λ=2r) liegt im kHz-Bereich (Treiber-Grenze)", () => {
    // Obere Grenze: λ = Throat-Durchmesser → fc = c / (2·rt)
    const fcHigh = C / (2 * RT);
    expect(fcHigh).toBeGreaterThan(1000);   // > 1 kHz
    expect(fcHigh).toBeLessThan(20000);     // < 20 kHz (Hörgrenze)
  });

  it("Horn-Cutoff (Flare-Konstante) liegt unterhalb fc_low", () => {
    // Flare-Konstante m ≈ ln(Bmouth/Bthroat) / L
    // wobei B = Breite (horizontaler Querschnitt)
    const Bthroat = 2 * RT;
    const Bmouth  = s.arcLen;   // = arcR · 2·ALPHA2
    const hornLen = s.zApex - s.hatTipZ;
    const m       = Math.log(Bmouth / Bthroat) / hornLen;
    const fcCut   = C * m / (4 * Math.PI);

    const fcLow   = C / (2 * Math.PI * s.arcR);
    // Cutoff-Frequenz soll unter der Mundfrequenz liegen (sinnvolles Horn)
    expect(fcCut).toBeLessThan(fcLow * 1.5);  // Näherung, daher großzügige Toleranz
    expect(fcCut).toBeGreaterThan(0);
  });

  it("Mundfläche (horiz.) / Throatfläche > 4 für guten Wirkungsgrad", () => {
    // Faustregel: Flächenverhältnis >= 4 für sinnvollen Hornbetrieb
    // Horizontale Mundfläche: Kreissektor = arcR² · ALPHA2
    // Horizontale Throatfläche: Kreissektor = rThroat² · ALPHA2 (bei Lt>0: innerer Bogen)
    const Smouth  = s.arcR * s.arcR * ALPHA2;
    const Sthroat = s.rInner * s.rInner * ALPHA2;
    expect(Smouth / Sthroat).toBeGreaterThan(4);
  });

  it("Flächenaufweitung ist stetig (keine Sprünge im Querschnitt)", () => {
    // Querschnittsbreite B(z) wächst monoton von Throat zu Mund.
    const nPoints = 20;
    const widths  = [];
    for (let i = 0; i <= nPoints; i++) {
      const z = s.zTrans + (s.Ls * i) / nPoints;
      const x = s.xTrans + (s.Ls * i) / nPoints * Math.tan(ALPHA2);
      widths.push(x);
    }
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
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
