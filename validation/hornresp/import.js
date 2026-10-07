// Hornresp-Export → Referenzdatei validation/hornresp/hornresp-<Fall>.csv: nur die geprüften Spalten
// (Werte unverändert, Dezimalpunkt), dazu ein Kopf zur Herkunft (Version, Eingaben, Einstellungen).
//   npm run hornresp:import -- <Fall A|B|C> <Pfad zum Hornresp-Export .txt>
// Hornresp legt Exporte unter <Hornresp-Ordner>\Export\ ab (Acoustical Power, Combined).
import { readFileSync, writeFileSync } from "node:fs";
import { AIR, CASES, GEMEINSAM, HORNRESP, hornrespInputs } from "./faelle.js";
import { REFERENCE_COLUMNS, parseHornrespExport } from "./modell.js";

const [id, file] = process.argv.slice(2);
const c = CASES.find(k => k.id === id);
if (!c || !file) {
  console.error(`Aufruf: npm run hornresp:import -- <${CASES.map(k => k.id).join("|")}> <Hornresp-Export.txt>`);
  process.exit(1);
}

const rows = parseHornrespExport(readFileSync(file, "latin1"));
for (const [, col] of REFERENCE_COLUMNS) {
  if (!(col in rows[0])) throw new Error(`Spalte „${col}“ fehlt im Export – Export aus dem Acoustical-Power-Fenster?`);
}
const header = [
  `# Hornresp ${HORNRESP.version} (Produktnummer ${HORNRESP.produkt}), exportiert ${HORNRESP.exportiert}`,
  `# Referenzfall ${c.id}: ${c.title}`,
  "# Hornresp ist ein eigenständiges Programm von David J McBean; dieses Projekt steht in keiner Verbindung",
  "# dazu. Die Werte sind mit Hornresp berechnete Ergebnisse für die unten genannten Eingaben und dienen",
  "# nur dem Vergleich (validation/hornresp/hornresp.test.js).",
  "# Mit freundlicher Genehmigung von David J McBean (E-Mail, Oktober 2026).",
  "#",
  `# Eingaben: ${hornrespInputs(c).map(([k, v]) => `${k} = ${v}`).join(", ")}`,
  "# Einheiten wie in Hornresp: S cm², L cm, Sd cm², Cms m/N, Mmd g, Le mH, Vtc cm³, Atc cm²",
  `# Einstellungen: ${Object.entries(GEMEINSAM).filter(([k]) => !hornrespInputs(c).some(([q]) => q === k)).map(([k, v]) => `${k}: ${v}`).join("; ")}`,
  `# Luft (in Hornresp fest): c = ${AIR.c} m/s, rho = ${AIR.rho} kg/m³`,
  "# Spalten: f [Hz], Halsimpedanz Ra/Xa normiert auf rho·c/S1, elektrische Impedanz |Ze| [Ohm], SPL [dB] bei 1 m",
];
const lines = rows.map(r => REFERENCE_COLUMNS.map(([, col]) => r[col].replace(",", ".")).join(","));
const out = `validation/hornresp/hornresp-${c.id}.csv`;
writeFileSync(out, [...header, REFERENCE_COLUMNS.map(([name]) => name).join(","), ...lines].join("\n") + "\n");
console.log(`${out}: ${lines.length} Frequenzen`);
