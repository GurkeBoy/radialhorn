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
 *   - Die Gesamtlänge L wird hier immer von der Hut-Spitze der Raumecke (hatTipZ = −dh − dw/2)
 *     bis zum Scheitel des Mundbogens gemessen. Die App zeigt L ohne Raumecke ab dem Flansch
 *     (Throat-Ebene z = 0, lengthOffset); geometry.js rechnet um.
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

/**
 * Abstand [mm] der Hut-Spitze (Beginn von L in dieser Datei) hinter dem Beginn der angezeigten
 * Gesamtlänge: mit Raumecke 0 (L ab der Hut-Spitze), ohne dh + dw/2 (L ab dem Flansch, der
 * Throat-Ebene vor dem Treiber – eine unsichtbare Hut-Spitze wäre kein sinnvoller Bezug, und der
 * Treiber gehört nicht zum Horn). Angezeigt = intern − lengthOffset.
 */
export const lengthOffset = (dw, dh, showRaumecke) => showRaumecke ? 0 : dh + dw / 2;

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
 * Punkte eines Übergangsstücks (Klothoide: Krümmung fällt linear von kappa0 auf kappa1 = 0 über die Länge; Kreisbogen:
 * kappa1 = kappa0): Tangentenwinkel zur Achse θ(s) = θ0 + κ0·s + (κ1 − κ0)·s²/2ℓ. n+1 Punkte {x, z, theta}.
 * @param c  { start: [x, z], theta0, kappa0, kappa1?, length, kind? }
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
  const k1 = c.kappa1 ?? 0;
  const theta = u => c.theta0 + c.kappa0 * u + (k1 - c.kappa0) * u * u / (2 * c.length);
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
 * @param {number} arc           Radius [mm] eines Kreisbogens als Übergang statt der Klothoide (Schmiegekreis an die
 *                               Traktrix, dann tangential in die Gerade); 0 = ohne; die Klothoide hat Vorrang
 */
