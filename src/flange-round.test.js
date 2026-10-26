/**
 * Verrundung des Außenrands der Flanschplatte auf der Hornseite (die Bohrungen bleiben scharfkantig).
 */
import { describe, it, expect } from "vitest";
import { createHornMath, makeProfile, computeFillet } from "./horn-math.js";
import { buildShellGeometry, flangeLayout, flangeRounds, triangulate } from "./horn-mesh.js";
import { meshVolume } from "./volume.js";
import { edgeCheck } from "./test-helpers.js";

const RT = 25.4, WALL = 10, TH = 10, N_RIM = 96;
const s = createHornMath(140, { clothoid: 30 }).solveHorn(500, 80, RT, 182, 90);
const fillet = computeFillet(s, RT, 200, "exponential", 0.5, 100);
const profile = makeProfile(s, RT, 200, "exponential", 0.5, fillet);
const spec = (round, extra = {}) => ({
  diameter: null, fallback: 182, thickness: TH, holes: { count: 4, circle: 101.6, diameter: 6.6, angle: 0 }, round, ...extra,
});
const build = (round, extra) => {
  const layout = flangeLayout(s, RT, profile, fillet, WALL, spec(round, extra), 0, null);
  return { layout, geo: buildShellGeometry(s, RT, profile, fillet, WALL, layout, 0, null) };
};
const tris = geo => geo.surfaces.flatMap(triangulate);


describe("Verrundung der Flanschplatte (Hornseite)", () => {
  const plain = build(0), rounded = build(3);

  it("ohne Radius unverändert, mit Radius geschlossen und einheitlich orientiert", () => {
    expect(plain.geo.surfaces.some(f => f.name.includes("Round"))).toBe(false);
    expect(edgeCheck(tris(rounded.geo))).toEqual(edgeCheck(tris(plain.geo)));
    expect(rounded.geo.surfaces.map(f => f.name)).toEqual(expect.arrayContaining(["flangeRound"]));
    expect(rounded.geo.surfaces.some(f => f.name.startsWith("flangeHoleRound"))).toBe(false);   // Bohrungen unverändert
  });

  it("Volumen sinkt um den abgenommenen Viertelkreis-Ring am Außenrand", () => {
    const { rim } = flangeRounds(rounded.layout, N_RIM);
    expect(rim).toBeCloseTo(3, 9);
    const R = rounded.layout.diameter / 2, A = 1 - Math.PI / 4;
    const expected = A * 2 * Math.PI * rim ** 2 * (R - 0.2234 * rim);
    const removed = meshVolume(tris(plain.geo)) - meshVolume(tris(rounded.geo));
    expect(removed).toBeGreaterThan(0);
    expect(removed / expected).toBeGreaterThan(0.97);
    expect(removed / expected).toBeLessThan(1.03);
  });

  it("Radius wird begrenzt: höchstens 90 % der Dicke, geschlossen", () => {
    const big = build(100);
    const { rim } = flangeRounds(big.layout, N_RIM);
    expect(rim).toBeGreaterThan(0);
    expect(rim).toBeLessThanOrEqual(0.9 * TH + 1e-9);
    expect(edgeCheck(tris(big.geo))).toEqual(edgeCheck(tris(plain.geo)));
  });

  it("Flansch knapp an der Schale: Rand-Verrundung auf den Platz begrenzt", () => {
    const tight = build(5, { diameter: 1 });   // zu klein → auf das Minimum angehoben
    expect(tight.layout.limited).toBe(true);
    const { rim } = flangeRounds(tight.layout, N_RIM);
    expect(rim).toBeLessThan(1);                       // Rand außen herum nur ≈ 1 mm
    expect(edgeCheck(tris(tight.geo))).toEqual(edgeCheck(tris(build(0, { diameter: 1 }).geo)));
  });

  it("Rippen enden vor der Verrundung des Rands", () => {
    const withRibs = build(4, { ribs: { thickness: 4, length: 30 } });
    const R = withRibs.layout.diameter / 2;
    const ribs = withRibs.geo.surfaces.filter(f => f.name.startsWith("flangeRib"));
    expect(ribs).toHaveLength(4);
    for (const rib of ribs) for (const [x, h] of triangulate(rib).flat()) expect(Math.hypot(x, h)).toBeLessThanOrEqual(R - 4 + 1e-9);
    for (const rib of ribs) expect(edgeCheck(triangulate(rib))).toEqual({ open: 0, flipped: 0 });
  });
});
