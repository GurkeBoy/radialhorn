/**
 * Geometrie-Mathematik des Radialhorn-Konfigurators – einzige Quelle für alle
 * Berechnungen, rein funktional (kein globaler Zustand).
 *
 * Konventionen
 *   - Längen in mm, Winkel intern in Radiant (Öffnungswinkel-Parameter in Grad).
 *   - Draufsicht: z = Hornachse (Treiberfront bei z = 0, Mund bei z = zApex),
 *     x = halbe Breite.  Seitenriss: z wie oben, h = halbe Höhe.
 *   - Horizontale Kontur: Traktrix-Eingang (0 … Lt) → gerade Wand unter dem halben
 *     Öffnungswinkel, radial zum Fokuspunkt → Mundbogen (Teilkreis um den Fokus).
 *   - Die Gesamtlänge L wird von der Hut-Spitze der Raumecke (hatTipZ = −dh − dw/2)
 *     bis zum Scheitel des Mundbogens gemessen.
 *
 * Aufbau
 *   createHornMath(openingAngle) liefert die winkelabhängigen Funktionen (Solver und
 *   Grenzen). Das Ergebnis von solveHorn trägt seinen Winkel mit (alpha2, tTrans),
 *   alle nachgelagerten Funktionen brauchen deshalb nur dieses Objekt.
 */

// ──────────────────────────────────────────────────────────────────
// KONSTANTEN UND GRUNDFUNKTIONEN
// ──────────────────────────────────────────────────────────────────

/** Unterhalb dieser Traktrix-Länge [mm] gilt der Eingang als abgeschaltet (konisches Horn). */
export const LT_MIN = 0.5;

/** Standard-Öffnungswinkel [°]. */
export const DEFAULT_OPENING_ANGLE = 140;

/** Schallgeschwindigkeit [mm/s]. */
export const SPEED_OF_SOUND = 343000;

/**
 * Radius für die Höhenregel des 3D-Körpers, h(x, z) = Profil(zFocus + focusRadius(s, x, z)).
 * Vor dem Fokus der Abstand zum Fokus (Rotation des Seitenprofils um die Achse durch den
 * Fokus). Hinter dem Fokus (z < zFocus – bei langer Traktrix liegt der Fokus weit im Horn)
 * (z − zFocus) + |x|: auf der Achse genau das Seitenprofil, am Fokus stetig, nach vorn
 * monoton steigend. Der Abstand selbst wüchse dort nach hinten wieder an und höbe den Deckel
 * am Throat bis in die Aufweitung.
 */
export const focusRadius = (s, x, z) =>
  z >= s.zFocus ? Math.hypot(x, z - s.zFocus) : z - s.zFocus + Math.abs(x);

/** Normierte Traktrix (r0 = 1), Parameter t: axiale Position und Radius. */
export const zN = t => t - Math.tanh(t);
export const xN = t => 1 / Math.cosh(t);

/** Hat die Lösung einen Traktrix-Eingang? */
export const hasTraktrix = s => s.Lt > LT_MIN;

/** Hat die Lösung einen Klothoiden-Übergang zwischen Traktrix und gerader Wand? */
export const hasClothoid = s => !!s.clothoid;

/**
 * Nullstelle von f in [lo, hi] mit f(lo) < 0 < f(hi) (Illinois-Verfahren: eingegrenzt wie
 * die Bisektion, aber meist in wenigen Schritten). Sprünge in f sind zulässig.
 */
function solveBracketed(f, lo, hi, maxIter = 200) {
  let flo = f(lo), fhi = f(hi), side = 0, x = lo;
  for (let i = 0; i < maxIter; i++) {
    x = (lo * fhi - hi * flo) / (fhi - flo);
    if (!(x > lo && x < hi)) x = (lo + hi) / 2;
    const fx = f(x);
    if (fx === 0 || hi - lo <= 1e-13 * Math.max(1, Math.abs(x))) break;
    if (fx > 0) { hi = x; fhi = fx; if (side === -1) flo /= 2; side = -1; }
    else        { lo = x; flo = fx; if (side === 1) fhi /= 2; side = 1; }
  }
  return x;
}

const CLOTHOID_STEPS = 64;   // Simpson-Schritte für die Klothoiden-Integration

/**
 * Punkte einer Klothoide (Krümmung fällt linear von kappa0 auf 0 über die Länge):
 * Tangentenwinkel zur Achse θ(s) = θ0 + κ0·(s − s²/2ℓ). n+1 Punkte {x, z, theta}.
 * @param c  { start: [x, z], theta0, kappa0, length }
 */
export function clothoidTable(c, n = CLOTHOID_STEPS) {
  const out = [{ x: c.start[0], z: c.start[1], theta: c.theta0 }];
  clothoidWalk(c, n, (x, z, theta) => out.push({ x, z, theta }));
  return out;
}

/** Endpunkt der Klothoide { x, z } wie clothoidTable(c, n).at(-1), ohne Tabelle (für die Suchen). */
export function clothoidEnd(c, n = CLOTHOID_STEPS) {
  return clothoidWalk(c, n);
}