export function createHornMath(openingAngle = DEFAULT_OPENING_ANGLE, { clothoid = 0, arc = 0 } = {}) {
  const blend = clothoid > 0 || arc > 0;     // Übergang Traktrix → Gerade (Klothoide oder Kreisbogen)
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
   * Eingang mit Kreisbogen für einen Traktrix-Radius r0: Die Traktrix läuft bis zum Parameter τa, an dem ihr
   * Krümmungsradius r0·sinh τa gerade den Radius R des Bogens hat (Schmiegekreis: Lage, Richtung und Krümmung stetig).
   * Der Bogen dreht die Tangente von θ(τa) = atan(1/sinh τa) auf den Winkel α, danach folgt die Gerade tangential;
   * die Krümmung springt dort von 1/R auf 0. Bogenlänge R·(α − θ). null, wenn R nicht passt: der Kreis muss
   * innerhalb der Traktrix beginnen (R ≤ r0·sinh τTh) und vor dem Winkel α (R ≥ r0·sinh τα = r0/tan α).
   */
  function arcEntrance(r0, rt, R) {
    if (r0 <= rt) return null;
    const tTh = Math.acosh(r0 / rt);
    if (tTh <= T_TRANS) return null;
    const tauA = Math.asinh(R / r0);
    if (!(tauA <= tTh && tauA > T_TRANS)) return null;
    const theta0 = Math.atan(1 / Math.sinh(tauA)), kappa = 1 / R;
    const x0 = r0 * xN(tauA), z0 = r0 * (zN(tTh) - zN(tauA));
    const c = {
      kind: "arc", start: [x0, z0], theta0, kappa0: kappa, kappa1: kappa, length: R * (ALPHA2 - theta0),
    };
    // Kreisbogen exakt: x = x0 + (cos θ0 − cos θ)/κ, z = z0 + (sin θ − sin θ0)/κ bei θ = α
    return {
      r0, tTh, tEnd: tauA, clothoid: c,
      xTrans: x0 + R * (Math.cos(theta0) - Math.cos(ALPHA2)), zTrans: z0 + R * (Math.sin(ALPHA2) - Math.sin(theta0)),
    };
  }

  /** Eingang mit dem eingestellten Übergangsstück (Klothoide hat Vorrang vor Kreisbogen) für r0; null ohne Übergang. */
  const entranceFor = (r0, rt) => clothoid > 0 ? clothoidEntrance(r0, rt, clothoid) : arcEntrance(r0, rt, arc);

  /**
   * Zulässige Traktrix-Längen Lₜ des Kreisbogens: r0 liegt zwischen r0_min (Bogen beginnt am Throat: R = r0·√(r0² − rt²)/rt
   * ⇒ r0² = (rt² + √(rt⁴ + 4·R²·rt²))/2) und r0_max = R·tan α (Bogen schrumpft auf 0); Lₜ steigt mit r0.
   * null, wenn das Fenster leer ist. Nur für den Kreisbogen.
   */
  function arcWindow(rt) {
    const rLo = Math.sqrt((rt * rt + Math.sqrt(rt ** 4 + 4 * arc * arc * rt * rt)) / 2) * (1 + 1e-9), rHi = arc * TAN;
    if (!(rLo < rHi)) return null;
    const lo = arcEntrance(rLo, rt, arc), hi = arcEntrance(rHi * (1 - 1e-12), rt, arc);
    return lo && hi ? { rLo, rHi: rHi * (1 - 1e-12), min: lo.zTrans, max: hi.zTrans } : null;
  }

  /**
   * Zustand der Traktrix-Länge zum Übergangsstück: "short" (zu kurz: Klothoide passt nicht, Kreisbogen beginnt vor dem
   * Throat), "long" (zu lang, nur Kreisbogen) oder "ok".
   */
  function blendState(Lt, rt) {
    if (!blend) return "ok";
    if (arc > 0 && !(clothoid > 0)) {
      const w = arcWindow(rt);
      if (!w) return "short";
      return Lt < w.min ? "short" : Lt > w.max ? "long" : "ok";
    }
    return transition(Lt, rt) === null ? "short" : "ok";
  }

  /**
   * Übergang Eingang → gerade Wand; ohne Traktrix beginnt die Wand direkt am Throat.
   * Mit Klothoide oder Kreisbogen wird r0 so bestimmt, dass Traktrix + Übergangsstück axial genau Lt lang sind.
   * null = unlösbar.
   */
  function transition(Lt, rt) {
    if (!blend) return transitionUncached(Lt, rt);
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
    if (!blend) {
      const r0 = solveR0(Lt, rt);
      if (!r0) return null;
      return { r0, tTh: Math.acosh(r0 / rt), tEnd: T_TRANS, clothoid: null, xTrans: r0 * xN(T_TRANS), zTrans: Lt };
    }
    const f = r0 => { const e = entranceFor(r0, rt); return e ? e.zTrans - Lt : -Lt; };
    let lo = rt * (1 + 1e-9), hi = rt * 2;
    if (!(clothoid > 0)) {
      // Kreisbogen: nur das Fenster [r0_min, r0_max) ist lösbar, Lₜ steigt darin mit r0
      const w = arcWindow(rt);
      if (!w || Lt < w.min || Lt > w.max) return null;
      lo = w.rLo; hi = w.rHi;
      if (f(hi) < 0) return null;
    } else {
      for (let i = 0; i < 80 && f(hi) < 0; i++) hi *= 2;
      if (f(hi) < 0) return null;
    }
    const r0 = solveBracketed(f, lo, hi);
    // Die Suche endet auch an einer Sprungstelle (Klothoide passt gerade so, beginnt am Throat,
    // ist aber schon länger als Lt) – dann gibt es keine Lösung.
    const e = entranceFor(r0, rt);
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
    const ok = lt => {
      const state = blendState(lt, rt);
      return state === "long" ? false : state === "short" ? blend : !!solveHorn(L, lt, rt, dw, dh);
    };
    let lo = 0, hi = L;
    for (let i = 0; i < 60 && hi - lo > LIMIT_TOL; i++) {
      const mid = (lo + hi) / 2;
      ok(mid) ? (lo = mid) : (hi = mid);
    }
    return lo;
  }

  /** Größte Traktrix-Länge, die das Übergangsstück zulässt (Kreisbogen: Ende des Fensters, 0 wenn es keins gibt; sonst unbegrenzt). */
  function maxLtForBlend(rt) {
    return arc > 0 && !(clothoid > 0) ? arcWindow(rt)?.max ?? 0 : Infinity;
  }

  /** Kleinste Traktrix-Länge, in die das Übergangsstück passt (Klothoide: Bisektion; Kreisbogen: Fenster); 0 ohne Übergang. */
  function minLtForClothoid(rt) {
    if (!blend) return 0;
    if (!(clothoid > 0)) return arcWindow(rt)?.min ?? Infinity;
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

  /**
   * Größte Gesamtlänge bis cap, die mit Raumecke noch geht, wenn Lₜ der Raumecke folgt (Lₜ so
   * groß, dass die Mundkante an der Wand liegt – minLtForRaumecke – und höchstens maxLt). Bisher
   * in allen geprüften Geometrien bis 1200 mm lösbar; sonst Bisektion (lösbar ist ein Anfangsstück).
   * null, wenn die Wand die Raumecke nie erreicht (Öffnungswinkel ≤ 90°: keine Grenze durch die
   * Raumecke). Passt gar keine Länge, die kleinste (minL ohne Traktrix).
   */
  function maxLWithRaumecke(rt, dw, dh, extraBreite = 0, cap = Infinity) {
    if (TAN <= 1) return null;
    const fits = L => {
      const lt = minLtForRaumecke(L, rt, dw, dh, extraBreite);
      return lt !== null && lt <= maxLt(L, rt, dw, dh);
    };
    if (fits(cap)) return cap;
    let lo = minL(0, rt, dw, dh), hi = cap;
    if (!fits(lo)) return lo;
    for (let i = 0; i < 60 && hi - lo > LIMIT_TOL; i++) {
      const m = (lo + hi) / 2;
      fits(m) ? (lo = m) : (hi = m);
    }
    return lo;
  }

  return {
    openingAngle, ALPHA2, T_TRANS, PHI_TOTAL,
    solveR0, solveHorn, minL, maxLt, maxLforRaumecke, minLtForRaumecke, minLtForClothoid, maxLtForBlend, maxLWithRaumecke,
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
    if (fillet.kind === "clothoid") return tableHeight(fillet, z);
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

/** Höhe der Klothoiden-Verrundung bei z (lineare Interpolation in der dichten Tabelle zs/hs, z aufsteigend). */
function tableHeight({ zs, hs }, z) {
  let lo = 0, hi = zs.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; zs[mid] <= z ? (lo = mid) : (hi = mid); }
  return hs[lo] + (hs[hi] - hs[lo]) * (z - zs[lo]) / (zs[hi] - zs[lo] || 1);
}

const BLEND_STEPS = 400;   // Stützstellen der Klothoiden-Verrundung (Simpson-Integration und Tabelle)

/**
 * Krümmungsstetige Verrundung (Klothoide) zwischen dem waagerechten Throat (h = rt, Krümmung 0) und der
 * Aufweitungskurve f: Die Krümmung steigt linear von 0 am Throat auf ein Maximum in der Mitte und fällt/steigt dann
 * linear auf die Krümmung κ_f der Aufweitung am Ende (zwei Klothoiden, Gesamtlänge ℓ). Lage, Richtung und Krümmung
 * sind an beiden Enden stetig. Das Ende T2 liegt bei z2 auf f: der Tangentenwinkel θ_f(z2) = atan f′ legt das
 * Krümmungsmaximum κa = 2·θ_f/ℓ − κ_f/2 fest, die Höhe rt + Y(ℓ, z2) = f(z2) bestimmt z2 (Bisektion), der Beginn
 * z1 = z2 − X(ℓ, z2) liegt auf dem Throat. Reicht der Platz nicht (z2 hinter dem Mund, Beginn vor dem Throat),
 * wird die größte machbare Länge genommen (limited).
 *
 * @returns {{kind: "clothoid", length, limited, zT1, zT2, hT2, zs, hs} | null}  null ohne Traktrix oder bei ℓ ≤ 0
 */
export function computeFilletClothoid(s, rt, hMouth, curve, hypexT, length) {
  if (!s || !hasTraktrix(s) || !(length > 0)) return null;
  const z0 = s.zInnerApex, z1 = s.zApex;
  const f = makeProfile(s, rt, hMouth, curve, hypexT);
  const d = Math.max(1e-3, (z1 - z0) * 1e-4);
  const slope = z => (f(z + d) - f(z - d)) / (2 * d);
  const curvature = z => {
    const m = slope(z);
    return (f(z + d) - 2 * f(z) + f(z - d)) / (d * d) / Math.pow(1 + m * m, 1.5);
  };
  // Verlauf der Klothoide: Tangentenwinkel θ(u), Krümmung 0 → κa (Mitte) → κe (Ende)
  const profileOf = (l, theta2, kEnd) => {
    const ka = 2 * theta2 / l - kEnd / 2, half = l / 2;
    return u => u <= half
      ? ka * u * u / l
      : ka * l / 4 + ka * (u - half) + (kEnd - ka) * (u - half) ** 2 / l;
  };
  // Lage am Ende: ∫cos θ, ∫sin θ (Simpson, BLEND_STEPS Schritte)
  const integrate = (l, theta) => {
    const h = l / BLEND_STEPS;
    let x = 0, y = 0;
    for (let k = 0; k < BLEND_STEPS; k++) {
      const a = theta(k * h), m = theta((k + 0.5) * h), b = theta((k + 1) * h);
      x += h / 6 * (Math.cos(a) + 4 * Math.cos(m) + Math.cos(b));
      y += h / 6 * (Math.sin(a) + 4 * Math.sin(m) + Math.sin(b));
    }
    return { x, y };
  };
  const trial = l => {
    const residual = z2 => {
      const { y } = integrate(l, profileOf(l, Math.atan(slope(z2)), curvature(z2)));
      return rt + y - f(z2);
    };
    let lo = z0 + 5 * d, hi = z1 - d;
    if (!(residual(lo) > 0) || residual(hi) > 0) return null;   // Länge zu groß: f steigt vor dem Schnitt nicht genug
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      residual(mid) > 0 ? (lo = mid) : (hi = mid);
    }
    const z2 = (lo + hi) / 2, theta = profileOf(l, Math.atan(slope(z2)), curvature(z2));
    const { x } = integrate(l, theta);
    return z2 - x >= 0 ? { l, z2, theta, zStart: z2 - x } : null;
  };

  let used = length, sol = trial(length), limited = false;
  if (!sol) {
    limited = true;
    let lo = 0, hi = length;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2, t = trial(mid);
      if (t) { lo = mid; sol = t; used = mid; } else hi = mid;
    }
    if (!sol || lo < 0.1) return null;
  }
  const zs = [sol.zStart], hs = [rt];
  const h = sol.l / BLEND_STEPS;
  let x = 0, y = 0;
  for (let k = 0; k < BLEND_STEPS; k++) {
    const a = sol.theta(k * h), m = sol.theta((k + 0.5) * h), b = sol.theta((k + 1) * h);
    x += h / 6 * (Math.cos(a) + 4 * Math.cos(m) + Math.cos(b));
    y += h / 6 * (Math.sin(a) + 4 * Math.sin(m) + Math.sin(b));
    zs.push(sol.zStart + x); hs.push(rt + y);
  }
  zs[BLEND_STEPS] = sol.z2; hs[BLEND_STEPS] = f(sol.z2);   // Ende exakt auf der Aufweitung
  return { kind: "clothoid", length: used, limited, zT1: sol.zStart, zT2: sol.z2, hT2: f(sol.z2), zs, hs };
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
 * Wellenfront (Draufsicht) durch die Achsenstelle zAxis, an der ihr Bogen die Hornachse schneidet: Kreisbogen um (0, zCenter)
 * mit Radius radius und Halbwinkel halbAngle, dazu die halbe Breite xWall an der Wand. Die Achsenstelle wächst mit der Wand
 * (Traktrix, Klothoide, gerade Wand), so dass sie die Wellenfronten eindeutig kennzeichnet. Vor der Throat-Wellenfront gilt
 * diese, hinter dem Mund der Mundbogen.
 * @returns {{ zCenter, radius, halfAngle, zAxis, xWall }}
 */
export function wavefrontAtAxis(s, zAxis) {
  const clothoid = denseClothoid(s);
  const first = wavefrontAt(s, 0, clothoid);
  if (zAxis <= first.zAxis) return first;
  let lo = 0, hi = s.zMouth;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    wavefrontAt(s, mid, clothoid).zAxis < zAxis ? (lo = mid) : (hi = mid);
  }
  return wavefrontAt(s, hi, clothoid);
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
 * Eckradius [mm] an der Bogenlänge sWall.
 *   - Übergang am Throat (throatMorph): rt·(1 − s/Länge) – gleichmäßig vom Kreis des Treiberausgangs
 *     (am Throat r = rt) auf 0 im scharfen Rechteck (am Ende des Übergangs).
 *   - Mundverrundung (mouthRounding): eine einzige Rampe vom Radius am Throat (rt mit Übergang, sonst 0)
 *     gleichmäßig auf R am Mund; die Länge des Throat-Übergangs gilt dann nicht mehr.
 * @param morph  { r, length, mouth? } (r = rt) oder null
 */
export function cornerRadius(sWall, morph) {
  if (!morph) return 0;
  if (morph.mouth) return mouthCornerRadius(sWall, morph.mouth);
  return sWall < morph.length ? morph.r * (1 - Math.max(0, sWall) / morph.length) : 0;
}

/**
 * Eckradius mit Mundverrundung an der Bogenlänge sWall: from + (R − from)·s/S – gleichmäßig vom Radius am
 * Throat (from) auf R am Mund (S = Wandlänge bis zum Mund), nirgends höher als die halbe Höhe an dieser Stelle
 * (am Mund nur 95 % davon; sampled: Stützstellen der Wand, aufsteigend in s). Die Enden liegen am Rand der Fläche
 * (Throat, offener Mund): ein Knick im Radius ist dort nicht zu sehen.
 */
function mouthCornerRadius(sWall, { R, S, from, sampled }) {
  const u = Math.min(1, Math.max(0, sWall / S)), r = from + (R - from) * u, cap = 1 - (1 - MOUTH_CAP) * u;
  // Obergrenzen: Anteil der halben Höhe und des Zeilenradius (Abstand zum Fokus), aber nie unter dem Radius am Throat
  // (am Treiberkreis ist r = h erlaubt)
  const limit = (hv, rho) => Math.min(r, Math.max(cap * hv, Math.min(from, hv)), Math.max(MOUTH_RHO * rho, from));
  const { s: ss, h, rho } = sampled;
  if (sWall <= ss[0]) return limit(h[0], rho[0]);
  if (sWall >= ss[ss.length - 1]) return limit(h[h.length - 1], rho[rho.length - 1]);
  let lo = 0, hi = ss.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; ss[mid] <= sWall ? (lo = mid) : (hi = mid); }
  const f = (sWall - ss[lo]) / (ss[hi] - ss[lo]);
  return limit(h[lo] + (h[hi] - h[lo]) * f, rho[lo] + (rho[hi] - rho[lo]) * f);
}

