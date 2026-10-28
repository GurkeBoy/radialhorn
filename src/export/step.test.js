import { describe, it, expect } from "vitest";
import { solveHorn, makeProfile, computeFillet, createHornMath, throatMorph, mouthRounding, maxMorphLength } from "../horn-math.js";
import { buildBrep, hornPatches, ribPatches, stepFile, hornStep, circleOf } from "./step.js";
import { flangeLayout } from "../horn-mesh.js";

const RT = 25.4, H = 200;
const BMS = { diameter: null, fallback: 120, thickness: 10, holes: { count: 4, circle: 101.6, diameter: 6.6, angle: 0 } };
const design = (s, curve = "exponential", R = 0, wall = 0, { edgeR = 0, morph = null, flange = null, mouth = 0 } = {}) => {
  const fillet = R > 0 ? computeFillet(s, RT, H, curve, 0.5, R) : null;
  const profile = makeProfile(s, RT, H, curve, 0.5, fillet);
  const throat = morph && throatMorph(s, RT, morph === "max" ? maxMorphLength(s) : undefined);
  const m = mouth ? mouthRounding(s, profile, throat, mouth) : throat;
  return { s, rt: RT, profile, fillet, wall, edgeR, morph: m,
           flange: flange && flangeLayout(s, RT, profile, fillet, wall, { ...BMS, ...flange }, edgeR, m) };
};
const std = () => solveHorn(500, 60, RT, 120, 100);
const CASES = {
  standard: design(solveHorn(500, 60, RT, 120, 100)),
  "ohne Traktrix": design(solveHorn(500, 0, RT, 120, 100), "linear"),
  Verrundung: design(solveHorn(500, 60, RT, 120, 100), "exponential", 40),
  Klothoide: design(createHornMath(140, { clothoid: 30 }).solveHorn(500, 60, RT, 120, 100)),
  "lange Traktrix": design(createHornMath(140).solveHorn(700, 345.3, RT, 182, 90), "hypex"),
  "Schale 12 mm": design(solveHorn(500, 60, RT, 120, 100), "exponential", 0, 12),
  "Schale 3 mm, Verrundung": design(solveHorn(500, 60, RT, 120, 100), "exponential", 40, 3),
  "Schale 25 mm ohne Traktrix": design(solveHorn(500, 0, RT, 120, 100), "linear", 0, 25),
  "Schale 12 mm, Klothoide": design(createHornMath(140, { clothoid: 30 }).solveHorn(500, 60, RT, 120, 100), "exponential", 0, 12),
  "Schale 3 mm, lange Traktrix": design(createHornMath(140).solveHorn(700, 345.3, RT, 182, 90), "hypex", 40, 3),
  "runder Throat": design(std(), "exponential", 0, 0, { morph: true }),
  "runder Throat ohne Traktrix": design(solveHorn(500, 0, RT, 120, 100), "linear", 0, 0, { morph: true }),
  "runder Throat bis zum Mund": design(std(), "exponential", 0, 0, { morph: "max" }),
  "Schale, runder Throat, e = 0": design(std(), "exponential", 0, 12, { morph: true }),
  "Schale, runder Throat, e = t": design(std(), "exponential", 0, 12, { morph: true, edgeR: 12 }),
  "Schale, runder Throat, Lₜ = 20": design(solveHorn(500, 20, RT, 120, 100), "exponential", 0, 12, { morph: true, edgeR: 12 }),
  "Schale, Kanten r = 6": design(std(), "exponential", 0, 12, { edgeR: 6 }),
  "Schale, Kanten r = t ohne Traktrix": design(solveHorn(500, 0, RT, 120, 100), "linear", 0, 12, { edgeR: 12 }),
  "Schale 3 mm, Kanten, Klothoide, Verrundung": design(createHornMath(140, { clothoid: 30 }).solveHorn(500, 60, RT, 120, 100), "exponential", 40, 3, { edgeR: 3 }),
  Flansch: design(std(), "exponential", 0, 12, { flange: {} }),
  "Mundecken R = 30": design(std(), "exponential", 0, 0, { mouth: 30 }),
  "Schale, Mundecken, e = 0": design(std(), "exponential", 0, 12, { mouth: 30 }),
  "Schale, Mundecken, e = t": design(std(), "exponential", 0, 12, { mouth: 30, edgeR: 12 }),
  "Schale, runder Throat + Mundecken": design(std(), "exponential", 0, 12, { morph: true, mouth: 30, edgeR: 12 }),
  "Flansch, Mundecken, Rippen": design(std(), "exponential", 0, 12, { mouth: 30, flange: { ribs: { thickness: 4, length: 30 } } }),
  "Flansch mit Stützrippen": design(std(), "exponential", 0, 12, { flange: { ribs: { thickness: 4, length: 30 } } }),
  "Flansch, Verrundung r = 3": design(std(), "exponential", 0, 12, { flange: { round: 3 } }),
  "Flansch, Verrundung, Rippen": design(std(), "exponential", 0, 12, { flange: { round: 3, ribs: { thickness: 4, length: 30 } } }),
  "Flansch ohne Bohrungen": design(std(), "exponential", 0, 12, { flange: { holes: { ...BMS.holes, count: 0 } } }),
  "Flansch, runder Throat, Kanten": design(std(), "exponential", 0, 12, { morph: true, edgeR: 12, flange: {} }),
  "Flansch ohne Traktrix, 6 Bohrungen": design(solveHorn(500, 0, RT, 120, 100), "linear", 0, 12, { flange: { holes: { count: 6, circle: null, diameter: 9, angle: 15 } } }),
};

