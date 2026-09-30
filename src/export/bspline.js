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

/**
 * Geklemmter kubischer B-Spline exakt durch alle Punkte (2D oder 3D): Sehnenlängen-
 * Parametrisierung, Averaging-Knotenvektor, lineares Gleichungssystem per Gauß-Elimination
 * mit Spaltenpivotisierung (eine Matrix für alle Koordinaten). Doppelte Punkte werden
 * entfernt; bei weniger als 4 Punkten sinkt der Grad entsprechend.
 *
 * @returns {{degree, knots, controlPoints, fitPoints, params} | null}  null bei < 2 Punkten
 */
export function fitBSpline(ptsIn) {
  const pts = [ptsIn[0]];
  for (let i = 1; i < ptsIn.length; i++) {
    const a = pts[pts.length - 1], b = ptsIn[i];
    if (Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] || 0) - (a[2] || 0)) > 1e-6) pts.push(b);
  }
  const n = pts.length - 1;
  const p = Math.min(3, n);
  if (p < 1) return null;
  const dim = pts[0].length;

  // Sehnenlängen-Parameter t_k ∈ [0, 1]
  const dist = [0];
  let total = 0;
  for (let k = 1; k <= n; k++) {
    let d = 0;
    for (let c = 0; c < dim; c++) d += (pts[k][c] - pts[k - 1][c]) ** 2;
    total += Math.sqrt(d);
    dist.push(total);
  }
  const t = dist.map(d => (total > 0 ? d / total : 0));
  t[0] = 0; t[n] = 1;

  // Knotenvektor: p+1 Nullen, gemittelte Innenknoten, p+1 Einsen
  const m = n + p + 1;
  const U = new Array(m + 1);
  for (let i = 0; i <= p; i++) { U[i] = 0; U[m - i] = 1; }
  for (let j = 1; j <= n - p; j++) {
    let sum = 0;
    for (let i = j; i <= j + p - 1; i++) sum += t[i];
    U[j + p] = sum / p;
  }

  // Kollokationsmatrix N[k][i] = N_i,p(t_k)
  const A = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  for (let k = 0; k <= n; k++) {
    const span = findSpan(n, p, t[k], U);
    const basis = basisFuns(span, t[k], p, U);
    for (let i = 0; i <= p; i++) A[k][span - p + i] = basis[i];
  }

  // Gauß-Elimination mit Spaltenpivotisierung
  const rhs = Array.from({ length: dim }, (_, c) => pts.map(pt => pt[c] || 0));
  for (let col = 0; col <= n; col++) {
    let piv = col;
    for (let r = col + 1; r <= n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (piv !== col) {
      [A[col], A[piv]] = [A[piv], A[col]];
      for (let c = 0; c < dim; c++) [rhs[c][col], rhs[c][piv]] = [rhs[c][piv], rhs[c][col]];
    }
    const pv = A[col][col];
    for (let r = col + 1; r <= n; r++) {
      const f = A[r][col] / pv;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
      for (let c = 0; c < dim; c++) rhs[c][r] -= f * rhs[c][col];
    }
  }
  const P = Array.from({ length: n + 1 }, () => new Array(dim).fill(0));
  for (let r = n; r >= 0; r--) {
    for (let c = 0; c < dim; c++) {
      let sum = rhs[c][r];
      for (let cc = r + 1; cc <= n; cc++) sum -= A[r][cc] * P[cc][c];
      P[r][c] = sum / A[r][r];
    }
  }
  return { degree: p, knots: U, controlPoints: P, fitPoints: pts, params: t };
}

/** Punkt des B-Splines an der Stelle u (für Tests und Kontrolle). */
export function evalBSpline({ degree: p, knots: U, controlPoints: P }, u) {
  const n = P.length - 1;
  const span = findSpan(n, p, u, U);
  const N = basisFuns(span, u, p, U);
  return P[0].map((_, c) => N.reduce((sum, b, i) => sum + b * P[span - p + i][c], 0));
}
