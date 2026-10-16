/**
 * Gerundete Längskanten der Schale: geschlossen, Wand nirgends dünner als t, Enden eben,
 * Volumen um die Rundung kleiner, ohne Radius alles wie bisher.
 */
import { describe, it, expect } from "vitest";
import { createHornMath, makeProfile, computeFillet, solveHorn } from "./horn-math.js";
import { buildShellGeometry, flangeLayout, triangulate } from "./horn-mesh.js";

const RT = 25.4, T = 20;
const s = solveHorn(500, 60, RT, 182, 90);
const profile = makeProfile(s, RT, 200, "exponential", 0.5);
const hAt = r => profile(s.zFocus + r);
const FLANGE = { diameter: null, fallback: 182, thickness: 10, holes: { count: 4, circle: 101.6, diameter: 6.6, angle: 0 } };

const key = p => p.map(v => Math.round(v * 1e6)).join(",");
const tris = geo => geo.surfaces.flatMap(triangulate);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const volume = ts => ts.reduce((V, [a, b, c]) => { const n = cross(b, c); return V + (a[0] * n[0] + a[1] * n[1] + a[2] * n[2]) / 6; }, 0);
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
const grid = (geo, name) => geo.surfaces.find(f => f.name === name).grid;

describe("gerundete Längskanten", () => {
  it("geschlossen und einheitlich orientiert – auch ohne Traktrix, mit Klothoide, lang, dick, mit Flansch", () => {
    const cases = [
      [s, profile, null, T, T / 2], [s, profile, null, T, T], [s, profile, null, 60, 30],
      [solveHorn(500, 0, RT, 182, 90), null, null, T, T],
      [createHornMath(140, { clothoid: 30 }).solveHorn(500, 80, RT, 182, 90), null, null, T, 8],
      [createHornMath(140).solveHorn(700, 250, RT, 182, 90), null, 150, 10, 10],
      [createHornMath(160).solveHorn(500, 120, RT, 182, 90), null, null, 80, 80],
    ];
    for (const [sol, prof, R, t, r] of cases) {
      const fillet = R ? computeFillet(sol, RT, 200, "hypex", 0.7, R) : null;
      const p = prof ?? makeProfile(sol, RT, 200, fillet ? "hypex" : "exponential", fillet ? 0.7 : 0.5, fillet);
      expect(edgeCheck(tris(buildShellGeometry(sol, RT, p, fillet, t, null, r)))).toEqual({ open: 0, flipped: 0 });
      const flange = flangeLayout(sol, RT, p, fillet, t, FLANGE, r);
      expect(edgeCheck(tris(buildShellGeometry(sol, RT, p, fillet, t, flange, r)))).toEqual({ open: 0, flipped: 0 });
    }
  }, 120000);   // 14 vollständige Schalen

  it("ohne Radius genau die scharfkantige Schale", () => {
    const sharp = buildShellGeometry(s, RT, profile, null, T), zero = buildShellGeometry(s, RT, profile, null, T, null, 0);
    expect(zero.surfaces.map(f => f.name)).toEqual(sharp.surfaces.map(f => f.name));
    expect(JSON.stringify(tris(zero))).toBe(JSON.stringify(tris(sharp)));
  });

  it("Volumen nimmt um die vier Kantenzwickel ab: (1 − π/4)·r² je Kantenlänge", () => {
    const r = 10, geo = buildShellGeometry(s, RT, profile, null, T, null, r);
    const edgeLength = ["edgeTrakTopR", "edgeLinTopR"].reduce((sum, n) => {
      const q = grid(geo, "outer." + n).map(row => row[0]);
      return sum + q.slice(1).reduce((l, p, i) => l + Math.hypot(p[0] - q[i][0], p[2] - q[i][2]), 0);
    }, 0);
    const dV = volume(tris(buildShellGeometry(s, RT, profile, null, T))) - volume(tris(geo));
    expect(dV / (4 * (1 - Math.PI / 4) * r * r * edgeLength)).toBeCloseTo(1, 1);
  });

  it("Wand an der Ecke nirgends dünner als t (gerader Bereich, Radius = t)", () => {
    const geo = buildShellGeometry(s, RT, profile, null, T, null, T);
    const n = [Math.cos(s.alpha2), -Math.sin(s.alpha2)], u = [Math.sin(s.alpha2), Math.cos(s.alpha2)];
    let min = Infinity;
    for (const row of grid(geo, "outer.edgeLinTopR")) for (const [x, h, z] of row) {
      // Abstand zur inneren Ecke (Wandlinie, Deckel des Luftvolumens) im Schnitt quer zur Wand
      const along = (x - s.xTrans) * u[0] + (z - s.zTrans) * u[1];
      const across = (x - s.xTrans) * n[0] + (z - s.zTrans) * n[1];
      const rad = Math.hypot(s.xTrans + along * u[0], s.zTrans + along * u[1] - s.zFocus);
      if (rad > s.arcR - T || rad < s.rInner + T) continue;   // Enden und Knick am Übergang ausgenommen
      min = Math.min(min, Math.hypot(across, h - hAt(rad)));
    }
    expect(min).toBeGreaterThan(T * 0.99);
  });

  it("Radius = t: kein Eckstreifen, Rundung beginnt über der Innenwand und hat genau den Radius t", () => {
    for (const flange of [null, flangeLayout(s, RT, profile, null, T, FLANGE, T)]) {
      const geo = buildShellGeometry(s, RT, profile, null, T, flange, T);
      expect(geo.surfaces.some(f => f.name.includes("corner"))).toBe(false);
      const inner = grid(geo, "inner.linTop"), strip = grid(geo, "outer.edgeLinTopR");
      const n = [Math.cos(s.alpha2), -Math.sin(s.alpha2)];
      strip.forEach((row, k) => {
        const [qx, qh, qz] = row[0], [wx, wh, wz] = row[row.length - 1];
        // Deckelkante Q senkrecht über der Innenwand-Linie (gleicher Grundrisspunkt wie innen)
        const wallPoint = inner[k].reduce((best, p) => Math.abs(p[0]) > Math.abs(best[0]) ? p : best);
        expect(Math.hypot(qx - Math.abs(wallPoint[0]), qz - wallPoint[2])).toBeLessThan(1e-9);
        // W = Q + t·n − t·oben: Radius genau t
        expect(Math.hypot(wx - qx - T * n[0], wz - qz - T * n[1])).toBeLessThan(1e-9);
        expect(qh - wh).toBeCloseTo(T, 9);
      });
    }
  });

  it("Throat-Randzug bleibt in seiner Ebene, Stirnflächen am Mund bleiben eben", () => {
    const r = 12, flange = flangeLayout(s, RT, profile, null, T, FLANGE, r);
    for (const [fl, z] of [[null, 0], [flange, 10]]) {
      const geo = buildShellGeometry(s, RT, profile, null, T, fl, r);
      for (const name of ["outer.edgeTrakTopR", "outer.edgeTrakBottomL", "outer.trakWallR"]) {
        for (const p of grid(geo, name)[0]) expect(p[2]).toBeCloseTo(z, 9);
      }
    }
    const geo = buildShellGeometry(s, RT, profile, null, T, null, r);
    const end = geo.surfaces.find(f => f.name === "rimEndR").triangles.flat();
    const [mx, mz] = [s.xMouth, s.zMouth];
    for (const [x, , z] of end) expect((x - mx) * Math.sin(s.alpha2) + (z - mz) * Math.cos(s.alpha2)).toBeCloseTo(0, 6);
  });

  it("Flansch: Mindest-Ø folgt dem gerundeten Umriss (kleiner als scharfkantig)", () => {
    const sharp = flangeLayout(s, RT, profile, null, T, FLANGE), round = flangeLayout(s, RT, profile, null, T, FLANGE, T);
    expect(round.minDiameter).toBeLessThan(sharp.minDiameter);
  });
});
