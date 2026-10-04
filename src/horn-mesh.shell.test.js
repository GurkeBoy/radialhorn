/**
 * Schale mit Wandstärke: geschlossen, überall t dick (senkrecht zur Fläche), bündige Enden.
 */
import { describe, it, expect } from "vitest";
import { solveHorn, makeProfile, computeFillet, traktrixPoints } from "./horn-math.js";
import { buildShellGeometry, offsetHeight, triangulate, shellPlanOutline, shellProfileOutline } from "./horn-mesh.js";

const RT = 25.4, H_MOUTH = 200, T = 20;
const s = solveHorn(500, 60, RT, 120, 100);
const profile = makeProfile(s, RT, H_MOUTH, "exponential", 0.5);
const hAt = r => profile(s.zFocus + r);
const shell = (sol = s, prof = profile, fillet = null, t = T) => buildShellGeometry(sol, RT, prof, fillet, t);
const surface = (geo, name) => geo.surfaces.find(f => f.name === name).grid;

const key = p => p.map(v => Math.round(v * 1e6)).join(",");
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const volume = tris => tris.reduce((V, [a, b, c]) => { const n = cross(b, c); return V + (a[0] * n[0] + a[1] * n[1] + a[2] * n[2]) / 6; }, 0);
function edgeCheck(tris) {
  const directed = new Map();
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const e = key(t[k]) + ">" + key(t[(k + 1) % 3]);
    directed.set(e, (directed.get(e) || 0) + 1);
  }
  let open = 0, flipped = 0;
  for (const [e, n] of directed) {
    const [a, b] = e.split(">");
    if (!directed.get(b + ">" + a)) open++;
    if (n > 1) flipped++;
  }
  return { open, flipped };
}
/** Kleinster Abstand eines Punkts zu einem Polygonzug. */
function distToPolyline(p, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const ab = [b[0] - a[0], b[1] - a[1]], ap = [p[0] - a[0], p[1] - a[1]];
    const f = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1)));
    best = Math.min(best, Math.hypot(ap[0] - f * ab[0], ap[1] - f * ab[1]));
  }
  return best;
}

describe("buildShellGeometry – geschlossener Körper", () => {
  it("wasserdicht, einheitlich orientiert, positives Volumen", () => {
    const tris = shell().surfaces.flatMap(triangulate);
    expect(edgeCheck(tris)).toEqual({ open: 0, flipped: 0 });
    expect(volume(tris)).toBeGreaterThan(0);
  });

  it("auch ohne Traktrix, mit Verrundung und mit Verrundung kleiner als die Wandstärke", () => {
    const s0 = solveHorn(500, 0, RT, 120, 100);
    const cases = [[s0, makeProfile(s0, RT, H_MOUTH, "linear", 0.5), null]];
    for (const R of [100, 5]) {
      const f = computeFillet(s, RT, H_MOUTH, "exponential", 0.5, R);
      cases.push([s, makeProfile(s, RT, H_MOUTH, "exponential", 0.5, f), f]);
    }
    for (const [sol, prof, f] of cases) {
      const tris = shell(sol, prof, f).surfaces.flatMap(triangulate);
      expect(edgeCheck(tris)).toEqual({ open: 0, flipped: 0 });
      expect(volume(tris)).toBeGreaterThan(0);
    }
  });
});

