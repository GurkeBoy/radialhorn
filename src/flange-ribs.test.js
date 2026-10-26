/**
 * Stützrippen am Flansch: je Rippe ein geschlossener Körper, mittig zwischen den Bohrungen,
 * nie über dem Flanschrand, im Außenkörper verankert, Überlapp im Volumen herausgerechnet.
 */
import { describe, it, expect } from "vitest";
import { createHornMath, makeProfile, computeFillet, throatMorph } from "./horn-math.js";
import { buildShellGeometry, flangeLayout, triangulate, boltHoleCenters } from "./horn-mesh.js";
import { meshVolume, computeVolumes } from "./volume.js";
import { surfaceTriangles, sliceSegments, rayReach } from "./flange-ribs.js";
import { edgeCheck } from "./test-helpers.js";

const RT = 25.4, WALL = 10, TH = 10;
const math = createHornMath(140, { clothoid: 30 });
const s = math.solveHorn(500, 80, RT, 182, 90);
const fillet = computeFillet(s, RT, 200, "exponential", 0.5, 100);
const profile = makeProfile(s, RT, 200, "exponential", 0.5, fillet);
const spec = (ribs, count = 4, angle = 0) => ({
  diameter: null, fallback: 182, thickness: TH, holes: { count, circle: 101.6, diameter: 6.6, angle }, ribs,
});
const build = (ribs, { count, angle, morph = null, edgeR = 0 } = {}) => {
  const layout = flangeLayout(s, RT, profile, fillet, WALL, spec(ribs, count, angle), edgeR, morph);
  return { layout, geo: buildShellGeometry(s, RT, profile, fillet, WALL, layout, edgeR, morph) };
};
const ribsOf = geo => geo.surfaces.filter(f => f.name.startsWith("flangeRib"));


const RIBS = { thickness: 4, length: 30 };

