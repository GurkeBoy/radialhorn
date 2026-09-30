import { describe, it, expect } from "vitest";
import {
  ALPHA2, T_TRANS, zN, xN,
  solveHorn, minL, maxLt, maxLforRaumecke, minLtForRaumecke,
} from "./horn-math.js";

// ─── Standardparameter für alle Tests ────────────────────────────
const RT = 25.4;   // 1" Throat-Radius
const DW = 120;
const DH = 100;
const L  = 500;
const LT = 60;
// ──────────────────────────────────────────────────────────────────
// 1. GEOMETRIE-KONSTANTEN
// ──────────────────────────────────────────────────────────────────
describe("Geometrie-Konstanten (70°)", () => {
  it("ALPHA2 = 70° in Radian", () => {
    expect(ALPHA2).toBeCloseTo(70 * Math.PI / 180, 12);
  });

  it("T_TRANS-Definition: tan(ALPHA2) = 1 / sinh(T_TRANS)", () => {
    // Mathematische Eigenschaft der Traktrix: am Übergang stimmt der
    // Tangentenwinkel exakt mit dem Öffnungswinkel überein.
    expect(Math.tan(ALPHA2)).toBeCloseTo(1 / Math.sinh(T_TRANS), 10);
  });

  it("T_TRANS = asinh(cot(ALPHA2))", () => {
    expect(T_TRANS).toBeCloseTo(Math.asinh(1 / Math.tan(ALPHA2)), 12);
  });
});

// ──────────────────────────────────────────────────────────────────
// 2. TRAKTRIX-BASISFUNKTIONEN
// ──────────────────────────────────────────────────────────────────
describe("Traktrix-Funktionen zN / xN", () => {
  it("zN(0) = 0", () => expect(zN(0)).toBeCloseTo(0, 12));
  it("xN(0) = 1 (normierte Breite am Throat)", () => expect(xN(0)).toBeCloseTo(1, 12));

  it("zN(t) = t - tanh(t)", () => {
    [0.1, 0.5, 1.0, 2.0, T_TRANS].forEach(t =>
      expect(zN(t)).toBeCloseTo(t - Math.tanh(t), 12)
    );
  });

  it("xN(t) = 1 / cosh(t)", () => {
    [0.1, 0.5, 1.0, 2.0, T_TRANS].forEach(t =>
      expect(xN(t)).toBeCloseTo(1 / Math.cosh(t), 12)
    );
  });

  it("xN ist streng monoton fallend (Traktrix wird schmaler)", () => {
    const ts = [0, 0.2, 0.5, 1.0, 2.0, 3.0];
    for (let i = 1; i < ts.length; i++)
      expect(xN(ts[i])).toBeLessThan(xN(ts[i - 1]));
  });

  it("zN ist streng monoton steigend (axiale Länge wächst)", () => {
    const ts = [0, 0.2, 0.5, 1.0, 2.0, 3.0];
    for (let i = 1; i < ts.length; i++)
      expect(zN(ts[i])).toBeGreaterThan(zN(ts[i - 1]));
  });

  it("Traktrix-Tangente bei T_TRANS entspricht ALPHA2", () => {
    // Tangentenwinkel der Traktrix = arctan(1/sinh(t))
    // → bei T_TRANS ist dieser Winkel exakt ALPHA2
    const angle = Math.atan(1 / Math.sinh(T_TRANS));
    expect(angle).toBeCloseTo(ALPHA2, 10);
  });
});

