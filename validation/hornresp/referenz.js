// Referenzdokument für den Vergleich mit Hornresp: schreibt validation/hornresp/referenz.md (Eingaben,
// Stützwerte, Stand des Abgleichs) und je Fall modell-<Fall>.csv mit dem vollen Frequenzgang.
//   npm run hornresp
// Die Werte folgen Hornresps Konventionen (modell.js), damit sie direkt mit der Hornresp-Anzeige
// vergleichbar sind; die Spalte „App“ zeigt das Horn allein wie in der App. Liegt für einen Fall eine
// Referenzdatei hornresp-<Fall>.csv vor, steht die gemessene Abweichung im Dokument.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { logFrequencies, simulate, driverSI, PLACEHOLDER_DRIVER } from "../../src/simulation.js";
import { AIR, CASES, HORNRESP, curveOf } from "./faelle.js";
import { hornrespResponse, parseReferenceCsv } from "./modell.js";

const DIR = "validation/hornresp";
const FREQS = logFrequencies(20, 20000, 24);
const CHECK = [100, 200, 300, 500, 700, 1000, 2000, 5000, 10000, 20000];
const fmt = (v, dg) => v.toFixed(dg).replace(".", ",");

/** Stand eines Falls: größte Abweichung gegen die Hornresp-Referenzdatei, falls vorhanden. */
function status(c, curve, driver) {
  const file = `${DIR}/hornresp-${c.id}.csv`;
  if (!existsSync(file)) return "offen (keine Referenzdatei)";
  const ref = parseReferenceCsv(readFileSync(file, "utf8"));
  const r = hornrespResponse({ curve, air: AIR, driver, freqs: ref.map(d => d.f_Hz) });
  let dSpl = 0, dZe = 0, dZa = 0;
  ref.forEach((d, i) => {
    dSpl = Math.max(dSpl, Math.abs(r.spl[i] - d.SPL_dB));
    dZe = Math.max(dZe, Math.abs(r.ze[i] / d.Ze_Ohm - 1));
    dZa = Math.max(dZa, Math.abs(r.ra[i] - d.Ra_norm), Math.abs(r.xa[i] - d.Xa_norm));
  });
  return `geprüft, ${ref.length} Frequenzen: max. ΔSPL ${fmt(dSpl, 4)} dB, ΔZe ${fmt(dZe * 100, 4)} %, ΔZa ${dZa.toExponential(1)}`;
}

const d = PLACEHOLDER_DRIVER;
const sections = [];
const rows = [];
for (const c of CASES) {
  const curve = curveOf(c.segments);
  const driver = driverSI(c.driver, AIR.rho);
  rows.push(`| ${c.id}: ${c.title} | ${status(c, curve, driver)} |`);

  const hr = hornrespResponse({ curve, air: AIR, driver, freqs: FREQS });
  const app = simulate({ curve, air: AIR, driver, mouth: "2pi", freqs: FREQS, adaptive: false });
  writeFileSync(`${DIR}/modell-${c.id}.csv`, ["f_Hz,SPL_Hornresp_dB,Ze_Ohm,Ra_norm,Xa_norm,SPL_App_dB",
    ...FREQS.map((f, i) => [f.toFixed(3), hr.spl[i].toFixed(3), hr.ze[i].toFixed(4), hr.ra[i].toFixed(5), hr.xa[i].toFixed(5), app.spl[i].toFixed(3)].join(","))].join("\n") + "\n");
  const chk = hornrespResponse({ curve, air: AIR, driver, freqs: CHECK });
  const chkApp = simulate({ curve, air: AIR, driver, mouth: "2pi", freqs: CHECK, adaptive: false });

  const segRows = c.segments.map((s, i) =>
    `| S${i + 1} = ${fmt(s.S1, 2)} cm² | S${i + 2} = ${fmt(s.S2, 2)} cm² | L${i + 1}${i + 2} = ${fmt(s.L, 2)} cm | ${s.flare} |`).join("\n");
  sections.push(`
## Fall ${c.id}: ${c.title}

| Fläche | Fläche | Länge | Flare |
|---|---|---|---|
${segRows}

Kompressionskammer: ${c.driver.Vtc > 0 ? `Vtc = ${fmt(c.driver.Vtc, 2)} cm³, Atc = ${fmt(c.driver.Atc, 2)} cm²` : "Vtc = 0, Atc = 0"}

| f [Hz] | SPL Hornresp [dB] | Ze [Ω] | Ra (norm) | SPL App, Horn allein [dB] |
|---:|---:|---:|---:|---:|
${CHECK.map((f, i) => `| ${f} | ${fmt(chk.spl[i], 2)} | ${fmt(chk.ze[i], 2)} | ${fmt(chk.ra[i], 3)} | ${fmt(chkApp.spl[i], 2)} |`).join("\n")}

Voller Frequenzgang des Modells: [modell-${c.id}.csv](modell-${c.id}.csv)${existsSync(`${DIR}/hornresp-${c.id}.csv`) ? `, Hornresp-Referenz: [hornresp-${c.id}.csv](hornresp-${c.id}.csv)` : ""}
`);
}

