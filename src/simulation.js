/**
 * 1D-Akustiksimulation des Horns: Webster-Horngleichung, gelöst per Transfermatrix-Verkettung,
 * mit Treiber-Ersatzschaltbild (Thiele-Small) und Strahlungsimpedanz am Mund. Rein funktional,
 * unabhängig von der Geometrie (bekommt nur die Flächenkurve S(x)); einzige Brücke zur
 * Geometrie ist der Adapter areaCurve.
 *
 * Konventionen
 *   - SI-Einheiten (m, m², kg, Pa, Hz), die Geometrie (mm, mm²) wird in areaCurve umgerechnet.
 *   - Akustische Größen: Schalldruck p und Schallfluss U (m³/s), Impedanzen p/U (Pa·s/m³).
 *   - Zeitabhängigkeit e^{+jωt}.
 *   - Effektivwerte: Spannung 2,83 V eff, SPL aus dem Effektivwert des Drucks (Bezug 20 µPa).
 *
 * Modell
 *   - S(x) stückweise konisch: zwischen zwei Stützstellen wächst √S linear (echter Konus,
 *     S ∝ r²). Für jeden solchen Abschnitt ist die Transfermatrix die exakte Lösung der
 *     Webster-Gleichung; eine Unterteilung ändert nichts. Die Näherung liegt allein in der
 *     Abtastung von S(x) – sie muss deutlich feiner sein als ein Zehntel der kleinsten
 *     Wellenlänge (areaCurve: λmin/20).
 *   - Mund: Kolben gleicher Fläche. 2π exakt (unendliche Schallwand), 4π/π/π/2 als Näherung.
 *   - Treiber: Re + jωLe, Bl, Mmd, Cms, Rms, Sd; Kompressionskammer Vtc (mit Atc als kurzes
 *     Rohr), optional geschlossene Rückkammer Vrc.
 *   - SPL wie Hornresp („constant directivity SPL“): die abgestrahlte Leistung W = Re(Z_r)·|U_Mund|²
 *     gleichmäßig auf den Raumwinkel Ω verteilt, |p| = √(W·ρc/Ω)/r. Im Tiefton gleich dem
 *     Monopol ωρ|U|/(Ω·r); darüber nicht der Achsendruck eines ebenen Kolbens, der für den
 *     gekrümmten Mund eines Radialhorns bis 20 dB zu hoch läge. Gegen Hornresp geprüft.
 *   - Verlustfrei (Wandverluste: spätere Erweiterung).
 */
import { crossSection } from "./horn-math.js";

// ──────────────────────────────────────────────────────────────────
// LUFT, FREQUENZEN
// ──────────────────────────────────────────────────────────────────

/** Spezifische Gaskonstante trockener Luft [J/(kg·K)]. */
const R_AIR = 287.05;

/**
 * Schallgeschwindigkeit und Dichte trockener Luft bei Temperatur T [°C] und Druck p [Pa]:
 * c = 331,3·√(1 + T/273,15), ρ = p / (R·T).
 */
export function airAt(tempC = 20, pressure = 101325) {
  const T = tempC + 273.15;
  return { c: 331.3 * Math.sqrt(T / 273.15), rho: pressure / (R_AIR * T) };
}

/** Logarithmischer Frequenzvektor von fMin bis fMax mit perOctave Punkten je Oktave. */
export function logFrequencies(fMin = 20, fMax = 20000, perOctave = 24) {
  const n = Math.round(perOctave * Math.log2(fMax / fMin));
  return Array.from({ length: n + 1 }, (_, i) => fMin * (fMax / fMin) ** (i / n));
}

/** Größte Abschnittslänge [m] für eine Frequenz: λ / 20. */
export const sampleStep = (f, c) => c / f / 20;

/**
 * Abtastweite der Geometrie für areaCurve [mm]. Gemessen gegen eine Abtastung mit 0,25 mm
 * (Standardhorn, lange Traktrix, ohne Traktrix, Klothoide + Verrundung): Abweichung im SPL
 * < 0,001 dB, in Z_el < 0,01 %. Bleibt unter λ/10 bei 20 kHz (1,7 mm).
 */
export const GEOMETRY_STEP_MM = 1.5;

