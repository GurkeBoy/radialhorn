// Referenzhörner für den Vergleich mit Hornresp: schreibt docs/hornresp-referenz.md (Eingabewerte
// und Stützwerte) sowie je Fall eine CSV mit dem vollen Frequenzgang nach docs/hornresp/.
//   node scripts/hornresp-referenz.js
import { mkdirSync, writeFileSync } from "node:fs";
import {
  airAt, logFrequencies, sampleStep, sampleArea, simulate, driverSI, PLACEHOLDER_DRIVER, abs, arg,
} from "../src/simulation.js";
import { buildCSV } from "../src/export/csv.js";

const AIR = airAt(20);
const FREQS = logFrequencies(20, 20000, 24);
const STEP = sampleStep(FREQS.at(-1), AIR.c);
const CHECK = [100, 200, 300, 500, 700, 1000, 2000, 5000, 10000, 20000];

const noChambers = { ...PLACEHOLDER_DRIVER, Vtc: 0, Atc: 0, Vrc: 0 };
const cm2 = v => v * 1e-4;

/** Segmente wie in Hornresp: { S1, S2 [cm²], L [cm], flare: "Con" | "Exp" }. */
function curveOf(segments) {
  const total = segments.reduce((a, s) => a + s.L, 0) / 100;
  let x0 = 0;
  const pieces = segments.map(s => {
    const p = { ...s, x0, x1: x0 + s.L / 100 };
    x0 = p.x1;
    return p;
  });
  const area = x => {
    const p = pieces.find(q => x <= q.x1 + 1e-12) ?? pieces.at(-1);
    const u = (x - p.x0) / (p.x1 - p.x0);
    if (p.flare === "Exp") return cm2(p.S1) * (p.S2 / p.S1) ** u;
    return (Math.sqrt(cm2(p.S1)) + u * (Math.sqrt(cm2(p.S2)) - Math.sqrt(cm2(p.S1)))) ** 2;   // Konus
  };
  // Stützstellen genau an den Segmentgrenzen (Knick), dazwischen höchstens STEP
  const x = [], S = [];
  for (const p of pieces) {
    const part = sampleArea(v => area(p.x0 + v), p.x1 - p.x0, STEP);
    part.x.forEach((v, i) => { if (x.length && i === 0) return; x.push(p.x0 + v); S.push(part.S[i]); });
  }
  return { x, S, total };
}

const CASES = [
  {
    id: "A", title: "Konushorn, ohne Kammern",
    segments: [{ S1: 20, S2: 800, L: 50, flare: "Con" }], driver: noChambers,
  },
  {
    id: "B", title: "Konushorn mit Kompressionskammer",
    segments: [{ S1: 20, S2: 800, L: 50, flare: "Con" }], driver: { ...noChambers, Vtc: 10, Atc: 45 },
  },
  {
    id: "C", title: "Konus + Exponential (Knick in S(x)), ohne Kammern",
    segments: [{ S1: 20, S2: 100, L: 10, flare: "Con" }, { S1: 100, S2: 1200, L: 50, flare: "Exp" }], driver: noChambers,
  },
];

const fmt = (v, d) => v.toFixed(d).replace(".", ",");
const d = PLACEHOLDER_DRIVER;
let md = `# Hornresp-Referenz

Erzeugt mit \`node scripts/hornresp-referenz.js\`. Zweck: Prüfen, ob der 1D-Solver (\`src/simulation.js\`)
dasselbe rechnet wie Hornresp. Alle Fälle mit dem **Platzhalter-Treiber** (keine echten Daten).

## Gemeinsame Eingaben

| Hornresp | Wert | Hinweis |
|---|---|---|
| Ang | 2,0 × Pi | Kolben in unendlicher Schallwand |
| Eg | 2,83 V | |
| Rg | 0 Ω | |
| Sd | ${fmt(d.Sd, 2)} cm² | |
| Bl | ${fmt(d.Bl, 2)} T·m | |
| Cms | ${(d.Cms * 1e-6).toExponential(2).replace(".", ",")} m/N | |
| Rms | ${fmt(d.Rms, 2)} N·s/m | |
| Mmd | ${fmt(d.mass, 2)} g | ohne Luftlast |
| Le | ${fmt(d.Le, 3)} mH | einfache Induktivität (kein Semi-Inductance-Modell) |
| Re | ${fmt(d.Re, 2)} Ω | |
| Nd | 1 | |
| Vrc, Lrc | 0 | keine Rückkammer – in Hornresp prüfen, dass die Rückseite unbelastet bleibt |
| Luft | c = ${fmt(AIR.c, 2)} m/s, ρ = ${fmt(AIR.rho, 4)} kg/m³ | 20 °C, in Hornresp unter den Optionen gleich einstellen |

SPL bei 1 m, Phase ohne Laufzeit über 1 m. Impedanz = elektrische Eingangsimpedanz.
`;

mkdirSync("docs/hornresp", { recursive: true });
for (const c of CASES) {
  const curve = curveOf(c.segments);
  const r = simulate({ curve, air: AIR, driver: driverSI(c.driver, AIR.rho), mouth: "2pi", freqs: FREQS });
  writeFileSync(`docs/hornresp/fall-${c.id}.csv`, buildCSV(r));

  const segRows = c.segments.map((s, i) =>
    `| S${i + 1} = ${fmt(s.S1, 2)} cm² | S${i + 2} = ${fmt(s.S2, 2)} cm² | L${i + 1}${i + 2} = ${fmt(s.L, 2)} cm | ${s.flare} |`).join("\n");
  md += `
## Fall ${c.id}: ${c.title}

| Fläche | Fläche | Länge | Flare |
|---|---|---|---|
${segRows}

Kompressionskammer: ${c.driver.Vtc > 0 ? `Vtc = ${fmt(c.driver.Vtc, 2)} cm³, Atc = ${fmt(c.driver.Atc, 2)} cm²` : "Vtc = 0, Atc = 0"}

| f [Hz] | SPL [dB] | Phase [°] | \\|Z\\| [Ω] | Phase Z [°] |
|---:|---:|---:|---:|---:|
${CHECK.map(f => {
    const i = FREQS.reduce((b, v, k) => Math.abs(Math.log(v / f)) < Math.abs(Math.log(FREQS[b] / f)) ? k : b, 0);
    return `| ${fmt(FREQS[i], 1)} | ${fmt(r.spl[i], 2)} | ${fmt(r.phase[i], 1)} | ${fmt(abs(r.zel[i]), 2)} | ${fmt(arg(r.zel[i]) * 180 / Math.PI, 1)} |`;
  }).join("\n")}

Voller Frequenzgang: [hornresp/fall-${c.id}.csv](hornresp/fall-${c.id}.csv)
`;
}
writeFileSync("docs/hornresp-referenz.md", md);
console.log("docs/hornresp-referenz.md und docs/hornresp/*.csv geschrieben");