/**
 * Simpson-Integration der Klothoide in n Schritten; visit(x, z, θ) je Schrittende. Sinus und
 * Kosinus am Schrittende sind die am Anfang des nächsten Schritts (gleiches Argument, gleicher
 * Wert) – je Schritt zwei statt drei Auswertungen.
 */
function clothoidWalk(c, n, visit) {
  const theta = u => c.theta0 + c.kappa0 * (u - u * u / (2 * c.length));
  const ds = c.length / n;
  let x = c.start[0], z = c.start[1];
  let sa = Math.sin(theta(0)), ca = Math.cos(theta(0));
  for (let k = 0; k < n; k++) {
    const m = theta((k + 0.5) * ds), b = theta((k + 1) * ds);
    const sb = Math.sin(b), cb = Math.cos(b);
    x = x + ds / 6 * (sa + 4 * Math.sin(m) + sb);
    z = z + ds / 6 * (ca + 4 * Math.cos(m) + cb);
    if (visit) visit(x, z, b);
    sa = sb; ca = cb;
  }
  return { x, z };
}

// ──────────────────────────────────────────────────────────────────
// WINKELABHÄNGIGE GEOMETRIE (Draufsicht)
// ──────────────────────────────────────────────────────────────────

/**
 * Erzeugt die an einen Öffnungswinkel gebundenen Geometrie-Funktionen.
 * @param {number} openingAngle  horizontaler Öffnungswinkel [°]
 * @param {number} clothoid      Länge [mm] eines krümmungsstetigen Übergangs (Klothoide)
 *                               zwischen Traktrix und gerader Wand; 0 = ohne
 */
