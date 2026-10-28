/**
 * Puffer für die 3D-Ansicht (Web Worker): gleiche Dreiecke wie triangulate, Normalen, Gitter,
 * klonbare Eingaben.
 */
import { describe, it, expect } from "vitest";
import { createHornMath, makeProfile, computeFillet } from "./horn-math.js";
import { buildShellGeometry, flangeLayout, triangulate, gridLines } from "./horn-mesh.js";
import { meshBuffers, pack, smoothNormals } from "./mesh-buffers.js";

const RT = 25.4;
const s = createHornMath(140, { clothoid: 30 }).solveHorn(500, 80, RT, 182, 90);
const fillet = computeFillet(s, RT, 200, "exponential", 0.5, 100);
const profile = makeProfile(s, RT, 200, "exponential", 0.5, fillet);
const FLANGE = { diameter: null, fallback: 182, thickness: 10, holes: { count: 4, circle: 101.6, diameter: 6.6, angle: 0 } };
const flange = flangeLayout(s, RT, profile, fillet, 20, FLANGE);
const SECTIONS = ["traktrix", "klothoide", "linear", "rim", "flansch"];
const input = { s, rt: RT, hMouth: 200, curve: "exponential", hypexT: 0.5, fillet, wall: 20, flange, sections: SECTIONS };

/** Float32-Puffer gleich den (auf Float32 gerundeten) Werten? Schleife statt toEqual: große Puffer */
function sameValues(buffer, values) {
  if (buffer.length !== values.length) return false;
  const f = new Float32Array(values);
  for (let i = 0; i < f.length; i++) if (buffer[i] !== f[i]) return false;
  return true;
}

// Eingaben gehen per postMessage an den Worker: nur Daten, keine Funktionen
const out = meshBuffers(structuredClone(input));

describe("meshBuffers", () => {
  it("je Sektion dieselben Dreiecke wie triangulate (Profil im Worker nachgebaut)", () => {
    const geo = buildShellGeometry(s, RT, profile, fillet, 20, flange);
    expect(out.sections.map(x => x.section)).toEqual(SECTIONS);
    for (const { section, positions, lines } of out.sections) {
      const surfaces = geo.surfaces.filter(f => f.section === section);
      expect(sameValues(positions, surfaces.flatMap(triangulate).flat(2))).toBe(true);
      expect(sameValues(lines, surfaces.flatMap(gridLines).flat(2))).toBe(true);
    }
  });

  it("Normalen: Länge 1, auf der Außenseite des Dreiecks (nach der Umlaufrichtung)", () => {
    for (const { positions, normals } of out.sections) {
      for (let o = 0; o < positions.length; o += 9 * 31) {
        const p = k => [positions[o + k], positions[o + k + 1], positions[o + k + 2]];
        const [a, b, c] = [p(0), p(3), p(6)];
        const u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]);
        const cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        for (const m of [0, 3, 6]) {
          const n = [normals[o + m], normals[o + m + 1], normals[o + m + 2]];
          expect(Math.hypot(...n)).toBeCloseTo(1, 5);
          expect(cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2]).toBeGreaterThan(0);
        }
      }
    }
  });

  it("Rundungen glatt: an einem Punkt eines Kantenstreifens eine gemeinsame Normale", () => {
    const geo = buildShellGeometry(s, RT, profile, fillet, 20, flange, 20);
    const strip = geo.surfaces.find(f => f.name === "outer.edgeLinTopR");
    const tris = triangulate(strip), normals = smoothNormals(pack(tris));
    const g = strip.grid, q = g[g.length >> 1][g[0].length >> 1];   // innerer Gitterpunkt
    const at = [];
    tris.forEach((tri, k) => tri.forEach((p, m) => { if (p === q) at.push([...normals.subarray(k * 9 + m * 3, k * 9 + m * 3 + 3)]); }));
    expect(at.length).toBeGreaterThanOrEqual(3);
    for (const n of at) n.forEach((v, i) => expect(v).toBeCloseTo(at[0][i], 6));
  });

  it("Entwurf (beim Ziehen): ¼ der Dreiecke, flach schattiert", () => {
    const draft = meshBuffers(structuredClone({ ...input, quality: "draft" }));
    const count = o => o.sections.reduce((n, x) => n + x.positions.length / 9, 0);
    expect(count(draft)).toBeLessThan(count(out) / 2.5);
    for (const { normals } of draft.sections) {
      for (let o = 0; o < normals.length; o += 9 * 13) {
        for (const m of [3, 6]) for (let i = 0; i < 3; i++) expect(normals[o + m + i]).toBe(normals[o + i]);
      }
    }
  });

  it("Luftvolumen ohne Wandstärke; nur angeforderte Sektionen; Puffer zum Übertragen", () => {
    const air = meshBuffers({ ...input, wall: 0, flange: null, sections: ["traktrix", "linear"] });
    expect(air.sections.map(x => x.section)).toEqual(["traktrix", "linear"]);
    expect(air.buffers).toHaveLength(6);
    expect(air.buffers.every(b => b instanceof ArrayBuffer)).toBe(true);
  });
});

