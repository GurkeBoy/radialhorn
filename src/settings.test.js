import { describe, it, expect, vi, afterEach } from "vitest";
import { readSetting, writeSetting, clearSettings, initSettings, detachSettingsFile } from "./settings.js";

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

/** Einstellungsdatei im Speicher: load/save wie die Rust-Befehle, Inhalt in text. */
function memoryFile(text = null) {
  const f = { text, saves: 0 };
  f.load = async () => f.text;
  f.save = async t => { f.text = t; f.saves++; };
  return f;
}
const fileValues = f => JSON.parse(f.text).values;

describe("Einstellungsdatei (Desktop-App)", () => {
  afterEach(() => { detachSettingsFile(); vi.useRealTimers(); });

  it("fehlt die Datei: aus dem Speicher angelegt (Übernahme bestehender Einstellungen)", async () => {
    const st = memoryStorage(), f = memoryFile();
    writeSetting("L", 700, st);
    writeSetting("curve", "hypex", st);
    expect(await initSettings({ load: f.load, save: f.save, storage: st })).toBe("storage");
    expect(JSON.parse(f.text).format).toBe("radialhorn-settings");
    expect(fileValues(f)).toEqual({ L: 700, curve: "hypex" });
  });

  it("Speicher leer (z. B. von WebView2 verworfen): alles aus der Datei", async () => {
    const st = memoryStorage(), f = memoryFile(JSON.stringify({ format: "radialhorn-settings", version: 1, savedAt: 5, values: { L: 640, flangeOn: true } }));
    expect(await initSettings({ load: f.load, save: f.save, storage: st })).toBe("file");
    expect(readSetting("L", 500, st)).toBe(640);
    expect(readSetting("flangeOn", false, st)).toBe(true);
    expect(f.saves).toBe(0);
  });

  it("neuere Quelle gewinnt: Speicher jünger als die Datei (letzte Änderung kam nicht mehr in die Datei)", async () => {
    const st = memoryStorage(), old = { format: "radialhorn-settings", version: 1, savedAt: 1000, values: { L: 500 } };
    st.setItem("radialhorn.v1.L", "720");
    st.setItem("radialhorn.v1.__savedAt", "2000");
    const f = memoryFile(JSON.stringify(old));
    expect(await initSettings({ load: f.load, save: f.save, storage: st })).toBe("storage");
    expect(fileValues(f)).toEqual({ L: 720 });
    expect(JSON.parse(f.text).savedAt).toBe(2000);
  });

  it("Datei jünger als der Speicher: ersetzt ihn ganz (auch Schlüssel, die es dort nicht mehr gibt)", async () => {
    const st = memoryStorage();
    st.setItem("radialhorn.v1.L", "720");
    st.setItem("radialhorn.v1.alt", "1");
    st.setItem("radialhorn.v1.__savedAt", "1000");
    const f = memoryFile(JSON.stringify({ format: "radialhorn-settings", version: 1, savedAt: 3000, values: { L: 450 } }));
    expect(await initSettings({ load: f.load, save: f.save, storage: st })).toBe("file");
    expect(readSetting("L", 500, st)).toBe(450);
    expect(st.getItem("radialhorn.v1.alt")).toBe(null);
  });

  it("unlesbare oder fremde Datei: aus dem Speicher neu geschrieben", async () => {
    for (const text of ["{kaputt", JSON.stringify({ format: "anders", savedAt: 9e12, values: {} })]) {
      const st = memoryStorage(), f = memoryFile(text);
      writeSetting("L", 610, st);
      expect(await initSettings({ load: f.load, save: f.save, storage: st })).toBe("storage");
      expect(fileValues(f)).toEqual({ L: 610 });
      detachSettingsFile();
    }
  });

  it("Lesefehler (nicht „fehlt“): Fehler an den Aufrufer, die Datei wird nie überschrieben", async () => {
    const st = memoryStorage(), save = vi.fn();
    await expect(initSettings({ load: async () => { throw new Error("gesperrt"); }, save, storage: st })).rejects.toThrow("gesperrt");
    writeSetting("L", 610, st);
    clearSettings(st);
    expect(save).not.toHaveBeenCalled();
  });

  it("Änderungen: verzögert und gebündelt in die Datei, unveränderte Werte lösen nichts aus", async () => {
    vi.useFakeTimers();
    let clock = 100;
    const st = memoryStorage(), f = memoryFile();
    await initSettings({ load: f.load, save: f.save, storage: st, now: () => clock, delay: 250 });
    const after = f.saves;
    clock = 200;
    for (const L of [510, 520, 530]) writeSetting("L", L, st);   // Regler ziehen
    expect(f.saves).toBe(after);
    await vi.advanceTimersByTimeAsync(250);
    expect(f.saves).toBe(after + 1);
    expect(fileValues(f)).toEqual({ L: 530 });
    expect(JSON.parse(f.text).savedAt).toBe(200);
    writeSetting("L", 530, st);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.saves).toBe(after + 1);
  });

  it("Zurücksetzen leert auch die Datei – sie gewinnt danach nicht mit den alten Werten", async () => {
    vi.useFakeTimers();
    let clock = 100;
    const st = memoryStorage(), f = memoryFile();
    await initSettings({ load: f.load, save: f.save, storage: st, now: () => clock });
    writeSetting("L", 700, st);
    clock = 300;
    await clearSettings(st);
    await vi.advanceTimersByTimeAsync(1000);                  // ausstehendes Schreiben verfällt
    expect(fileValues(f)).toEqual({});
    detachSettingsFile();
    expect(await initSettings({ load: f.load, save: f.save, storage: st })).toBe("file");
    expect(readSetting("L", 500, st)).toBe(500);
  });
});
