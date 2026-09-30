import { describe, it, expect } from "vitest";
import { linspace, clamp, svgPath, niceTicks } from "./utils.js";

describe("utils", () => {
  it("linspace: n+1 Werte einschließlich beider Enden", () => {
    expect(linspace(0, 1, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(linspace(5, 5, 2)).toEqual([5, 5, 5]);
  });

  it("clamp", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(3, 0, 10)).toBe(3);
  });

  it("svgPath mit und ohne Rundung", () => {
    expect(svgPath([[0, 0], [1.234, 5.678]])).toBe("M0,0 L1.234,5.678");
    expect(svgPath([[0, 0], [1.234, 5.678]], 1)).toBe("M0.0,0.0 L1.2,5.7");
    expect(svgPath([])).toBe("");
  });

  it("niceTicks: runde Schritte 1/2/5·10ⁿ innerhalb des Bereichs", () => {
    expect(niceTicks(0, 100)).toEqual([0, 50, 100]);           // Rohschritt 25 → 50
    expect(niceTicks(103, 161)).toEqual([120, 140, 160]);       // Rohschritt 14,5 → 20
    expect(niceTicks(100, 160)).toEqual([100, 120, 140, 160]);
    expect(niceTicks(0, 149437)).toEqual([0, 50000, 100000]);
    expect(niceTicks(5, 5)).toEqual([]);
  });
});