export function createHornMath(openingAngle = DEFAULT_OPENING_ANGLE, { clothoid = 0 } = {}) {
  const ALPHA2    = (openingAngle / 2) * Math.PI / 180;   // halber Öffnungswinkel
  const T_TRANS   = Math.asinh(1 / Math.tan(ALPHA2));    // Traktrix-Parameter, bei dem die Tangente ALPHA2 erreicht
  const PHI_TOTAL = openingAngle * Math.PI / 180;
  const TAN       = Math.tan(ALPHA2);
  const ZN_TRANS  = zN(T_TRANS);                         // fest je Winkel; solveR0 läuft in den Grenzsuchen hundertfach

  /** Traktrix-Radius r0, für den der Eingang von rt bis zum Übergang genau Lt lang ist (Bisektion). */
  function solveR0(Lt, rt) {
    const f = r0 => {
      if (r0 <= rt) return -Lt;
      const tTh = Math.acosh(r0 / rt);
      if (tTh <= T_TRANS) return -Lt;
      return r0 * (zN(tTh) - ZN_TRANS) - Lt;
    };
    let hi = rt * 2;
    for (let i = 0; i < 80 && f(hi) < 0; i++) hi *= 2;
    if (f(hi) < 0) return null;
    let lo = rt * (1 + 1e-9);
    for (let i = 0; i < 90; i++) {
      const m = (lo + hi) / 2;
      if (m <= lo || m >= hi) break;   // Fließkomma-Auflösung erreicht: weitere Schritte ändern nichts
      f(m) < 0 ? (lo = m) : (hi = m);
    }
    return (lo + hi) / 2;
  }

  /**
   * Eingang mit Klothoide für einen Traktrix-Radius r0: Die Traktrix läuft bis zum Parameter
   * τa, an dem eine Klothoide der vorgegebenen Länge ℓ mit linear auf 0 fallender Krümmung
   * genau den Winkel α erreicht: ℓ = 2·(α − θ(τa)) / κ(τa) mit θ = atan(1/sinh τ),
   * κ = 1/(r0·sinh τ). Lage, Richtung und Krümmung sind an beiden Enden stetig.
   * null, wenn die Traktrix dafür nicht lang genug ist.
   */
  function clothoidEntrance(r0, rt, length) {
    if (r0 <= rt) return null;
    const tTh = Math.acosh(r0 / rt);
    if (tTh <= T_TRANS) return null;
    const g = tau => 2 * r0 * Math.sinh(tau) * (ALPHA2 - Math.atan(1 / Math.sinh(tau))) - length;
    if (g(tTh) < 0) return null;
    const tauA = solveBracketed(g, T_TRANS, tTh);
    const c = {
      start: [r0 * xN(tauA), r0 * (zN(tTh) - zN(tauA))],
      theta0: Math.atan(1 / Math.sinh(tauA)),
      kappa0: 1 / (r0 * Math.sinh(tauA)),
      length,
    };
    const end = clothoidEnd(c);
    return { r0, tTh, tEnd: tauA, clothoid: c, xTrans: end.x, zTrans: end.z };
  }

  /**
   * Übergang Eingang → gerade Wand; ohne Traktrix beginnt die Wand direkt am Throat.
   * Mit Klothoide wird r0 so bestimmt, dass Traktrix + Klothoide axial genau Lt lang sind.
   * null = unlösbar.
   */
  function transition(Lt, rt) {
    if (!(clothoid > 0)) return transitionUncached(Lt, rt);
    // mit Klothoide teuer und von den Grenzsuchen tausendfach mit gleichen Werten gerufen
    const key = Lt + "|" + rt;
    if (!transitionCache.has(key)) {
      if (transitionCache.size > 2000) transitionCache.clear();
      transitionCache.set(key, transitionUncached(Lt, rt));
    }
    return transitionCache.get(key);
  }
  const transitionCache = new Map();

  function transitionUncached(Lt, rt) {
    if (!(Lt > LT_MIN)) return { r0: null, tTh: null, tEnd: null, clothoid: null, xTrans: rt, zTrans: 0 };
    if (!(clothoid > 0)) {
      const r0 = solveR0(Lt, rt);
      if (!r0) return null;
      return { r0, tTh: Math.acosh(r0 / rt), tEnd: T_TRANS, clothoid: null, xTrans: r0 * xN(T_TRANS), zTrans: Lt };
    }
    const f = r0 => { const e = clothoidEntrance(r0, rt, clothoid); return e ? e.zTrans - Lt : -Lt; };
    let hi = rt * 2;
    for (let i = 0; i < 80 && f(hi) < 0; i++) hi *= 2;
    if (f(hi) < 0) return null;
    const r0 = solveBracketed(f, rt * (1 + 1e-9), hi);
    // Die Suche endet auch an einer Sprungstelle (Klothoide passt gerade so, beginnt am Throat,
    // ist aber schon länger als Lt) – dann gibt es keine Lösung.
    const e = clothoidEntrance(r0, rt, clothoid);
    return e && Math.abs(e.zTrans - Lt) < 1e-6 ? e : null;
  }

  /** Fokuspunkt (Schnitt der verlängerten Wand mit der Achse) und Abstand Übergang–Fokus. */
  function focusOf({ xTrans, zTrans }) {
    const zFocus = zTrans - xTrans / TAN;
    return { zFocus, rInner: Math.sqrt((zTrans - zFocus) ** 2 + xTrans ** 2) };
  }

  /**
   * Löst die Horngeometrie für Gesamtlänge L, Traktrix-Länge Lt, Throat-Radius rt und
   * Treibermaße dw × dh. Gibt null zurück, wenn die Parameter geometrisch unmöglich sind.
   */
  function solveHorn(L, Lt, rt, dw, dh) {
    const tr = transition(Lt, rt);
    return tr ? solveWith(tr, L, Lt, dw, dh) : null;
  }

  /** solveHorn mit bereits bestimmtem Übergang tr = transition(Lt, rt) (für Suchen über L). */
  function solveWith(tr, L, Lt, dw, dh) {
    const { r0, tTh, tEnd, xTrans, zTrans } = tr;

    const { zFocus, rInner } = focusOf(tr);
    const hatTipZ = -dh - dw / 2;
    const Rtarget = L - dh - dw / 2 - zFocus;
    if (Rtarget <= 0) return null;

    // Länge Ls der geraden Wand so, dass der Mundpunkt genau Rtarget vom Fokus entfernt liegt
    const a = zTrans - zFocus, b = xTrans, c = TAN;
    const A = 1 + c * c, B = 2 * (a + b * c), C = a * a + b * b - Rtarget * Rtarget;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;
    const Ls = (-B + Math.sqrt(disc)) / (2 * A);
    if (Ls < 0) return null;

    const zMouth = zTrans + Ls;
    const xMouth = xTrans + Ls * c;
    const arcR   = Math.sqrt((zMouth - zFocus) ** 2 + xMouth ** 2);

    return {
      openingAngle, alpha2: ALPHA2, tTrans: T_TRANS,
      r0, tTh, tEnd, clothoid: tr.clothoid, Lt, Ls,
      xTrans, zTrans,
      xMouth, zMouth,
      zFocus, arcR, zApex: zFocus + arcR,
      hatTipZ, arcLen: arcR * PHI_TOTAL,
      rInner, zInnerApex: zFocus + rInner,
    };
  }

  // Grenzsuchen (Reglergrenzen) halbieren bis auf LIMIT_TOL statt bis zur Fließkomma-Auflösung:
  // ≈ 30 statt ≈ 52 Schritte, verschachtelt (minLtForRaumecke → maxLforRaumecke) ≈ ⅓ der Zeit.
  // Die Seite bleibt erhalten (maxLt lösbar, minLtForRaumecke passend); solveHorn bleibt exakt.
  const LIMIT_TOL = 1e-6;   // [mm]

  /** Kleinste Gesamtlänge, bei der der Mundbogen gerade hinter dem Übergang liegt (+10 mm Reserve). */
  function minL(Lt, rt, dw, dh) {
    const tr = transition(Lt, rt);
    if (!tr) return dh + dw / 2 + 50;
    const { zFocus, rInner } = focusOf(tr);
    return Math.ceil(dh + dw / 2 + zFocus + rInner) + 10;
  }

  /**
   * Größte Traktrix-Länge, für die solveHorn bei Gesamtlänge L noch lösbar ist.
   * Ist der Eingang zu kurz für die Klothoide, zählt das als „zu kurz“ (untere Seite).
   */
  function maxLt(L, rt, dw, dh) {
    if (!solveHorn(L, 0, rt, dw, dh)) return 0;
    const ok = lt => transition(lt, rt) === null ? clothoid > 0 : !!solveHorn(L, lt, rt, dw, dh);
    let lo = 0, hi = L;
    for (let i = 0; i < 60 && hi - lo > LIMIT_TOL; i++) {
      const mid = (lo + hi) / 2;
      ok(mid) ? (lo = mid) : (hi = mid);
    }
    return lo;
  }

  /** Kleinste Traktrix-Länge, in die die Klothoide passt (0 ohne Klothoide). */
  function minLtForClothoid(rt) {
    if (!(clothoid > 0)) return 0;
    let lo = LT_MIN, hi = clothoid;
    while (transition(hi, rt) === null && hi < 1e5) hi *= 2;
    for (let i = 0; i < 60 && hi - lo > LIMIT_TOL; i++) {
      const mid = (lo + hi) / 2;
      transition(mid, rt) ? (hi = mid) : (lo = mid);
    }
    return hi;
  }

  /**
   * Größte Gesamtlänge, bei der die Mundkante (plus extraBreite, z.B. Wandstärke) noch
   * innerhalb der 45°-Raumecke liegt, die an der Treiberecke (dw/2, −dh) beginnt.
   * null, wenn die Wand die Raumecke nie erreicht (Öffnungswinkel ≤ 90°).
   */
  function maxLforRaumecke(Lt, rt, dw, dh, extraBreite = 0) {
    const tr = transition(Lt, rt);
    if (!tr) return null;
    const { xTrans, zTrans } = tr;
    // Mundkante auf der Raumecke: xTrans + Ls·tan = dw/2 + (zTrans + Ls) + dh − extraBreite
    const LsMax = (dw / 2 + dh + zTrans - xTrans - extraBreite) / (TAN - 1);
    if (LsMax <= 0) return null;
    // Lt ist fest: Übergang einmal, nicht in jedem Suchschritt (minLtForRaumecke ruft diese Suche
    // selbst in einer Suche über Lt – ohne Klothoide gibt es keinen Zwischenspeicher)
    let lo = minL(Lt, rt, dw, dh), hi = lo + 5000;
    for (let i = 0; i < 40; i++) {
      const sv = solveWith(tr, hi, Lt, dw, dh);
      if (sv && sv.Ls >= LsMax) break;
      hi *= 2;
    }
    for (let i = 0; i < 80 && hi - lo > LIMIT_TOL; i++) {
      const mid = (lo + hi) / 2;
      if (mid <= lo || mid >= hi) break;
      const sv  = solveWith(tr, mid, Lt, dw, dh);
      sv && sv.Ls < LsMax ? (lo = mid) : (hi = mid);
    }
    return (lo + hi) / 2;
  }

  /** Kleinste Traktrix-Länge, mit der Gesamtlänge L noch in die Raumecke passt; null = gar nicht. */
  function minLtForRaumecke(L, rt, dw, dh, extraBreite = 0) {
    const fits = lt => {
      const r = maxLforRaumecke(lt, rt, dw, dh, extraBreite);
      return r !== null && r >= L;
    };
    if (fits(0)) return 0;
    let lo = 0, hi = L;
    if (!fits(hi)) return null;
    for (let i = 0; i < 80 && hi - lo > LIMIT_TOL; i++) {
      const m = (lo + hi) / 2;
      if (m <= lo || m >= hi) break;
      fits(m) ? (hi = m) : (lo = m);
    }
    return hi;
  }

  return {
    openingAngle, ALPHA2, T_TRANS, PHI_TOTAL,
    solveR0, solveHorn, minL, maxLt, maxLforRaumecke, minLtForRaumecke, minLtForClothoid,
  };
}