// ──────────────────────────────────────────────────────────────────
// 3. SOLVEHORN – GEOMETRISCHE INVARIANTEN
//    Diese prüfen die mathematische Konsistenz der Lösung.
// ──────────────────────────────────────────────────────────────────
describe("solveHorn – Geometrie-Invarianten", () => {
  const s = solveHorn(L, LT, RT, DW, DH);

  it("gibt ein Objekt zurück (valide Parameter)", () => {
    expect(s).not.toBeNull();
  });

  it("Throat-Bedingung: r0 · xN(tTh) = rt", () => {
    // Die Traktrix startet exakt am Throat-Radius.
    expect(s.r0 * xN(s.tTh)).toBeCloseTo(RT, 6);
  });

  it("Übergangs-x: r0 · xN(T_TRANS) = xTrans", () => {
    expect(s.r0 * xN(T_TRANS)).toBeCloseTo(s.xTrans, 6);
  });

  it("Übergangs-z: r0 · (zN(tTh) - zN(T_TRANS)) = zTrans = Lt", () => {
    expect(s.r0 * (zN(s.tTh) - zN(T_TRANS))).toBeCloseTo(LT, 6);
    expect(s.zTrans).toBeCloseTo(LT, 6);
  });

  it("Mundpunkt liegt auf der linearen Wand: xMouth = xTrans + Ls·tan(α)", () => {
    expect(s.xMouth).toBeCloseTo(s.xTrans + s.Ls * Math.tan(ALPHA2), 6);
  });

  it("zMouth = zTrans + Ls", () => {
    expect(s.zMouth).toBeCloseTo(s.zTrans + s.Ls, 6);
  });

  it("Mundpunkt liegt auf dem Teilkreis: dist(Fokus, Mund) = arcR", () => {
    const dist = Math.hypot(s.zMouth - s.zFocus, s.xMouth);
    expect(dist).toBeCloseTo(s.arcR, 6);
  });

  it("Scheitelpunkt: zApex = zFocus + arcR", () => {
    expect(s.zApex).toBeCloseTo(s.zFocus + s.arcR, 6);
  });

  it("Übergangspunkt liegt auf dem inneren Teilkreis", () => {
    const dist = Math.hypot(s.zTrans - s.zFocus, s.xTrans);
    expect(dist).toBeCloseTo(s.rInner, 6);
  });

  it("zInnerApex = zFocus + rInner", () => {
    expect(s.zInnerApex).toBeCloseTo(s.zFocus + s.rInner, 6);
  });

  it("hatTipZ = -dh - dw/2", () => {
    expect(s.hatTipZ).toBeCloseTo(-DH - DW / 2, 10);
  });

  it("arcLen = arcR · 2·ALPHA2", () => {
    expect(s.arcLen).toBeCloseTo(s.arcR * 2 * ALPHA2, 6);
  });

  it("Teilkreis ist größer als innerer Teilkreis (Horn weitet sich auf)", () => {
    expect(s.arcR).toBeGreaterThan(s.rInner);
  });

  it("Mund ist breiter als der Übergang", () => {
    expect(s.xMouth).toBeGreaterThan(s.xTrans);
  });
});

