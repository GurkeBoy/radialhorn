// Kubische B-Spline-Interpolation (Piegl & Tiller, "The NURBS Book", Kap. 9.2.1).
//
// Für den DXF-Export: CAD-Systeme (z.B. Siemens NX) machen aus POLYLINE-Kurven facettierte
// Körper, weil Polylinien stückweise linear sind. Eine SPLINE-Entity mit Kontrollpunkten und
// Knotenvektor beschreibt die Kurve dagegen glatt.

/** Knotenintervall, in dem u liegt (Algorithmus A2.1). */
export function findSpan(n, p, u, U) {
  if (u >= U[n + 1]) return n;
  if (u <= U[p]) return p;
  let lo = p, hi = n + 1, mid = Math.floor((lo + hi) / 2);
  while (u < U[mid] || u >= U[mid + 1]) {
    if (u < U[mid]) hi = mid; else lo = mid;
    mid = Math.floor((lo + hi) / 2);
  }
  return mid;
}

/** Die p+1 nicht verschwindenden Basisfunktionen an der Stelle u (Algorithmus A2.2). */
export function basisFuns(span, u, p, U) {
  const N = [1];
  const left = [0], right = [0];
  for (let j = 1; j <= p; j++) {
    left[j] = u - U[span + 1 - j];
    right[j] = U[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const temp = N[r] / (right[r + 1] + left[j - r]);
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
  return N;
}

/** Parameter t ∈ [0, 1] nach Sehnenlänge; null, wenn alle Punkte zusammenfallen. */
export function chordParams(pts) {
  const d = [0];
  for (let k = 1; k < pts.length; k++) {
    let s = 0;
    for (let c = 0; c < pts[k].length; c++) s += (pts[k][c] - pts[k - 1][c]) ** 2;
    d.push(d[k - 1] + Math.sqrt(s));
  }
  const total = d[d.length - 1];
  if (!(total > 0)) return null;
  const t = d.map(x => x / total);
  t[0] = 0; t[t.length - 1] = 1;
  return t;
}

/** Geklemmter Knotenvektor zu den Parametern t (Averaging, Gl. 9.8). */
export function averagingKnots(t, p) {
  const n = t.length - 1, m = n + p + 1;
  const U = new Array(m + 1);
  for (let i = 0; i <= p; i++) { U[i] = 0; U[m - i] = 1; }
  for (let j = 1; j <= n - p; j++) {
    let sum = 0;
    for (let i = j; i <= j + p - 1; i++) sum += t[i];
    U[j + p] = sum / p;
  }
  return U;
}

/**
 * Kontrollpunkte des Splines (Grad p, Knoten U) durch die Werte rhs[k] an den Stellen t[k].
 * rhs[k] ist ein Vektor beliebiger Länge – eine Matrix für alle Komponenten. Gauß-Elimination
 * mit Spaltenpivotisierung.
 */
export function solveInterpolation(t, U, p, rhs) {
  const n = t.length - 1, dim = rhs[0].length;
  const A = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  for (let k = 0; k <= n; k++) {
    const span = findSpan(n, p, t[k], U);
    const basis = basisFuns(span, t[k], p, U);
    for (let i = 0; i <= p; i++) A[k][span - p + i] = basis[i];
  }
  const B = rhs.map(r => [...r]);
  for (let col = 0; col <= n; col++) {
    let piv = col;
    for (let r = col + 1; r <= n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (piv !== col) { [A[col], A[piv]] = [A[piv], A[col]]; [B[col], B[piv]] = [B[piv], B[col]]; }
    const pv = A[col][col];
    for (let r = col + 1; r <= n; r++) {
      const f = A[r][col] / pv;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
      for (let c = 0; c < dim; c++) B[r][c] -= f * B[col][c];
    }
  }
  const P = Array.from({ length: n + 1 }, () => new Array(dim).fill(0));
  for (let r = n; r >= 0; r--) {
    for (let c = 0; c < dim; c++) {
      let sum = B[r][c];
      for (let cc = r + 1; cc <= n; cc++) sum -= A[r][cc] * P[cc][c];
      P[r][c] = sum / A[r][r];
    }
  }
  return P;
}

/**
 * Geklemmter kubischer B-Spline exakt durch alle Punkte (2D oder 3D): Sehnenlängen-
 * Parametrisierung, Averaging-Knotenvektor, lineares Gleichungssystem per Gauß-Elimination
 * mit Spaltenpivotisierung (eine Matrix für alle Koordinaten). Doppelte Punkte werden
 * entfernt; bei weniger als 4 Punkten sinkt der Grad entsprechend.
 * Mit params (steigend, 0 … 1, je Punkt): diese Parameter statt der Sehnenlänge, Punkte
 * unverändert – z.B. die einer Fläche, deren Randkurve der Spline dann genau ist.
 *
 * @returns {{degree, knots, controlPoints, fitPoints, params} | null}  null bei < 2 Punkten
 */
export function fitBSpline(ptsIn, params = null) {
  const pts = params ? ptsIn : [ptsIn[0]];
  for (let i = 1; !params && i < ptsIn.length; i++) {
    const a = pts[pts.length - 1], b = ptsIn[i];
    if (Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] || 0) - (a[2] || 0)) > 1e-6) pts.push(b);
  }
  const n = pts.length - 1;
  const p = Math.min(3, n);
  if (p < 1) return null;
  const dim = pts[0].length;
  const t = params ?? chordParams(pts);
  const U = averagingKnots(t, p);
  const P = solveInterpolation(t, U, p, pts.map(pt => Array.from({ length: dim }, (_, c) => pt[c] || 0)));
  return { degree: p, knots: U, controlPoints: P, fitPoints: pts, params: t };
}

