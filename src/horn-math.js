const ALPHA2 = 70 * Math.PI / 180;
const T_TRANS = Math.asinh(1 / Math.tan(ALPHA2));

function zN(t) { return t - Math.tanh(t); }
function xN(t) { return 1 / Math.cosh(t); }

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
  for (let i = 0; i < 90; i++) { const m = (lo + hi) / 2; f(m) < 0 ? lo = m : hi = m; }
  return (lo + hi) / 2;
}

function solveHorn(L, Lt, rt, dw, dh) {
  let r0 = null, tTh = null, xTrans, zTrans;
  if (Lt > 0.5) {
    r0 = solveR0(Lt, rt);
    if (!r0) return null;
    tTh = Math.acosh(r0 / rt);
    xTrans = r0 * xN(T_TRANS);
    zTrans = Lt;
  } else { xTrans = rt; zTrans = 0; }

  const hatTipZ = -dh - dw / 2;
  const zFocus = zTrans - xTrans / Math.tan(ALPHA2);
  const Rtarget = L - dh - dw / 2 - zFocus;
  if (Rtarget <= 0) return null;

  const a = zTrans - zFocus, b = xTrans, c = Math.tan(ALPHA2);
  const A = 1 + c * c, B = 2 * a + 2 * b * c, C = a * a + b * b - Rtarget * Rtarget;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const Ls = (-B + Math.sqrt(disc)) / (2 * A);
  if (Ls < 0) return null;

  const zMouth = zTrans + Ls;
  const xMouth = xTrans + Ls * c;
  const arcR = Math.sqrt((zMouth - zFocus) ** 2 + xMouth ** 2);
  const zApex = zFocus + arcR;
  const arcLen = arcR * 140 * Math.PI / 180;

  return { r0, tTh, Lt, Ls, xTrans, zTrans, xMouth, zMouth, zFocus, arcR, zApex, hatTipZ, arcLen };
}

function minL(Lt, rt, dw, dh) {
  let xTrans, zTrans;
  if (Lt > 0.5) {
    const r0 = solveR0(Lt, rt);
    if (!r0) return dh + dw / 2 + 50;
    xTrans = r0 * xN(T_TRANS); zTrans = Lt;
  } else { xTrans = rt; zTrans = 0; }
  const zFocus = zTrans - xTrans / Math.tan(ALPHA2);
  const arcR0 = Math.sqrt((zTrans - zFocus) ** 2 + xTrans ** 2);
  return Math.ceil(dh + dw / 2 + zFocus + arcR0) + 10;
}

function maxLt(L, rt, dw, dh) {
  if (!solveHorn(L, 0, rt, dw, dh)) return 0;
  let lo = 0, hi = L;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (solveHorn(L, mid, rt, dw, dh)) lo = mid; else hi = mid;
  }
  return lo;
}

// Max L such that horn mouth width <= raumecke width at mouth position
// Raumecke width at z=zMouth: dw/2 + (zMouth - (-dh)) = dw/2 + zMouth + dh  (each side)
// xMouth must <= dw/2 + zMouth + dh
// xMouth = xTrans + Ls*tan(α), zMouth = zTrans + Ls
// xTrans + Ls*tan(α) <= dw/2 + zTrans + Ls + dh
// Ls*(tan(α)-1) <= dw/2 + dh + zTrans - xTrans
// Since tan(70°)≈2.747 > 1, this gives a max Ls → max L
function maxLforRaumecke(Lt, rt, dw, dh) {
  let xTrans, zTrans;
  if (Lt > 0.5) {
    const r0 = solveR0(Lt, rt);
    if (!r0) return null;
    xTrans = r0 * xN(T_TRANS); zTrans = Lt;
  } else { xTrans = rt; zTrans = 0; }
  // xTrans + Ls*tan(α) = dw/2 + zTrans + Ls + dh
  // Ls*(tan(α)-1) = dw/2 + dh + zTrans - xTrans
  const LsMax = (dw / 2 + dh + zTrans - xTrans) / (Math.tan(ALPHA2) - 1);
  if (LsMax <= 0) return null;
  let lo = minL(Lt, rt, dw, dh), hi = lo + 5000;
  for (let i = 0; i < 40; i++) {
    const sv = solveHorn(hi, Lt, rt, dw, dh);
    if (sv && sv.Ls >= LsMax) break;
    hi *= 2;
  }
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const sv = solveHorn(mid, Lt, rt, dw, dh);
    if (sv && sv.Ls < LsMax) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// minLtForRaumecke: smallest Lt where maxLforRaumecke(Lt) >= L
function minLtForRaumecke(L, rt, dw, dh) {
  const check = lt => { const r = maxLforRaumecke(lt, rt, dw, dh); return r !== null && r >= L; };
  if (check(0)) return 0;
  let lo = 0, hi = L;
  if (!check(hi)) return null;
  for (let i = 0; i < 80; i++) { const m = (lo+hi)/2; check(m) ? hi=m : lo=m; }
  return hi;
}

export { ALPHA2, T_TRANS, zN, xN, solveHorn, minL, maxLt, maxLforRaumecke, minLtForRaumecke };