describe("buildBrep", () => {
  for (const [name, d] of Object.entries(CASES)) {
    // Euler-Poincaré V − E + F − H = 2 − 2g (H Lochränder): Luftvolumen g = 0, Schale (Rohr) g = 1,
    // jede Durchgangsbohrung im Flansch +1
    it(`${name}: geschlossen, jede Kante zweimal gegenläufig, Euler-Poincaré`, () => {
      const brep = buildBrep(hornPatches(d));
      expect(brep.problems).toEqual([]);
      const holes = brep.faces.reduce((n, f) => n + f.bounds.length - 1, 0);
      expect(brep.vertices.length - brep.edges.length + brep.faces.length - holes).toBe(2 - 2 * (d.wall > 0 ? 1 + (d.flange?.centers.length ?? 0) : 0));
    });
  }

  it("Flächen der Sektionen, ebene Flächen erkannt", () => {
    const { faces } = buildBrep(hornPatches(CASES.standard));
    const names = faces.map(f => f.name);
    expect(names).toEqual(expect.arrayContaining(["trakTop", "linTop", "linWallR", "capThroat", "capMouth"]));
    const planar = Object.fromEntries(faces.map(f => [f.name, !!f.planar]));
    expect(planar).toMatchObject({ capThroat: true, linWallL: true, linWallR: true, linTop: false, capMouth: false });
  });

  it("Schale: Throat-Ring eben mit Loch, Stirnflächen eben, T-Stoß an der Naht des äußeren Deckels geteilt", () => {
    const { faces } = buildBrep(hornPatches(CASES["Schale 12 mm"]));
    const byName = n => faces.find(f => f.name === n);
    const rim = byName("rimThroat");
    expect(rim.planar.normal[1]).toBeCloseTo(-1, 9);
    expect(rim.bounds).toHaveLength(2);                       // außen Außenkörper, innen Luftkanal
    expect(byName("rimEndR").planar).not.toBeNull();
    expect(byName("rimEndR").bounds).toHaveLength(1);
    // Naht: links Eckstreifen, Mitte gerader Bereich, rechts Eckstreifen → mehr als 4 Kanten
    expect(byName("outer.trakTop").bounds[0].length).toBeGreaterThan(4);
  });

  it("Regelflächen übernehmen die Parameter der Nachbarkante (Wand am Deckel genau)", () => {
    const { faces } = buildBrep(hornPatches(CASES["Schale 12 mm"]));
    const wall = faces.find(f => f.name === "outer.trakWallR"), top = faces.find(f => f.name === "outer.trakTop");
    const shared = wall.bounds[0].map(b => b.edge).find(e => top.bounds[0].some(b => b.edge === e));
    expect(shared.params).not.toBeNull();
    const along = wall.grid.length === 2 ? wall.fit.params.u : wall.fit.params.v;
    const own = [...shared.params];
    const back = own.map(x => 1 - x).reverse();
    const match = t => t.every((x, k) => Math.abs(x - along[k]) < 1e-12);
    expect(match(own) || match(back)).toBe(true);
  });

  it("runder Throat: Kreis am Throat eben, Rundungsstreifen als Flächen, endet mit dem Übergang", () => {
    const { faces } = buildBrep(hornPatches(CASES["runder Throat"]));
    const cap = faces.find(f => f.name === "capThroat");
    expect(cap.planar.normal[1]).toBeCloseTo(-1, 9);
    const strips = faces.filter(f => f.name.startsWith("roundTrak"));
    expect(strips).toHaveLength(4);
    strips.forEach(f => expect(f.planar).toBeNull());
    // Radius 0 nach dem Übergang: kein Rundungsstreifen im geraden Bereich (Standardlänge 2·rt)
    expect(faces.some(f => f.name.startsWith("roundLin"))).toBe(false);
  });

  it("Kantenradius = t: keine Splitterflächen über den Seitenwänden", () => {
    const { faces } = buildBrep(hornPatches(design(std(), "exponential", 0, 12, { edgeR: 12 })));
    expect(faces.some(f => f.name.includes("corner"))).toBe(false);
    expect(faces.filter(f => f.name.startsWith("outer.edge"))).toHaveLength(8);
  });

  it("gerundete Kanten: Streifen je Sektion und Seite, nach außen gewölbt", () => {
    const { faces } = buildBrep(hornPatches(CASES["Schale, Kanten r = 6"]));
    const strips = faces.filter(f => f.name.startsWith("outer.edge"));
    expect(strips.map(f => f.name).sort()).toEqual(["Lin", "Trak"].flatMap(k => ["BottomL", "BottomR", "TopL", "TopR"].map(s => `outer.edge${k}${s}`)).sort());
    // Viertelkreis oben rechts: Mitte liegt außerhalb der Sehne Deckelkante – Wand (nach rechts oben)
    const g = faces.find(x => x.name === "outer.edgeLinTopR").grid;
    const line = g.length > g[0].length ? g[g.length >> 1] : g.map(row => row[row.length >> 1]);
    const [q, m, w] = [line[0], line[line.length >> 1], line[line.length - 1]];
    expect(m[0]).toBeGreaterThan((q[0] + w[0]) / 2);
    expect(m[2]).toBeGreaterThan((q[2] + w[2]) / 2);
  });

  it("Flansch: Bohrungen und Rand als Zylinder, Rückseite eben mit Luftkanal und Bohrungen als Löchern", () => {
    const { faces, edges } = buildBrep(hornPatches(CASES.Flansch));
    const byName = n => faces.find(f => f.name === n);
    const holes = faces.filter(f => f.name.startsWith("flangeHole"));
    expect(holes).toHaveLength(4);
    for (const h of holes) {
      expect(h.cylinder.r).toBeCloseTo(3.3, 6);
      expect(Math.abs(h.cylinder.axis[1])).toBeCloseTo(1, 9);   // Achse = Hornachse (CAD-Y)
      expect(h.cylinder.sameSense).toBe(false);                  // Bohrung: Außenseite zeigt zur Achse
    }
    const rim = byName("flangeRim");
    expect(rim.cylinder.r).toBeCloseTo(CASES.Flansch.flange.diameter / 2, 6);
    expect(rim.cylinder.sameSense).toBe(true);
    const back = byName("flangeBack");
    expect(back.planar.normal[1]).toBeCloseTo(-1, 9);
    expect(back.bounds).toHaveLength(1 + 1 + 4);
    expect(byName("flangeFront").bounds).toHaveLength(1 + 1 + 4);
    // Bohrungsränder sind Vollkreise mit einer Ecke
    const circles = edges.filter(e => e.circle && e.start === e.end);
    expect(circles.length).toBe(2 * 4 + 2);
  });

  it("Mund: Stirnfläche des Luftvolumens ist ein Zylinder um den Fokus", () => {
    const d = CASES.standard;
    const cap = buildBrep(hornPatches(d)).faces.find(f => f.name === "capMouth");
    expect(cap.cylinder.r).toBeCloseTo(d.s.arcR, 6);
    expect(Math.abs(cap.cylinder.axis[2])).toBeCloseTo(1, 9);    // senkrechte Achse durch den Fokus
    expect(cap.cylinder.center[1]).toBeCloseTo(d.s.zFocus, 6);
    expect(cap.cylinder.sameSense).toBe(true);
  });

  it("Normalen nach außen: Throat −Y, Deckel +Z (CAD-Achsen)", () => {
    const { faces } = buildBrep(hornPatches(CASES.standard));
    const byName = n => faces.find(f => f.name === n);
    expect(byName("capThroat").planar.normal[1]).toBeCloseTo(-1, 9);
    expect(byName("trakTop").planar.normal[2]).toBeCloseTo(1, 9);
    expect(byName("trakBottom").planar.normal[2]).toBeCloseTo(-1, 9);
    expect(byName("linWallR").planar.normal[0]).toBeGreaterThan(0);
  });
});