describe("Wandstärke senkrecht zur Fläche", () => {
  it("Profilschnitt: Außenkurve überall im Abstand t zur Innenkurve (und umgekehrt)", () => {
    const outer = offsetHeight(hAt, s.arcR, T);
    const rs = Array.from({ length: 2001 }, (_, i) => s.rInner * 0.5 + (s.arcR - s.rInner * 0.5) * i / 2000);
    const inner = rs.map(r => [r, hAt(r)]), outerPts = rs.map(r => [r, outer(r)]);
    // Ausgenommen: das Mundende (Gegenstück hinter dem Mundschnitt) und der Knick am Übergang –
    // dort treffen sich außen zwei Versatzflächen in einer scharfen Kante, der Knickpunkt ist
    // t / cos(Knickwinkel/2) davon entfernt (Wand minimal dicker, nie dünner).
    const away = ([r]) => Math.abs(r - s.rInner) > 2 && r < s.arcR - T;
    for (const p of outerPts.filter(away)) expect(distToPolyline(p, inner)).toBeCloseTo(T, 1);
    for (const p of inner.filter(away)) expect(distToPolyline(p, outerPts)).toBeCloseTo(T, 1);
    const kink = Math.atan((hAt(s.rInner + 0.01) - hAt(s.rInner)) / 0.01);
    expect(distToPolyline([s.rInner, hAt(s.rInner)], outerPts)).toBeCloseTo(T / Math.cos(kink / 2), 2);
  });

  it("ebene Bereiche: außen genau rt + t", () => {
    const outer = offsetHeight(hAt, s.arcR, T);
    expect(outer(s.rInner * 0.5)).toBeCloseTo(RT + T, 6);
    const top = surface(shell(), "outer.trakTop");
    expect(top[1][Math.floor(top[1].length / 2)][1]).toBeCloseTo(RT + T, 6);
  });

  it("Verrundung mit Radius R > t: außen Kreisbogen mit Radius R − t", () => {
    const f = computeFillet(s, RT, H_MOUTH, "exponential", 0.5, 100);
    const prof = makeProfile(s, RT, H_MOUTH, "exponential", 0.5, f);
    const outer = offsetHeight(r => prof(s.zFocus + r), s.arcR, T);
    const rc = f.zc - s.zFocus;   // Mittelpunkt des Verrundungskreises im Abstand zum Fokus
    // über dem Bogen (rc … T2) – davor ist die Außenseite eben
    for (const r of [rc, rc + 4, rc + 8, rc + 12]) {
      expect(Math.hypot(r - rc, outer(r) - f.hc)).toBeCloseTo(f.R - T, 1);
    }
  });

  it("Draufsicht: Außenwände überall im Abstand t zur Innenkontur", () => {
    const innerContour = [...traktrixPoints(s, 4000), [s.xMouth * 1.2, s.zFocus + (s.zMouth - s.zFocus) * 1.2]];
    const geo = shell();
    for (const name of ["outer.trakWallR", "outer.linWallR"]) {
      for (const [, top] of surface(geo, name)) {
        if (top[2] < 1) continue;   // am Throat-Schnitt z = 0 liegt die Außenwand näher an der Achse
        expect(distToPolyline([top[0], top[2]], innerContour)).toBeCloseTo(T, 1);
      }
    }
  });
});

describe("2D-Schnitte der Schale (Draufsicht, Seitenriss)", () => {
  it("Draufsicht: Außenkontur im Abstand t zur Innenwand, endet an Mundkante + t·Normale", () => {
    const outline = shellPlanOutline(s, RT, T);
    const innerContour = [...traktrixPoints(s, 4000), [s.xMouth, s.zMouth]];
    for (const p of outline.slice(0, -1)) {
      if (p[1] < 1) continue;   // am Throat-Schnitt z = 0 liegt die Kontur näher an der Achse
      expect(distToPolyline(p, innerContour)).toBeCloseTo(T, 1);
    }
    const [xE, zE] = outline[outline.length - 1];
    expect(Math.hypot(xE - s.xMouth, zE - s.zMouth)).toBeCloseTo(T, 9);
    expect(outline[0][1]).toBe(0);
  });

  it("Draufsicht: Kontur liegt auf der Außenwand des 3D-Körpers", () => {
    const geo = shell();
    const wall3d = ["outer.trakWallR", "outer.linWallR"].flatMap(n => surface(geo, n).map(([, top]) => [top[0], top[2]]))
      .sort((a, b) => a[1] - b[1]);
    for (const p of shellPlanOutline(s, RT, T)) expect(distToPolyline(p, wall3d)).toBeLessThan(0.5);
  });

  it("Seitenriss: eben rt + t, am Mund hMouth/2 + t, überall mindestens t von der Innenkontur", () => {
    const outline = shellProfileOutline(s, RT, profile, T);
    const inner = outline.map(([, z]) => [profile(z), z]);
    for (const [h, z] of outline) {
      if (z > 1 && z < s.zInnerApex - T) expect(h).toBeCloseTo(RT + T, 6);
      expect(distToPolyline([h, z], inner)).toBeGreaterThan(T - 0.05);
    }
    expect(outline[outline.length - 1][0]).toBeCloseTo(H_MOUTH / 2 + T, 6);
  });

  it("mit Flansch beginnen beide Konturen erst bei z = Flanschdicke", () => {
    expect(shellPlanOutline(s, RT, T, 10)[0][1]).toBe(10);
    expect(shellProfileOutline(s, RT, profile, T, 10)[0][1]).toBe(10);
  });
});