// ──────────────────────────────────────────────────────────────────
// 4. SOLVEHORN – GRENZFÄLLE
// ──────────────────────────────────────────────────────────────────
describe("solveHorn – Grenzfälle", () => {
  it("Lt=0: kein Traktrix → xTrans=rt, zTrans=0", () => {
    const s = solveHorn(L, 0, RT, DW, DH);
    expect(s).not.toBeNull();
    expect(s.xTrans).toBeCloseTo(RT, 10);
    expect(s.zTrans).toBeCloseTo(0, 10);
  });

  it("Lt=0: Mund liegt trotzdem auf dem Teilkreis", () => {
    const s = solveHorn(L, 0, RT, DW, DH);
    const dist = Math.hypot(s.zMouth - s.zFocus, s.xMouth);
    expect(dist).toBeCloseTo(s.arcR, 6);
  });

  it("L zu klein → null", () => {
    expect(solveHorn(50, 0, RT, DW, DH)).toBeNull();
  });

  it("Lt > L → null (geometrisch unmöglich)", () => {
    expect(solveHorn(L, L * 2, RT, DW, DH)).toBeNull();
  });

  it("Verschiedene Throat-Größen: alle validen Konfigurationen lösen", () => {
    [12.7, 25.4, 38.1, 50.8, 76.2].forEach(rt => {
      const s = solveHorn(600, 50, rt, 140, 110);
      expect(s).not.toBeNull();
      if (s) {
        // Mundpunkt auf dem Teilkreis
        const dist = Math.hypot(s.zMouth - s.zFocus, s.xMouth);
        expect(dist).toBeCloseTo(s.arcR, 5);
      }
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// 5. MINL – MINDESTLÄNGE
// ──────────────────────────────────────────────────────────────────
describe("minL", () => {
  it("solveHorn(minL, ...) liefert valide Lösung", () => {
    const lMin = minL(LT, RT, DW, DH);
    expect(solveHorn(lMin, LT, RT, DW, DH)).not.toBeNull();
  });

  it("solveHorn mit klar zu kleinem L liefert null", () => {
    // minL hat einen internen +10mm-Puffer, daher testen wir mit L=50
    // das geometrisch unmöglich ist (kleiner als dh + dw/2 allein).
    expect(solveHorn(50, LT, RT, DW, DH)).toBeNull();
  });

  it("minL ist positiv", () => {
    expect(minL(LT, RT, DW, DH)).toBeGreaterThan(0);
  });

  it("minL(0, ...) ≤ minL(Lt, ...) für Lt > 0", () => {
    // Ohne Traktrix braucht das Horn weniger Platz.
    expect(minL(0, RT, DW, DH)).toBeLessThanOrEqual(minL(LT, RT, DW, DH) + 1);
  });
});

// ──────────────────────────────────────────────────────────────────
// 6. MAXLT – MAXIMALE TRAKTRIX-LÄNGE
// ──────────────────────────────────────────────────────────────────
describe("maxLt", () => {
  it("liegt im Bereich (0, L)", () => {
    const ltMax = maxLt(L, RT, DW, DH);
    expect(ltMax).toBeGreaterThan(0);
    expect(ltMax).toBeLessThan(L);
  });

  it("solveHorn mit 99 % von maxLt ist valide", () => {
    const ltMax = maxLt(L, RT, DW, DH);
    expect(solveHorn(L, ltMax * 0.99, RT, DW, DH)).not.toBeNull();
  });

  it("solveHorn mit Lt > maxLt gibt null", () => {
    const ltMax = maxLt(L, RT, DW, DH);
    expect(solveHorn(L, ltMax * 1.1, RT, DW, DH)).toBeNull();
  });

  it("maxLt wächst mit L (längeres Horn → mehr Platz für Traktrix)", () => {
    expect(maxLt(600, RT, DW, DH)).toBeGreaterThanOrEqual(maxLt(400, RT, DW, DH));
  });
});

// ──────────────────────────────────────────────────────────────────
// 7. RAUMECKE-CONSTRAINTS
// ──────────────────────────────────────────────────────────────────
describe("maxLforRaumecke", () => {
  it("gibt positiven Wert zurück", () => {
    expect(maxLforRaumecke(LT, RT, DW, DH)).toBeGreaterThan(0);
  });

  it("Lösung bei maxLforRaumecke respektiert den Raumecken-Constraint", () => {
    const lMax = maxLforRaumecke(LT, RT, DW, DH);
    const s = solveHorn(lMax, LT, RT, DW, DH);
    expect(s).not.toBeNull();
    // Invariante: xMouth ≤ dw/2 + zMouth + dh  (mit 1mm Toleranz)
    expect(s.xMouth).toBeLessThanOrEqual(DW / 2 + s.zMouth + DH + 1.0);
  });

  it("extraBreite verkleinert das erlaubte L", () => {
    const lMax0  = maxLforRaumecke(LT, RT, DW, DH, 0);
    const lMax50 = maxLforRaumecke(LT, RT, DW, DH, 50);
    // Mit mehr Wandstärke wird das erlaubte L kleiner oder null.
    expect(lMax50 === null || lMax50 < lMax0).toBe(true);
  });

  it("sehr große extraBreite → null (kein Platz mehr)", () => {
    // Mit extraBreite = DW halbieren wir effektiv den verfügbaren Raum deutlich.
    const extraGroß = DW / 2 + DH + 500;
    expect(maxLforRaumecke(LT, RT, DW, DH, extraGroß)).toBeNull();
  });
});

describe("minLtForRaumecke", () => {
  it("gibt Wert ≤ maxLt zurück wenn Raumecke erreichbar", () => {
    const ltMinR = minLtForRaumecke(L, RT, DW, DH);
    if (ltMinR !== null) {
      expect(ltMinR).toBeLessThanOrEqual(maxLt(L, RT, DW, DH) + 0.5);
    }
  });

  it("bei minLtForRaumecke ist der Raumecken-Constraint erfüllbar", () => {
    const ltMinR = minLtForRaumecke(L, RT, DW, DH);
    if (ltMinR !== null) {
      const lMax = maxLforRaumecke(ltMinR, RT, DW, DH);
      expect(lMax).not.toBeNull();
      expect(lMax).toBeGreaterThanOrEqual(L - 1);
    }
  });
});

// ──────────────────────────────────────────────────────────────────
// 8. NUMERISCHE REFERENZ-WERTE (Quercheck)
//    Bekannte Ausgabe für L=500, Lt=60, rt=25.4, dw=120, dh=100
//    bei ALPHA2=70° – verifiziert durch mathematische Invarianten.
// ──────────────────────────────────────────────────────────────────
describe("Numerische Quercheck (Standardparameter)", () => {
  const s = solveHorn(500, 60, 25.4, 120, 100);

  it("Lösung ist valide", () => expect(s).not.toBeNull());

  it("hatTipZ = -160 mm", () => {
    expect(s.hatTipZ).toBeCloseTo(-100 - 120 / 2, 6); // = -160
  });

  it("arcLen = arcR · 140° in Radiant", () => {
    expect(s.arcLen).toBeCloseTo(s.arcR * (140 * Math.PI / 180), 5);
  });

  it("Öffnungswinkel der Fokusstrahlen entspricht ALPHA2", () => {
    // Der Winkel des Strahls (Fokus → Mund) zur Achse sollte ALPHA2 sein.
    const angle = Math.atan2(s.xMouth, s.zMouth - s.zFocus);
    expect(angle).toBeCloseTo(ALPHA2, 3);
  });

  it("Fokus liegt vor dem Scheitelpunkt (zFocus < zApex)", () => {
    // arcR > 0 garantiert: zApex = zFocus + arcR > zFocus
    expect(s.zFocus).toBeLessThan(s.zApex);
  });

  it("xMouth > 0 (Horn öffnet sich)", () => {
    expect(s.xMouth).toBeGreaterThan(0);
  });

  it("Alle Positionen sind endliche Zahlen", () => {
    ["r0", "tTh", "Lt", "Ls", "xTrans", "zTrans", "xMouth", "zMouth",
     "zFocus", "arcR", "zApex", "hatTipZ", "arcLen", "rInner", "zInnerApex"]
      .forEach(key => {
        expect(isFinite(s[key])).toBe(true);
        expect(isNaN(s[key])).toBe(false);
      });
  });
});
