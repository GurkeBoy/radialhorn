/**
 * Verdrahtung der Entwurfswerte in App.jsx: Jeder Wert aus DESIGN_DEFAULTS braucht Zustand, Eintrag in
 * Projektdatei/Verlauf (designValues, designSetters) und – wenn er die Geometrie betrifft – den
 * Live-Wert samt Abhängigkeiten. Ein neuer Wert wird an mehreren Stellen eingetragen; vergisst man
 * eine, bleibt er stumm wirkungslos (Regler ohne Wirkung, nicht gespeichert, nicht rückgängig zu machen).
 * Geprüft wird der Quelltext von App.jsx – die Oberfläche selbst läuft hier nicht.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DESIGN_DEFAULTS } from "./project.js";
import { GEOMETRY_KEYS } from "./geometry.js";

const app = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

/** Text zwischen start und dem ersten end dahinter. */
function between(start, end) {
  const i = app.indexOf(start);
  expect(i, `„${start}“ in App.jsx`).toBeGreaterThanOrEqual(0);
  const j = app.indexOf(end, i + start.length);
  expect(j, `Ende von „${start}“`).toBeGreaterThan(i);
  return app.slice(i + start.length, j);
}
const hasName = (text, name) => new RegExp(`(^|[^A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(text);

const KEYS = Object.keys(DESIGN_DEFAULTS);
// Entwurfswerte, die nicht zur Geometrie gehören (Bedienung bzw. Simulation)
const NOT_GEOMETRY = ["abstrahlung", "driver", "simTemp", "throatCustom"];

describe("Entwurfswerte in App.jsx", () => {
  it("jeder Entwurfswert hat einen gespeicherten Zustand (usePersistentState)", () => {
    for (const key of KEYS) expect(app, key).toMatch(new RegExp(`usePersistentState\\("${key}", `));
  });

  it("jeder Entwurfswert steht in designValues (Projektdatei, Verlauf) und designSetters (Öffnen, Rückgängig)", () => {
    const values = between("const designValues = {", "\n  };"), setters = between("const designSetters = {", "\n  };");
    for (const key of KEYS) {
      expect(hasName(values, key), `${key} in designValues`).toBe(true);
      expect(new RegExp(`(^|[^A-Za-z0-9_])${key}:`).test(setters), `${key} in designSetters`).toBe(true);
    }
  });

  it("jeder Geometriewert steht im Live-Wert und in dessen Abhängigkeiten", () => {
    const live = between("const live = useMemo(() => ({", "\n  }), ["), deps = between("\n  }), [", "]);");
    for (const key of GEOMETRY_KEYS) {
      expect(hasName(live, key), `${key} im Live-Wert`).toBe(true);
      expect(hasName(deps, key), `${key} in den Abhängigkeiten`).toBe(true);
    }
  });

  it("Geometriewerte sind Entwurfswerte; die übrigen Entwurfswerte sind bewusst keine Geometrie", () => {
    for (const key of GEOMETRY_KEYS) expect(KEYS, key).toContain(key);
    // Wer einen neuen Entwurfswert einführt, entscheidet hier: Geometrie (GEOMETRY_KEYS in geometry.js) oder nicht
    expect(KEYS.filter(k => !GEOMETRY_KEYS.includes(k)).sort()).toEqual(NOT_GEOMETRY);
  });
});
