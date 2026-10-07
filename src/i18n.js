// Sprachen der Oberfläche: Wörterbücher in locales/, Auswahl über React-Context. Ohne Bibliothek –
// ein Schlüssel je Text, Platzhalter {name} werden mit params ersetzt.
//
// Neue Sprache: locales/<code>.js mit denselben Schlüsseln wie de.js anlegen und in LANGUAGES
// eintragen; i18n.test.js prüft, dass kein Schlüssel und kein Platzhalter fehlt.
import { createContext, useContext, useMemo } from "react";
import de from "./locales/de.js";
import en from "./locales/en.js";

/** Verfügbare Sprachen: Kürzel → { name (in der eigenen Sprache), locale (Datum), dict }. */
export const LANGUAGES = {
  de: { name: "Deutsch", locale: "de-DE", dict: de },
  en: { name: "English", locale: "en-GB", dict: en },
};

/** Sprache aus der Systemsprache: Deutsch für de-*, sonst Englisch. */
export function detectLanguage(systemLanguage = globalThis.navigator?.language) {
  return String(systemLanguage ?? "").toLowerCase().startsWith("de") ? "de" : "en";
}

/** Text zum Schlüssel in der Sprache lang; fehlt er, Deutsch, sonst der Schlüssel selbst. */
export function translate(lang, key, params) {
  const text = LANGUAGES[lang]?.dict[key] ?? de[key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m)) : text;
}

export const LanguageContext = createContext("de");

/** Übersetzungsfunktion t(key, params) der aktuellen Sprache. */
export function useT() {
  const lang = useContext(LanguageContext);
  return useMemo(() => (key, params) => translate(lang, key, params), [lang]);
}

/** Aktuelle Sprache (Kürzel). */
export const useLanguage = () => useContext(LanguageContext);