const MOUTH_SAMPLES = 160;
const MOUTH_CAP = 0.95;   // Eckradius am Mund höchstens dieser Anteil der halben Höhe (sonst schrumpft die gerade Wand auf nichts)

const MOUTH_RHO = 0.25;   // Eckradius höchstens dieser Anteil des Zeilenradius (Abstand zum Fokus): die Ecke wird in der Zeile, einem Kreisbogen um den Fokus, gerundet – bei größerem Radius im Verhältnis zum Bogen weicht die Wandstärke an der Rundung merklich ab

/** Größter Radius der Mundverrundung: fast die halbe Mundhöhe (dann laufen die Enden des Mundes beinahe als Halbkreis aus), höchstens ein Viertel des Mundbogenradius arcR. */
export const maxMouthRound = (hMouthHalf, arcR = Infinity) => Math.min(MOUTH_CAP * hMouthHalf, MOUTH_RHO * arcR);

/**
 * Ecken am Mund gerundet: ein Eckradius, der gleichmäßig vom Radius am Throat (0, mit throatMorph rt) auf R am Mund
 * ansteigt (cornerRadius). Das Ergebnis ersetzt das morph-Objekt überall (Netz, Querschnitt, Simulation); mit Übergang
 * am Throat ist length dann die ganze Wand (die Zeilen des Netzes werden bis zum Mund verdichtet). null, wenn R < 0,5 mm
 * ist und es keinen Übergang am Throat gibt.
 * @param morph  Übergang am Throat (throatMorph) oder null
 * @returns {{ r, length, limited, max, mouth: { R, S, from, sampled } } | null}
 */
