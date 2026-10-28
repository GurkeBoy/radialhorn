/**
 * Die Netzprüfung der Tests (edgeCheck) selbst: sie muss Löcher, falsch herum stehende und doppelte
 * Flächen finden – sonst prüfen die vielen Geschlossenheits-Tests nichts.
 */
import { describe, it, expect } from "vitest";
import { edgeCheck, openEdges, signedVolume } from "./test-helpers.js";

/** Würfel der Kantenlänge 2 um den Ursprung, 12 Dreiecke, nach außen orientiert. */
function cube() {
  const v = i => [(i & 1) * 2 - 1, ((i >> 1) & 1) * 2 - 1, ((i >> 2) & 1) * 2 - 1];
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const c = [0, 0, 0];
  return quads.flatMap(([a, b, d, e]) => [[a, b, d], [a, d, e]]).map(t => {
    const [p, q, r] = t.map(v);
    const n = [(q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]),
               (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]),
               (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])];
    const outward = n[0] * (p[0] - c[0]) + n[1] * (p[1] - c[1]) + n[2] * (p[2] - c[2]) > 0;
    return outward ? [p, q, r] : [p, r, q];
  });
}

describe("edgeCheck", () => {
  it("geschlossener, einheitlich orientierter Würfel: nichts offen, nichts doppelt", () => {
    expect(edgeCheck(cube())).toEqual({ open: 0, flipped: 0 });
    expect(signedVolume(cube())).toBeCloseTo(8, 9);
  });

  it("fehlendes Dreieck: drei Kanten ohne Gegenkante", () => {
    expect(edgeCheck(cube().slice(1))).toEqual({ open: 3, flipped: 0 });
    expect(openEdges(cube().slice(1))).toBe(3);
  });

  it("umgedrehtes Dreieck: Kanten laufen doppelt in dieselbe Richtung", () => {
    const tris = cube().map((t, i) => i === 3 ? [t[0], t[2], t[1]] : t);
    expect(edgeCheck(tris)).toEqual({ open: 3, flipped: 3 });
  });

  it("doppeltes Dreieck: dieselben drei gerichteten Kanten zweimal", () => {
    expect(edgeCheck([...cube(), cube()[5]])).toEqual({ open: 0, flipped: 3 });
  });

  it("Punkte zählen als gleich, wenn sie sich unter der Rundung (1e-6) nicht unterscheiden – geteilte Objekte oder Kopien", () => {
    const copies = cube().map(t => t.map(p => [...p]));
    expect(edgeCheck(copies)).toEqual({ open: 0, flipped: 0 });
    const nudged = cube().map((t, i) => i === 2 ? [[t[0][0] + 1e-8, t[0][1], t[0][2]], t[1], t[2]] : t);
    expect(edgeCheck(nudged)).toEqual({ open: 0, flipped: 0 });
    const apart = cube().map((t, i) => i === 2 ? [[t[0][0] + 1e-3, t[0][1], t[0][2]], t[1], t[2]] : t);
    expect(edgeCheck(apart).open).toBeGreaterThan(0);
  });
});