describe("Enden an Throat und Mund", () => {
  const geo = shell();
  const pointsOf = name => {
    const f = geo.surfaces.find(x => x.name === name);
    return f.grid ? f.grid.flat() : f.triangles.flat();
  };
  const all = geo.surfaces.flatMap(f => (f.grid ? f.grid.flat() : f.triangles.flat()));
  const h1 = H_MOUTH / 2;
  const u = [Math.sin(s.alpha2), Math.cos(s.alpha2)];   // Richtung der rechten Wand

  it("Throat: Ringfläche in der Ebene z = 0, nichts ragt dahinter", () => {
    for (const [, , z] of pointsOf("rimThroat")) expect(z).toBeCloseTo(0, 9);
    expect(Math.min(...all.map(p => p[2]))).toBeGreaterThanOrEqual(-1e-9);
  });

  it("Deckel/Boden: außen waagerecht auf hMouth/2 + t abgeschnitten", () => {
    expect(Math.max(...all.map(p => p[1]))).toBeCloseTo(h1 + T, 9);
    expect(Math.min(...all.map(p => p[1]))).toBeCloseTo(-h1 - T, 9);
  });

  it("Deckel/Boden: Stirnfläche bündig auf dem Mundbogen, senkrecht von h1 bis h1 + t", () => {
    for (const name of ["rimMouthTop", "rimMouthBottom"]) {
      const pts = pointsOf(name);
      for (const [x, , z] of pts) expect(Math.hypot(x, z - s.zFocus)).toBeCloseTo(s.arcR, 6);
      const hs = pts.map(p => Math.abs(p[1]));
      expect(Math.min(...hs)).toBeCloseTo(h1, 9);
      expect(Math.max(...hs)).toBeCloseTo(h1 + T, 9);
    }
  });

  it("Seitenwände: Stirnfläche senkrecht zur Wand durch die Mundkante, volle Höhe", () => {
    const pts = pointsOf("rimEndR");
    // alle Punkte in der Ebene (p − F)·u = arcR
    for (const [x, , z] of pts) expect(x * u[0] + (z - s.zFocus) * u[1]).toBeCloseTo(s.arcR, 6);
    // Außenecke = Mundkante + t·Normale (wie der Wandstärke-Strich in der Draufsicht)
    const outerX = s.xMouth + T * Math.cos(s.alpha2), outerZ = s.zMouth - T * Math.sin(s.alpha2);
    const corners = pts.filter(([x, , z]) => Math.hypot(x - outerX, z - outerZ) < 1e-6);
    expect(corners.length).toBeGreaterThan(0);
    for (const [, h] of corners) expect(Math.abs(h)).toBeCloseTo(h1 + T, 9);
    expect(Math.max(...pts.map(p => p[1]))).toBeCloseTo(h1 + T, 9);
  });

  it("links spiegelbildlich", () => {
    for (const [x, , z] of pointsOf("rimEndL")) expect(-x * u[0] + (z - s.zFocus) * u[1]).toBeCloseTo(s.arcR, 6);
  });
});

describe("extreme Wandstärke (größer als die Krümmung der Traktrix)", () => {
  const t = 60;
  const geo = shell(s, profile, null, t);

  it("geschlossen und richtig orientiert", () => {
    const tris = geo.surfaces.flatMap(triangulate);
    expect(edgeCheck(tris)).toEqual({ open: 0, flipped: 0 });
    expect(volume(tris)).toBeGreaterThan(0);
  });

  it("Außenkontur der Traktrix ohne Schlaufe: z und x steigen monoton", () => {
    const wall = surface(geo, "outer.trakWallR").map(([, top]) => top);
    for (let i = 1; i < wall.length; i++) {
      expect(wall[i][2]).toBeGreaterThan(wall[i - 1][2]);
      expect(wall[i][0]).toBeGreaterThanOrEqual(wall[i - 1][0] - 1e-9);
    }
  });

  it("Oberkante der Traktrix-Außenwand eben auf rt + t (abseits der Aufweitung)", () => {
    const wall = surface(geo, "outer.trakWallR").map(([, top]) => top);
    const front = wall.filter(([, , z]) => z < s.zTrans / 2);
    expect(front.length).toBeGreaterThan(3);
    for (const [, h] of front) expect(h).toBeCloseTo(RT + t, 6);
  });

  it("Außenhöhe nirgends unter der Innenhöhe + t im Prisma", () => {
    for (const [, h] of surface(geo, "outer.trakTop").flat()) expect(h).toBeGreaterThanOrEqual(RT + t - 1e-9);
  });
});