export function mouthRounding(s, profile, morph, R) {
  const used = Math.min(R, maxMouthRound(profile(s.zApex), s.arcR));
  if (!(used >= 0.5)) return morph;
  const S = maxMorphLength(s), ss = [], h = [], rho = [];
  for (let i = 0; i <= MOUTH_SAMPLES; i++) {
    const zWall = s.zMouth * i / MOUTH_SAMPLES, p = wallPoint(s, profile, zWall);
    ss.push(p.sWall); h.push(p.hWall); rho.push(Math.hypot(p.xWall, zWall - s.zFocus));
  }
  const base = morph ?? { r: 0, length: 0, limited: false, max: S };
  return { ...base, length: S, mouth: { R: used, S, from: base.r, sampled: { s: ss, h, rho } } };
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
 * @param blockage Fläche [mm²], die Einbauten (Lamellen, vaneBlockage) an einer Wellenfront wegnehmen, oder null
 * @returns {{z: number, A: number, B: number, part: "traktrix" | "klothoide" | "linear", zWall: number, cornerR: number}[]}
 *   aufsteigend in z; zWall = zugehöriger Wandpunkt, cornerR = Eckradius dort; B = abgezogene Einbauten (in A schon enthalten)
 */
export function crossSection(s, profile, n = 100, zWallList = null, morph = null, blockage = null) {
  if (s.round) return crossSectionRound(s, n, zWallList);
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
    const B = blockage ? blockage(wf) : 0;
    return { z: wf.zAxis, A: areaOf(wf) - cornerDeficit(cornerR) - B, B, part: wf.part, zWall, cornerR };
  });
  return [{ ...pts[0], z: 0 }, ...pts];
}