/**
 * Frequenz [Hz], ab der im Hals Querwellen möglich sind (Breite = λ/2) – ab hier ist das
 * 1D-Modell unsicher (Faustregel, keine harte Grenze). throatWidth in m.
 */
export const transverseLimit = (throatWidth, c) => c / (2 * throatWidth);

// ──────────────────────────────────────────────────────────────────
// KOMPLEXE ZAHLEN (klein, nur was gebraucht wird)
// ──────────────────────────────────────────────────────────────────

export const cx = (re, im = 0) => ({ re, im });
const add = (a, b) => cx(a.re + b.re, a.im + b.im);
const mul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const inv = a => div(cx(1), a);
export const abs = a => Math.hypot(a.re, a.im);
export const arg = a => Math.atan2(a.im, a.re);

// ──────────────────────────────────────────────────────────────────
// HORN: TRANSFERMATRIZEN
// ──────────────────────────────────────────────────────────────────

/**
 * Transfermatrix eines Konusabschnitts der Länge L von Fläche S1 nach S2 (√S linear):
 * [p1; U1] = [[A11, j·B], [j·C, A22]]·[p2; U2], verlustfrei, det = 1.
 * Herleitung: q = r·p erfüllt die ebene Wellengleichung; mit a = √S und g = (a2 − a1)/L
 * (Steigung von √S) bleibt die Formel auch für den Zylinder (g = 0) und für verengende
 * Abschnitte (g < 0) gültig, ohne Sonderfall.
 */
export function coneMatrix(S1, S2, L, k, rhoC) {
  const a1 = Math.sqrt(S1), a2 = Math.sqrt(S2), g = (a2 - a1) / L;
  const s = Math.sin(k * L), c = Math.cos(k * L);
  return {
    A11: (a2 / a1) * c - g * s / (k * a1),
    B:   rhoC * s / (a1 * a2),
    C:   (a1 * a2 * s - g * g * L * c / k + g * g * s / (k * k)) / rhoC,
    A22: (a1 / a2) * c + g * s / (k * a2),
  };
}

/**
 * Druck und Schallfluss am Hornanfang für eine Last am Ende: läuft vom Ende zum Anfang durch
 * alle Abschnitte. load = Lastimpedanz am Ende (p/U) oder Infinity (schallhart, U = 0).
 * Rückgabe { p, U } mit U_Ende = 1 (bzw. p_Ende = 1 bei schallhartem Ende).
 */
export function propagate(curve, k, rhoC, load) {
  const { x, S } = curve;
  let p = load === Infinity ? cx(1) : cx(load.re, load.im);
  let U = load === Infinity ? cx(0) : cx(1);
  for (let i = x.length - 2; i >= 0; i--) {
    const { A11, B, C, A22 } = coneMatrix(S[i], S[i + 1], x[i + 1] - x[i], k, rhoC);
    const p1 = cx(A11 * p.re - B * U.im, A11 * p.im + B * U.re);
    U = cx(A22 * U.re - C * p.im, A22 * U.im + C * p.re);
    p = p1;
  }
  return { p, U };
}

/**
 * Längste Abschnitte [m] auch bei tiefen Frequenzen. Unterhalb der Horn-Grenzfrequenz bestimmt
 * die Krümmung von S(x) das Verhalten, nicht die Wellenlänge – gröbere Abschnitte verschieben
 * dort die (scharfen) Resonanzen: mit λ/20 allein bis 1,2 dB bei langer Traktrix. Gemessen
 * gegen volle Auflösung (5 Geometrien, 20 Hz – 20 kHz): 3 mm ≤ 0,011 dB, 5 mm ≤ 0,025 dB.
 */
export const MAX_SEGMENT = 0.003;

/**
 * Vergröberte Fassungen der Flächenkurve: Stufe j hat Abschnitte höchstens h0·2^j lang, die
 * letzte genau hMax (gierig ausgedünnt; Hals, erste Wellenfront und Mund bleiben). Auch
 * Stufe 0 wird ausgedünnt – areaCurve liegt stellenweise viel dichter als nötig (ungleiche
 * Wellenfront-Abstände). Weil jeder Abschnitt ein exakter Konus ist, liegt der Fehler einer
 * Stufe allein in der gröberen Form.
 * @returns {{ h, curve }[]}  aufsteigend in h
 */
