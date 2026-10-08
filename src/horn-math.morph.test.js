import { describe, it, expect } from "vitest";
import {
  createHornMath, makeProfile, crossSection, entrancePoints, linearWallPoints,
  wallPoint, cornerRadius, cornerDeficit, maxMorphLength, throatMorph, frequencyEstimates,
} from "./horn-math.js";
import { areaCurve } from "./simulation.js";

const RT = 25.4;
const solve = (Lt, clothoid = 0) => createHornMath(140, { clothoid }).solveHorn(500, Lt, RT, 182, 90);
const profileOf = s => makeProfile(s, RT, 200, "exponential", 0.5);

/** Bogenlänge entlang der Wand bis zWall, numerisch über einen dichten Polygonzug. */
function polylineLength(s, zWall) {
  const pts = [...entrancePoints(s, 20000, 4000), ...linearWallPoints(s, 4000).slice(1)];
  if (pts.length === 0 || pts[0][1] > 0) pts.unshift([s.xTrans, s.zTrans]);
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
    if (z1 >= zWall) {
      const f = (zWall - z0) / (z1 - z0);
      return len + f * Math.hypot(x1 - x0, z1 - z0);
    }
    len += Math.hypot(x1 - x0, z1 - z0);
  }
  return len;
}

describe("Bogenlänge entlang der Wand (wallPoint)", () => {
  for (const [name, s] of [["Traktrix", solve(60)], ["Traktrix + Klothoide", solve(60, 30)], ["ohne Traktrix", solve(0)]]) {
    it(`${name}: gleich der Länge des Polygonzugs`, () => {
      const profile = profileOf(s);
      for (const f of [0, 0.05, 0.2, 0.5, 0.9, 1]) {
        const zWall = s.zMouth * f;
        expect(wallPoint(s, profile, zWall).sWall).toBeCloseTo(polylineLength(s, zWall), 2);
      }
    });
  }

  it("am Throat: s = 0, x = rt, Höhe = rt", () => {
    const s = solve(60);
    const p = wallPoint(s, profileOf(s), 0);
    expect(p.sWall).toBeCloseTo(0, 9);
    expect(p.xWall).toBeCloseTo(RT, 6);
    expect(p.hWall).toBeCloseTo(RT, 9);
  });
});

describe("Eckradius (cornerRadius)", () => {
  const morph = { r: RT, length: 50 };
  it("rt am Throat, rt/2 in der Mitte, 0 am Ende und danach, ohne Übergang 0", () => {
    expect(cornerRadius(0, morph)).toBeCloseTo(RT, 12);
    expect(cornerRadius(25, morph)).toBeCloseTo(RT / 2, 12);
    expect(cornerRadius(50, morph)).toBe(0);
    expect(cornerRadius(80, morph)).toBe(0);
    expect(cornerRadius(10, null)).toBe(0);
  });
  it("fällt monoton", () => {
    let prev = Infinity;
    for (let sw = 0; sw <= 50; sw += 0.5) {
      const r = cornerRadius(sw, morph);
      expect(r).toBeLessThanOrEqual(prev);
      prev = r;
    }
  });
});

describe("Länge des Übergangs (maxMorphLength, throatMorph)", () => {
  it("höchstens die ganze Wand bis zum Mund – dort ist r = 0", () => {
    for (const s of [solve(60), solve(0), solve(60, 30)]) {
      const max = maxMorphLength(s);
      expect(max).toBeCloseTo(polylineLength(s, s.zMouth), 2);
      expect(cornerRadius(wallPoint(s, profileOf(s), s.zMouth).sWall, { r: RT, length: max })).toBe(0);
    }
  });

  it("Standard = Throat-Durchmesser; zu lang wird begrenzt", () => {
    const s = solve(60);
    expect(throatMorph(s, RT, null)).toMatchObject({ r: RT, length: 2 * RT, limited: false });
    const m = throatMorph(s, RT, 5000);
    expect(m.limited).toBe(true);
    expect(m.length).toBeCloseTo(maxMorphLength(s), 9);
  });

  it("auch ohne Traktrix und mit Verrundung möglich", () => {
    expect(throatMorph(solve(0), RT, null)).toMatchObject({ length: 2 * RT, limited: false });
    expect(throatMorph(solve(60), RT, 200)).toMatchObject({ length: 200, limited: false });
  });
});

describe("Querschnitt mit rundem Throat", () => {
  const s = solve(60), profile = profileOf(s);
  const morph = throatMorph(s, RT, null);

  it("je Wellenfront genau der Abzug (4 − π)·r² mit dem Radius ihres Wandpunkts", () => {
    const zWalls = [0, 5, 10, 20, 30, 45, 60, 120, 300];
    const square = crossSection(s, profile, 0, zWalls);
    const round = crossSection(s, profile, 0, zWalls, morph);
    expect(round).toHaveLength(square.length + 1);   // + Stützstelle am Ende des Übergangs
    for (const p of square.slice(1)) {
      const q = round.find(r => r.zWall === p.zWall);
      const r = cornerRadius(wallPoint(s, profile, p.zWall).sWall, morph);
      expect(q.cornerR).toBeCloseTo(r, 12);
      expect(p.A - q.A).toBeCloseTo(cornerDeficit(r), 9);
    }
  });

  it("erste Wellenfront mit Eckradius rt, hinter dem Übergang unverändert", () => {
    const round = crossSection(s, profile, 100, null, morph);
    expect(round[1].cornerR).toBeCloseTo(RT, 9);
    const square = crossSection(s, profile, 100);
    expect(round.at(-1).A).toBe(square.at(-1).A);
  });

  it("die Ecke wird an der Wand bemessen, nicht auf der Achse: Wandpunkt liegt hinter der Wellenfront", () => {
    const round = crossSection(s, profile, 100, null, morph);
    const inside = round.filter(p => p.cornerR > 0 && p.zWall > 0);
    for (const p of inside) expect(p.zWall).toBeLessThan(p.z);
  });

  it("Simulation: Halsfläche = Kreis des Treiberausgangs", () => {
    expect(areaCurve(s, RT, profile, undefined, morph).S[0]).toBeCloseTo(Math.PI * RT * RT * 1e-6, 15);
    expect(areaCurve(s, RT, profile).S[0]).toBeCloseTo(4 * RT * RT * 1e-6, 15);
  });

  it("Horn-Cutoff mit rundem Throat: Flare-Konstante um ln(4/π)/L größer", () => {
    const sq = frequencyEstimates(s, RT, 200), rd = frequencyEstimates(s, RT, 200, true);
    const c = 343000, L = s.zApex - s.hatTipZ;
    expect((rd.fcCut - sq.fcCut) * 4 * Math.PI / c).toBeCloseTo(Math.log(4 / Math.PI) / L, 12);
  });
});