/** Geometrie-Funktionen für den Standardwinkel (140°). */
export const {
  ALPHA2, T_TRANS, PHI_TOTAL,
  solveR0, solveHorn, minL, maxLt, maxLforRaumecke, minLtForRaumecke,
} = createHornMath();

// ──────────────────────────────────────────────────────────────────
// ABTASTUNG DER DRAUFSICHT
// ──────────────────────────────────────────────────────────────────

/** n+1 Punkte [x, z] der Traktrix vom Throat bis zu ihrem Ende (Klothoide bzw. gerade Wand); leer ohne Traktrix. */
export function traktrixPoints(s, n) {
  if (!hasTraktrix(s)) return [];
  const z0 = zN(s.tTh);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = s.tTh + (s.tEnd - s.tTh) * i / n;
    return [s.r0 * xN(t), s.r0 * (z0 - zN(t))];
  });
}

/** n+1 Punkte [x, z] der Klothoide vom Ende der Traktrix bis zum Beginn der geraden Wand; leer ohne Klothoide. */
export function clothoidPoints(s, n) {
  if (!hasClothoid(s)) return [];
  const pts = clothoidTable(s.clothoid, n).map(p => [p.x, p.z]);
  pts[n] = [s.xTrans, s.zTrans];   // Ende exakt auf dem Beginn der Geraden
  return pts;
}