export function curveLevels(curve, h0, hMax = MAX_SEGMENT) {
  const levels = [];
  const n = curve.x.length - 1;
  for (let h = Math.min(h0, hMax); !(h <= levels.at(-1)?.h); h = Math.min(2 * h, hMax)) {
    const idx = n > 1 ? [0, 1] : [0];
    let i = idx.at(-1);
    while (i < n) {
      let k = i + 1;
      while (k < n && curve.x[k + 1] - curve.x[i] <= h) k++;
      idx.push(k);
      i = k;
    }
    levels.push({ h, curve: { x: idx.map(j => curve.x[j]), S: idx.map(j => curve.S[j]) } });
  }
  return levels;
}

/** Eingangsimpedanz [Pa·s/m³] des Horns (S(x)) bei Wellenzahl k mit Last am Ende. */
export function inputImpedance(curve, k, rhoC, load) {
  const { p, U } = propagate(curve, k, rhoC, load);
  return div(p, U);
}

// ──────────────────────────────────────────────────────────────────
// STRAHLUNGSIMPEDANZ
// ──────────────────────────────────────────────────────────────────

/** Ab hier werden J1 und H1 asymptotisch berechnet (Restfehler < 1e-9). */
const ASYMPTOTIC_X = 30;

/**
 * J1 und Y1 für große x aus der Hankel-Asymptotik (Abramowitz/Stegun 9.2.5–9.2.10, μ = 4):
 * J1 = √(2/πx)·(P cos χ − Q sin χ), Y1 = √(2/πx)·(P sin χ + Q cos χ), χ = x − 3π/4.
 */
function hankelAsymptotic(x) {
  const m = 4, y = 8 * x;
  const P = 1 - (m - 1) * (m - 9) / (2 * y ** 2) + (m - 1) * (m - 9) * (m - 25) * (m - 49) / (24 * y ** 4);
  const Q = (m - 1) / y - (m - 1) * (m - 9) * (m - 25) / (6 * y ** 3)
    + (m - 1) * (m - 9) * (m - 25) * (m - 49) * (m - 81) / (120 * y ** 5);
  const chi = x - 3 * Math.PI / 4, a = Math.sqrt(2 / (Math.PI * x));
  return {
    j1: a * (P * Math.cos(chi) - Q * Math.sin(chi)),
    y1: a * (P * Math.sin(chi) + Q * Math.cos(chi)),
  };
}

/**
 * Besselfunktion J1(x), x ≥ 0: J1(x) = (1/π)∫₀^π cos(θ − x·sin θ) dθ. Der Integrand ist
 * gerade und 2π-periodisch, die Trapezregel konvergiert deshalb exponentiell – mit
 * x + 40 Stützstellen auf Maschinengenauigkeit.
 */
export function besselJ1(x) {
  if (x >= ASYMPTOTIC_X) return hankelAsymptotic(x).j1;
  const n =Math.ceil(Math.abs(x)) + 40, h = Math.PI / n;
  let sum = (Math.cos(0) + Math.cos(Math.PI)) / 2;   // Endpunkte: cos(0 − 0) und cos(π − 0)
  for (let i = 1; i < n; i++) sum += Math.cos(i * h - x * Math.sin(i * h));
  return sum * h / Math.PI;
}

/**
 * Struve-Funktion H1(x), x ≥ 0. Kleine x: Potenzreihe
 * H1(x) = Σ (−1)^m (x/2)^{2m+2} / (Γ(m+3/2)·Γ(m+5/2)); mittlere x: Integraldarstellung
 * H1(x) = (2x/π)∫₀^{π/2} sin(x·cos θ)·sin²θ dθ, Simpson mit Schrittweite ≪ 1/x; große x:
 * H1 = Y1 + (2/π)·(1 + 1/x² − 3/x⁴ + 45/x⁶ − 1575/x⁸) (Abramowitz/Stegun 12.1.31).
 */
