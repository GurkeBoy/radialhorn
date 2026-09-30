/**
 * 3D-Körper: geschlossen, richtig orientiert, maßhaltig und konsistent mit der
 * vereinbarten Konstruktion (Traktrix-Prisma + Rotationskörper um den Fokus).
 */
import { describe, it, expect } from "vitest";
import { solveHorn, makeProfile, computeFillet, traktrixPoints } from "./horn-math.js";
import { buildHornGeometry, triangulate } from "./horn-mesh.js";
import { stlBinary } from "./export/stl.js";

const RT = 25.4, H_MOUTH = 200;
const s  = solveHorn(500, 60, RT, 120, 100);
const profile = makeProfile(s, RT, H_MOUTH, "exponential", 0.5);
const geometry = (sol = s, prof = profile, fillet = null) => buildHornGeometry(sol, RT, prof, fillet);
const trianglesOf = geo => geo.surfaces.flatMap(triangulate);

const key = p => p.map(v => Math.round(v * 1e6)).join(",");
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const signedVolume = tris => tris.reduce((V, [a, b, c]) => V + (a[0] * cross(b, c)[0] + a[1] * cross(b, c)[1] + a[2] * cross(b, c)[2]) / 6, 0);

/** Gerichtete Kanten zählen: geschlossen und konsistent orientiert ⇔ jede Kante genau einmal je Richtung. */
function edgeCheck(tris) {
  const directed = new Map();
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const e = key(t[k]) + ">" + key(t[(k + 1) % 3]);
      directed.set(e, (directed.get(e) || 0) + 1);
    }
  }
  let open = 0, flipped = 0;
  for (const [e, n] of directed) {
    const [a, b] = e.split(">");
    const back = directed.get(b + ">" + a) || 0;
    if (back === 0) open++;
    if (n > 1) flipped++;
  }
  return { open, flipped };
}

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
        expect(h).toBe(row[0][1]);
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

describe("stlBinary", () => {
  const tris = trianglesOf(geometry());
  const buf = stlBinary(tris);
  const view = new DataView(buf);

  it("Größe und Dreiecksanzahl", () => {
    expect(buf.byteLength).toBe(84 + 50 * tris.length);
    expect(view.getUint32(80, true)).toBe(tris.length);
  });

  it("Normalen zeigen nach außen (positives Volumen in STL-Koordinaten)", () => {
    let V = 0;
    for (let t = 0; t < tris.length; t++) {
      const p = [0, 1, 2].map(k => [0, 1, 2].map(c => view.getFloat32(84 + 50 * t + 12 + 12 * k + 4 * c, true)));
      const c = cross(p[1], p[2]);
      V += (p[0][0] * c[0] + p[0][1] * c[1] + p[0][2] * c[2]) / 6;
    }
    expect(V / signedVolume(tris)).toBeCloseTo(1, 4);
  });

  it("Hochachse Z: Höhe des Mundes ±hMouth/2", () => {
    let zMax = -Infinity;
    for (let t = 0; t < tris.length; t++) for (let k = 0; k < 3; k++) zMax = Math.max(zMax, view.getFloat32(84 + 50 * t + 12 + 12 * k + 8, true));
    expect(zMax).toBeCloseTo(H_MOUTH / 2, 3);
  });
});
