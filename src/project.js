// Projektdateien: ein Entwurf als JSON (*.radialhorn.json) zum Speichern, Öffnen und Teilen.
// Enthält alles, was das Horn festlegt – nicht persönliche Einstellungen (Sprache, eingeklappte
// Karten, Export-Auswahl, Ansicht an/aus). Beim Öffnen wird jeder Wert nach denselben Regeln geprüft
// wie gespeicherte Einstellungen (settings.js); ungültige oder fehlende Werte → Standard.
import { checkSetting, readSetting, writeSetting } from "./settings.js";
import { CURVES, lengthOffset } from "./horn-math.js";
import { PLACEHOLDER_DRIVER } from "./simulation.js";
import { fmtLength } from "./utils.js";
import { MATERIAL_KEYS } from "./wall-advice.js";

export const PROJECT_FORMAT = "radialhorn-project";
/** 2: L ohne Raumecke ab der Treiberrückseite (in Version 1 ab der Hut-Spitze, dw/2 dahinter). */
export const PROJECT_VERSION = 2;
export const PROJECT_EXTENSION = ".radialhorn.json";

/**
 * L aus der Zeit vor Version 2 umrechnen: ohne Raumecke zählte L ab der Hut-Spitze, jetzt ab der
 * Treiberrückseite – um dw/2 kürzer, das Horn bleibt dasselbe. Mit Raumecke unverändert.
 */
export const legacyLength = (L, dw, showRaumecke) => L - lengthOffset(dw, showRaumecke);

/**
 * Gespeicherte Einstellungen einmalig auf den aktuellen Stand bringen (Schlüssel "schema", fehlt =
 * Stand 1). Vor dem ersten Rendern aufrufen (main.jsx), nach initSettings.
 */
export function migrateSettings(storage) {
  if (readSetting("schema", 1, storage) >= 2) return;
  const L = readSetting("L", null, storage);
  if (L !== null) {
    writeSetting("L", legacyLength(L, readSetting("dw", DESIGN_DEFAULTS.dw, storage),
      readSetting("showRaumecke", DESIGN_DEFAULTS.showRaumecke, storage)), storage);
  }
  writeSetting("schema", 2, storage);
}

/**
 * Entwurf: Schlüssel (wie die gespeicherten Einstellungen) → Standardwert. Einzige Quelle für die
 * Standardwerte dieser Einstellungen in App.jsx.
 */
export const DESIGN_DEFAULTS = {
  throatDiam: 50.8,
  throatCustom: false,
  morphOn: false,          // Übergang rund → eckig am Throat
  morphLength: null,       // Länge entlang der Wand [mm]; null: Throat-Durchmesser
  mouthRoundOn: false,     // Ecken am Mund gerundet (weicher Übergang vom Throat)
  mouthRoundR: 20,         // Eckradius am Mund [mm]
  openingAngle: 140,
  L: 500,
  Lt: 60,
  dw: 182,                 // BMS 4591: Ø 182 mm
  dh: 90,                  // BMS 4591: Tiefe 90 mm
  hMouth: 200,
  curve: "exponential",
  hypexT: 0.5,
  showRaumecke: true,
  showWandstaerke: false,
  wandstaerke: 20,
  filletOn: false,
  filletR: 100,
  clothoidOn: false,
  clothoidLength: 30,
  edgeOn: false,
  edgeR: null,             // null: Wandstärke
  flangeOn: false,
  flangeD: null,           // null: Treiberbreite dw, mind. Schale + Bohrungen
  flangeT: 10,
  holeCount: 4,
  holeCircle: 101.6,       // Bohrbild BMS 4591: 4 × M6 auf Ø 101,6 mm; null: mittig im Flanschring
  holeD: 6.6,
  holeAngle: 0,            // 0°: Bohrungen auf 3, 12, 9, 6 Uhr
  ribsOn: false,           // Stützrippen am Flansch, mittig zwischen den Bohrungen (so viele wie Bohrungen)
  ribThickness: 4,
  roundOn: false,          // Verrundungen auf der Hornseite des Flanschs (Plattenkanten, Rippen)
  roundR: 2,
  wallMaterial: "pla",     // Werkstoff der Wandstärke-Empfehlung (wall-advice.js: MATERIAL_KEYS)
  wallE: 3,                // eigener Werkstoff: E-Modul [GPa]
  wallRho: 1250,           // eigener Werkstoff: Dichte [kg/m³]
  wallLimit: 5,            // zulässige Nachgiebigkeit der Wand [%]
  ribLength: 30,           // entlang des Horns ab der Plattenfläche, soweit die Wand unter dem Flanschrand bleibt
  abstrahlung: "auto",
  simTemp: 20,
  driver: PLACEHOLDER_DRIVER,
};