export function struveH1(x) {
  if (x >= ASYMPTOTIC_X) {
    const u = 1 / (x * x);
    return hankelAsymptotic(x).y1 + 2 / Math.PI * (1 + u * (1 + u * (-3 + u * (45 - 1575 * u))));
  }
  if (x < 16) {
    // Γ(3/2) = √π/2, Γ(5/2) = 3√π/4; Folgeglieder rekursiv
    let term = (x / 2) ** 2 / (Math.sqrt(Math.PI) / 2 * (3 * Math.sqrt(Math.PI) / 4));
    let sum = term;
    for (let m = 0; m < 200; m++) {
      term *= -((x / 2) ** 2) / ((m + 1.5) * (m + 2.5));
      sum += term;
      if (Math.abs(term) < 1e-17 * Math.max(1, Math.abs(sum))) break;
    }
    return sum;
  }
  const n = 2 * Math.ceil(16 * x + 40), h = Math.PI / 2 / n;   // gerade Zahl Intervalle
  const f = t => Math.sin(x * Math.cos(t)) * Math.sin(t) ** 2;
  let sum = f(0) + f(Math.PI / 2);
  for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * f(i * h);
  return 2 * x / Math.PI * (h / 3) * sum;
}

/** Raumwinkel der Abstrahlung [sr]. */
export const SOLID_ANGLE = { "4pi": 4 * Math.PI, "2pi": 2 * Math.PI, "pi": Math.PI, "pi/2": Math.PI / 2 };

/**
 * Strahlungsimpedanz [Pa·s/m³] eines Kolbens der Fläche S (Radius a = √(S/π)) bei Wellenzahl k.
 * 2π: Kolben in unendlicher Schallwand, exakt: Z = ρc/S·(1 − J1(2ka)/ka + j·H1(2ka)/ka).
 * Andere Raumwinkel Ω als Näherung: dieselbe Formel mit a' = a·√(2π/Ω). Das trifft die
 * Tiefton-Strahlungsresistanz ρck²/Ω exakt (Spiegelquellen: π doppelt, π/2 vierfach) und gibt
 * für 4π eine Mündungskorrektur von 0,60·a (Levine–Schwinger, ungeflanschtes Rohr: 0,61·a).
 */
export function radiationImpedance(S, k, rhoC, mouth = "2pi") {
  const a = Math.sqrt(S / Math.PI) * Math.sqrt(2 * Math.PI / SOLID_ANGLE[mouth]);
  const ka = k * a;
  const z = ka < 1e-6
    ? cx(ka * ka / 2, 8 * ka / (3 * Math.PI))   // Grenzwert für ka → 0 (vermeidet 0/0)
    : cx(1 - besselJ1(2 * ka) / ka, struveH1(2 * ka) / ka);
  return cx(z.re * rhoC / S, z.im * rhoC / S);
}

// ──────────────────────────────────────────────────────────────────
// TREIBER
// ──────────────────────────────────────────────────────────────────

/**
 * Platzhalter-Treiber (generischer 2"-Kompressionstreiber, KEINE echten Daten) in
 * Anzeige-Einheiten: Re Ω, Le mH, Bl T·m, Masse g, Cms µm/N, Rms N·s/m, Sd cm², Vtc cm³,
 * Atc cm², Vrc cm³ (0 = keine Rückkammer). massIs: "Mmd" (ohne Luftlast) oder "Mms".
 */
export const PLACEHOLDER_DRIVER = {
  Re: 5.8, Le: 0.06, Bl: 15, mass: 2.5, massIs: "Mmd", Cms: 30, Rms: 1.5, Sd: 45,
  Vtc: 2.5, Atc: 45, Vrc: 0,
};

/**
 * Mmd aus Mms [kg]: Mms enthält die Luftlast beider Seiten eines Kolbens in unendlicher
 * Schallwand, je Seite 8ρa³/3 mit a = √(Sd/π) (Annahme – gilt für Messungen nach Thiele-Small
 * an der Schallwand, nicht für jeden Kompressionstreiber).
 */
export const mmdFromMms = (Mms, Sd, rho) => Mms - 2 * (8 / 3) * rho * Math.sqrt(Sd / Math.PI) ** 3;

/** Treiber aus Anzeige-Einheiten (PLACEHOLDER_DRIVER) in SI. */
export function driverSI(d, rho) {
  const Sd = d.Sd * 1e-4, mass = d.mass * 1e-3;
  return {
    Re: d.Re, Le: d.Le * 1e-3, Bl: d.Bl, Cms: d.Cms * 1e-6, Rms: d.Rms, Sd,
    Mmd: d.massIs === "Mms" ? mmdFromMms(mass, Sd, rho) : mass,
    Vtc: d.Vtc * 1e-6, Atc: d.Atc * 1e-4, Vrc: d.Vrc * 1e-6,
  };
}

