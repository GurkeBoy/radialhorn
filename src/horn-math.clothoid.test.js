/**
 * Krümmungsstetiger Übergang (Klothoide) zwischen Traktrix und gerader Wand in der Draufsicht.
 */
import { describe, it, expect } from "vitest";
import {
  createHornMath, hasClothoid, traktrixPoints, clothoidPoints, clothoidTable, clothoidEnd, entrancePoints,
  makeProfile, crossSection, xN, zN,
} from "./horn-math.js";
import { buildHornGeometry, buildShellGeometry } from "./horn-mesh.js";
import { edgeCheck, trianglesOf } from "./test-helpers.js";

const RT = 25.4, DW = 120, DH = 100, L = 500, LT = 60, LEN = 30;
const math = createHornMath(140, { clothoid: LEN });
const s = math.solveHorn(L, LT, RT, DW, DH);
const s0 = createHornMath(140).solveHorn(L, LT, RT, DW, DH);

/** Tangentenwinkel (zur Achse) und Krümmung einer Traktrix bei Parameter τ. */
const trakTheta = tau => Math.atan(1 / Math.sinh(tau));
const trakKappa = tau => 1 / (s.r0 * Math.sinh(tau));

describe("Klothoide – Anschlüsse", () => {
  it("wird berechnet", () => {
    expect(s).not.toBeNull();
    expect(hasClothoid(s)).toBe(true);
    expect(hasClothoid(s0)).toBe(false);
  });

  it("Beginn auf der Traktrix: Lage, Richtung und Krümmung stimmen überein", () => {
    const c = s.clothoid;
    expect(c.start[0]).toBeCloseTo(s.r0 * xN(s.tEnd), 9);
    expect(c.start[1]).toBeCloseTo(s.r0 * (zN(s.tTh) - zN(s.tEnd)), 9);
    expect(c.theta0).toBeCloseTo(trakTheta(s.tEnd), 12);
    expect(c.kappa0).toBeCloseTo(trakKappa(s.tEnd), 12);
    expect(c.theta0).toBeLessThan(s.alpha2);
  });

  it("Ende: Winkel genau α, Krümmung 0, Lage = Beginn der geraden Wand", () => {
    const tab = clothoidTable(s.clothoid, 4000);
    const end = tab.at(-1);
    expect(end.theta).toBeCloseTo(s.alpha2, 12);
    expect(end.x).toBeCloseTo(s.xTrans, 6);
    expect(end.z).toBeCloseTo(s.zTrans, 6);
  });

  it("Bogenlänge der Klothoide = ℓ", () => {
    const pts = clothoidPoints(s, 4000);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    expect(len).toBeCloseTo(LEN, 3);
  });

  it("Krümmung entlang der Klothoide fällt linear (numerisch aus den Punkten)", () => {
    const tab = clothoidTable(s.clothoid, 400);
    const ds = LEN / 400;
    for (const k of [50, 200, 350]) {
      const kappa = (tab[k + 1].theta - tab[k - 1].theta) / (2 * ds);
      expect(kappa).toBeCloseTo(s.clothoid.kappa0 * (1 - k * ds / LEN), 6);
    }
  });
});

describe("Klothoide – Einbindung in die Geometrie", () => {
  it("Eingang (Traktrix + Klothoide) ist axial genau Lt lang", () => {
    expect(s.zTrans).toBeCloseTo(LT, 6);
    expect(entrancePoints(s, 100).at(-1)[1]).toBeCloseTo(LT, 6);
  });

  it("gerade Wand ab dem Klothoiden-Ende zeigt auf den (neuen) Fokus", () => {
    expect(s.xTrans / (s.zTrans - s.zFocus)).toBeCloseTo(Math.tan(s.alpha2), 9);
    expect(s.zFocus).not.toBeCloseTo(s0.zFocus, 3);   // Fokus verschiebt sich
  });

  it("Traktrix endet vor dem Übergangsparameter T", () => {
    expect(s.tEnd).toBeGreaterThan(s.tTrans);
    expect(traktrixPoints(s, 10).at(-1)[0]).toBeCloseTo(s.clothoid.start[0], 9);
  });

  it("Gesamtlänge L bleibt erhalten", () => {
    expect(s.zApex - s.hatTipZ).toBeCloseTo(L, 6);
  });

  it("kleine Längen gehen stetig in die Form ohne Klothoide über", () => {
    const tiny = createHornMath(140, { clothoid: 1e-4 }).solveHorn(L, LT, RT, DW, DH);
    for (const k of ["r0", "zFocus", "arcR", "xMouth", "zInnerApex"]) expect(tiny[k]).toBeCloseTo(s0[k], 3);
  });

  it("zu lange Klothoide ist unlösbar (null statt falscher Geometrie)", () => {
    expect(createHornMath(140, { clothoid: 5000 }).solveHorn(L, LT, RT, DW, DH)).toBeNull();
  });

  it("Grenzfunktionen arbeiten mit Klothoide", () => {
    const ltMax = math.maxLt(L, RT, DW, DH);
    const lMax = math.maxLforRaumecke(LT, RT, DW, DH);
    const ltMin = math.minLtForRaumecke(L, RT, DW, DH);
    expect(math.solveHorn(L, ltMax * 0.99, RT, DW, DH)).not.toBeNull();
    expect(lMax).toBeGreaterThan(L * 0.5);
    expect(ltMin).not.toBeNull();
  });
});

