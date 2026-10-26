import { describe, it, expect } from "vitest";
import {
  DESIGN_DEFAULTS, PROJECT_FORMAT, PROJECT_VERSION, ProjectError, buildProject, parseProject, projectFileName, migrateSettings,
} from "./project.js";
import { PLACEHOLDER_DRIVER } from "./simulation.js";

const sample = {
  ...DESIGN_DEFAULTS,
  throatDiam: 35.5, openingAngle: 120, L: 612.5, Lt: 80, curve: "hypex", hypexT: 0.8, showWandstaerke: true,
  flangeOn: true, flangeD: 210, edgeR: null, abstrahlung: "pi", driver: { ...PLACEHOLDER_DRIVER, Re: 6.4, massIs: "Mms" },
};
const DATE = new Date("2026-10-08T12:00:00Z");
const fileWith = design => JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, design });

describe("Projektdateien", () => {
  it("Rundlauf: speichern und öffnen ergibt denselben Entwurf, ohne Meldungen", () => {
    const text = buildProject(sample, { appVersion: "0.1.0", date: DATE });
    const head = JSON.parse(text);
    expect(head).toMatchObject({ format: PROJECT_FORMAT, version: PROJECT_VERSION, app: "0.1.0", saved: "2026-10-08T12:00:00.000Z" });
    const { design, invalid, missing, newer } = parseProject(text);
    expect(design).toEqual(sample);
    expect([invalid, missing, newer]).toEqual([[], [], false]);
  });

  it("speichert nur den Entwurf, keine persönlichen Einstellungen", () => {
    const keys = Object.keys(JSON.parse(buildProject({ ...sample, sprache: "en", simPhase: true, exportLayers: {} })).design);
    expect(keys.sort()).toEqual(Object.keys(DESIGN_DEFAULTS).sort());
  });

  it("ungültige Werte → Standard, einzeln gemeldet (auch Felder des Treibers und feste Auswahlen)", () => {
    const { design, invalid } = parseProject(fileWith({
      ...sample, L: "lang", curve: "parabel", abstrahlung: "3pi", flangeD: "x", showRaumecke: 1,
      driver: { ...sample.driver, Bl: "stark", massIs: "Mxx" },
    }));
    expect(invalid.sort()).toEqual(["L", "abstrahlung", "curve", "driver.Bl", "driver.massIs", "flangeD", "showRaumecke"].sort());
    expect(design.L).toBe(DESIGN_DEFAULTS.L);
    expect(design.curve).toBe(DESIGN_DEFAULTS.curve);
    expect(design.flangeD).toBe(null);
    expect(design.driver.Bl).toBe(PLACEHOLDER_DRIVER.Bl);
    expect(design.driver.massIs).toBe(PLACEHOLDER_DRIVER.massIs);
    expect(design.driver.Re).toBe(6.4);   // gültige Felder bleiben
  });

  it("Treiber ist kein Objekt → ganzer Treiber Standard, eine Meldung", () => {
    const { design, invalid } = parseProject(fileWith({ ...sample, driver: 5 }));
    expect(invalid).toEqual(["driver"]);
    expect(design.driver).toEqual(PLACEHOLDER_DRIVER);
  });

  it("fehlende Werte → Standard, gemeldet; unbekannte Werte werden ignoriert", () => {
    const partial = { openingAngle: 100, unbekannt: 1 };
    const { design, missing, invalid } = parseProject(fileWith(partial));
    expect(design.openingAngle).toBe(100);
    expect(design).not.toHaveProperty("unbekannt");
    expect(missing.length).toBe(Object.keys(DESIGN_DEFAULTS).length - 1 - 7);   // ohne die später dazugekommenen
    expect(invalid).toEqual([]);
  });

  it("Datei von vor dem runden Throat: still ergänzt (Übergang aus), keine Meldung", () => {
    const old = { ...sample };
    delete old.morphOn;
    delete old.morphLength;
    const { design, missing, invalid } = parseProject(fileWith(old));
    expect([missing, invalid]).toEqual([[], []]);
    expect(design.morphOn).toBe(false);
    expect(design.morphLength).toBeNull();
  });

  it("Datei von vor den Stützrippen und Verrundungen: still ergänzt (beides aus), keine Meldung", () => {
    const old = { ...sample };
    delete old.ribsOn;
    delete old.ribThickness;
    delete old.ribLength;
    delete old.roundOn;
    delete old.roundR;
    const { design, missing, invalid } = parseProject(fileWith(old));
    expect([missing, invalid]).toEqual([[], []]);
    expect(design.ribsOn).toBe(false);
    expect(design.ribThickness).toBe(DESIGN_DEFAULTS.ribThickness);
    expect(design.ribLength).toBe(DESIGN_DEFAULTS.ribLength);
    expect(design.roundOn).toBe(false);
    expect(design.roundR).toBe(DESIGN_DEFAULTS.roundR);
  });

  it("null nur bei automatischen Werten (Kantenradius, Flansch-Ø, Lochkreis), sonst ungültig", () => {
    const { design, invalid } = parseProject(fileWith({ ...sample, flangeD: null, holeCircle: null, wandstaerke: null, driver: null }));
    expect(design.flangeD).toBe(null);
    expect(design.holeCircle).toBe(null);
    expect(design.wandstaerke).toBe(DESIGN_DEFAULTS.wandstaerke);   // ein Regler mit null bräche
    expect(design.driver).toEqual(PLACEHOLDER_DRIVER);
    expect(invalid.sort()).toEqual(["driver", "wandstaerke"]);
  });

  it("neuere Formatversion wird erkannt", () => {
    expect(parseProject(JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION + 1, design: sample })).newer).toBe(true);
  });

  it("kein JSON bzw. keine Projektdatei → Fehler mit Code", () => {
    const code = text => { try { parseProject(text); return null; } catch (e) { return e instanceof ProjectError ? e.code : "anderer Fehler"; } };
    expect(code("{ kaputt")).toBe("json");
    expect(code(JSON.stringify({ design: sample }))).toBe("format");
    expect(code(JSON.stringify({ format: PROJECT_FORMAT }))).toBe("format");
    expect(code("null")).toBe("format");
  });

  it("Dateiname aus Winkel und Länge", () => {
    expect(projectFileName({ openingAngle: 140, L: 575.2898834303028 })).toBe("radialhorn_140deg_L575.3.radialhorn.json");
  });
});

