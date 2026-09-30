// ──────────────────────────────────────────────────────────────────
// Geometrie-Mathematik des Radialhorns – einzige Quelle, von App.jsx importiert.
//
// Der Öffnungswinkel ist einstellbar: setOpeningAngle(deg) setzt ALPHA2 (halber
// Winkel), T_TRANS und PHI_TOTAL. Diese werden als ES-Modul-"live bindings"
// exportiert – Importeure sehen immer den aktuellen Wert. Standard: 140°.
// ──────────────────────────────────────────────────────────────────

// ── Geometrie-Konstanten (werden zur Laufzeit gesetzt) ─────────────────────
let ALPHA2    = 70 * Math.PI / 180;
let T_TRANS   = Math.asinh(1 / Math.tan(ALPHA2));
let PHI_TOTAL = 2 * ALPHA2;

function setOpeningAngle(deg) {
  ALPHA2    = (deg / 2) * Math.PI / 180;
  T_TRANS   = Math.asinh(1 / Math.tan(ALPHA2));
  PHI_TOTAL = deg * Math.PI / 180;
}

const zN = t => t - Math.tanh(t);
const xN = t => 1 / Math.cosh(t);

// ──────────────────────────────────────────────────────────────────
// SOLVER
// ──────────────────────────────────────────────────────────────────

function solveR0(Lt, rt) {
  const f = r0 => {
    if (r0 <= rt) return -Lt;
    const tTh = Math.acosh(r0 / rt);
    if (tTh <= T_TRANS) return -Lt;
    return r0 * (zN(tTh) - zN(T_TRANS)) - Lt;
  };
  let hi = rt * 2;
  for (let i = 0; i < 80 && f(hi) < 0; i++) hi *= 2;
  if (f(hi) < 0) return null;
  let lo = rt * (1 + 1e-9);
  for (let i = 0; i < 90; i++) {
    const m = (lo + hi) / 2;
    f(m) < 0 ? (lo = m) : (hi = m);
  }
  return (lo + hi) / 2;
}

function solveHorn(L, Lt, rt, dw, dh) {
  let r0 = null, tTh = null, xTrans, zTrans;

  if (Lt > 0.5) {
    r0 = solveR0(Lt, rt);
    if (!r0) return null;
    tTh    = Math.acosh(r0 / rt);
    xTrans = r0 * xN(T_TRANS);
    zTrans = Lt;
  } else {
    xTrans = rt;
    zTrans = 0;
  }

  const zFocus  = zTrans - xTrans / Math.tan(ALPHA2);
  const hatTipZ = -dh - dw / 2;
  const Rtarget = L - dh - dw / 2 - zFocus;
  if (Rtarget <= 0) return null;

  const a = zTrans - zFocus, b = xTrans, c = Math.tan(ALPHA2);
  const A = 1 + c * c, B = 2 * (a + b * c), C = a * a + b * b - Rtarget * Rtarget;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const Ls = (-B + Math.sqrt(disc)) / (2 * A);
  if (Ls < 0) return null;

  const zMouth = zTrans + Ls;
  const xMouth = xTrans + Ls * c;
  const arcR   = Math.sqrt((zMouth - zFocus) ** 2 + xMouth ** 2);
  const zApex  = zFocus + arcR;
  const arcLen = arcR * PHI_TOTAL;

  const rInner     = Math.sqrt((zTrans - zFocus) ** 2 + xTrans ** 2);
  const zInnerApex = zFocus + rInner;

  return {
    r0, tTh, Lt, Ls,
    xTrans, zTrans,
    xMouth, zMouth,
    zFocus, arcR, zApex,
    hatTipZ, arcLen,
    rInner, zInnerApex,
    Fv: zFocus,
  };
}

function minL(Lt, rt, dw, dh) {
  let xTrans, zTrans;
  if (Lt > 0.5) {
    const r0 = solveR0(Lt, rt);
    if (!r0) return dh + dw / 2 + 50;
    xTrans = r0 * xN(T_TRANS); zTrans = Lt;
  } else { xTrans = rt; zTrans = 0; }
  const zFocus = zTrans - xTrans / Math.tan(ALPHA2);
  const rInner = Math.sqrt((zTrans - zFocus) ** 2 + xTrans ** 2);
  return Math.ceil(dh + dw / 2 + zFocus + rInner) + 10;
}

function maxLt(L, rt, dw, dh) {
  if (!solveHorn(L, 0, rt, dw, dh)) return 0;
  let lo = 0, hi = L;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    solveHorn(L, mid, rt, dw, dh) ? (lo = mid) : (hi = mid);
  }
  return lo;
}

function maxLforRaumecke(Lt, rt, dw, dh, extraBreite = 0) {
  let xTrans, zTrans;
  if (Lt > 0.5) {
    const r0 = solveR0(Lt, rt);
    if (!r0) return null;
    xTrans = r0 * xN(T_TRANS); zTrans = Lt;
  } else { xTrans = rt; zTrans = 0; }
  const LsMax = (dw / 2 + dh + zTrans - xTrans - extraBreite) / (Math.tan(ALPHA2) - 1);
  if (LsMax <= 0) return null;
  let lo = minL(Lt, rt, dw, dh), hi = lo + 5000;
  for (let i = 0; i < 40; i++) {
    const sv = solveHorn(hi, Lt, rt, dw, dh);
    if (sv && sv.Ls >= LsMax) break;
    hi *= 2;
  }
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const sv  = solveHorn(mid, Lt, rt, dw, dh);
    sv && sv.Ls < LsMax ? (lo = mid) : (hi = mid);
  }
  return (lo + hi) / 2;
}