describe("Stützrippen am Flansch", () => {
  const { layout, geo } = build(RIBS);
  const ribs = ribsOf(geo);

  it("ohne Rippenvorgabe keine Rippen und derselbe Körper wie bisher", () => {
    const plain = build(null).geo;
    expect(ribsOf(plain)).toHaveLength(0);
    expect(plain.ribs).toBeNull();
    expect(geo.surfaces.length).toBe(plain.surfaces.length + ribs.length);
  });

  it("so viele Rippen wie Bohrungen, jede ein geschlossener, nach außen orientierter Körper", () => {
    expect(ribs).toHaveLength(4);
    expect(geo.ribs).toMatchObject({ count: 4 });
    for (const rib of ribs) {
      const tris = triangulate(rib);
      expect(edgeCheck(tris)).toEqual({ open: 0, flipped: 0 });
      expect(meshVolume(tris)).toBeGreaterThan(0);
    }
  });

  it("mittig zwischen den Bohrungen", () => {
    const holes = boltHoleCenters(layout.holes).map(([x, h]) => Math.atan2(h, x));
    for (const rib of ribs) {
      const pts = triangulate(rib).flat();
      const [cx, ch] = pts.reduce(([ax, ah], p) => [ax + p[0] / pts.length, ah + p[1] / pts.length], [0, 0]);
      const phi = Math.atan2(ch, cx);
      const gaps = holes.map(a => Math.abs(Math.atan2(Math.sin(phi - a), Math.cos(phi - a))));
      expect(Math.min(...gaps)).toBeGreaterThan(Math.PI / 4 - 0.02);   // 4 Löcher: Rippen auf 45°, 135°, …
    }
  });

  it("nie über dem Flanschrand, nur auf der Hornseite, höchstens so lang wie vorgegeben", () => {
    const R = layout.diameter / 2;
    for (const rib of ribs) {
      for (const [x, h, z] of triangulate(rib).flat()) {
        expect(Math.hypot(x, h)).toBeLessThanOrEqual(R);
        expect(z).toBeGreaterThanOrEqual(TH - 1 - 1e-9);
        expect(z).toBeLessThanOrEqual(TH + RIBS.length + 1e-9);
      }
    }
    expect(geo.ribs.length).toBeGreaterThan(5);
    expect(geo.ribs.length).toBeLessThanOrEqual(RIBS.length);
  });

  it("keine Rippe über einer Bohrung", () => {
    const rh = layout.holes.diameter / 2;
    for (const rib of ribs) {
      for (const [x, h] of triangulate(rib).flat()) {
        for (const [cx, ch] of layout.centers) expect(Math.hypot(x - cx, h - ch)).toBeGreaterThan(rh + 1);
      }
    }
  });

  it("Gesamtnetz bleibt geschlossen: Rippen fügen keine offenen Kanten hinzu", () => {
    const base = edgeCheck(build(null).geo.surfaces.flatMap(triangulate));
    expect(edgeCheck(geo.surfaces.flatMap(triangulate))).toEqual(base);
  });

  it("Volumen: Überlapp mit Platte und Wand wird abgezogen", () => {
    const plain = meshVolume(build(null).geo.surfaces.flatMap(triangulate));
    const raw = meshVolume(geo.surfaces.flatMap(triangulate));
    const ribVolume = ribs.reduce((V, r) => V + meshVolume(triangulate(r)), 0);
    expect(raw).toBeCloseTo(plain + ribVolume, 3);
    expect(geo.ribs.overlap).toBeGreaterThan(0);
    expect(geo.ribs.overlap).toBeLessThan(ribVolume);
    const base = { s, rt: RT, hMouth: 200, curve: "exponential", hypexT: 0.5, fillet, wall: WALL };
    const withRibs = computeVolumes({ ...base, flange: layout });
    const without = computeVolumes({ ...base, flange: build(null).layout });
    expect(withRibs.shell - without.shell).toBeCloseTo(ribVolume - geo.ribs.overlap, 3);
    expect(withRibs.air).toBeCloseTo(without.air, 3);
  });

  it("dickere Rippen: mehr Material; längere: wirksame Länge wächst", () => {
    const thick = build({ thickness: 8, length: 30 });
    const long = build({ thickness: 4, length: 60 });
    const vol = r => ribsOf(r.geo).reduce((V, f) => V + meshVolume(triangulate(f)), 0);
    expect(vol(thick)).toBeGreaterThan(vol({ geo }) * 1.5);
    expect(long.geo.ribs.length).toBeGreaterThan(geo.ribs.length);
  });

  it("Zahl und Lage folgen den Bohrungen (6 Bohrungen, Winkel 10°)", () => {
    const six = build(RIBS, { count: 6, angle: 10 });
    expect(ribsOf(six.geo)).toHaveLength(6);
    for (const rib of ribsOf(six.geo)) expect(edgeCheck(triangulate(rib)).open).toBe(0);
  });

  it("ohne Bohrungen keine Rippen", () => {
    const none = build(RIBS, { count: 0 });
    expect(ribsOf(none.geo)).toHaveLength(0);
  });

  it("mit gerundeten Außenkanten und rundem Throat", () => {
    const morph = throatMorph(s, RT, 150);
    const { geo: g } = build(RIBS, { morph, edgeR: WALL });
    expect(ribsOf(g)).toHaveLength(4);
    for (const rib of ribsOf(g)) expect(edgeCheck(triangulate(rib))).toEqual({ open: 0, flipped: 0 });
  });
});

describe("Stützrippen an der gerundeten Ecke", () => {
  // Dicke Rippe an der gerundeten Außenkante: die Wand weicht seitlich zurück, die Einbettung muss
  // deshalb auch an den Seiten der Rippe in die Wand reichen (sonst klafft dort ein Spalt)
  const { geo } = build({ thickness: 10, length: 60 }, { edgeR: WALL });
  const outer = surfaceTriangles(geo.surfaces.filter(f => f.name.startsWith("outer.")));

  it("Innenkante der Rippe liegt auf der Mitte und an beiden Seiten in der Wand", () => {
    expect(geo.ribs.count).toBe(4);
    for (const { phi, poly } of geo.ribs.shapes) {
      const c = Math.cos(phi), s = Math.sin(phi);
      const chain = poly.slice(2, -1);                                   // Spitze → Platte: [ρ − Einbettung, z]
      for (const [rho, z] of chain) {
        const segs = sliceSegments(outer, Math.max(z, TH + 0.05));
        for (const side of [-5, 0, 5]) {
          const wall = rayReach(segs, c, s, side);
          expect(wall, `z ${z.toFixed(1)}, Seite ${side}`).not.toBeNull();
          expect(rho, `z ${z.toFixed(1)}, Seite ${side}`).toBeLessThan(wall - 0.3);   // Innenkante hinter der Wandfläche
        }
      }
    }
  });
});
