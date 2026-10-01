import { describe, it, expect } from "vitest";
import { readSetting, writeSetting, clearSettings } from "./settings.js";

/** Minimaler Speicher mit der localStorage-Schnittstelle. */
function memoryStorage() {
  const data = new Map();
  return {
    getItem: k => data.has(k) ? data.get(k) : null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
    key: i => [...data.keys()][i] ?? null,
    get length() { return data.size; },
    data,
  };
}

describe("Einstellungen speichern", () => {
  it("ohne Eintrag gilt der Standard, geschriebene Werte kommen zurück", () => {
    const st = memoryStorage();
    expect(readSetting("L", 500, st)).toBe(500);
    writeSetting("L", 420, st);
    writeSetting("curve", "hypex", st);
    writeSetting("filletOn", true, st);
    expect(readSetting("L", 500, st)).toBe(420);
    expect(readSetting("curve", "exponential", st)).toBe("hypex");
    expect(readSetting("filletOn", false, st)).toBe(true);
  });

  it("falscher Typ, kaputtes JSON, NaN → Standard", () => {
    const st = memoryStorage();
    st.setItem("radialhorn.v1.L", '"abc"');
    st.setItem("radialhorn.v1.dw", "{kaputt");
    st.setItem("radialhorn.v1.dh", "1e999");
    expect(readSetting("L", 500, st)).toBe(500);
    expect(readSetting("dw", 182, st)).toBe(182);
    expect(readSetting("dh", 90, st)).toBe(90);
  });

  it("null (automatisch) bei Zahlenwerten, Zahl bei Standard null", () => {
    const st = memoryStorage();
    writeSetting("flangeD", 200, st);
    expect(readSetting("flangeD", null, st)).toBe(200);
    writeSetting("holeCircle", null, st);
    expect(readSetting("holeCircle", 101.6, st)).toBe(null);
    writeSetting("curve", null, st);
    expect(readSetting("curve", "exponential", st)).toBe("exponential");
  });

  it("Layer-Auswahl: mit dem Standard zusammengeführt, nur bekannte Schlüssel", () => {
    const st = memoryStorage();
    writeSetting("layers", { fokus: false, alt: true, mundbogen: "ja" }, st);
    expect(readSetting("layers", { fokus: true, mundbogen: true, flansch: true }, st))
      .toEqual({ fokus: false, mundbogen: true, flansch: true });
  });

  it("Zurücksetzen löscht nur die eigenen Einträge; ohne Speicher kein Fehler", () => {
    const st = memoryStorage();
    writeSetting("L", 420, st);
    st.setItem("fremd", "1");
    clearSettings(st);
    expect([...st.data.keys()]).toEqual(["fremd"]);
    expect(readSetting("L", 500, null)).toBe(500);
    expect(() => writeSetting("L", 1, null)).not.toThrow();
  });
});
