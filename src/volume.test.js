/**
 * Volumen aus dem 3D-Netz: Formel am Würfel, Luft/Schale/Außenkörper am Horn.
 */
import { describe, it, expect } from "vitest";
import { createHornMath, makeProfile, computeFillet } from "./horn-math.js";
import { buildHornGeometry, buildShellGeometry, triangulate } from "./horn-mesh.js";
import { meshVolume, meshMoments, computeVolumes } from "./volume.js";
import { entrancePoints, linearWallPoints } from "./horn-math.js";

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

describe("meshMoments: Schwerpunkt", () => {
  it("Würfel: Mitte, unabhängig von der Lage zum Ursprung; Volumen wie meshVolume", () => {
    for (const origin of [[0, 0, 0], [-5, 20, 300]]) {
      const m = meshMoments(cube(10, origin));
      expect(m.volume).toBeCloseTo(1000, 6);
      expect(m.centroid[0]).toBeCloseTo(origin[0] + 5, 9);
      expect(m.centroid[1]).toBeCloseTo(origin[1] + 5, 9);
      expect(m.centroid[2]).toBeCloseTo(origin[2] + 5, 9);
    }
  });

  it("zwei Würfel: Schwerpunkt gewichtet nach dem Volumen; ein innen liegender Hohlraum zählt negativ", () => {
    const m = meshMoments([...cube(10, [0, 0, 0]), ...cube(20, [100, 0, 0])]);
    expect(m.centroid[0]).toBeCloseTo((1000 * 5 + 8000 * 110) / 9000, 9);
    // Würfel 10 mit Hohlraum 4: V = 1000 − 64, der Hohlraum (Mitte 5 + 2 = 7) verschiebt den Schwerpunkt von 5 weg nach −
    const hollow = meshMoments([...cube(10, [0, 0, 0]), ...cube(4, [5, 3, 3]).map(([a, b, c]) => [a, c, b])]);
    expect(hollow.volume).toBeCloseTo(936, 9);
    expect(hollow.centroid[0]).toBeCloseTo((1000 * 5 - 64 * 7) / 936, 9);
  });

  it("leeres Netz: Volumen 0, kein Schwerpunkt", () => {
    expect(meshMoments([])).toEqual({ volume: 0, centroid: null });
  });
});

describe("Schwerpunkt des Horns", () => {
  const RT = 25.4;
  const radial = createHornMath(140).solveHorn(500, 60, RT, 182, 90);
  const radialInput = extra => ({ s: radial, rt: RT, hMouth: 200, curve: "exponential", hypexT: 0.5, fillet: null, ...extra });

  it("Radialhorn: auf der Achse (x = h = 0, symmetrisch), z zwischen Throat und Mund – für Luft und Schale", () => {
    const v = computeVolumes(radialInput({ wall: 10 }));
    for (const c of [v.airCentroid, v.shellCentroid]) {
      expect(Math.abs(c[0])).toBeLessThan(1e-3);   // Rundung der Netzpunkte, nicht exakt 0
      expect(Math.abs(c[1])).toBeLessThan(1e-3);
      expect(c[2]).toBeGreaterThan(0);
      expect(c[2]).toBeLessThan(radial.zApex);
    }
  });

  it("ohne Wandstärke nur der Luftschwerpunkt, keiner für die Schale", () => {
    const v = computeVolumes(radialInput({ wall: 0 }));
    expect(v.airCentroid).toHaveLength(3);
    expect(v.shellCentroid).toBeNull();
  });

  it("rundes Horn: z des Luftschwerpunkts = ∫ π·x²·z dz / ∫ π·x² dz (Wand) plus Kugelkappe am Mund", () => {
    const s = { ...createHornMath(70).solveHorn(500, 60, RT, 0, 0), round: true };
    const v = computeVolumes({ s, rt: RT, hMouth: 0, curve: "exponential", hypexT: 0.5, fillet: null, wall: 0 });
    const pts = [...entrancePoints(s, 4000, 4000), ...linearWallPoints(s, 4000)].filter((p, i, a) => i === 0 || p[1] > a[i - 1][1]);
    let vol = 0, moment = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x0, z0] = pts[i - 1], [x1, z1] = pts[i], dz = z1 - z0, zm = (z0 + z1) / 2;
      const dv = Math.PI * (x0 * x0 + x0 * x1 + x1 * x1) / 3 * dz;
      vol += dv; moment += dv * zm;
    }
    // Kugelkappe: Höhe h über der Ebene z = zMouth, Grundkreis a, Kugelradius R = arcR; Volumen π·h·(3a² + h²)/6
    const h = s.zApex - s.zMouth, a = s.xMouth, R = s.arcR, capV = Math.PI * h * (3 * a * a + h * h) / 6;
    // Schwerpunkt der Kappe (Kugelsegment): Abstand vom Kugelmittelpunkt = 3·(2R − h)²/(4·(3R − h)); Kugelmittelpunkt bei zFocus
    const capCentre = s.zFocus + 3 * (2 * R - h) ** 2 / (4 * (3 * R - h));
    const expected = (moment + capV * capCentre) / (vol + capV);
    expect(v.airCentroid[2] / expected).toBeCloseTo(1, 3);
    expect(Math.abs(v.airCentroid[0])).toBeLessThan(1e-3);
  });
});