// Werte, die nach der ersten Fassung des Formats dazugekommen sind und deren Standard genau das
// frühere Verhalten ergibt (runder Throat aus): fehlen sie in einer älteren Datei, wird still der
// Standard eingesetzt – der Entwurf ist dann genau der gespeicherte, es gibt nichts zu melden.
// Fehlt dagegen ein Wert, den es von Anfang an gab, ist die Datei beschädigt oder bearbeitet.
export const ADDED_LATER = new Set(["morphOn", "morphLength", "mouthRoundOn", "mouthRoundR", "ribsOn", "ribThickness", "ribLength", "roundOn", "roundR", "wallMaterial", "wallE", "wallRho", "wallLimit"]);

// Werte, für die null „automatisch“ bedeutet; sonst ist null ungültig (ein Regler mit null bräche)
const NULLABLE = new Set(["morphLength", "edgeR", "flangeD", "holeCircle"]);

// Werte, die aus einer festen Auswahl kommen müssen (der Code verzweigt danach)
const CHOICES = {
  curve: CURVES,
  abstrahlung: ["auto", "4pi", "2pi", "pi", "pi/2"],
  "driver.massIs": ["Mmd", "Mms"],
  wallMaterial: MATERIAL_KEYS,
};

/** Projektdatei (Text) aus dem aktuellen Entwurf. */
export function buildProject(design, { appVersion = "", date = new Date() } = {}) {
  const out = {};
  for (const key of Object.keys(DESIGN_DEFAULTS)) out[key] = design[key] ?? DESIGN_DEFAULTS[key];
  return JSON.stringify({
    format: PROJECT_FORMAT, version: PROJECT_VERSION, app: appVersion, saved: date.toISOString(), design: out,
  }, null, 2) + "\n";
}

/** Vorschlag für den Dateinamen, z. B. radialhorn_140deg_L500.radialhorn.json. */
export const projectFileName = design =>
  `radialhorn_${design.openingAngle}deg_L${fmtLength(design.L)}${PROJECT_EXTENSION}`;

/** Fehler beim Öffnen: code = "json" (kein JSON) | "format" (keine Radialhorn-Projektdatei). */
export class ProjectError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/**
 * Projektdatei lesen und prüfen.
 * @returns {{ design, invalid: string[], missing: string[], newer: boolean }}
 *   design vollständig (jeder Schlüssel aus DESIGN_DEFAULTS); invalid/missing: Schlüssel, für die
 *   der Standard eingesetzt wurde (später dazugekommene Werte fehlen still, ADDED_LATER); newer:
 *   Datei aus einer neueren Formatversion
 * @throws {ProjectError}
 */
export function parseProject(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new ProjectError("json"); }
  if (!data || typeof data !== "object" || data.format !== PROJECT_FORMAT || typeof data.design !== "object" || !data.design) {
    throw new ProjectError("format");
  }
  const design = {}, invalid = [], missing = [];
  for (const [key, initial] of Object.entries(DESIGN_DEFAULTS)) {
    const value = data.design[key];
    if (value === undefined) { design[key] = initial; if (!ADDED_LATER.has(key)) missing.push(key); continue; }
    let checked = value === null && NULLABLE.has(key) ? null : checkSetting(value, initial);
    if (value === null && !NULLABLE.has(key)) {
      // eine Datei kann von überall kommen: null nur bei automatischen Werten
      checked = initial;
      invalid.push(key);
    } else if (initial !== null && typeof initial === "object" && (typeof value !== "object" || value === null || Array.isArray(value))) {
      checked = initial;
      invalid.push(key);
    } else if (initial !== null && typeof initial === "object") {
      // Objekte (Treiber): je Feld prüfen, ungültige Felder einzeln melden
      for (const k of Object.keys(initial)) {
        const ok = typeof value?.[k] === typeof initial[k] && (typeof value[k] !== "number" || Number.isFinite(value[k]))
          && (!CHOICES[`${key}.${k}`] || CHOICES[`${key}.${k}`].includes(value[k]));
        if (!ok) { checked = { ...checked, [k]: initial[k] }; invalid.push(`${key}.${k}`); }
      }
    } else if (checked !== value || (CHOICES[key] && !CHOICES[key].includes(value))) {
      checked = initial;
      invalid.push(key);
    }
    design[key] = checked;
  }
  // vor Version 2 zählte L ohne Raumecke ab der Hut-Spitze (fehlende Version: die erste)
  if (!(Number(data.version) >= 2)) design.L = legacyLength(design.L, design.dw, design.showRaumecke);
  return { design, invalid, missing, newer: Number(data.version) > PROJECT_VERSION };
}
