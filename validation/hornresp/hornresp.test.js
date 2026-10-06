// Abgleich mit Hornresp: Referenzdateien hornresp-<Fall>.csv (533 Frequenzen, 10 Hz – 20 kHz) gegen
// dasselbe Modell mit Hornresps Konventionen bei Vrc = 0 (modell.js: Rückseite offen, „Combined“,
// SPL aus der Leistung). Braucht kein installiertes Hornresp.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { simulate, driverSI } from "../../src/simulation.js";
import { AIR, CASES, curveOf } from "./faelle.js";
import { hornrespResponse, parseReferenceCsv } from "./modell.js";

describe("Hornresp-Abgleich", () => {
  for (const c of CASES) {
    it(`Fall ${c.id} (${c.title}): Halsimpedanz, Ze und SPL wie Hornresp über alle Frequenzen`, () => {
      const ref = parseReferenceCsv(readFileSync(new URL(`hornresp-${c.id}.csv`, import.meta.url), "utf8"));
      expect(ref).toHaveLength(533);
      const r = hornrespResponse({ curve: curveOf(c.segments), air: AIR, driver: driverSI(c.driver, AIR.rho), freqs: ref.map(d => d.f_Hz) });
      ref.forEach((d, i) => {
        expect(Math.abs(r.ra[i] - d.Ra_norm)).toBeLessThan(1e-4);
        expect(Math.abs(r.xa[i] - d.Xa_norm)).toBeLessThan(1e-4);
        expect(Math.abs(r.ze[i] / d.Ze_Ohm - 1)).toBeLessThan(1e-4);
        expect(Math.abs(r.spl[i] - d.SPL_dB)).toBeLessThan(0.01);
      });
    });
  }

  it("App-SPL = Hornresp-SPL des Horns allein (Rückseite unbelastet und stumm)", () => {
    const c = CASES.find(k => k.id === "B"), curve = curveOf(c.segments), driver = driverSI(c.driver, AIR.rho);
    const freqs = [20, 100, 400, 1000, 5000, 20000];
    const app = simulate({ curve, air: AIR, driver, freqs, adaptive: false });
    const ref = hornrespResponse({ curve, air: AIR, driver, freqs, rearOpen: false });
    freqs.forEach((f, i) => expect(app.spl[i]).toBeCloseTo(ref.spl[i], 9));
  });
});