/** Eingang (Traktrix + Klothoide) als Polygonzug [x, z] vom Throat bis zum Beginn der geraden Wand. */
export function entrancePoints(s, nTrak, nClothoid = nTrak) {
  const trak = traktrixPoints(s, nTrak);
  return hasClothoid(s) ? [...trak, ...clothoidPoints(s, nClothoid).slice(1)] : trak;
}

/** n+1 Punkte [x, z] der geraden Wand vom Übergang bis zum Mund. */
export function linearWallPoints(s, n) {
  const tan = Math.tan(s.alpha2);
  return Array.from({ length: n + 1 }, (_, i) => {
    const f = i / n;
    return [s.xTrans + f * s.Ls * tan, s.zTrans + f * s.Ls];
  });
}

// ──────────────────────────────────────────────────────────────────
// VERTIKALES PROFIL (Seitenriss)
// ──────────────────────────────────────────────────────────────────

/** Aufweitungskurven des Seitenrisses. */
export const CURVES = ["linear", "exponential", "hypex"];

// Der Hypex-Exponent hängt nur von (h1/h0, T) ab, wird aber pro Profilpunkt benötigt –
// der Solver für die Verrundung wertet das Profil zehntausendfach aus. Einfacher Cache
// für die zuletzt benutzte Kombination.
let hypexCache = { ratio: NaN, T: NaN, m: 0 };

function hypexExponent(ratio, T) {
  if (hypexCache.ratio === ratio && hypexCache.T === T) return hypexCache.m;
  const fVal = mv => Math.cosh(mv) + T * Math.sinh(mv);
  let lo = 0, hi = Math.log(ratio * 2 + 2) + 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    fVal(mid) < ratio ? (lo = mid) : (hi = mid);
  }
  hypexCache = { ratio, T, m: (lo + hi) / 2 };
  return hypexCache.m;
}

/**
 * Halbe Höhe des Horns im Seitenriss an der Stelle z: waagerechter Throat (h = rt) bis
 * zInnerApex, danach Aufweitung bis hMouth/2 am Mundscheitel zApex.
 * Mit fillet (aus computeFillet) liegt die Wand zwischen den Tangentenpunkten auf dem
 * Verrundungsbogen.
 */
export function verticalHalfHeight(z, s, rt, hMouth, curve, hypexT, fillet = null) {
  if (fillet && z > fillet.zT1 && z < fillet.zT2) {
    return fillet.hc - Math.sqrt(Math.max(0, fillet.R ** 2 - (z - fillet.zc) ** 2));
  }
  const h0 = rt, h1 = hMouth / 2;
  const z0 = s.zInnerApex, z1 = s.zApex;
  if (z <= z0) return h0;
  if (z >= z1) return h1;

  const u = (z - z0) / (z1 - z0);
  const linear = h0 + (h1 - h0) * u;

  if (curve === "exponential") {
    return h0 <= 0 ? h1 : h0 * Math.exp(Math.log(h1 / h0) * u);
  }
  if (curve === "hypex") {
    // h = h0·(cosh(m·u) + T·sinh(m·u)), m so gewählt, dass h(1) = h1
    const ratio = h1 / h0;
    if (ratio <= 0) return h0;
    if (Math.abs(ratio - 1) < 1e-9 || ratio < 1) return linear;
    const m = hypexExponent(ratio, hypexT);
    if (m < 1e-10) return linear;
    return h0 * (Math.cosh(m * u) + hypexT * Math.sinh(m * u));
  }
  return linear;
}

/** Profilfunktion z ↦ halbe Höhe für einen festen Parametersatz. */
export function makeProfile(s, rt, hMouth, curve, hypexT, fillet = null) {
  return z => verticalHalfHeight(z, s, rt, hMouth, curve, hypexT, fillet);
}

/**
 * Verrundung des Knicks zwischen waagerechtem Throat (h = rt) und Aufweitungskurve f(z):
 * Kreis mit Radius R, tangential an beide. Der Mittelpunkt (zc, rt + R) liegt außerhalb
 * der Wand; der Tangentenpunkt T2 auf f ist die Stelle, an der der Mittelpunkt genau R
 * entlang der Normalen liegt: f(z2) + R/√(1+f'²) = rt + R (Bisektion).
 * Ist R zu groß (T1 vor dem Throat oder T2 hinter dem Mund), wird der größte machbare
 * Radius genommen und limited = true gesetzt.
 *
 * @returns {{R, zc, hc, zT1, zT2, hT2, limited} | null}  null ohne Traktrix oder bei R ≤ 0
 */