describe("Querschnitt mit Klothoide", () => {
  const profile = makeProfile(s, RT, 2 * RT, "linear", 0.5);   // konstante Höhe: A hängt nur von der Draufsicht ab
  const pts = crossSection(s, profile, 2000);

  it("Sektionen Traktrix → Klothoide → gerade Wand in dieser Reihenfolge", () => {
    const parts = [...new Set(pts.slice(1).map(p => p.part))];
    expect(parts).toEqual(["traktrix", "klothoide", "linear"]);
  });

  it("A(z) ohne Knick: Steigung an beiden Übergängen stetig", () => {
    for (const from of ["traktrix", "klothoide"]) {
      const i = pts.findIndex((p, k) => k > 0 && p.part !== from && pts[k - 1].part === from);
      const [a, b, c, d] = [pts[i - 2], pts[i - 1], pts[i + 1], pts[i + 2]];
      const left = (b.A - a.A) / (b.z - a.z), right = (d.A - c.A) / (d.z - c.z);
      expect(right / left).toBeCloseTo(1, 1);
    }
  });

  it("zum Vergleich: ohne Klothoide springt die Steigung", () => {
    const p0 = makeProfile(s0, RT, 2 * RT, "linear", 0.5);
    const q = crossSection(s0, p0, 2000);
    const i = q.findIndex((p, k) => k > 0 && p.part === "linear" && q[k - 1].part === "traktrix");
    const left = (q[i - 1].A - q[i - 2].A) / (q[i - 1].z - q[i - 2].z);
    const right = (q[i + 2].A - q[i + 1].A) / (q[i + 2].z - q[i + 1].z);
    expect(right / left).toBeGreaterThan(1.2);
  });
});

describe("3D-Körper mit Klothoide", () => {
  const profile = makeProfile(s, RT, 200, "exponential", 0.5);
  it("Luftvolumen und Schale wasserdicht, Klothoide als eigene Fläche", () => {
    const air = buildHornGeometry(s, RT, profile);
    expect(edgeCheck(trianglesOf(air))).toEqual({ open: 0, flipped: 0 });
    expect(air.surfaces.filter(f => f.section === "klothoide").length).toBe(4);
    for (const t of [20, 60]) expect(edgeCheck(trianglesOf(buildShellGeometry(s, RT, profile, null, t)))).toEqual({ open: 0, flipped: 0 });
  });

  it("Wand der Klothoiden-Fläche liegt auf der Klothoide", () => {
    const air = buildHornGeometry(s, RT, profile);
    const wall = air.surfaces.find(f => f.name === "kloWallR").grid.map(([, top]) => [top[0], top[2]]);
    const curve = clothoidPoints(s, 4000);
    for (const [x, z] of wall) {
      const d = Math.min(...curve.map(([cx, cz]) => Math.hypot(cx - x, cz - z)));
      expect(d).toBeLessThan(0.05);
    }
  });
});

describe("Klothoide – Grenzen", () => {
  it("Mindest-Lt: knapp darüber lösbar (Klothoide beginnt am Throat), darunter nicht", () => {
    const ltMin = math.minLtForClothoid(RT);
    const above = math.solveHorn(L, ltMin + 0.01, RT, DW, DH);
    expect(above).not.toBeNull();
    expect(above.clothoid.start[1]).toBeLessThan(0.5);
    expect(math.solveHorn(L, ltMin - 0.01, RT, DW, DH)).toBeNull();
  });

  it("keine Scheinlösungen: jede gefundene Lösung erfüllt die Eingangslänge", () => {
    for (const lt of [5, 10, 14, 15, 20, 40, 80]) {
      const sol = math.solveHorn(L, lt, RT, DW, DH);
      if (sol) expect(sol.zTrans).toBeCloseTo(lt, 6);
    }
  });

  it("maxLt liegt oberhalb des Mindest-Lt und ist lösbar", () => {
    const ltMax = math.maxLt(L, RT, DW, DH);
    expect(ltMax).toBeGreaterThan(math.minLtForClothoid(RT));
    expect(math.solveHorn(L, ltMax * 0.999, RT, DW, DH)).not.toBeNull();
    expect(math.solveHorn(L, ltMax * 1.01, RT, DW, DH)).toBeNull();
  });

  it("ohne Klothoide ist das Mindest-Lt 0", () => {
    expect(createHornMath(140).minLtForClothoid(RT)).toBe(0);
  });
});

describe("clothoidEnd (Suchen ohne Tabelle)", () => {
  it("bitgleich mit dem letzten Tabellenpunkt", () => {
    for (const n of [1, 8, 64, 400]) {
      const end = clothoidEnd(s.clothoid, n), last = clothoidTable(s.clothoid, n).at(-1);
      expect(Object.is(end.x, last.x) && Object.is(end.z, last.z)).toBe(true);
    }
  });

  it("Endpunkt ist der Übergang in die gerade Wand", () => {
    const end = clothoidEnd(s.clothoid);
    expect(end.x).toBe(s.xTrans);
    expect(end.z).toBe(s.zTrans);
  });
});
