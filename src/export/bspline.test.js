import { describe, it, expect } from "vitest";
import { fitBSpline, evalBSpline, fitBSplineSurface, evalBSplineSurface } from "./bspline.js";

const circle = (r, n) => Array.from({ length: n + 1 }, (_, i) => {
  const a = Math.PI / 2 * i / n;
  return [r * Math.cos(a), r * Math.sin(a)];
});

describe("fitBSpline", () => {
  it("interpoliert alle Punkte exakt", () => {
    const pts = circle(100, 12);
    const fit = fitBSpline(pts);
    fit.params.forEach((u, k) => {
      const [x, y] = evalBSpline(fit, u);
      expect(x).toBeCloseTo(pts[k][0], 9);
      expect(y).toBeCloseTo(pts[k][1], 9);
    });
  });

  it("geklemmt: Anfangs- und Endkontrollpunkt sind die Endpunkte", () => {
    const pts = circle(50, 8);
    const { controlPoints: P } = fitBSpline(pts);
    expect(P[0][0]).toBeCloseTo(pts[0][0], 9);
    expect(P[0][1]).toBeCloseTo(pts[0][1], 9);
    expect(P[P.length - 1][0]).toBeCloseTo(pts[8][0], 9);
    expect(P[P.length - 1][1]).toBeCloseTo(pts[8][1], 9);
  });

  it("gültiger Knotenvektor: Länge n+p+2, geklemmt, monoton", () => {
    const { knots: U, degree: p, controlPoints } = fitBSpline(circle(10, 10));
    expect(U).toHaveLength(controlPoints.length + p + 1);
    expect(U.slice(0, p + 1)).toEqual([0, 0, 0, 0]);
    expect(U.slice(-p - 1)).toEqual([1, 1, 1, 1]);
    for (let i = 1; i < U.length; i++) expect(U[i]).toBeGreaterThanOrEqual(U[i - 1]);
  });

  it("zwischen den Stützpunkten nah an der Originalkurve (Kreisbogen)", () => {
    const fit = fitBSpline(circle(100, 16));
    for (let i = 0; i < 64; i++) {
      const [x, y] = evalBSpline(fit, (i + 0.5) / 64);
      expect(Math.hypot(x, y)).toBeCloseTo(100, 2);
    }
  });

  it("3D-Punkte und doppelte Punkte", () => {
    const pts = [[0, 0, 0], [1, 0, 1], [1, 0, 1], [2, 0, 4], [3, 0, 9]];
    const fit = fitBSpline(pts);
    expect(fit.fitPoints).toHaveLength(4);
    fit.params.forEach((u, k) => {
      const [x, y, z] = evalBSpline(fit, u);
      expect([x, y, z].map(v => +v.toFixed(9))).toEqual(fit.fitPoints[k]);
    });
  });

  it("reduziert den Grad bei wenigen Punkten, null bei einem", () => {
    expect(fitBSpline([[0, 0], [1, 1]]).degree).toBe(1);
    expect(fitBSpline([[0, 0], [1, 1], [2, 0]]).degree).toBe(2);
    expect(fitBSpline([[0, 0], [0, 0]])).toBeNull();
  });
});

describe("fitBSplineSurface", () => {
  // Zylinderstück mit ungleichmäßigen Zeilenabständen
  const zs = [0, 1, 2.5, 7, 20, 21, 40];
  const grid = zs.map(z => Array.from({ length: 9 }, (_, j) => {
    const a = Math.PI / 2 * j / 8;
    return [100 * Math.cos(a), 100 * Math.sin(a), z];
  }));

  it("interpoliert alle Gitterpunkte exakt", () => {
    const fit = fitBSplineSurface(grid);
    fit.params.v.forEach((v, i) => fit.params.u.forEach((u, j) => {
      evalBSplineSurface(fit, u, v).forEach((c, k) => expect(c).toBeCloseTo(grid[i][j][k], 8));
    }));
  });

  it("Grad je Richtung, gültige Knotenvektoren", () => {
    const fit = fitBSplineSurface(grid);
    expect([fit.degreeU, fit.degreeV]).toEqual([3, 3]);
    expect(fit.knotsU.length).toBe(9 + 3 + 1);
    expect(fit.knotsV.length).toBe(7 + 3 + 1);
    expect(fit.controlPoints.length).toBe(7);
    expect(fit.controlPoints[0].length).toBe(9);
    const lin = fitBSplineSurface([grid[0], grid[6]]);
    expect(lin.degreeV).toBe(1);
  });

  it("zwischen den Punkten nahe an der Fläche (Zylinder)", () => {
    const fit = fitBSplineSurface(grid);
    for (const u of [0.05, 0.33, 0.71]) for (const v of [0.1, 0.5, 0.9]) {
      const [x, y] = evalBSplineSurface(fit, u, v);
      expect(Math.abs(Math.hypot(x, y) - 100)).toBeLessThan(0.01);
    }
  });

  it("Pol: zusammengefallene Zeile zählt nicht für die Parameter", () => {
    const tri = [Array(5).fill([0, 0, 0]), ...[1, 2, 3].map(r => Array.from({ length: 5 }, (_, j) => [r, r * j, 0]))];
    const fit = fitBSplineSurface(tri);
    expect(fit.params.u).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(evalBSplineSurface(fit, 0.5, 0)).toEqual([0, 0, 0]);
  });
});
