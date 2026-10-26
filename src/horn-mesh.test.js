/**
 * 3D-Körper: geschlossen, richtig orientiert, maßhaltig und konsistent mit der
 * vereinbarten Konstruktion (Traktrix-Prisma + Rotationskörper um den Fokus).
 */
import { describe, it, expect } from "vitest";
import { solveHorn, makeProfile, computeFillet, traktrixPoints, createHornMath, focusRadius, crossSection } from "./horn-math.js";
import { buildHornGeometry, buildShellGeometry, triangulate } from "./horn-mesh.js";
import { edgeCheck, signedVolume } from "./test-helpers.js";

const RT = 25.4, H_MOUTH = 200;
const s  = solveHorn(500, 60, RT, 120, 100);
const profile = makeProfile(s, RT, H_MOUTH, "exponential", 0.5);
const geometry = (sol = s, prof = profile, fillet = null) => buildHornGeometry(sol, RT, prof, fillet);
const trianglesOf = geo => geo.surfaces.flatMap(triangulate);



/** Referenzvolumen: 2·rt·Fläche(Traktrix-Grundfläche) + ∫∫ 2h dA über den Kreisringsektor. */
function referenceVolume(sol, prof) {
  const pts = traktrixPoints(sol, 4000);
  let trakArea = 0;
  for (let i = 1; i < pts.length; i++) trakArea += (pts[i][1] - pts[i - 1][1]) * (pts[i][0] + pts[i - 1][0]);   // 2·∫x dz
  const theta = 2 * sol.alpha2;
  trakArea += sol.rInner ** 2 / 2 * (theta - Math.sin(theta));   // Kreisabschnitt hinter dem Übergang
  const n = 4000, dr = (sol.arcR - sol.rInner) / n;
  let radial = 0;
  for (let i = 0; i < n; i++) {
    const r = sol.rInner + (i + 0.5) * dr;
    radial += 2 * prof(sol.zFocus + r) * r * dr;
  }
  return 2 * RT * trakArea + theta * radial;
}

describe("buildHornGeometry – geschlossener Körper", () => {
  const tris = trianglesOf(geometry());

  it("wasserdicht und einheitlich orientiert", () => {
    expect(edgeCheck(tris)).toEqual({ open: 0, flipped: 0 });
  });

  it("Normalen zeigen nach außen (positives Volumen)", () => {
    expect(signedVolume(tris)).toBeGreaterThan(0);
  });

  it("Volumen stimmt mit unabhängiger Integration überein (±0,5 %)", () => {
    expect(signedVolume(tris) / referenceVolume(s, profile)).toBeCloseTo(1, 2);
  });

  it("auch ohne Traktrix und mit Verrundung geschlossen", () => {
    const s0 = solveHorn(500, 0, RT, 120, 100);
    expect(edgeCheck(trianglesOf(geometry(s0, makeProfile(s0, RT, H_MOUTH, "linear", 0.5))))).toEqual({ open: 0, flipped: 0 });
    const fillet = computeFillet(s, RT, H_MOUTH, "exponential", 0.5, 100);
    const withFillet = trianglesOf(geometry(s, makeProfile(s, RT, H_MOUTH, "exponential", 0.5, fillet), fillet));
    expect(edgeCheck(withFillet)).toEqual({ open: 0, flipped: 0 });
  });
});

