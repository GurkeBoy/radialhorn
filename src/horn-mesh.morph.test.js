/**
 * Runder Throat im 3D-Netz: Luftvolumen und Schale geschlossen und einheitlich orientiert, am
 * Throat genau der Kreis des Treiberausgangs, Deckel ohne Faltung, im geraden Bereich jede Zeile
 * (Wellenfront) mit genau der Querschnittsfläche der Simulation.
 */
import { describe, it, expect } from "vitest";
import { createHornMath, makeProfile, computeFillet, throatMorph, crossSection } from "./horn-math.js";
import { buildHornGeometry, buildShellGeometry, flangeLayout, triangulate } from "./horn-mesh.js";

const RT = 25.4;
const solve = (Lt, { clothoid = 0, rt = RT, angle = 140 } = {}) => createHornMath(angle, { clothoid }).solveHorn(500, Lt, rt, 182, 90);
const profileOf = (s, rt = RT, fillet = null) => makeProfile(s, rt, 200, "exponential", 0.5, fillet);
const FLANGE = { diameter: null, fallback: 182, thickness: 10, holes: { count: 4, circle: 101.6, diameter: 6.6, angle: 0 } };

const key = p => p.map(v => Math.round(v * 1e6)).join(",");
const tris = geo => geo.surfaces.flatMap(triangulate);
function edgeCheck(ts) {
  const directed = new Map();
  for (const t of ts) for (let k = 0; k < 3; k++) {
    const e = key(t[k]) + ">" + key(t[(k + 1) % 3]);
    directed.set(e, (directed.get(e) || 0) + 1);
  }
  let open = 0, flipped = 0;
  for (const [e, n] of directed) {
    const [a, b] = e.split(">");
    if (!directed.get(b + ">" + a)) open++;
    if (n > 1) flipped++;
  }
  return { open, flipped };
}
const surface = (geo, name) => geo.surfaces.find(f => f.name === name);

const CASES = [
  ["Standard", solve(60), RT, null, null],
  ["kurzer Übergang", solve(60), RT, null, 5],
  ["längster Übergang (bis zum Mund)", solve(60), RT, null, 1e4],
  ["in den geraden Bereich", solve(60), RT, null, 150],
  ["ohne Traktrix", solve(0), RT, null, null],
  ["ohne Traktrix, bis zum Mund", solve(0), RT, null, 1e4],
  ["kurze Traktrix", solve(20), RT, null, null],
  ["lange Traktrix", solve(150), RT, null, null],
  ["mit Klothoide", solve(80, { clothoid: 30 }), RT, null, 1e4],
  ["mit Verrundung", solve(60), RT, 100, null],
  ["mit Verrundung, bis zum Mund", solve(60), RT, 100, 1e4],
  ['1"-Throat', solve(60, { rt: 12.7 }), 12.7, null, null],
  ["160°", solve(120, { angle: 160 }), RT, null, null],
];