const md = `# Hornresp-Referenz

Erzeugt mit \`npm run hornresp\` – nicht von Hand bearbeiten. Zweck: Prüfen, ob der 1D-Solver
(\`src/simulation.js\`) dasselbe rechnet wie Hornresp ${HORNRESP.version}. Alle Fälle mit dem
**Platzhalter-Treiber** (keine echten Daten). Hintergrund und Vorgehen: [../README.md](../README.md).

| Fall | Stand |
|---|---|
${rows.join("\n")}

## Hornresps Konventionen (Vrc = 0)

- **Rückseite offen:** Ohne Rückkammer strahlt die Membranrückseite frei ab (Kolben, 2π). Das belastet
  die Membran und wird zum Horn addiert (Ausgabe „Combined“). Die App lässt die Rückseite unbelastet
  und stumm (Kompressionstreiber: die Rückkammer steckt in den gemessenen Thiele-Small-Werten).
  Die Tabellen unten folgen Hornresp, die Spalte **App** zeigt das Horn allein wie in der App.
- **SPL aus der Leistung** („constant directivity SPL“): je Quelle |p| = √(W·ρc/Ω)/r. Die App rechnet
  ebenso.
- **Kompressionskammer** als kurzes Rohr (Fläche Atc, Länge Vtc/Atc) – wie die App.
- **Luft:** c = ${AIR.c} m/s, ρ = ${fmt(AIR.rho, 3)} kg/m³, in Hornresp fest eingebaut. Die Referenz rechnet mit
  diesen Werten, in Hornresp nichts umstellen.

## Gemeinsame Eingaben

| Hornresp | Wert | Hinweis |
|---|---|---|
| Ang | 2,0 × Pi | |
| Eg | 2,83 V | |
| Rg | 0 Ω | |
| Sd | ${fmt(d.Sd, 2)} cm² | „CAUTION: S1 < Sd“ ist nur ein Hinweis |
| Bl | ${fmt(d.Bl, 2)} T·m | |
| Cms | ${(d.Cms * 1e-6).toExponential(2).replace(".", ",")} m/N | |
| Rms | ${fmt(d.Rms, 2)} N·s/m | |
| Mmd | ${fmt(d.mass, 2)} g | ohne Luftlast |
| Le | ${fmt(d.Le, 3)} mH | |
| Re | ${fmt(d.Re, 2)} Ω | |
| Nd | 1 | |
| Vrc, Lrc | 0 | keine Rückkammer (Rückseite offen, siehe oben) |
| Fr, Tal | Standard lassen | ohne Rückkammer ohne Wirkung |

Einen Konus als **zwei Con-Segmente** gleicher Steigung von √S eingeben: Hornresp lehnt ein einzelnes
Segment mit S3 = 0 ab („ERROR: S3 = 0,00“). Den Flare-Typ eines Segments ändert ein Doppelklick auf seine
Beschriftung. Rechnen mit **Calculate**; bei Kammer-Resonanzen „nicht maskieren“ (Nein). Werte über das
**Sample**-Fenster bei genau den Frequenzen der Tabelle ablesen.
${sections.join("")}`;

writeFileSync(`${DIR}/referenz.md`, md);
console.log(`${DIR}/referenz.md und modell-*.csv geschrieben`);