export function computeFillet(s, rt, hMouth, curve, hypexT, R) {
  if (!s || !hasTraktrix(s) || !(R > 0)) return null;
  const z0 = s.zInnerApex, z1 = s.zApex, h0 = rt;
  const f  = makeProfile(s, rt, hMouth, curve, hypexT);
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

  let lo = 0, hi = R, best = null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const sol = solve(mid);
    if (sol) { lo = mid; best = sol; } else hi = mid;
  }
  return lo > 0.1 ? { ...best, limited: true } : null;
}

// ──────────────────────────────────────────────────────────────────
// QUERSCHNITT A(z)
// ──────────────────────────────────────────────────────────────────

/** Wellenfront durch einen Wandpunkt (x, z) mit Tangentenwinkel θ zur Achse: Kreisbogen um den
 *  Schnittpunkt der Tangente mit der Achse, Halbwinkel θ. */
const wavefrontThrough = (x, z, theta) => {
  const radius = x / Math.sin(theta), zCenter = z - x / Math.tan(theta);
  return { zCenter, radius, halfAngle: theta, zAxis: zCenter + radius };
};

/**
 * Wellenfront (Draufsicht) zu einem Wandpunkt bei zWall: Kreisbogen um den Punkt, in dem die
 * Wandtangente die Achse schneidet – nur so steht er senkrecht auf beiden Wänden. Im geraden
 * Bereich ist das der Fokus (wachsender Radius, fester Halbwinkel α); auf der Traktrix ein
 * mitwandernder Fußpunkt mit konstantem Radius r0 (definierende Traktrix-Eigenschaft) und
 * wachsendem Halbwinkel; auf der Klothoide wandern Mittelpunkt und Radius.
 * Dazu der Wandpunkt selbst: xWall und die Bogenlänge sWall entlang der Wand ab dem Throat
 * (Traktrix geschlossen: ds = r0·tanh t dt, also s = r0·ln(cosh tTh / cosh t)).
 * @param clothoid  dichte Tabelle der Klothoide (clothoidTable) oder null
 * @returns {{ zCenter, radius, halfAngle, zAxis, part, xWall, sWall }}
 */
function wavefrontAt(s, zWall, clothoid) {
  const zTrakEnd = clothoid ? clothoid[0].z : s.zTrans;
  const sTrakEnd = hasTraktrix(s) ? s.r0 * Math.log(Math.cosh(s.tTh) / Math.cosh(s.tEnd)) : 0;
  if (hasTraktrix(s) && zWall <= zTrakEnd) {
    // Bisektion (t fällt vom Throat zum Traktrix-Ende: lo > hi); zN(tTh) einmal vorab, Abbruch bei
    // erreichter Fließkomma-Auflösung (ergebnisgleich, wird für den runden Throat sehr oft aufgerufen)
    const z0 = zN(s.tTh);
    let lo = s.tTh, hi = s.tEnd;
    for (let i = 0; i < 60; i++) {
      const tm = (lo + hi) / 2;
      if (tm === lo || tm === hi) break;
      s.r0 * (z0 - zN(tm)) < zWall ? (lo = tm) : (hi = tm);
    }
    const t = (lo + hi) / 2;
    const zAxis = s.r0 * (z0 - t + 1);
    return {
      zCenter: zAxis - s.r0, radius: s.r0, halfAngle: Math.atan(1 / Math.sinh(t)), zAxis, part: "traktrix",
      xWall: s.r0 * xN(t), sWall: s.r0 * Math.log(Math.cosh(s.tTh) / Math.cosh(t)),
    };
  }
  if (clothoid && zWall <= s.zTrans) {
    let k = 1;
    while (k < clothoid.length - 1 && clothoid[k].z < zWall) k++;
    const p = clothoid[k - 1], q = clothoid[k], f = (zWall - p.z) / (q.z - p.z);
    const lerp = key => p[key] + f * (q[key] - p[key]);
    const ds = s.clothoid.length / (clothoid.length - 1);   // Tabelle in gleichen Bogenschritten
    return {
      ...wavefrontThrough(lerp("x"), zWall, lerp("theta")), part: "klothoide",
      xWall: lerp("x"), sWall: sTrakEnd + (k - 1 + f) * ds,
    };
  }
  const frac  = (zWall - s.zTrans) / (s.Ls || 1);
  const xWall = s.xTrans + frac * s.Ls * Math.tan(s.alpha2);
  const R = Math.sqrt((zWall - s.zFocus) ** 2 + xWall ** 2);
  const sEntranceEnd = sTrakEnd + (clothoid ? s.clothoid.length : 0);
  return {
    zCenter: s.zFocus, radius: R, halfAngle: s.alpha2, zAxis: s.zFocus + R, part: "linear",
    xWall, sWall: sEntranceEnd + (zWall - s.zTrans) / Math.cos(s.alpha2),
  };
}