describe("stepFile", () => {
  const text = hornStep(CASES.standard, { fileName: "test.step", date: "2026-10-13T12:00:00" });

  it("Rahmen und Schema AP214", () => {
    expect(text.startsWith("ISO-10303-21;\nHEADER;")).toBe(true);
    expect(text).toContain("FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));");
    expect(text.trimEnd().endsWith("END-ISO-10303-21;")).toBe(true);
    expect(text).toContain("SI_UNIT(.MILLI.,.METRE.)");
  });

  it("jede Referenz ist definiert, Nummern fortlaufend", () => {
    const defs = [...text.matchAll(/^#(\d+)=/gm)].map(m => +m[1]);
    expect(defs).toEqual(defs.map((_, i) => i + 1));
    const max = defs.length;
    for (const [, n] of text.matchAll(/#(\d+)(?!=)/g)) expect(+n).toBeLessThanOrEqual(max);
  });

  it("ein Volumenkörper, eine Fläche je Gitterfläche, Zahlen mit Dezimalpunkt", () => {
    const brep = buildBrep(hornPatches(CASES.standard));
    expect(text.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(1);
    expect(text.match(/ADVANCED_FACE\(/g)).toHaveLength(brep.faces.length);
    expect(text.match(/EDGE_CURVE\(/g)).toHaveLength(brep.edges.length);
    expect(text).not.toMatch(/\d[eE][+-]?\d/);   // kein Exponent außer 1.E-3 der Toleranz
    for (const [, nums] of text.matchAll(/CARTESIAN_POINT\('',\(([^)]*)\)\)/g)) {
      for (const n of nums.split(",")) expect(n).toMatch(/^-?\d+\.\d*$/);
    }
  });

  it("Kreise und Zylinder als analytische Geometrie", () => {
    const flange = hornStep(CASES.Flansch);
    expect(flange.match(/CYLINDRICAL_SURFACE\(/g)).toHaveLength(1 + 4 + 2);   // Rand, Bohrungen, Mund oben/unten
    expect(flange).toMatch(/ADVANCED_FACE\('flangeHole0',.*,\.F\.\);/);
    expect(flange).toMatch(/CIRCLE\('',#\d+,3\.3\)/);
  });

  it("Apostroph im Namen wird verdoppelt", () => {
    expect(stepFile(buildBrep(hornPatches(CASES.standard)), { name: "Julius' Horn" })).toContain("PRODUCT('Julius'' Horn'");
  });
});

describe("circleOf", () => {
  const arc = (r, a0, a1, n, c = [10, 20, 30]) => Array.from({ length: n }, (_, k) => {
    const a = a0 + (a1 - a0) * k / (n - 1);
    return [c[0] + r * Math.cos(a), c[1], c[2] + r * Math.sin(a)];
  });

  it("findet Mittelpunkt und Radius, Normale gegen den Uhrzeigersinn, ref zum ersten Punkt", () => {
    const c = circleOf(arc(50, 0.3, 2.5, 20));
    expect(c.r).toBeCloseTo(50, 9);
    c.center.forEach((v, k) => expect(v).toBeCloseTo([10, 20, 30][k], 9));
    // in der x-z-Ebene von x nach z gedreht: x × z = −y
    expect(c.normal[1]).toBeCloseTo(-1, 12);
    expect(c.ref[0]).toBeCloseTo(Math.cos(0.3), 12);
    expect(circleOf(arc(50, 2.5, 0.3, 20)).normal[1]).toBeCloseTo(1, 12);
  });

  it("Vollkreis mit wiederholtem Startpunkt", () => {
    expect(circleOf(arc(3.3, 0, 2 * Math.PI, 25)).r).toBeCloseTo(3.3, 9);
  });

  it("keine Kreise: Gerade, Ellipse, zu wenige Punkte, nicht eben", () => {
    expect(circleOf(Array.from({ length: 10 }, (_, k) => [k, 0, 2 * k]))).toBeNull();
    expect(circleOf(arc(50, 0, 3, 20).map(([x, y, z]) => [x, y, 30 + 0.9 * (z - 30)]))).toBeNull();
    expect(circleOf(arc(50, 0, 1, 4))).toBeNull();
    expect(circleOf(arc(50, 0, 3, 20).map(([x, y, z], k) => [x, y + 1e-3 * k, z]))).toBeNull();
  });
});

describe("Stützrippen im STEP", () => {
  const d = CASES["Flansch mit Stützrippen"];
  const text = hornStep(d, { fileName: "test.step", date: "2026-10-13T12:00:00" });

  it("Hauptkörper ohne Rippen bleibt geschlossen; je Rippe ein eigener geschlossener Körper", () => {
    expect(buildBrep(hornPatches(d)).problems).toEqual([]);
    expect(text.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(1 + 4);
    expect(text.match(/CLOSED_SHELL/g)).toHaveLength(1 + 4);
    expect(text).toContain("Radialhorn Rippe 4");
  });

  it("jede Rippe ist ein Vielflach: geschlossen, V − E + F = 2, alle Flächen eben", () => {
    const ribs = ribPatches(d);
    expect(ribs).toHaveLength(4);
    for (const patches of ribs) {
      const brep = buildBrep(patches);
      expect(brep.problems).toEqual([]);
      expect(brep.vertices.length - brep.edges.length + brep.faces.length).toBe(2);
      expect(brep.faces.every(f => f.planar)).toBe(true);
      expect(brep.faces.every(f => f.bounds.length === 1)).toBe(true);
    }
  });

  it("ohne Rippen nur ein Körper", () => {
    expect(hornStep(CASES.Flansch).match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(1);
    expect(ribPatches(CASES.Flansch)).toEqual([]);
  });
});
