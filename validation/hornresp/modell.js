// Das Modell aus simulation.js mit Hornresps Konventionen für Vrc = 0, damit Ergebnisse direkt mit
// Hornresp-Exporten vergleichbar sind (referenz.js und hornresp.test.js):
//   - Membranrückseite offen: belastet mit der Strahlungsimpedanz eines Kolbens Sd (2π) und
//     strahlt selbst ab („Combined“-Ausgabe, Weglänge 0)
//   - SPL je Quelle aus ihrer abgestrahlten Leistung, kohärent summiert
// Die App selbst lässt die Rückseite unbelastet (Kompressionstreiber: Rückkammer steckt in den
// gemessenen Thiele-Small-Werten).
import { abs, propagate, radiationImpedance, coneMatrix, cx } from "../../src/simulation.js";

const add = (a, b) => cx(a.re + b.re, a.im + b.im);
const sub = (a, b) => cx(a.re - b.re, a.im - b.im);
const mul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a, b) => { const d = b.re ** 2 + b.im ** 2; return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };

/**
 * @param curve     { x, S } in m, m²; driver in SI (driverSI); Abstrahlung 2π, r = 1 m
 * @param rearOpen  false: Rückseite unbelastet und stumm wie in der App (nur zum Querprüfen)
 * @returns {{ f, spl, ze: number[], ra: number[], xa: number[] }}  ra/xa normiert auf ρc/S_Hals
 */
export function hornrespResponse({ curve, air, driver: dr, freqs, voltage = 2.83, rearOpen = true }) {
  const rhoC = air.rho * air.c, omega = 2 * Math.PI;
  const out = { f: freqs, spl: [], ze: [], ra: [], xa: [] };
  for (const f of freqs) {
    const w = 2 * Math.PI * f, k = w / air.c;
    const zrM = radiationImpedance(curve.S.at(-1), k, rhoC), zrD = rearOpen ? radiationImpedance(dr.Sd, k, rhoC) : cx(0);
    const { p, U } = propagate(curve, k, rhoC, zrM);
    const zt = div(p, U);
    let T = { A11: 1, B: 0, C: 0, A22: 1 };
    if (dr.Vtc > 0) {
      T = dr.Atc > 0 ? coneMatrix(dr.Atc, dr.Atc, dr.Vtc / dr.Atc, k, rhoC) : { A11: 1, B: 0, C: w * dr.Vtc / (air.rho * air.c ** 2), A22: 1 };
    }
    const den = add(mul(cx(0, T.C), zt), cx(T.A22));
    const zFront = div(add(mul(cx(T.A11), zt), cx(0, T.B)), den);
    const zm = add(cx(dr.Rms, w * dr.Mmd - 1 / (w * dr.Cms)), mul(cx(dr.Sd ** 2), add(zFront, zrD)));
    const ze = add(cx(dr.Re, w * dr.Le), div(cx(dr.Bl ** 2), zm));
    const v = div(cx(dr.Bl * voltage), mul(ze, zm));
    const uD = mul(cx(dr.Sd), v), uM = div(div(uD, den), U);
    // Druckamplitude je Quelle √(W·ρc/Ω) mit der Phase ihres Volumenstroms; Rückseite gegenphasig
    const amp = zr => Math.sqrt(zr.re * rhoC / omega);
    const pr = sub(mul(cx(amp(zrM)), uM), mul(cx(amp(zrD)), uD));
    out.spl.push(20 * Math.log10(abs(pr) / 20e-6));
    out.ze.push(abs(ze));
    out.ra.push(zt.re * curve.S[0] / rhoC);
    out.xa.push(zt.im * curve.S[0] / rhoC);
  }
  return out;
}

/**
 * Roher Hornresp-Export (Tab-getrennt, Dezimalkomma, Kopfzeile mit Spaltennamen) als Textzeilen je
 * Spalte: [{ "Freq (hertz)": "10,000000", … }]. Werte bleiben Text, damit der Import sie unverändert
 * übernimmt.
 */
export function parseHornrespExport(text) {
  const rows = text.trim().split(/\r?\n/);
  const head = rows[0].split("\t").map(s => s.trim());
  return rows.slice(1).filter(l => l.trim())
    .map(l => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v.trim()])));
}

/** Spalten der Referenzdateien: Name in der CSV ← Spalte im Hornresp-Export. */
export const REFERENCE_COLUMNS = [
  ["f_Hz", "Freq (hertz)"], ["Ra_norm", "Ra (norm)"], ["Xa_norm", "Xa (norm)"], ["Ze_Ohm", "Ze (ohms)"], ["SPL_dB", "SPL (dB)"],
];

/** Referenzdatei (hornresp-<Fall>.csv: Kommentarzeilen mit #, Kopfzeile, Komma-getrennt) → [{ f_Hz, … }]. */
export function parseReferenceCsv(text) {
  const rows = text.split(/\r?\n/).filter(l => l.trim() && !l.startsWith("#"));
  const head = rows[0].split(",");
  return rows.slice(1).map(l => Object.fromEntries(l.split(",").map((v, i) => [head[i], parseFloat(v)])));
}
