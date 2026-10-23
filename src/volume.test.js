/**
 * Volumen aus dem 3D-Netz: Formel am Würfel, Luft/Schale/Außenkörper am Horn.
 */
import { describe, it, expect } from "vitest";
import { createHornMath, makeProfile, computeFillet } from "./horn-math.js";
import { buildHornGeometry, buildShellGeometry, triangulate } from "./horn-mesh.js";
import { meshVolume, computeVolumes } from "./volume.js";

/** Würfel der Kantenlänge a bei (x0, y0, z0), Dreiecke nach außen orientiert. */
function cube(a, [x0, y0, z0]) {
  const v = i => [x0 + a * (i & 1), y0 + a * ((i >> 1) & 1), z0 + a * ((i >> 2) & 1)];
  const quads = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const c = [x0 + a / 2, y0 + a / 2, z0 + a / 2];
  return quads.flatMap(([i, j, k, l]) => [[i, j, k], [i, k, l]]).map(t => {
    const [p, q, r] = t.map(v);
    const n = [(q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]),
               (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]),
               (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])];
    const out = n[0] * (p[0] - c[0]) + n[1] * (p[1] - c[1]) + n[2] * (p[2] - c[2]) > 0;
    return out ? [p, q, r] : [p, r, q];
  });
}

describe("meshVolume", () => {
  it("Würfel: a³, unabhängig von der Lage zum Ursprung", () => {
    expect(meshVolume(cube(10, [0, 0, 0]))).toBeCloseTo(1000, 6);
    expect(meshVolume(cube(10, [-5, 20, 300]))).toBeCloseTo(1000, 6);
  });
  it("innen liegende (umgedrehte) Flächen zählen negativ", () => {
    const inner = cube(4, [3, 3, 3]).map(([a, b, c]) => [a, c, b]);
    expect(meshVolume([...cube(10, [0, 0, 0]), ...inner])).toBeCloseTo(1000 - 64, 6);
  });
});

describe("computeVolumes", () => {
  const RT = 25.4;
  const s = createHornMath(140, { clothoid: 30 }).solveHorn(500, 80, RT, 182, 90);
  const fillet = computeFillet(s, RT, 200, "exponential", 0.5, 100);
  const base = { s, rt: RT, hMouth: 200, curve: "exponential", hypexT: 0.5, fillet };

  it("ohne Wandstärke nur das Luftvolumen", () => {
    const v = computeVolumes({ ...base, wall: 0 });
    expect(v.air).toBeGreaterThan(0);
    expect(v.shell).toBeNull();
    expect(v.outer).toBeNull();
  });

  it("Luftvolumen = Volumen des Luftnetzes, Außenkörper = Luft + Wand", () => {
    const profile = makeProfile(s, RT, 200, "exponential", 0.5, fillet);
    const air = meshVolume(buildHornGeometry(s, RT, profile, fillet, null).surfaces.flatMap(triangulate));
    const shell = meshVolume(buildShellGeometry(s, RT, profile, fillet, 10, null, 0, null).surfaces.flatMap(triangulate));
    const v = computeVolumes({ ...base, wall: 10 });
    expect(v.air).toBeCloseTo(air, 3);
    expect(v.shell).toBeCloseTo(shell, 3);
    expect(v.outer).toBeCloseTo(air + shell, 3);
  });

  it("dickere Wand: mehr Material, gleiche Luft", () => {
    const thin = computeVolumes({ ...base, wall: 5 });
    const thick = computeVolumes({ ...base, wall: 15 });
    expect(thick.air).toBeCloseTo(thin.air, 3);
    expect(thick.shell).toBeGreaterThan(thin.shell);
    expect(thick.outer).toBeGreaterThan(thin.outer);
  });
});
