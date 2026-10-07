import { describe, it, expect } from "vitest";
import { LANGUAGES, detectLanguage, translate } from "./i18n.js";

const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const reference = LANGUAGES.de.dict;

describe("i18n", () => {
  for (const [code, { dict }] of Object.entries(LANGUAGES)) {
    it(`${code}: dieselben Schlüssel wie Deutsch, keine leeren Texte`, () => {
      expect(Object.keys(dict).sort()).toEqual(Object.keys(reference).sort());
      for (const [key, text] of Object.entries(dict)) {
        expect(typeof text, key).toBe("string");
        expect(text.trim().length, key).toBeGreaterThan(0);
      }
    });

    it(`${code}: dieselben Platzhalter wie Deutsch`, () => {
      for (const key of Object.keys(reference)) expect(placeholders(dict[key]), key).toEqual(placeholders(reference[key]));
    });
  }

  it("translate: Platzhalter, Rückfall auf Deutsch und auf den Schlüssel", () => {
    expect(translate("de", "warn.ltMax", { mm: 120 })).toBe("Lₜ-Maximum erreicht (120 mm)");
    expect(translate("en", "warn.ltMax", { mm: 120 })).toBe("Lₜ maximum reached (120 mm)");
    expect(translate("xx", "card.export")).toBe("EXPORT");
    expect(translate("en", "gibt.es.nicht")).toBe("gibt.es.nicht");
    expect(translate("de", "warn.ltMax")).toBe("Lₜ-Maximum erreicht ({mm} mm)");   // ohne params unverändert
  });

  it("detectLanguage: de-* → Deutsch, alles andere → Englisch", () => {
    expect(detectLanguage("de-DE")).toBe("de");
    expect(detectLanguage("de-AT")).toBe("de");
    expect(detectLanguage("en-US")).toBe("en");
    expect(detectLanguage("fr-FR")).toBe("en");
    expect(detectLanguage("")).toBe("en");   // keine Systemsprache
  });
});
