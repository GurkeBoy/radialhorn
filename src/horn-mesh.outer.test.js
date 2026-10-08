/**
 * Runder Throat außen: Kanten der Schale mit R = r + e (r innen, e Kantenradius). Geschlossen,
 * ohne Faltung, Wand an den Ecken nirgends dünner als t (mit e = t im geraden Bereich und am
 * Throat genau t), am Throat mit e = t außen nahezu ein Kreis.
 */
import { describe, it, expect } from "vitest";
import { createHornMath, makeProfile, computeFillet, throatMorph } from "./horn-math.js";
import { buildShellGeometry, flangeLayout, triangulate } from "./horn-mesh.js";

const RT = 25.4, T = 20;
const solve = (Lt, clothoid = 0) => createHornMath(140, { clothoid }).solveHorn(500, Lt, RT, 182, 90);
const profileOf = (s, fillet = null) => makeProfile(s, RT, 200, "exponential", 0.5, fillet);
const FLANGE = { diameter: null, fallback: 182, thickness: 10, holes: { count: 4, circle: 101.6, diameter: 6.6, angle: 0 } };

const key = p => p.map(v => Math.round(v * 1e6)).join(",");
const tris = geo => geo.surfaces.flatMap(triangulate);
function edgeCheck(ts) {
  const directed = new Map();
  for (const t of ts) for (let k = 0; k < 3; k++) {
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

// Nächster Punkt eines Dreiecks (Ericson, Real-Time Collision Detection 5.1.5)
const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const along = (a, d, f) => [a[0] + f * d[0], a[1] + f * d[1], a[2] + f * d[2]];
function closest(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return along(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return along(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return along(b, sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
  const den = 1 / (va + vb + vc);
  return along(along(a, ab, vb * den), ac, vc * den);
}

/**
 * Kleinster Abstand der Punkte der äußeren Rundungen (rechts oben) zur Innenfläche – gesucht wird
 * nur unter 2·t (Dreiecke, deren Hüllquader weiter weg liegt als der beste Wert, entfallen).
 */
function minWall(geo, t) {
  const tris = geo.surfaces.filter(f => f.name.startsWith("inner.")).flatMap(triangulate).map(tri => ({
    tri,
    lo: [0, 1, 2].map(k => Math.min(tri[0][k], tri[1][k], tri[2][k])),
    hi: [0, 1, 2].map(k => Math.max(tri[0][k], tri[1][k], tri[2][k])),
  }));
  let min = 2 * t;
  for (const p of geo.surfaces.filter(f => /^outer\.round.*TopR$/.test(f.name)).flatMap(f => f.grid.flat())) {
    for (const { tri, lo, hi } of tris) {
      const dx = Math.max(lo[0] - p[0], 0, p[0] - hi[0]), dy = Math.max(lo[1] - p[1], 0, p[1] - hi[1]), dz = Math.max(lo[2] - p[2], 0, p[2] - hi[2]);
      if (dx * dx + dy * dy + dz * dz >= min * min) continue;
      const q = closest(p, ...tri);
      min = Math.min(min, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
    }
  }
  return min;
}

describe("runder Throat außen (R = r + e)", () => {
  const CASES = [
    ["Standard", solve(60), null, null],
    ["bis zum Mund", solve(60), 1e4, null],
    ["ohne Traktrix", solve(0), null, null],
    ["ohne Traktrix, bis zum Mund", solve(0), 1e4, null],
    ["kurze Traktrix", solve(20), null, null],
    ["mit Klothoide, bis zum Mund", solve(80, 30), 1e4, null],
    ["mit Verrundung", solve(60), null, 100],
  ];
  for (const [name, s, length, R] of CASES) {
    const fillet = R ? computeFillet(s, RT, 200, "exponential", 0.5, R) : null;
    const profile = profileOf(s, fillet), morph = throatMorph(s, RT, length);
    it(`${name}: geschlossen und ohne Faltung – Kanten scharf, e = t/2, e = t`, () => {
      for (const e of [0, T / 2, T]) {
        const geo = buildShellGeometry(s, RT, profile, fillet, T, null, e, morph);
        expect(edgeCheck(tris(geo))).toEqual({ open: 0, flipped: 0 });
        for (const grid of ["outer.trakTop", "outer.kloTop", "outer.linTop", "outer.cornerTopR"].map(n => geo.surfaces.find(f => f.name === n)?.grid).filter(Boolean)) {
          let pos = 0, neg = 0;
          for (let i = 0; i < grid.length - 1; i++) for (let j = 0; j < grid[i].length - 1; j++) {
            for (const [a, b, c] of [[grid[i][j], grid[i][j + 1], grid[i + 1][j + 1]], [grid[i][j], grid[i + 1][j + 1], grid[i + 1][j]]]) {
              const area = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
              if (area > 1e-9) pos++; else if (area < -1e-9) neg++;
            }
          }
          expect(Math.min(pos, neg)).toBe(0);
        }
      }
    }, 20000);
  }

  it("Wand an den Ecken: mit e = t genau t (gerader Bereich, Throat), im Eingang vor der Naht knapp darunter", () => {
    // [Lösung, Länge, Mindeststärke / t] – Eingang vor der Naht: außen andere Zeilen als innen
    for (const [s, length, f] of [[solve(60), null, 0.998], [solve(0), null, 0.998], [solve(60), 1e4, 0.98], [solve(80, 30), 1e4, 0.98], [solve(20), null, 0.94]]) {
      const geo = buildShellGeometry(s, RT, profileOf(s), null, T, null, T, throatMorph(s, RT, length));
      expect(minWall(geo, T)).toBeGreaterThan(f * T);
    }
    // scharf und e = t/2: an den Ecken ohnehin dicker
    const s = solve(60), m = throatMorph(s, RT, null);
    for (const e of [0, T / 2]) expect(minWall(buildShellGeometry(s, RT, profileOf(s), null, T, null, e, m), T)).toBeGreaterThan(T);
  }, 60000);

  it("Throat mit e = t: außen nahezu ein Kreis Ø 2·(rt + t), sonst ein gerundetes Rechteck", () => {
    // Wand am Throat schräg (≈ 20°): senkrecht zur Wand t, waagerecht etwas mehr – die Rundung
    // folgt dem nächsten Innenwandpunkt (exakte Wandstärke), der Kreis weicht um < 2 mm ab
    const s = solve(60), profile = profileOf(s), m = throatMorph(s, RT, null);
    const ring = e => {
      const rim = buildShellGeometry(s, RT, profile, null, T, null, e, m).surfaces.find(f => f.name === "rimThroat");
      return rim.triangles.flat().map(([x, h]) => Math.hypot(x, h)).filter(d => d > RT + 1);
    };
    const round = ring(T);
    expect(Math.min(...round)).toBeCloseTo(RT + T, 6);
    expect(Math.max(...round)).toBeLessThan(RT + T + 2);
    expect(Math.max(...ring(0))).toBeGreaterThan(Math.max(...round) + 5);          // scharf: Ecken weiter draußen
  });

  it("Außenseite am Throat glatt – auch ohne Traktrix und bei kurzer Traktrix, mit und ohne Flansch", () => {
    // größter Knick zwischen benachbarten Dreiecken der Außenseite (z < 60, oben rechts), ohne die
    // gewollten scharfen Kanten (90°); [Lₜ, erlaubt] – Lₜ = 20 ohne Flansch: die Außenkontur vor der
    // geraden Wand ist dort nur ≈ 1 mm lang (bisherige Kantenrundung dort ≈ 20°); Lₜ = 60: der Deckel
    // knickt beim Übergang in die Aufweitung schon ohne runden Throat um ≈ 11°
    const maxCrease = geo => {
      const edges = new Map(), k = p => p.map(v => Math.round(v * 1e5)).join(",");
      for (const f of geo.surfaces.filter(f => f.name.startsWith("outer."))) for (const tri of triangulate(f)) {
        const u = sub(tri[1], tri[0]), v = sub(tri[2], tri[0]);
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], len = Math.hypot(...n);
        if (len < 1e-8) continue;
        for (let i = 0; i < 3; i++) {
          const a = tri[i], b = tri[(i + 1) % 3], key = [k(a), k(b)].sort().join("|");
          if (!edges.has(key)) edges.set(key, []);
          edges.get(key).push({ n: n.map(x => x / len), mid: [0, 1, 2].map(j => (a[j] + b[j]) / 2) });
        }
      }
      let max = 0;
      for (const [p, q] of [...edges.values()].filter(l => l.length === 2)) {
        if (p.mid[2] >= 60 || p.mid[1] <= 0 || p.mid[0] <= 0) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, dot(p.n, q.n)))) * 180 / Math.PI;
        if (ang < 89) max = Math.max(max, ang);
      }
      return max;
    };
    for (const [Lt, limit] of [[0, 8], [10, 8.5], [20, 17], [60, 12.5]]) {
      const s = solve(Lt), profile = profileOf(s), m = throatMorph(s, RT, null);
      for (const e of [0, T]) for (const withFlange of [false, true]) {
        const flange = withFlange ? flangeLayout(s, RT, profile, null, T, FLANGE, e, m) : null;
        expect(maxCrease(buildShellGeometry(s, RT, profile, null, T, flange, e, m))).toBeLessThan(limit);
      }
    }
  }, 120000);

  it("Flansch auf Mindest-Ø: Schale berührt den Rand nicht, Öffnung bleibt frei (Vorder- und Rückseite)", () => {
    // Fall aus der App: zu kleiner Flansch → Mindest-Ø; die gerundete Außenkontur lag am Flanschrand
    // (Vieleck, Kanten innerhalb des Kreises) an, die Vorderseite verstopfte die Öffnung
    const s = createHornMath(140, { clothoid: 30 }).solveHorn(685, 14.05, RT, 182, 90);
    const fillet = computeFillet(s, RT, 200, "hypex", 0.7, 568), profile = makeProfile(s, RT, 200, "hypex", 0.7, fillet);
    const m = throatMorph(s, RT, 459), t = 10;
    const flange = flangeLayout(s, RT, profile, fillet, t, { ...FLANGE, diameter: 120 }, t, m);
    expect(flange.limited).toBe(true);
    const geo = buildShellGeometry(s, RT, profile, fillet, t, flange, t, m);
    expect(edgeCheck(tris(geo))).toEqual({ open: 0, flipped: 0 });
    const center = tri => Math.hypot(...[0, 1].map(k => (tri[0][k] + tri[1][k] + tri[2][k]) / 3));
    for (const name of ["flangeFront", "flangeBack"]) {
      expect(geo.surfaces.find(f => f.name === name).triangles.filter(tri => center(tri) < RT - 0.5)).toHaveLength(0);
    }
  });

  it("Flansch mit gerundeter Außenkontur: geschlossen, Mindest-Ø kleiner als eckig", () => {
    const s = solve(60), profile = profileOf(s), m = throatMorph(s, RT, null);
    const round = flangeLayout(s, RT, profile, null, T, FLANGE, T, m), square = flangeLayout(s, RT, profile, null, T, FLANGE);
    expect(round.minDiameter).toBeLessThan(square.minDiameter);
    expect(edgeCheck(tris(buildShellGeometry(s, RT, profile, null, T, round, T, m)))).toEqual({ open: 0, flipped: 0 });
  });
});
