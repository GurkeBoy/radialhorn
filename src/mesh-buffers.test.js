/**
 * Puffer für die 3D-Ansicht (Web Worker): gleiche Dreiecke wie triangulate, Normalen, Gitter,
 * klonbare Eingaben.
 */
import { describe, it, expect } from "vitest";
import { createHornMath, makeProfile, computeFillet } from "./horn-math.js";
import { buildShellGeometry, flangeLayout, triangulate, gridLines } from "./horn-mesh.js";
import { meshBuffers } from "./mesh-buffers.js";

const RT = 25.4;
const s = createHornMath(140, { clothoid: 30 }).solveHorn(500, 80, RT, 182, 90);
const fillet = computeFillet(s, RT, 200, "exponential", 0.5, 100);
const profile = makeProfile(s, RT, 200, "exponential", 0.5, fillet);
const flange = flangeLayout(s, RT, profile, fillet, 20, {
  diameter: null, fallback: 182, thickness: 10, holes: { count: 4, circle: 101.6, diameter: 6.6, angle: 0 },
});
const SECTIONS = ["traktrix", "klothoide", "linear", "rim", "flansch"];
const input = { s, rt: RT, hMouth: 200, curve: "exponential", hypexT: 0.5, fillet, wall: 20, flange, sections: SECTIONS };

/** Float32-Puffer gleich den (auf Float32 gerundeten) Werten? Schleife statt toEqual: große Puffer */
function sameValues(buffer, values) {
  if (buffer.length !== values.length) return false;
  const f = new Float32Array(values);
  for (let i = 0; i < f.length; i++) if (buffer[i] !== f[i]) return false;
  return true;
}

describe("meshBuffers", () => {
  // Eingaben gehen per postMessage an den Worker: nur Daten, keine Funktionen
  const out = meshBuffers(structuredClone(input));

  it("je Sektion dieselben Dreiecke wie triangulate (Profil im Worker nachgebaut)", () => {
    const geo = buildShellGeometry(s, RT, profile, fillet, 20, flange);
    expect(out.sections.map(x => x.section)).toEqual(SECTIONS);
    for (const { section, positions, lines } of out.sections) {
      const surfaces = geo.surfaces.filter(f => f.section === section);
      expect(sameValues(positions, surfaces.flatMap(triangulate).flat(2))).toBe(true);
      expect(sameValues(lines, surfaces.flatMap(gridLines).flat(2))).toBe(true);
    }
  });

  it("Normalen: Länge 1 und senkrecht zum Dreieck, nach der Umlaufrichtung", () => {
    const { positions, normals } = out.sections.find(x => x.section === "linear");
    for (let o = 0; o < positions.length; o += 9 * 97) {
      const p = k => [positions[o + k], positions[o + k + 1], positions[o + k + 2]];
      const [a, b, c] = [p(0), p(3), p(6)];
      const n = [normals[o], normals[o + 1], normals[o + 2]];
      expect(Math.hypot(...n)).toBeCloseTo(1, 5);
      const u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]);
      const cr = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      expect(cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2]).toBeGreaterThan(0);
    }
  });

  it("Luftvolumen ohne Wandstärke; nur angeforderte Sektionen; Puffer zum Übertragen", () => {
    const air = meshBuffers({ ...input, wall: 0, flange: null, sections: ["traktrix", "linear"] });
    expect(air.sections.map(x => x.section)).toEqual(["traktrix", "linear"]);
    expect(air.buffers).toHaveLength(6);
    expect(air.buffers.every(b => b instanceof ArrayBuffer)).toBe(true);
  });
});