/**
 * Treiber an einer akustischen Last. zThroat: Impedanz am Hornhals, uRatio = U_Mund / U_Hals.
 * Kette: Membran (Sd) → Kompressionskammer → Hals. Die Kammer ist mit Atc ein kurzes Rohr
 * (Fläche Atc, Länge Vtc/Atc; im Tiefton genau die Nachgiebigkeit Vtc/ρc² parallel, dazu die
 * Masse der Luftschicht), ohne Atc die reine Nachgiebigkeit parallel.
 * @returns {{ zel, uMouth }}  elektrische Eingangsimpedanz [Ω] und U_Mund [m³/s] bei Spannung e
 */
export function driverResponse(dr, air, f, zThroat, uRatio, e) {
  const w = 2 * Math.PI * f, k = w / air.c, rhoC = air.rho * air.c;
  const comp = V => air.rho * air.c ** 2 / V;   // Steifigkeit eines Volumens: Z = comp/(jω)

  // Kammer: [p_Membran; U_Membran] = T·[p_Hals; U_Hals]
  let T = { A11: 1, B: 0, C: 0, A22: 1 };
  if (dr.Vtc > 0) {
    T = dr.Atc > 0
      ? coneMatrix(dr.Atc, dr.Atc, dr.Vtc / dr.Atc, k, rhoC)
      : { A11: 1, B: 0, C: w * dr.Vtc / (air.rho * air.c ** 2), A22: 1 };
  }
  // U_Hals/U_Membran = 1/(jC·Z + A22), Z_Membran = (A11·Z + jB)/(jC·Z + A22)
  const den = add(mul(cx(0, T.C), zThroat), cx(T.A22));
  const zFront = div(add(mul(cx(T.A11), zThroat), cx(0, T.B)), den);
  const zRear = dr.Vrc > 0 ? cx(0, -comp(dr.Vrc) / w) : cx(0);

  const zMech = add(
    cx(dr.Rms, w * dr.Mmd - 1 / (w * dr.Cms)),
    mul(cx(dr.Sd * dr.Sd), add(zFront, zRear)),
  );
  const zE = cx(dr.Re, w * dr.Le);
  const zel = add(zE, div(cx(dr.Bl * dr.Bl), zMech));
  const v = div(cx(dr.Bl * e), add(mul(zE, zMech), cx(dr.Bl * dr.Bl)));   // Membranschnelle
  const uMouth = mul(mul(cx(dr.Sd), v), mul(inv(den), uRatio));
  return { zel, uMouth };
}

// ──────────────────────────────────────────────────────────────────
// SIMULATION
// ──────────────────────────────────────────────────────────────────

/**
 * Frequenzgang des Horns mit Treiber.
 * @param curve    { x: m[], S: m²[] } – x aufsteigend, Hals bei x[0]
 * @param air      { c, rho } (airAt)
 * @param driver   Treiber in SI (driverSI)
 * @param mouth    "2pi" | "4pi" | "pi" | "pi/2"
 * @param freqs    Frequenzen [Hz]
 * @param adaptive je Frequenz die gröbste Stufe (curveLevels) mit Abschnitten ≤ λ/20 und
 *                 ≤ MAX_SEGMENT statt immer der vollen Kurve
 * @returns {{ f, spl, phase, zel, zThroat }}
 *   spl [dB] in distance (Standard 1 m) bei voltage (Standard 2,83 V eff), aus der Leistung
 *   (siehe oben), phase [°] des Drucks (Monopol, ohne Laufzeit über distance), zel [Ω] komplex, zThroat komplex normiert auf ρc/S_Hals
 */