function minLtForRaumecke(L, rt, dw, dh, extraBreite = 0) {
  const check = lt => { const r = maxLforRaumecke(lt, rt, dw, dh, extraBreite); return r !== null && r >= L; };
  if (check(0)) return 0;
  let lo = 0, hi = L;
  if (!check(hi)) return null;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; check(m) ? (hi = m) : (lo = m); }
  return hi;
}

// ──────────────────────────────────────────────────────────────────
// VERTIKALES PROFIL (Seitenriss) – von App.jsx importiert
// ──────────────────────────────────────────────────────────────────

// fillet (optional, aus computeFillet): Verrundung des Übergangs Throat → Aufweitung.
// Zwischen den Tangentenpunkten zT1..zT2 liegt die Wand auf dem Verrundungsbogen.
function verticalHalfHeight(z, s, rt, hMouth, curve, hypexT, fillet = null) {
  if (fillet && z > fillet.zT1 && z < fillet.zT2) {
    return fillet.hc - Math.sqrt(Math.max(0, fillet.R ** 2 - (z - fillet.zc) ** 2));
  }
  const h0 = rt;
  const h1 = hMouth / 2;
  const z0 = s.zInnerApex;
  const z1 = s.zApex;

  if (z <= z0) return h0;
  if (z >= z1) return h1;

  const u = (z - z0) / (z1 - z0);

  if (curve === "linear") {
    return h0 + (h1 - h0) * u;
  }
  if (curve === "exponential") {
    if (h0 <= 0) return h1;
    return h0 * Math.exp(Math.log(h1 / h0) * u);
  }
  if (curve === "hypex") {
    const T = hypexT;
    const ratio = h1 / h0;
    if (ratio <= 0) return h0;
    let m;
    const fVal = mv => Math.cosh(mv) + T * Math.sinh(mv);
    if (Math.abs(ratio - 1) < 1e-9) {
      m = 0;
    } else if (ratio > 1) {
      let lo = 0, hi = Math.log(ratio * 2 + 2) + 1;
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        fVal(mid) < ratio ? (lo = mid) : (hi = mid);
      }
      m = (lo + hi) / 2;
    } else {
      return h0 + (h1 - h0) * u;
    }
    if (m < 1e-10) return h0 + (h1 - h0) * u;
    return h0 * fVal(m * u);
  }
  return h0 + (h1 - h0) * u;
}

// Verrundung des Knicks zwischen waagerechtem Throat (h = rt) und Aufweitungskurve f(z)
// im Seitenriss: Kreis mit Radius R, tangential an beide. Mittelpunkt (zc, rt + R) liegt
// außerhalb der Wand; Tangentenpunkt T2 auf f ist die Stelle, an der der Mittelpunkt
// genau R entlang der Normalen liegt: f(z2) + R/√(1+f'²) = rt + R  (Bisektion).
// Ist R zu groß (T1 vor dem Throat oder T2 hinter dem Mund), wird der größte machbare
// Radius genommen und limited = true gesetzt.
function computeFillet(s, rt, hMouth, curve, hypexT, R) {
  if (!s || !(s.Lt > 0.5) || !(R > 0)) return null;
  const z0 = s.zInnerApex, z1 = s.zApex, h0 = rt;
  const f  = z => verticalHalfHeight(z, s, rt, hMouth, curve, hypexT);
  const d  = Math.max(1e-4, (z1 - z0) * 1e-5);
  const df = z => {
    const a = Math.max(z0, z - d), b = Math.min(z1, z + d);
    return (f(b) - f(a)) / (b - a);
  };
  const solve = r => {
    const g = z => f(z) + r / Math.hypot(1, df(z)) - h0 - r;
    if (g(z1) < 0) return null;
    let lo = z0, hi = z1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      g(mid) < 0 ? (lo = mid) : (hi = mid);
    }
    const z2 = (lo + hi) / 2, m = df(z2);
    const zc = z2 - r * m / Math.hypot(1, m);
    if (zc < 0) return null;
    return { R: r, zc, hc: h0 + r, zT1: zc, zT2: z2, hT2: f(z2) };
  };
  const full = solve(R);
  if (full) return { ...full, limited: false };
  let lo = 0, hi = R;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    solve(mid) ? (lo = mid) : (hi = mid);
  }
  return lo > 0.1 ? { ...solve(lo), limited: true } : null;
}

export {
  ALPHA2, T_TRANS, PHI_TOTAL, setOpeningAngle,
  zN, xN, solveR0, solveHorn, minL, maxLt, maxLforRaumecke, minLtForRaumecke,
  verticalHalfHeight, computeFillet,
};
