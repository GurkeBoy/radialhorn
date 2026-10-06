// Referenzfälle für den Abgleich mit Hornresp – einzige Quelle für Geometrie, Treiber und
// Hornresp-Einstellungen (Referenzdokument, Import der Exporte, Test).
import { sampleArea, PLACEHOLDER_DRIVER } from "../../src/simulation.js";

/** Hornresp-Version der Referenzdaten. */
export const HORNRESP = { version: "60.50", produkt: "6050-260928", exportiert: "2026-10-06" };

/** Luftwerte, in Hornresp fest eingebaut (laut Hornresp-Hilfe nur per Strg+F5 änderbar). */
export const AIR = { c: 344, rho: 1.205 };

/** Hornresp-Eingaben, die für alle Fälle gleich sind (Treiber = Platzhalter aus simulation.js). */
export const GEMEINSAM = {
  Ang: "2,0 x Pi", Eg: "2,83", Rg: "0", Nd: "1", Vrc: "0", Lrc: "0", "Fr, Tal": "Standard (40000, 4; ohne Rückkammer ohne Wirkung)",
  Ausgabe: "Acoustical Power, Combined, Path 0 cm", "Kammer-Resonanzen": "nicht maskiert",
};

const noChambers = { ...PLACEHOLDER_DRIVER, Vtc: 0, Atc: 0, Vrc: 0 };
// Konus als zwei Con-Segmente gleicher Steigung von √S: Hornresp lehnt ein einzelnes Segment mit
// S3 = 0 ab („ERROR: S3 = 0,00“); geometrisch derselbe Konus 20 → 800 cm² über 50 cm
const CONE = [{ S1: 20, S2: 268.25, L: 25, flare: "Con" }, { S1: 268.25, S2: 800, L: 25, flare: "Con" }];

/** Segmente wie in Hornresp: S in cm², L in cm; Treiber in Anzeige-Einheiten (driverSI). */
export const CASES = [
  { id: "A", title: "Konushorn, ohne Kammern", segments: CONE, driver: noChambers },
  { id: "B", title: "Konushorn mit Kompressionskammer", segments: CONE, driver: { ...noChambers, Vtc: 10, Atc: 45 } },
  { id: "C", title: "Konus + Exponential (Knick in S(x)), ohne Kammern",
    segments: [{ S1: 20, S2: 100, L: 10, flare: "Con" }, { S1: 100, S2: 1200, L: 50, flare: "Exp" }], driver: noChambers },
];

/** Flächenkurve { x [m], S [m²] } aus Hornresp-Segmenten, Stützstellen genau an den Segmentgrenzen. */
export function curveOf(segments, step = 0.0005) {
  const x = [], S = [];
  let x0 = 0;
  for (const s of segments) {
    const L = s.L / 100, s1 = s.S1 * 1e-4, s2 = s.S2 * 1e-4;
    const area = s.flare === "Exp"
      ? v => s1 * (s2 / s1) ** (v / L)
      : v => (Math.sqrt(s1) + (Math.sqrt(s2) - Math.sqrt(s1)) * v / L) ** 2;   // Konus: √S linear
    const part = sampleArea(area, L, step);
    part.x.forEach((v, i) => { if (x.length && i === 0) return; x.push(x0 + v); S.push(part.S[i]); });
    x0 += L;
  }
  return { x, S };
}

/** Hornresp-Eingaben eines Falls als Tabelle [Feld, Wert] (Referenzdokument, CSV-Kopf). */
export function hornrespInputs(c) {
  const d = c.driver;
  const seg = c.segments.flatMap((s, i) => [
    [`S${i + 1}`, String(s.S1)], [`S${i + 2}`, String(s.S2)], [`L${i + 1}${i + 2} (${s.flare})`, String(s.L)],
  ]).filter(([k], i, all) => all.findIndex(([q]) => q === k) === i);
  return [
    ["Ang", GEMEINSAM.Ang], ["Eg", GEMEINSAM.Eg], ["Rg", GEMEINSAM.Rg], ...seg,
    ["Sd", String(d.Sd)], ["Bl", String(d.Bl)], ["Cms", (d.Cms * 1e-6).toExponential(2)], ["Rms", String(d.Rms)],
    ["Mmd", String(d.mass)], ["Le", String(d.Le)], ["Re", String(d.Re)], ["Nd", GEMEINSAM.Nd],
    ["Vrc", GEMEINSAM.Vrc], ["Lrc", GEMEINSAM.Lrc], ["Vtc", String(d.Vtc)], ["Atc", String(d.Atc)],
  ];
}
