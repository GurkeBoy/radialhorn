import { describe, it, expect } from "vitest";
import { solveHorn, makeProfile, throatMorph } from "../horn-math.js";
import { flangeLayout, EXPORT_RES } from "../horn-mesh.js";
import { hornGeometry, hornTriangles } from "./stl.js";

const RT = 25.4;
const s = solveHorn(500, 60, RT, 120, 100);
const profile = makeProfile(s, RT, 200, "exponential", 0.5);
const morph = throatMorph(s, RT);
const FLANGE = { diameter: null, fallback: 120, thickness: 10, holes: { count: 4, circle: 101.6, diameter: 6.6, angle: 0 } };
const shell = { s, rt: RT, profile, fillet: null, wall: 12, edgeR: 12, morph, flange: flangeLayout(s, RT, profile, null, 12, FLANGE, 12, morph) };
const air = { s, rt: RT, profile, fillet: null, morph };

const key = p => p.map(v => Math.round(v * 1e6)).join(",");
function openEdges(tris) {
  const directed = new Set();
  for (const t of tris) for (let k = 0; k < 3; k++) directed.add(key(t[k]) + ">" + key(t[(k + 1) % 3]));
  return [...directed].filter(e => { const [a, b] = e.split(">"); return !directed.has(b + ">" + a); }).length;
}

describe("STL-Export mit doppelter Auflösung (EXPORT_RES)", () => {
  it("geschlossen: Luftvolumen mit rundem Throat, Schale mit rundem Throat, Kanten r = t und Flansch", () => {
    expect(openEdges(hornTriangles(air, EXPORT_RES))).toBe(0);
    expect(openEdges(hornTriangles(shell, EXPORT_RES))).toBe(0);
  }, 30000);

  it("feiner als die Ansicht: Gitter, Viertelkreise der Rundungen, Flanschrand und Bohrungen", () => {
    expect(hornTriangles(shell, EXPORT_RES).length).toBeGreaterThan(3 * hornTriangles(shell).length);
    const fine = hornGeometry(shell, EXPORT_RES).surfaces, coarse = hornGeometry(shell).surfaces;
    const cols = (list, name) => list.find(f => f.name === name).grid[0].length;
    expect(cols(fine, "flangeRim")).toBe(2 * 96 + 1);
    expect(cols(fine, "flangeHole0")).toBe(2 * 24 + 1);
    expect(cols(coarse, "flangeRim")).toBe(96 + 1);
    // Rundungsstreifen: Zeilen sind Viertelkreise aus round Stücken
    const arcPoints = list => list.find(f => f.name === "inner.roundTrakTopR").grid[0].length;
    expect(arcPoints(fine)).toBe(32 + 1);
    expect(arcPoints(coarse)).toBe(16 + 1);
  }, 30000);
});