describe("Gesamtlänge ab der Treiberrückseite (Formatversion 2)", () => {
  const v1 = design => JSON.stringify({ format: PROJECT_FORMAT, version: 1, design });

  it("Version 1 ohne Raumecke: L um dw/2 kürzer (dasselbe Horn), mit Raumecke unverändert", () => {
    expect(parseProject(v1({ ...DESIGN_DEFAULTS, showRaumecke: false, L: 600, dw: 182 })).design.L).toBe(509);
    expect(parseProject(v1({ ...DESIGN_DEFAULTS, showRaumecke: true, L: 600 })).design.L).toBe(600);
    const noVersion = JSON.stringify({ format: PROJECT_FORMAT, design: { ...DESIGN_DEFAULTS, showRaumecke: false, L: 600, dw: 120 } });
    expect(parseProject(noVersion).design.L).toBe(540);
  });

  it("Version 2 bleibt, wie sie ist; neue Dateien sind Version 2", () => {
    const text = buildProject({ ...DESIGN_DEFAULTS, showRaumecke: false, L: 509 });
    expect(JSON.parse(text).version).toBe(2);
    expect(parseProject(text).design.L).toBe(509);
  });

  it("gespeicherte Einstellungen: einmalig umgerechnet", () => {
    const data = new Map();
    const st = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k),
      key: i => [...data.keys()][i] ?? null, get length() { return data.size; } };
    st.setItem("radialhorn.v1.L", "600");
    st.setItem("radialhorn.v1.showRaumecke", "false");
    migrateSettings(st);
    expect(st.getItem("radialhorn.v1.L")).toBe("509");
    migrateSettings(st);                                          // kein zweites Mal
    expect(st.getItem("radialhorn.v1.L")).toBe("509");
    const fresh = new Map();
    const st2 = { ...st, getItem: k => fresh.get(k) ?? null, setItem: (k, v) => fresh.set(k, String(v)) };
    migrateSettings(st2);                                         // neue Installation: nur die Kennung
    expect([...fresh.keys()]).toEqual(["radialhorn.v1.schema"]);
  });
});
