/**
 * Verrundete Ecken am Mund (mouthRounding): Luftvolumen und Schale bleiben geschlossen und gleichsinnig
 * orientiert, die Mundfläche verliert (4 − π)·R², das Volumen nimmt mit dem Radius ab.
 */
import { describe, it, expect } from "vitest";
import { createHornMath, makeProfile, throatMorph, mouthRounding, maxMouthRound, mouthArea, cornerDeficit } from "./horn-math.js";
import { buildHornGeometry, buildShellGeometry, triangulate } from "./horn-mesh.js";
import { edgeCheck, signedVolume } from "./test-helpers.js";

const RT = 25.4, T = 10, H_MOUTH = 200;
const solve = (Lt, clothoid = 0) => createHornMath(140, { clothoid }).solveHorn(500, Lt, RT, 182, 90);
const profileOf = s => makeProfile(s, RT, H_MOUTH, "exponential", 0.5);
const tris = geo => geo.surfaces.flatMap(triangulate);
const area = ([a, b, c]) => Math.hypot(
  (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
  (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;

describe("geschlossen und gleichsinnig", () => {
  for (const [name, s] of [["Traktrix", solve(60)], ["Traktrix + Klothoide", solve(60, 30)]]) {
    const profile = profileOf(s);
    for (const [throatName, throat] of [["eckiger Throat", null], ["runder Throat", throatMorph(s, RT, 150)]]) {
      for (const R of [15, 60, maxMouthRound(H_MOUTH / 2, s.arcR)]) {
        const morph = mouthRounding(s, profile, throat, R);
        it(`${name}, ${throatName}, R = ${R.toFixed(0)}: Luftvolumen`, () => {
          expect(edgeCheck(tris(buildHornGeometry(s, RT, profile, null, morph)))).toEqual({ open: 0, flipped: 0 });
        });
        it(`${name}, ${throatName}, R = ${R.toFixed(0)}: Schale mit scharfen und gerundeten Außenkanten`, () => {
          for (const edge of [0, T]) {
            expect(edgeCheck(tris(buildShellGeometry(s, RT, profile, null, T, null, edge, morph))), `Kantenradius ${edge}`).toEqual({ open: 0, flipped: 0 });
          }
        });
      }
    }
  }

  it("ohne Traktrix (Linse): Luftvolumen geschlossen", () => {
    const s = solve(0), profile = profileOf(s);
    expect(edgeCheck(tris(buildHornGeometry(s, RT, profile, null, mouthRounding(s, profile, null, 30))))).toEqual({ open: 0, flipped: 0 });
  });
});

describe("Mundfläche und Volumen", () => {
  const s = solve(60), profile = profileOf(s);
  const mouthCap = R => buildHornGeometry(s, RT, profile, null, mouthRounding(s, profile, null, R)).surfaces.find(f => f.name === "capMouth");

  it("die Mundkappe liegt auf dem Zylinder um den Fokus und hat die Fläche Mund − (4 − π)·R²", () => {
    const R = 40, cap = mouthCap(R), morph = mouthRounding(s, profile, null, R);
    for (const p of triangulate(cap).flat()) expect(Math.hypot(p[0], p[2] - s.zFocus)).toBeCloseTo(s.arcR, 6);
    const A = triangulate(cap).reduce((sum, tri) => sum + area(tri), 0);
    expect(A / mouthArea(s, H_MOUTH, morph)).toBeCloseTo(1, 2);   // Sehnen statt Bogen: Abweichung unter 1 %
  });

  it("ohne Rundung unverändert; das Volumen nimmt mit dem Radius ab, höchstens um (4 − π)·R² · Wandlänge", () => {
    const volume = morph => signedVolume(tris(buildHornGeometry(s, RT, profile, null, morph)));
    const plain = volume(null);
    expect(volume(mouthRounding(s, profile, null, 0))).toBe(plain);
    let prev = plain;
    for (const R of [10, 30, 60]) {
      const v = volume(mouthRounding(s, profile, null, R));
      expect(v).toBeLessThan(prev);
      expect(plain - v).toBeLessThan(cornerDeficit(R) * s.zMouth);
      prev = v;
    }
  });
});

describe("Wandstärke an den Mundecken", () => {
  // Abstand des Außenbogens der letzten Zeile zum Innenbogen (Mundebene) – bei e = t überall t
  const segDist = (p, a, b) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const f = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1)));
    return Math.hypot(p[0] - a[0] - f * ab[0], p[1] - a[1] - f * ab[1], p[2] - a[2] - f * ab[2]);
  };
  const thickness = (s, profile, R, t) => {
    const geo = buildShellGeometry(s, RT, profile, null, t, null, t, mouthRounding(s, profile, null, R));
    const last = name => { const g = geo.surfaces.find(f => f.name === name).grid; return g[g.length - 1]; };
    const inner = last("inner.roundLinTopR"), outer = last("outer.roundLinTopR");
    // erster Punkt liegt am Ende des Deckels (kein Bogenpunkt der Wand), der Rest auf dem Außenbogen
    return outer.slice(1).map(p => Math.min(...inner.slice(1).map((q, i) => segDist(p, inner[i], q))));
  };

  it("größter Radius ist ein Viertel des Mundbogenradius, bei großen Mundhöhen auch dann: Wandstärke bleibt innerhalb 2 %", () => {
    for (const [L, Lt, hMouth] of [[300, 60, 600], [700, 100, 600], [1100, 150, 600]]) {
      const s = createHornMath(140).solveHorn(L, Lt, RT, 182, 90), profile = makeProfile(s, RT, hMouth, "exponential", 0.5);
      const morph = mouthRounding(s, profile, null, 1e6);
      expect(morph.mouth.R).toBeCloseTo(Math.min(0.95 * hMouth / 2, 0.25 * s.arcR), 9);
      for (const t of [10, 20]) for (const d of thickness(s, profile, 1e6, t)) expect(Math.abs(d / t - 1)).toBeLessThan(0.02);
    }
  });
});
