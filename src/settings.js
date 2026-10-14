// Gespeicherte Einstellungen: jeder Wert unter eigenem Schlüssel im localStorage, damit die
// App beim nächsten Start dort weitermacht, wo man aufgehört hat. Beim Laden wird jeder Wert
// gegen seinen Standard geprüft – kaputte oder veraltete Einträge fallen auf den Standard zurück.
//
// Desktop-App: zusätzlich als Datei im Konfigurationsordner der App (initSettings, Rust-Befehle
// load_settings/save_settings). Den Speicher von WebView2 allein kann eine Neuinstallation, eine
// verworfene Datenbank oder eine geänderte App-Kennung leeren – die App begänne dann kommentarlos
// mit Standardwerten. Beim Start gewinnt die neuere der beiden Quellen (Zeitstempel SAVED_AT),
// danach spiegelt jede Änderung den Speicher verzögert in die Datei.

const PREFIX = "radialhorn.v1.";
const SAVED_AT = "__savedAt";          // Zeitpunkt der letzten Änderung [ms], im Speicher und in der Datei
const FILE_FORMAT = "radialhorn-settings";
const SAVE_DELAY = 250;                // ms Ruhe, bis die Datei geschrieben wird (Regler schreiben beim Ziehen laufend)

/** localStorage, falls verfügbar (im Test oder bei gesperrtem Speicher: null). */
function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** Eigene Schlüssel im Speicher (mit PREFIX). */
const ownKeys = storage => Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(k => k?.startsWith(PREFIX));

/**
 * Gespeicherten Wert lesen und prüfen. Zahlen müssen endlich sein, Typ wie der Standard;
 * null ist erlaubt, wenn Standard oder Wert null ist (z.B. „automatisch“). Objekte
 * (Layer-Auswahl) werden mit dem Standard zusammengeführt, nur bekannte Schlüssel gleichen Typs.
 */
export function readSetting(key, initial, storage = defaultStorage()) {
  let value;
  try {
    const raw = storage?.getItem(PREFIX + key);
    if (raw == null) return initial;
    value = JSON.parse(raw);
  } catch { return initial; }
  return checkSetting(value, initial);
}

/**
 * Wert gegen seinen Standard prüfen (Regeln wie bei readSetting); passt er nicht, der Standard.
 * Auch für Projektdateien (project.js).
 */
export function checkSetting(value, initial) {
  if (value === undefined) return initial;
  if (value === null) return initial === null || typeof initial === "number" ? value : initial;
  if (initial !== null && typeof initial === "object") {
    if (typeof value !== "object" || Array.isArray(value)) return initial;
    const merged = { ...initial };
    for (const k of Object.keys(initial)) if (typeof value[k] === typeof initial[k]) merged[k] = value[k];
    return merged;
  }
  const type = initial === null ? "number" : typeof initial;
  if (typeof value !== type) return initial;
  if (type === "number" && !Number.isFinite(value)) return initial;
  return value;
}

/** Wert speichern; unveränderte Werte (jeder Start schreibt alle einmal) lösen nichts aus. */
export function writeSetting(key, value, storage = defaultStorage()) {
  try {
    const raw = JSON.stringify(value);
    if (!storage || storage.getItem(PREFIX + key) === raw) return;
    storage.setItem(PREFIX + key, raw);
    changed(storage);
  } catch { /* Speicher voll oder gesperrt */ }
}

/**
 * Alle gespeicherten Einstellungen löschen – mit Einstellungsdatei auch dort. Das Ergebnis
 * abwarten, bevor neu geladen wird (sonst käme die Datei beim nächsten Start zurück).
 */
export function clearSettings(storage = defaultStorage()) {
  try {
    if (!storage) return Promise.resolve();
    for (const k of ownKeys(storage)) storage.removeItem(k);
  } catch { return Promise.resolve(); }
  return file && file.storage === storage ? writeFile(file.now()) : Promise.resolve();
}

// ──────────────────────────────────────────────────────────────────
// EINSTELLUNGSDATEI (Desktop-App)
// ──────────────────────────────────────────────────────────────────

/** Aktive Einstellungsdatei: { load, save, storage, now, delay, timer } oder null (Web-Version, Tests). */
let file = null;

/**
 * Einstellungsdatei anbinden, vor dem ersten Rendern abwarten. Gewinnt die Datei (neuer als der
 * Speicher oder der Speicher leer), ersetzt sie den Speicher; ist der Speicher neuer oder fehlt
 * die Datei bzw. ist sie unlesbar, wird sie aus dem Speicher (neu) geschrieben. Lässt sich die
 * Datei nicht lesen (Fehler, nicht „fehlt“), bleibt sie in dieser Sitzung unberührt – lieber
 * ohne Spiegel als eine vorhandene Datei überschreiben.
 * @param load   () ⇒ Promise<string | null>  Inhalt der Datei, null wenn es sie nicht gibt
 * @param save   text ⇒ Promise               Datei schreiben
 * @returns {Promise<"file" | "storage">}  welche Quelle gewonnen hat
 */
export async function initSettings({ load, save, storage = defaultStorage(), now = Date.now, delay = SAVE_DELAY }) {
  if (!storage) return "storage";
  const text = await load();   // Fehler gehen an den Aufrufer, die Datei bleibt dann außen vor
  file = { save, storage, now, delay, timer: 0 };
  const data = parseFile(text);
  const localAt = Number(storage.getItem(PREFIX + SAVED_AT)) || 0;
  if (data && data.savedAt >= localAt) {
    for (const k of ownKeys(storage)) storage.removeItem(k);
    for (const [key, value] of Object.entries(data.values)) storage.setItem(PREFIX + key, JSON.stringify(value));
    storage.setItem(PREFIX + SAVED_AT, String(data.savedAt));
    return "file";
  }
  await writeFile();
  return "storage";
}

/** Einstellungsdatei lösen (Tests; ausstehendes Schreiben verfällt). */
export function detachSettingsFile() {
  if (file) clearTimeout(file.timer);
  file = null;
}

/** Inhalt der Datei prüfen: { savedAt, values } oder null (leer, kein JSON, falsches Format). */
function parseFile(text) {
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    if (data?.format !== FILE_FORMAT || !Number.isFinite(data.savedAt) || !data.values || typeof data.values !== "object") return null;
    return data;
  } catch { return null; }
}

/** Nach einer Änderung im Speicher: Zeitstempel setzen, Datei verzögert schreiben. */
function changed(storage) {
  if (!file || file.storage !== storage) return;
  storage.setItem(PREFIX + SAVED_AT, String(file.now()));
  clearTimeout(file.timer);
  file.timer = setTimeout(() => writeFile(), file.delay);
}

/** Speicher als Datei schreiben (Schlüssel sortiert, lesbar eingerückt). savedAt: sonst der Stempel im Speicher. */
function writeFile(savedAt) {
  const f = file;
  clearTimeout(f.timer);
  const values = {};
  for (const k of ownKeys(f.storage).sort()) {
    if (k === PREFIX + SAVED_AT) continue;
    try { values[k.slice(PREFIX.length)] = JSON.parse(f.storage.getItem(k)); } catch { /* kaputter Eintrag: weglassen */ }
  }
  const stamp = savedAt ?? (Number(f.storage.getItem(PREFIX + SAVED_AT)) || f.now());
  const text = JSON.stringify({ format: FILE_FORMAT, version: 1, savedAt: stamp, values }, null, 2) + "\n";
  return Promise.resolve(f.save(text)).catch(e => console.error("Einstellungsdatei:", e));
}