describe("buildHornGeometry – Konstruktion", () => {
  const byName = geo => Object.fromEntries(geo.surfaces.map(f => [f.name, f.grid]));

  it("Mittelschnitt (x = 0) des Deckels ist das Seitenprofil", () => {
    const { linTop } = byName(geometry());
    const mid = linTop.map(row => row[row.length >> 1]);   // φ = 0
    for (const [x, h, z] of mid) {
      expect(x).toBeCloseTo(0, 9);
      expect(h).toBeCloseTo(profile(z), 9);
    }
  });

  it("Rotationskörper: gleicher Abstand zum Fokus → gleiche Höhe", () => {
    const { linTop } = byName(geometry());
    for (const row of linTop) {
      const r = Math.hypot(row[0][0], row[0][2] - s.zFocus);
      for (const [x, h, z] of row) {
        expect(Math.hypot(x, z - s.zFocus)).toBeCloseTo(r, 6);
        expect(h).toBeCloseTo(row[0][1], 9);
      }
    }
  });

  it("gerade Seitenwände liegen im Öffnungswinkel, Mund auf dem Bogen", () => {
    const { linWallR, capMouth } = byName(geometry());
    for (const [, top] of linWallR) expect(Math.atan2(top[0], top[2] - s.zFocus)).toBeCloseTo(s.alpha2, 9);
    for (const [bottom, top] of capMouth) {
      expect(Math.hypot(top[0], top[2] - s.zFocus)).toBeCloseTo(s.arcR, 6);
      expect(top[1]).toBeCloseTo(H_MOUTH / 2, 6);
      expect(bottom[1]).toBeCloseTo(-H_MOUTH / 2, 6);
    }
  });

  it("Traktrix-Sektion ohne Verrundung: ebenes Prisma der Höhe 2·rt, Wände auf der Traktrix", () => {
    const { trakTop, trakWallR } = byName(geometry());
    for (const row of trakTop) for (const [, h] of row) expect(h).toBeCloseTo(RT, 9);
    const wallPts = traktrixPoints(s, 40);
    trakWallR.forEach(([, top], i) => {
      expect(top[0]).toBeCloseTo(wallPts[i][0], 6);
      expect(top[2]).toBeCloseTo(wallPts[i][1], 6);
    });
  });

  it("Verrundung (Variante a): Ringband im Prisma vor dem inneren Teilkreis steigt an", () => {
    const fillet = computeFillet(s, RT, H_MOUTH, "exponential", 0.5, 100);
    const fp = makeProfile(s, RT, H_MOUTH, "exponential", 0.5, fillet);
    const { trakTop } = byName(geometry(s, fp, fillet));
    const rT1 = fillet.zT1 - s.zFocus;
    for (const row of trakTop) {
      for (const [x, h, z] of row) {
        const r = Math.hypot(x, z - s.zFocus);
        if (r <= rT1) expect(h).toBeCloseTo(RT, 9);             // innen eben
        else expect(h).toBeCloseTo(fp(s.zFocus + r), 9);        // im Band: rotierte Verrundung
      }
    }
    expect(trakTop.flat().some(([, h]) => h > RT + 0.1)).toBe(true);
  });
});

describe("Fokus weit im Horn (lange Traktrix): Höhenregel hinter dem Fokus", () => {
  // Fall aus der App: L 700, Lt 345, Hypex 0,7, Verrundung (begrenzt) – der Fokus liegt weiter
  // vom Throat entfernt, als der innere Teilkreis reicht; der Abstand zum Fokus hob früher den
  // Deckel am Throat bis in die Aufweitung
  const sl = createHornMath(140).solveHorn(700, 345.3, RT, 182, 90);
  const fl = computeFillet(sl, RT, 200, "hypex", 0.7, 631);
  const pl = makeProfile(sl, RT, 200, "hypex", 0.7, fl);
  const T = 10;
  const shell = buildShellGeometry(sl, RT, pl, fl, T);
  const grid = name => shell.surfaces.find(f => f.name === name).grid;

  it("Voraussetzung: Fokus weiter hinten als der innere Teilkreis vorn", () => {
    expect(sl.zFocus).toBeGreaterThan(sl.rInner);
  });

  it("focusRadius: auf der Achse z − zFocus, am Fokus stetig, nach vorn monoton", () => {
    for (const z of [0, 100, sl.zFocus, 400, 600]) expect(focusRadius(sl, 0, z)).toBeCloseTo(z - sl.zFocus, 9);
    for (const x of [0, 20, 60]) {
      expect(focusRadius(sl, x, sl.zFocus - 1e-9)).toBeCloseTo(focusRadius(sl, x, sl.zFocus), 6);
      let prev = -Infinity;
      for (let z = 0; z <= 600; z += 5) { const r = focusRadius(sl, x, z); expect(r).toBeGreaterThanOrEqual(prev); prev = r; }
    }
  });

  it("Mittelschnitt des Luftvolumens in der Traktrix = Seitenprofil", () => {
    for (const row of grid("inner.trakTop")) {
      const [x, h, z] = row[row.length >> 1];
      expect(x).toBeCloseTo(0, 9);
      expect(h).toBeCloseTo(pl(z), 9);
    }
  });

  it("Deckel steigt nirgends zum Throat hin an: am Throat innen rt, außen rt + t", () => {
    const inner = grid("inner.trakTop"), outer = grid("outer.trakTop");
    for (const [, h] of inner[0]) expect(h).toBeCloseTo(RT, 9);
    for (const [, h] of outer[0]) expect(h).toBeCloseTo(RT + T, 6);
    for (let j = 0; j < inner[0].length; j++)
      for (let i = 1; i < inner.length; i++) expect(inner[i][j][1]).toBeGreaterThanOrEqual(inner[i - 1][j][1] - 1e-9);
  });

  it("Querschnitt am Throat ≈ quadratischer Throat (2·rt)² (Wellenfront dort kaum gekrümmt)", () => {
    expect(crossSection(sl, pl)[0].A / (2 * RT) ** 2).toBeCloseTo(1, 2);
  });
});
