import { describe, it, expect } from "vitest";
import { fitBSpline, evalBSpline } from "./bspline.js";

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
