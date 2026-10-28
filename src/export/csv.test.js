import { describe, it, expect } from "vitest";
import { createHornMath, makeProfile } from "../horn-math.js";
import { airAt, logFrequencies, areaCurve, simulate, driverSI, PLACEHOLDER_DRIVER } from "../simulation.js";
import { buildCSV } from "./csv.js";

describe("buildCSV (Frequenzgang)", () => {
  const air = airAt(20), RT = 25.4;
  const s = createHornMath(140).solveHorn(500, 60, RT, 182, 90);
  const profile = makeProfile(s, RT, 200, "exponential", 0.5);
  const freqs = logFrequencies(20, 20000, 6);
  const r = simulate({ curve: areaCurve(s, RT, profile), air, driver: driverSI(PLACEHOLDER_DRIVER, air.rho), freqs });

  it("Kopfzeile und eine Zeile je Frequenz", () => {
    const lines = buildCSV(r).trim().split("\n");
    expect(lines[0]).toMatch(/^f_Hz,SPL_dB,/);
    expect(lines).toHaveLength(freqs.length + 1);
  });

  it("alle Spalten sind endliche Zahlen, die erste ist die Frequenz", () => {
    const lines = buildCSV(r).trim().split("\n");
    for (const line of lines.slice(1)) {
      const cols = line.split(",").map(Number);
      expect(cols).toHaveLength(9);
      expect(cols.every(Number.isFinite)).toBe(true);
    }
    expect(Number(lines[1].split(",")[0])).toBeCloseTo(20, 3);
    expect(Number(lines.at(-1).split(",")[0])).toBeCloseTo(20000, -1);
  });
});