// ──────────────────────────────────────────────────────────────────
// RUNDES HORN (Rotationskörper)
// ──────────────────────────────────────────────────────────────────
//
// Das Draufsicht-Profil (Traktrix-Eingang, gerade Wand, Mundbogen um den Fokus) um die Hornachse gedreht ergibt ein
// rotationssymmetrisches Horn. Jede Wellenfront ist dann eine Kugelkappe mit dem Radius und dem Halbwinkel des
// Draufsicht-Bogens: Fläche 2π·R²·(1 − cos θ), am Throat die Kreisscheibe π·rt². Die Lösung s trägt s.round = true
// (geometry.js); alles Nachgelagerte (Querschnitt, Mundfläche, Netze, Simulation) prüft dieses Kennzeichen.
// Länge L zählt dabei vom Throat (Treiberfront, z = 0) bis zum Scheitel des Mundbogens.

/** Fläche der Kugelkappe mit Radius R und Halbwinkel θ [mm²]: 2π·R²·(1 − cos θ), numerisch stabil auch für große R. */
export const capArea = (R, theta) => 2 * Math.PI * R * R * Math.sin(theta) ** 2 / (1 + Math.cos(theta));

/**
 * Querschnittsfläche der Wellenfront des runden Horns (wie crossSection, ohne Profil und Ecken), dazu Radius und
 * Tangentenwinkel der Wand an ihrem Fußpunkt (xWall, theta).
 * @returns {{z: number, A: number, part: string, zWall: number, cornerR: number, xWall: number, theta: number}[]}
 */
