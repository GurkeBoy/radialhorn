// Wandstärke-Empfehlung: wie dick muss die Schale mindestens sein, damit die Wand unter dem Schalldruck
// kaum nachgibt? Rein funktional, keine Geometrie in Komponenten (siehe CLAUDE.md, „Wandstärke-Empfehlung“).
//
// Modell (Faustregel, keine Messung):
//  • Maßgebend ist der druckreiche Bereich am Hals. Im Horn fällt der Schalldruck einer fortschreitenden
//    Welle wie 1/√S; der Bereich reicht bis S = ZONE_AREA_RATIO · S_Hals (Druck −6 dB gegenüber dem Hals).
//  • An jeder Stelle z bilden Deckel/Boden (Spannweite B = A/H, die Wellenfront-Breite) und die beiden
//    Seitenwände (Spannweite H = Höhe des Querschnitts) einen Kasten aus vier gleich dicken ebenen Streifen
//    mit starren Ecken (gedruckt oder verleimt). Konservativ: Krümmung der Wände, Rippen und die Zugsteifigkeit
//    in der Ebene der Wände bleiben unberücksichtigt.
//  • Unter dem Innendruck p verteilen sich die Ecken-Momente nach den Drehwinkeln der Wände (Momentenverteilung,
//    exakt): M = p·(B³ + H³)/(12·(B + H)). Für B = H ist das die volle Einspannung (p·L²/12), für B ≫ H
//    sitzt die lange Wand praktisch eingespannt. Die Ausbiegung eines Streifens als Fläche je Meter Länge:
//    p·L⁵/(120·D) − M·L³/(12·D), D = E·t³/(12·(1 − ν²)); zusammen über alle vier Wände
//    ΔA = 2·g·p/D mit g = (B⁵ + H⁵)/120 − (B³ + H³)²/(144·(B + H)).
//  • Die Luft hat die Steifigkeit K = ρ·c² (≈ 1,4·10⁵ Pa). Gibt die Wand nach, sinkt die Wellengeschwindigkeit
//    um den Faktor 1/√(1 + ν_w) mit der Nachgiebigkeit ν_w = K·ΔA/A. Zulässig ist ν_w ≤ nuMax (Standard 5 %,
//    also ≈ 2,5 % langsamere Welle).
//  • Weil D mit t³ wächst: t_min = ∛( 24·K·g·(1 − ν²) / (E·A·nuMax) ), das Maximum über den Bereich.
//  • Zusätzlich die tiefste Biegemode des breitesten Streifens (nur Information, eingespannt-eingespannt):
//    f₁ = 3,561/L²·√(D/(ρ·t)). Eigenfrequenzen im Betriebsbereich lassen sich nicht vermeiden; sie zeigen, wo
//    die Wand mitschwingt.
import { crossSection, crossSectionRound } from "./horn-math.js";

/** Richtwerte der Werkstoffe (E-Modul [Pa], Dichte [kg/m³], Querkontraktion): gedruckt bei 100 % Füllung, Schichten längs. */
export const MATERIALS = {
  pla:     { E: 2.8e9, rho: 1250, nu: 0.36 },
  petg:    { E: 2.1e9, rho: 1270, nu: 0.38 },
  abs:     { E: 2.0e9, rho: 1050, nu: 0.35 },
  resin:   { E: 2.5e9, rho: 1150, nu: 0.38 },
  plywood: { E: 7.0e9, rho: 680,  nu: 0.30 },
  mdf:     { E: 3.0e9, rho: 750,  nu: 0.25 },
  alu:     { E: 69e9,  rho: 2700, nu: 0.33 },
};
export const CUSTOM = "custom";
export const MATERIAL_KEYS = [...Object.keys(MATERIALS), CUSTOM];
export const NU_CUSTOM = 0.35;               // Querkontraktion bei eigenen Werkstoffwerten
export const ZONE_AREA_RATIO = 4;            // druckreicher Bereich: S ≤ 4·S_Hals (−6 dB)
export const NU_MAX_DEFAULT = 5;             // zulässige Nachgiebigkeit [%]
export const ROUND_TO = 0.5;                 // Empfehlung wird auf diese Schrittweite aufgerundet [mm]

/** Werkstoffwerte: Vorgabe oder eigene Werte (E in GPa, Dichte in kg/m³) → { E [Pa], rho, nu }. */
export function materialOf(key, customE = 3, customRho = 1250) {
  if (key === CUSTOM) return { E: customE * 1e9, rho: customRho, nu: NU_CUSTOM };
  return MATERIALS[key] ?? MATERIALS.pla;
}

