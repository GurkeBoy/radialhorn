// Gespeicherte Einstellungen: jeder Wert unter eigenem Schlüssel im localStorage, damit die
// App beim nächsten Start dort weitermacht, wo man aufgehört hat. Beim Laden wird jeder Wert
// gegen seinen Standard geprüft – kaputte oder veraltete Einträge fallen auf den Standard zurück.

const PREFIX = "radialhorn.v1.";

/** localStorage, falls verfügbar (im Test oder bei gesperrtem Speicher: null). */
function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

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

export function writeSetting(key, value, storage = defaultStorage()) {
  try { storage?.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* Speicher voll oder gesperrt */ }
}

/** Alle gespeicherten Einstellungen löschen. */
export function clearSettings(storage = defaultStorage()) {
  try {
    if (!storage) return;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(k => k?.startsWith(PREFIX));
    for (const k of keys) storage.removeItem(k);
  } catch { /* gesperrt */ }
}