/**
 * Tensorprodukt-B-Spline-Fläche exakt durch ein Punktgitter grid[i][j] (Algorithmus A9.4):
 * Parameter je Richtung als Mittel der Sehnenlängen-Parameter aller Zeilen bzw. Spalten
 * (zusammengefallene Zeilen, z.B. an einem Pol, zählen nicht), Grad höchstens 3 (bei 2 Zeilen
 * oder Spalten linear). u läuft entlang der Spalten j, v entlang der Zeilen i.
 * Doppelte Zeilen/Spalten müssen vorher entfernt sein. params.u / params.v ersetzen die
 * gemittelten Parameter einer Richtung (z.B. die einer Nachbarkante).
 *
 * @returns {{degreeU, degreeV, knotsU, knotsV, params: {u, v}, controlPoints}}
 *   controlPoints[i][j]: i entlang v, j entlang u
 */
export function fitBSplineSurface(grid, params = {}) {
  const nv = grid.length, nu = grid[0].length;
  const average = lines => {
    const list = lines.map(chordParams).filter(Boolean);
    return list[0].map((_, k) => list.reduce((s, t) => s + t[k], 0) / list.length);
  };
  const u = params.u ?? average(grid);
  const v = params.v ?? average(grid[0].map((_, j) => grid.map(row => row[j])));
  const pU = Math.min(3, nu - 1), pV = Math.min(3, nv - 1);
  const U = averagingKnots(u, pU), V = averagingKnots(v, pV);
  // erst entlang u (jede Zeile), dann entlang v (alle Spalten auf einmal)
  const R = grid.map(row => solveInterpolation(u, U, pU, row));
  const flat = solveInterpolation(v, V, pV, R.map(row => row.flat()));
  const controlPoints = flat.map(row => Array.from({ length: nu }, (_, j) => row.slice(3 * j, 3 * j + 3)));
  return { degreeU: pU, degreeV: pV, knotsU: U, knotsV: V, params: { u, v }, controlPoints };
}

/** Punkt der B-Spline-Fläche an (u, v). */
export function evalBSplineSurface({ degreeU: p, degreeV: q, knotsU: U, knotsV: V, controlPoints: P }, u, v) {
  const nu = P[0].length - 1, nv = P.length - 1;
  const su = findSpan(nu, p, u, U), sv = findSpan(nv, q, v, V);
  const Nu = basisFuns(su, u, p, U), Nv = basisFuns(sv, v, q, V);
  const out = [0, 0, 0];
  for (let l = 0; l <= q; l++) {
    for (let k = 0; k <= p; k++) {
      const w = Nv[l] * Nu[k], pt = P[sv - q + l][su - p + k];
      for (let c = 0; c < 3; c++) out[c] += w * pt[c];
    }
  }
  return out;
}

/** Punkt des B-Splines an der Stelle u (für Tests und Kontrolle). */
export function evalBSpline({ degree: p, knots: U, controlPoints: P }, u) {
  const n = P.length - 1;
  const span = findSpan(n, p, u, U);
  const N = basisFuns(span, u, p, U);
  return P[0].map((_, c) => N.reduce((sum, b, i) => sum + b * P[span - p + i][c], 0));
}