/** Biegesteifigkeit der Platte D [N·m] für E [Pa], ν und Dicke t [m]. */
export const plateStiffness = (E, nu, t) => E * t ** 3 / (12 * (1 - nu ** 2));

/**
 * g [m⁵] des Kastens mit starren Ecken: ΔA = 2·g·p/D für die Querschnittsänderung je Meter Länge (siehe oben).
 * B = H = L: g = L⁵/360 (alle Wände voll eingespannt); B ≫ H: g → B⁵/720.
 */
export const frameCompliance = (B, H) => (B ** 5 + H ** 5) / 120 - (B ** 3 + H ** 3) ** 2 / (144 * (B + H));

/**
 * Stützstellen entlang der Achse: Lage z, Fläche A (Wellenfront), Höhe H = 2·h(z) und Breite B = A/H [mm].
 * @param profile  z ↦ halbe Höhe (makeProfile)
 */
export function wallStations(s, profile, morph = null, n = 120) {
  return crossSection(s, profile, n, null, morph).map(({ z, A }) => {
    const H = 2 * profile(z);
    return { z, A, H, B: A / H };
  });
}

/** Stützstellen im druckreichen Bereich (A ≤ ratio·A_Hals), mindestens die ersten beiden. */
export function pressureZone(stations, ratio = ZONE_AREA_RATIO) {
  const limit = ratio * stations[0].A;
  const zone = stations.filter(st => st.A <= limit);
  return zone.length >= 2 ? zone : stations.slice(0, 2);
}

/** Nachgiebigkeit ν_w einer Stützstelle bei der Wandstärke t [mm]: relative Querschnittsänderung · K / Druck. */
export function stationCompliance(st, mat, tMM, K) {
  const D = plateStiffness(mat.E, mat.nu, tMM / 1000), A = st.A / 1e6;
  return K * 2 * frameCompliance(st.B / 1000, st.H / 1000) / (D * A);
}

/** Kleinste Wandstärke [mm], bei der die Nachgiebigkeit der Stützstelle höchstens nuMax (Anteil, z. B. 0,05) beträgt. */
export function stationMinThickness(st, mat, nuMax, K) {
  const A = st.A / 1e6;
  return 1000 * Math.cbrt(24 * K * frameCompliance(st.B / 1000, st.H / 1000) * (1 - mat.nu ** 2) / (mat.E * A * nuMax));
}

/** Tiefste Biegemode [Hz] eines beidseitig eingespannten Streifens der Breite spanMM [mm] und Dicke tMM [mm]. */
export function lowestMode(spanMM, mat, tMM) {
  const t = tMM / 1000, L = spanMM / 1000, D = plateStiffness(mat.E, mat.nu, t);
  return 22.373 / (2 * Math.PI * L ** 2) * Math.sqrt(D / (mat.rho * t));
}

// ── Rundes Horn (Rotationskörper) ────────────────────────────────────────────────────────────────────────
// Dünnwandige Rotationsschale unter Innendruck (Membrantheorie, Ring um die Achse): Ringkraft N = p·x/cos θ (x Radius
// der Wand, θ ihr Winkel zur Achse), die Wand weitet sich radial um u = x·N/(E·t), die Querschnittsfläche um ΔA/A =
// 2·u/x. Nachgiebigkeit ν_w = K·ΔA/(A·p) = 2·K·x/(E·t·cos θ), also t_min = 2·K·x/(E·ν_max·cos θ). Eine runde Schale ist
// um Größenordnungen steifer als ein Kasten; die Empfehlung liegt meist unter der Mindestwandstärke für Druck und
// Handhabung. Information: tiefste Atmungsmode des Rings f = √(E/(ρ(1 − ν²)))/(2π·x). Bei steiler Wand (cos θ klein) wird
// die Schale zur Platte – cos θ wird deshalb auf ROUND_COS_MIN begrenzt.
const ROUND_COS_MIN = 0.1;

/** Stützstellen des runden Horns: Lage z, Fläche A, Wandradius x und Wandwinkel θ. */
export function wallStationsRound(s, n = 120) {
  return crossSectionRound(s, n).map(({ z, A, xWall, theta }) => ({ z, A, x: xWall, theta, B: 2 * xWall, H: 2 * xWall }));
}

const roundFactor = st => 2 * (st.x / 1000) / Math.max(ROUND_COS_MIN, Math.cos(st.theta));

/** Nachgiebigkeit ν_w des runden Horns an einer Stützstelle bei der Wandstärke t [mm]. */
export const stationComplianceRound = (st, mat, tMM, K) => K * roundFactor(st) / (mat.E * tMM / 1000);