export function simulate({ curve, air, driver, mouth = "2pi", freqs, voltage = 2.83, distance = 1, adaptive = true }) {
  const rhoC = air.rho * air.c, omega = SOLID_ANGLE[mouth];
  const S0 = curve.S[0], Sm = curve.S.at(-1);
  const levels = adaptive ? curveLevels(curve, sampleStep(Math.max(...freqs), air.c)) : [{ h: 0, curve }];
  const out = { f: freqs, spl: [], phase: [], zel: [], zThroat: [] };
  for (const f of freqs) {
    const w = 2 * Math.PI * f, k = w / air.c, hMax = sampleStep(f, air.c);
    let level = levels[0];
    for (const l of levels) if (l.h <= hMax) level = l;
    const zr = radiationImpedance(Sm, k, rhoC, mouth);
    const { p, U } = propagate(level.curve, k, rhoC, zr);
    const zThroat = div(p, U);
    const { zel, uMouth } = driverResponse(driver, air, f, zThroat, inv(U), voltage);
    // abgestrahlte Leistung Re(Z_r)·|U|², gleichmäßig auf Ω verteilt: |p| = √(W·ρc/Ω)/r,
    // Phase wie beim Monopol (j·U)
    const pr = mul(cx(0, Math.sqrt(zr.re * rhoC / omega) / distance), uMouth);
    out.spl.push(20 * Math.log10(abs(pr) / 20e-6));
    out.phase.push(arg(pr) * 180 / Math.PI);
    out.zel.push(zel);
    out.zThroat.push(cx(zThroat.re * S0 / rhoC, zThroat.im * S0 / rhoC));
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// ADAPTER: GEOMETRIE → S(x)
// ──────────────────────────────────────────────────────────────────

/**
 * Flächenkurve des Horns in SI aus der Geometrie (crossSection, mm/mm²).
 * x = Lage der Wellenfront auf der Achse ab der Treiberfront (z), S = Wellenfrontfläche.
 * Am Hals (x = 0) steht die ebene Halsfläche 2·rt × 2·h(0); von dort geht es konisch zur
 * ersten Wellenfront (Modellannahme, siehe CLAUDE.md – Hals und erste Wellenfront passen
 * geometrisch nicht genau zusammen). Ab der ersten Wellenfront so fein abgetastet, dass kein
 * Abstand größer als stepMm ist; der Übergang Hals → erste Wellenfront ist ein einzelner
 * Konusabschnitt (dazwischen liefert die Geometrie keine Wellenfront, der Konus ist exakt).
 * Gleichmäßig an der Wand abgetastet lägen die Wellenfronten auf der Achse sehr ungleich
 * dicht (bei langer Traktrix um ein Vielfaches). Deshalb: grobe Probe, dann die Wandpunkte so
 * verteilen, dass die Wellenfronten auf der Achse etwa gleichmäßig liegen; Lücken, die danach
 * noch zu groß sind, werden halbiert.
 * @param stepMm  größte Abtastweite [mm]
 */
export function areaCurve(s, rt, profile, stepMm = GEOMETRY_STEP_MM) {
  const probe = crossSection(s, profile, 64).slice(1);   // ohne die bis z = 0 verlängerte Kopie
  let walls = [probe[0].zWall];
  for (let i = 1; i < probe.length; i++) {
    const a = probe[i - 1], b = probe[i];
    const m = Math.ceil((b.z - a.z) / (0.9 * stepMm));
    for (let j = 1; j <= m; j++) walls.push(a.zWall + (b.zWall - a.zWall) * j / m);
  }
  let pts;
  for (let pass = 0; pass < 6; pass++) {
    pts = crossSection(s, profile, 0, walls).slice(1);
    const refined = [pts[0].zWall];
    let tooWide = false;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].z - pts[i - 1].z > stepMm) { refined.push((pts[i - 1].zWall + pts[i].zWall) / 2); tooWide = true; }
      refined.push(pts[i].zWall);
    }
    if (!tooWide) break;
    walls = refined;
  }
  const x = [0], S = [2 * rt * 2 * profile(0) * 1e-6];
  for (const { z, A } of pts) {
    if (z - x.at(-1) * 1e3 <= 1e-9) continue;   // doppelte Stützstellen (Sektionsgrenzen)
    x.push(z * 1e-3);
    S.push(A * 1e-6);
  }
  return { x, S };
}

/**
 * Flächenkurve einer Funktion S(x) [m²] über die Länge L [m], gleichmäßig mit Abstand ≤ step.
 * Für Referenzhörner (Tests, Hornresp-Vergleich).
 */
export function sampleArea(areaAt, L, step) {
  const n = Math.max(1, Math.ceil(L / step));
  const x = Array.from({ length: n + 1 }, (_, i) => L * i / n);
  return { x, S: x.map(areaAt) };
}