// Dichte Klothoiden-Tabelle je Klothoide nur einmal: wallArcLength wird für den runden Throat
// tausendfach mit derselben Lösung gerufen (vorher jedes Mal neu, ≈ 3 ms je Reglerschritt)
const denseClothoids = new WeakMap();
const denseClothoid = s => {
  if (!hasClothoid(s)) return null;
  if (!denseClothoids.has(s.clothoid)) denseClothoids.set(s.clothoid, clothoidTable(s.clothoid, 400));
  return denseClothoids.get(s.clothoid);
};

/** Bogenlänge der Wand vom Throat bis zum Wandpunkt bei zWall [mm]. */
export function wallArcLength(s, zWall) {
  return wavefrontAt(s, zWall, denseClothoid(s)).sWall;
}

/**
 * Wandpunkt bei zWall (0 … zMouth): Lage xWall, Bogenlänge sWall ab dem Throat und halbe Höhe
 * hWall an der Wand nach der Höhenregel des 3D-Körpers.
 */
export function wallPoint(s, profile, zWall) {
  const clothoid = denseClothoid(s);
  const { xWall, sWall } = wavefrontAt(s, zWall, clothoid);
  return { xWall, sWall, hWall: profile(s.zFocus + focusRadius(s, xWall, zWall)) };
}

// ──────────────────────────────────────────────────────────────────
// RUNDER THROAT (Übergang rund → eckig)
// ──────────────────────────────────────────────────────────────────
//
// Der Treiber hat einen runden Ausgang (Ø 2·rt), das Horn einen rechteckigen Querschnitt.
// Im Übergang sind die vier inneren Längskanten (Seitenwand ↔ Deckel/Boden) mit einem Radius
// gerundet, der entlang der Wand von rt auf 0 fällt. Am Throat ist halbe Breite = halbe Höhe =
// Radius = rt: genau der Kreis des Treiberausgangs. Parameter ist die Bogenlänge entlang der Wand,
// nicht z auf der Achse – die Ecke liegt an der Wand, und jede Wellenfront (Kreisbogen, senkrecht
// auf der Wand) endet an ihrem eigenen Wandpunkt, der hinter ihrer Lage auf der Achse liegt.

/**
 * Eckradius [mm] an der Bogenlänge sWall: rt·(1 + cos(π·s/Länge))/2 – an beiden Enden ohne Knick
 * (am Throat läuft die Ecke rund aus dem Treiber heraus, am Ende tangential ins scharfe Rechteck).
 * @param morph  { r, length } (r = rt) oder null
 */
export function cornerRadius(sWall, morph) {
  if (!morph || !(sWall < morph.length)) return 0;
  return morph.r * (1 + Math.cos(Math.PI * Math.max(0, sWall) / morph.length)) / 2;
}

/** Wandpunkt z, an dem der Übergang endet (Bogenlänge = morph.length; Bisektion). */
function morphEndZ(s, morph, clothoid) {
  let lo = 0, hi = s.zMouth;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    wavefrontAt(s, mid, clothoid).sWall < morph.length ? (lo = mid) : (hi = mid);
  }
  return (lo + hi) / 2;
}

/** Flächenabzug [mm²] der vier gerundeten Ecken eines Querschnitts: 4·(1 − π/4)·r². */
export const cornerDeficit = r => (4 - Math.PI) * r * r;

/**
 * Größte Länge des Übergangs entlang der Wand [mm]: die ganze Wand bis zum Mund – dort ist der
 * Radius dann gerade 0, der Mund bleibt rechteckig. Die Ecke wird in der Querschnittsfläche
 * gerundet (im geraden Bereich der Wellenfront-Bogen, auf dem die Höhe konstant ist), ein
 * ansteigender Deckel stört deshalb nicht.
 */
export const maxMorphLength = s => wallArcLength(s, s.zMouth);

/**
 * Übergang rund → eckig aus den Einstellungen: Länge (null = Throat-Durchmesser) auf das
 * Machbare begrenzt. null, wenn aus oder kürzer als 1 mm.
 * @returns {{ r, length, limited, max } | null}
 */
export function throatMorph(s, rt, length) {
  const max = maxMorphLength(s);
  const want = length ?? 2 * rt;
  const used = Math.min(want, max);
  return used >= 1 ? { r: rt, length: used, limited: want > max, max } : null;
}

const ARC_SAMPLES = 64;   // Simpson-Intervalle je Halbbogen (gerade Zahl)