/** Kleinste Wandstärke [mm] des runden Horns an einer Stützstelle für die Nachgiebigkeit nuMax (Anteil). */
export const stationMinThicknessRound = (st, mat, nuMax, K) => 1000 * K * roundFactor(st) / (mat.E * nuMax);

/** Tiefste Atmungsmode [Hz] eines Rings vom Radius xMM [mm]. */
export const ringMode = (xMM, mat) => Math.sqrt(mat.E / (mat.rho * (1 - mat.nu ** 2))) / (2 * Math.PI * xMM / 1000);

/**
 * Wandstärke-Empfehlung.
 * @param opts.s, opts.profile, opts.morph  Lösung, Profil (makeProfile), Übergang rund → eckig oder null
 * @param opts.material  { E [Pa], rho, nu } (materialOf)
 * @param opts.K         Steifigkeit der Luft ρ·c² [Pa] (airAt)
 * @param opts.tMM       aktuelle Wandstärke [mm] oder null (Wandstärke aus)
 * @param opts.nuMax     zulässige Nachgiebigkeit [%]
 * @returns {{ tMin, tRecommended, worst: { z, B, H }, zoneEnd, compliance, ratio, status, fMode } | null}
 *   tMin: genaue Mindestwandstärke, tRecommended: aufgerundet auf ROUND_TO; worst: maßgebende Stelle; zoneEnd:
 *   Ende des druckreichen Bereichs [mm]; compliance: ν_w bei tMM (Anteil); ratio: compliance/nuMax;
 *   status: "ok" (ratio ≤ 1) | "tight" (≤ 2, t ≥ 79 % der Empfehlung) | "thin"; fMode: tiefste Wandmode
 *   des breitesten Streifens bei tMM (bzw. der Empfehlung ohne Wand) [Hz]
 */
export function wallAdvice({ s, profile, morph = null, material, K, tMM = null, nuMax = NU_MAX_DEFAULT }) {
  if (!s || (!profile && !s.round)) return null;
  if (s.round) return wallAdviceRound({ s, material, K, tMM, nuMax });
  const stations = wallStations(s, profile, morph);
  const zone = pressureZone(stations);
  const limit = nuMax / 100;
  let worst = zone[0], tMin = 0;
  for (const st of zone) {
    const t = stationMinThickness(st, material, limit, K);
    if (t > tMin) { tMin = t; worst = st; }
  }
  const tRecommended = Math.max(ROUND_TO, Math.ceil(tMin / ROUND_TO - 1e-9) * ROUND_TO);
  const widest = Math.max(...zone.map(st => Math.max(st.B, st.H)));
  const result = {
    tMin, tRecommended, worst: { z: worst.z, B: worst.B, H: worst.H }, zoneEnd: zone.at(-1).z,
    compliance: null, ratio: null, status: null, fMode: lowestMode(widest, material, tMM ?? tRecommended),
  };
  if (tMM !== null) {
    result.compliance = Math.max(...zone.map(st => stationCompliance(st, material, tMM, K)));
    result.ratio = result.compliance / limit;
    result.status = result.ratio <= 1 ? "ok" : result.ratio <= 2 ? "tight" : "thin";
  }
  return result;
}

/** wallAdvice für das runde Horn: gleiches Ergebnis, mit round = true; B und H sind der Durchmesser an der maßgebenden Stelle. */
function wallAdviceRound({ s, material, K, tMM, nuMax }) {
  const zone = pressureZone(wallStationsRound(s));
  const limit = nuMax / 100;
  let worst = zone[0], tMin = 0;
  for (const st of zone) {
    const t = stationMinThicknessRound(st, material, limit, K);
    if (t > tMin) { tMin = t; worst = st; }
  }
  const tRecommended = Math.max(ROUND_TO, Math.ceil(tMin / ROUND_TO - 1e-9) * ROUND_TO);
  const result = {
    round: true, tMin, tRecommended, worst: { z: worst.z, B: worst.B, H: worst.H }, zoneEnd: zone.at(-1).z,
    compliance: null, ratio: null, status: null, fMode: ringMode(Math.max(...zone.map(st => st.x)), material),
  };
  if (tMM !== null) {
    result.compliance = Math.max(...zone.map(st => stationComplianceRound(st, material, tMM, K)));
    result.ratio = result.compliance / limit;
    result.status = result.ratio <= 1 ? "ok" : result.ratio <= 2 ? "tight" : "thin";
  }
  return result;
}