describe("meshBuffers mit Stützrippen", () => {
  const ribbed = flangeLayout(s, RT, profile, fillet, 20, { ...FLANGE, ribs: { thickness: 4, length: 30 }, round: 3 });
  const triangles = (out, section) => out.sections.find(x => x.section === section).positions.length / 9;

  it("Rippen liegen in der Sektion Flansch – im feinen Netz wie im Entwurf beim Ziehen", () => {
    for (const quality of ["fine", "draft"]) {
      const plain = quality === "fine" ? out : meshBuffers(structuredClone({ ...input, quality }));   // out: das feine Netz ohne Rippen (oben)
      const withRibs = meshBuffers(structuredClone({ ...input, flange: ribbed, quality }));
      expect(triangles(withRibs, "flansch"), quality).toBeGreaterThan(triangles(plain, "flansch"));
      for (const section of ["traktrix", "klothoide", "linear", "rim"]) expect(triangles(withRibs, section), `${quality} ${section}`).toBe(triangles(plain, section));
    }
  });

  it("Dreiecke wie triangulate, auch mit Rippen (Eingabe klonbar)", () => {
    const out = meshBuffers(structuredClone({ ...input, flange: ribbed }));
    const surfaces = buildShellGeometry(s, RT, profile, fillet, 20, ribbed).surfaces.filter(f => f.section === "flansch");
    expect(surfaces.some(f => f.name.startsWith("flangeRib"))).toBe(true);
    expect(sameValues(out.sections.find(x => x.section === "flansch").positions, surfaces.flatMap(triangulate).flat(2))).toBe(true);
  });
});

describe("smoothNormals", () => {
  const strip = deg => {   // zwei Dreiecke über die Kante x = 0, das rechte um deg nach oben geknickt
    const a = deg * Math.PI / 180;
    return [[[-1, 0, 0], [0, 0, 0], [0, 1, 0]], [[0, 0, 0], [Math.cos(a), 0, Math.sin(a)], [0, 1, 0]]];
  };
  const at = (normals, k, m) => [...normals.subarray(k * 9 + m * 3, k * 9 + m * 3 + 3)];

  it("flacher Knick (10°): an der gemeinsamen Kante eine gemittelte Normale", () => {
    const n = smoothNormals(pack(strip(10)));
    at(n, 0, 1).forEach((v, i) => expect(v).toBeCloseTo(at(n, 1, 0)[i], 9));
    expect(at(n, 0, 1)[0]).toBeLessThan(0);                    // zwischen beiden Flächen geneigt
    expect(at(n, 0, 1)[0]).toBeGreaterThan(-Math.sin(10 * Math.PI / 180));
    expect(at(n, 0, 0)).toEqual([0, 0, 1]);                    // außerhalb der Kante flach
  });

  it("scharfe Kante (90°): jede Fläche behält ihre Normale", () => {
    const n = smoothNormals(pack(strip(90)));
    at(n, 0, 1).forEach((v, i) => expect(v).toBeCloseTo([0, 0, 1][i], 9));
    at(n, 1, 0).forEach((v, i) => expect(v).toBeCloseTo([-1, 0, 0][i], 9));
  });
});