/**
 * Querschnittsfläche der Wellenfront = ∫ 2·h ds über den Wellenfront-Bogen, mit der Höhe
 * aus derselben Regel wie beim 3D-Körper: h = Profil(zFocus + focusRadius). Im
 * geraden Bereich liegt der Bogen um den Fokus, h ist darauf konstant (A = Bogenlänge · 2h).
 * Auf der Traktrix liegt er um einen anderen Mittelpunkt; mit Verrundung ändert sich h dort
 * entlang des Bogens und wird numerisch integriert (Simpson).
 *
 * Abgetastet an n+1 Wandpunkten plus exakt an den Sektionsgrenzen. Vor der ersten
 * definierten Wellenfront (Treiberebene) wird A bis z = 0 konstant gehalten.
 * Ohne Klothoide ist A am Übergang Traktrix → Gerade stetig, hat aber einen Knick: die
 * Wandkrümmung springt dort, und die Wellenfrontbreite hängt vom Tangentenwinkel der Wand
 * ab. Mit Klothoide ist die Krümmung stetig und A glatt.
 *
 * Mit rundem Throat (morph) fehlen jeder Wellenfront die vier Ecken mit dem Radius ihres
 * Wandpunkts: A − (4 − π)·r². Die Ecke liegt in der Wellenfrontfläche; im geraden Bereich ist
 * die Höhe auf dem Bogen konstant und der Abzug exakt, im Eingang mit Verrundung genähert.
 *
 * @param profile  z ↦ halbe Höhe (makeProfile)
 * @param zWallList  statt der gleichmäßigen Abtastung diese Wandpunkte (z, 0 … zMouth); die
 *                   Sektionsgrenzen kommen in jedem Fall dazu (Simulation: gezielt dichter)
 * @param morph    Übergang rund → eckig (throatMorph) oder null
 * @returns {{z: number, A: number, part: "traktrix" | "klothoide" | "linear", zWall: number, cornerR: number}[]}
 *   aufsteigend in z; zWall = zugehöriger Wandpunkt, cornerR = Eckradius dort
 */
export function crossSection(s, profile, n = 100, zWallList = null, morph = null) {
  const clothoid = denseClothoid(s);
  const zWalls = zWallList ? [...zWallList] : Array.from({ length: n + 1 }, (_, i) => s.zMouth * i / n);
  if (hasTraktrix(s)) zWalls.push(s.zTrans);
  if (clothoid) zWalls.push(clothoid[0].z);
  if (morph) zWalls.push(morphEndZ(s, morph, clothoid));
  zWalls.sort((a, b) => a - b);

  const areaOf = ({ zCenter, radius, halfAngle, zAxis }) => {
    if (zCenter === s.zFocus) return 2 * halfAngle * radius * (2 * profile(zAxis));
    // Punkt auf dem Bogen unter dem Winkel ψ zur Achse; seine Lage zum Fokus bestimmt die Höhe
    const height = psi => {
      const x = radius * Math.sin(psi), z = zCenter + radius * Math.cos(psi);
      return profile(s.zFocus + focusRadius(s, x, z));
    };
    const m = ARC_SAMPLES, step = halfAngle / m;
    let sum = height(0) + height(halfAngle);
    for (let k = 1; k < m; k++) sum += (k % 2 ? 4 : 2) * height(k * step);
    return 2 * (2 * radius * step / 3 * sum);   // beide Bogenhälften, Höhe 2h
  };

  const pts = zWalls.map(zWall => {
    const wf = wavefrontAt(s, zWall, clothoid);
    const cornerR = cornerRadius(wf.sWall, morph);
    return { z: wf.zAxis, A: areaOf(wf) - cornerDeficit(cornerR), part: wf.part, zWall, cornerR };
  });
  return [{ ...pts[0], z: 0 }, ...pts];
}

// ──────────────────────────────────────────────────────────────────
// KENNWERTE
// ──────────────────────────────────────────────────────────────────

/** Mundfläche (Bogenlänge × Mundhöhe) [mm²]. */
export const mouthArea = (s, hMouth) => s.arcR * 2 * s.alpha2 * hMouth;

/** Vertikaler Öffnungswinkel am Mund [°], aus der Profilsteigung kurz vor dem Mundscheitel. */
export function verticalMouthAngle(s, profile) {
  const dz = Math.max(0.5, (s.zApex - (hasTraktrix(s) ? s.zInnerApex : 0)) * 0.01);
  const slope = (profile(s.zApex) - profile(s.zApex - dz)) / dz;
  return 2 * Math.atan(slope) * 180 / Math.PI;
}

/**
 * Grobe akustische Grenzfrequenzen [Hz] (Näherungen nach Olson/Beranek):
 *   fcLow  – Umfang des flächengleichen Kreismunds ≈ Wellenlänge (λ = 2π·√(A_Mund/π))
 *   fcCut  – Horn-Cutoff aus der mittleren Flare-Konstante m = ln(A_Mund / A_Throat) / L,
 *            A_Throat = (2·rt)² (quadratischer Throat) bzw. π·rt² (runder Throat),
 *            A_Mund = Bogenlänge × Mundhöhe
 *   fcHigh – Throat-Durchmesser ≈ halbe Wellenlänge (λ = 2·rt)
 */
export function frequencyEstimates(s, rt, hMouth, roundThroat = false) {
  const c = SPEED_OF_SOUND;
  const A = mouthArea(s, hMouth);
  const throatArea = roundThroat ? Math.PI * rt * rt : (2 * rt) ** 2;
  const m = Math.log(A / throatArea) / (s.zApex - s.hatTipZ);
  return {
    fcLow:  c / (2 * Math.PI * Math.sqrt(A / Math.PI)),
    fcCut:  c * m / (4 * Math.PI),
    fcHigh: c / (2 * rt),
  };
}
