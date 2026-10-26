import { describe, it, expect } from "vitest";
import { solveHorn, makeProfile, throatMorph } from "../horn-math.js";
import { flangeLayout, EXPORT_RES } from "../horn-mesh.js";
import { buildHornGeometry } from "../horn-mesh.js";
import { hornGeometry, hornTriangles, stlBinary } from "./stl.js";
import { openEdges, trianglesOf, signedVolume, cross } from "../test-helpers.js";

const RT = 25.4;
const s = solveHorn(500, 60, RT, 120, 100);
const profile = makeProfile(s, RT, 200, "exponential", 0.5);
const morph = throatMorph(s, RT);
const FLANGE = { diameter: null, fallback: 120, thickness: 10, holes: { count: 4, circle: 101.6, diameter: 6.6, angle: 0 } };
const shell = { s, rt: RT, profile, fillet: null, wall: 12, edgeR: 12, morph, flange: flangeLayout(s, RT, profile, null, 12, FLANGE, 12, morph) };
const air = { s, rt: RT, profile, fillet: null, morph };


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

describe("STL mit Stützrippen und Verrundung", () => {
  const ribbed = {
    ...shell,
    flange: flangeLayout(s, RT, profile, null, 12, { ...FLANGE, diameter: 160, ribs: { thickness: 4, length: 30 }, round: 3 }, 12, morph),
  };

  it("die Rippen sind im Netz, jede ein eigener geschlossener Körper, das Gesamtnetz bleibt geschlossen", () => {
    const ribs = hornGeometry(ribbed, EXPORT_RES).surfaces.filter(f => f.rib);
    expect(ribs).toHaveLength(4);
    expect(hornTriangles(ribbed).length).toBeGreaterThan(hornTriangles({ ...shell, flange: flangeLayout(s, RT, profile, null, 12, { ...FLANGE, diameter: 160 }, 12, morph) }).length);
    expect(openEdges(hornTriangles(ribbed, EXPORT_RES))).toBe(0);
  }, 60000);

  it("ohne Rippenvorgabe keine Rippenflächen", () => {
    expect(hornGeometry(shell).surfaces.some(f => f.rib)).toBe(false);
  }, 30000);
});

describe("stlBinary (Luftvolumen, Standardhorn)", () => {
  const H_MOUTH = 200;
  const tris = trianglesOf(buildHornGeometry(s, RT, profile));
  const buf = stlBinary(tris);
  const view = new DataView(buf);

  it("Größe und Dreiecksanzahl", () => {
    expect(buf.byteLength).toBe(84 + 50 * tris.length);
    expect(view.getUint32(80, true)).toBe(tris.length);
  });

  it("Normalen zeigen nach außen (positives Volumen in STL-Koordinaten)", () => {
    let V = 0;
    for (let t = 0; t < tris.length; t++) {
      const p = [0, 1, 2].map(k => [0, 1, 2].map(c => view.getFloat32(84 + 50 * t + 12 + 12 * k + 4 * c, true)));
      const c = cross(p[1], p[2]);
      V += (p[0][0] * c[0] + p[0][1] * c[1] + p[0][2] * c[2]) / 6;
    }
    expect(V / signedVolume(tris)).toBeCloseTo(1, 4);
  });

  it("Hochachse Z: Höhe des Mundes ±hMouth/2", () => {
    let zMax = -Infinity;
    for (let t = 0; t < tris.length; t++) for (let k = 0; k < 3; k++) zMax = Math.max(zMax, view.getFloat32(84 + 50 * t + 12 + 12 * k + 8, true));
    expect(zMax).toBeCloseTo(H_MOUTH / 2, 3);
  });
});