describe("runder Throat im 3D-Netz", () => {
  for (const [name, s, rt, R, length] of CASES) {
    const fillet = R ? computeFillet(s, rt, 200, "exponential", 0.5, R) : null;
    const profile = profileOf(s, rt, fillet);
    const morph = throatMorph(s, rt, length);

    it(`${name}: Luftvolumen und Schale geschlossen, einheitlich orientiert`, () => {
      expect(morph).not.toBeNull();
      expect(edgeCheck(tris(buildHornGeometry(s, rt, profile, fillet, morph)))).toEqual({ open: 0, flipped: 0 });
      expect(edgeCheck(tris(buildShellGeometry(s, rt, profile, fillet, 20, null, 0, morph)))).toEqual({ open: 0, flipped: 0 });
    });

    it(`${name}: Throat = Kreis mit Radius rt in der Ebene z = 0`, () => {
      const cap = surface(buildHornGeometry(s, rt, profile, fillet, morph), "capThroat");
      const pts = cap.triangles.flat();
      for (const [x, h, z] of pts) {
        expect(z).toBeCloseTo(0, 9);
        if (Math.hypot(x, h) > 1e-6) expect(Math.hypot(x, h)).toBeCloseTo(rt, 6);   // ohne Fächermitte
      }
    });

    it(`${name}: Deckel faltet nicht (im Grundriss alle Zellen gleich orientiert)`, () => {
      const geo = buildHornGeometry(s, rt, profile, fillet, morph);
      for (const name of ["trakTop", "kloTop", "linTop"]) {
        const grid = surface(geo, name)?.grid;
        if (!grid) continue;
        let pos = 0, neg = 0;
        for (let i = 0; i < grid.length - 1; i++) for (let j = 0; j < grid[i].length - 1; j++) {
          for (const [a, b, c] of [[grid[i][j], grid[i][j + 1], grid[i + 1][j + 1]], [grid[i][j], grid[i + 1][j + 1], grid[i + 1][j]]]) {
            const area = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
            if (area > 1e-9) pos++; else if (area < -1e-9) neg++;
          }
        }
        expect(Math.min(pos, neg)).toBe(0);
      }
    });
  }

  it("gerader Bereich: Querschnitt jeder Zeile (abgewickelter Bogen) = crossSection der Simulation", () => {
    for (const [s, length, R] of [[solve(60), 200, null], [solve(0), null, null], [solve(0), 1e4, null], [solve(60), 1e4, 100]]) {
      const fillet = R ? computeFillet(s, RT, 200, "exponential", 0.5, R) : null;
      const profile = profileOf(s, RT, fillet), morph = throatMorph(s, RT, length);
      const geo = buildHornGeometry(s, RT, profile, fillet, morph);
      const top = surface(geo, "linTop").grid, arcTR = surface(geo, "roundLinTopR").grid, arcTL = surface(geo, "roundLinTopL").grid;
      const unroll = ([x, h, z]) => [Math.hypot(x, z - s.zFocus) * Math.atan2(x, z - s.zFocus), h];
      let checked = 0;
      for (let k = 0; k < top.length; k++) {
        const W = arcTR[k][arcTR[k].length - 1];
        if (W[1] >= top[k][0][1] - 1e-9) continue;                    // ohne Rundung (r = 0)
        // obere Hälfte: linke Rundung (W → q), Deckel, rechte Rundung (q → W); unten gespiegelt
        const upper = [...[...arcTL[k]].reverse(), ...top[k].slice(1, -1), ...arcTR[k]].map(unroll);
        const loop = [...upper, ...[...upper].reverse().map(([u, h]) => [u, -h])];
        let A = 0;
        for (let i = 0; i < loop.length; i++) { const [a, b] = [loop[i], loop[(i + 1) % loop.length]]; A += a[0] * b[1] - b[0] * a[1]; }
        const ref = crossSection(s, profile, 0, [W[2]], morph).find(p => Math.abs(p.zWall - W[2]) < 1e-9);
        expect(Math.abs(A / 2) / ref.A - 1).toBeLessThan(2e-3);
        checked++;
      }
      expect(checked).toBeGreaterThan(5);
    }
  });

  it("Schale mit gerundeten Außenkanten und mit Flansch: geschlossen, Flanschöffnung rund", () => {
    const s = solve(60), profile = profileOf(s), morph = throatMorph(s, RT, null);
    expect(edgeCheck(tris(buildShellGeometry(s, RT, profile, null, 20, null, 10, morph)))).toEqual({ open: 0, flipped: 0 });
    const flange = flangeLayout(s, RT, profile, null, 20, FLANGE);
    const geo = buildShellGeometry(s, RT, profile, null, 20, flange, 0, morph);
    expect(edgeCheck(tris(geo))).toEqual({ open: 0, flipped: 0 });
    const back = surface(geo, "flangeBack").triangles.flat().filter(([x, h]) => Math.hypot(x, h) < RT + 1);
    expect(back.length).toBeGreaterThan(0);
    for (const [x, h] of back) expect(Math.hypot(x, h)).toBeCloseTo(RT, 6);
  });

  it("ohne Übergang (null) unverändert", () => {
    const s = solve(60), profile = profileOf(s);
    expect(tris(buildHornGeometry(s, RT, profile, null, null))).toEqual(tris(buildHornGeometry(s, RT, profile)));
  });
});
