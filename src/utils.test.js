import { describe, it, expect } from "vitest";
import { linspace, clamp, svgPath, niceTicks, clipFromZ, fmtLength } from "./utils.js";

describe("utils", () => {
  it("fmtLength: höchstens eine Nachkommastelle", () => {
    expect(fmtLength(575.2898834303028)).toBe("575.3");
    expect(fmtLength(500)).toBe("500");
    expect(fmtLength(126.04)).toBe("126");
  });

  it("clipFromZ: ab der Ebene z0, Schnittpunkt interpoliert", () => {
    const pts = [[10, 0], [20, 10], [30, 20]];
    expect(clipFromZ(pts, 5)).toEqual([[15, 5], [20, 10], [30, 20]]);
    expect(clipFromZ(pts, 0)).toBe(pts);
    expect(clipFromZ(pts, 10)).toEqual([[20, 10], [30, 20]]);
    expect(clipFromZ(pts, 25)).toEqual([]);
  });

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