export function crossSectionRound(s, n = 100, zWallList = null) {
  const clothoid = denseClothoid(s);
  const zWalls = zWallList ? [...zWallList] : Array.from({ length: n + 1 }, (_, i) => s.zMouth * i / n);
  if (hasTraktrix(s)) zWalls.push(s.zTrans);
  if (clothoid) zWalls.push(clothoid[0].z);
  zWalls.sort((a, b) => a - b);
  const pts = zWalls.map(zWall => {
    const wf = wavefrontAt(s, zWall, clothoid);
    return { z: wf.zAxis, A: capArea(wf.radius, wf.halfAngle), part: wf.part, zWall, cornerR: 0, xWall: wf.xWall, theta: wf.halfAngle };
  });
  return [{ ...pts[0], z: 0 }, ...pts];
}

// ──────────────────────────────────────────────────────────────────
// KENNWERTE
// ──────────────────────────────────────────────────────────────────

/**
 * Mundfläche (Bogenlänge × Mundhöhe) [mm²], mit gerundeten Mundecken (morph, mouthRounding) um (4 − π)·r²
 * des Eckradius am Mund vermindert – dieselbe Fläche wie am Ende von crossSection und der Simulation.
 */
export const mouthArea = (s, hMouth, morph = null) => s.round
  ? capArea(s.arcR, s.alpha2)   // rundes Horn: Kugelkappe des Mundbogens
  : s.arcR * 2 * s.alpha2 * hMouth - cornerDeficit(cornerRadius(maxMorphLength(s), morph));

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
export function frequencyEstimates(s, rt, hMouth, roundThroat = false, morph = null) {
  const c = SPEED_OF_SOUND;
  const A = mouthArea(s, hMouth, morph);
  const throatArea = roundThroat || s.round ? Math.PI * rt * rt : (2 * rt) ** 2;
  const m = Math.log(A / throatArea) / (s.zApex - s.hatTipZ);
  return {
    fcLow:  c / (2 * Math.PI * Math.sqrt(A / Math.PI)),
    fcCut:  c * m / (4 * Math.PI),
    fcHigh: c / (2 * rt),
  };
}
