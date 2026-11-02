/**
 * 3D-Körper des runden Horns (Rotationskörper) als Flächengitter: Luftvolumen und Schale.
 *
 * Das Draufsicht-Profil (Traktrix-Eingang, Klothoide, gerade Wand) wird um die Hornachse gedreht. Koordinaten wie
 * horn-mesh.js: [X, Y, Z] = [x, h, z] in mm, Z = Hornachse, Throat in der Ebene z = 0. Jede Wandfläche ist in
 * vier Viertel um die Achse geteilt (je ein Gitter Zeilen entlang der Kontur × Spalten um die Achse): so enthält
 * keine Fläche ihre eigene Naht, was das STEP-B-Rep einfach hält. Nachbarflächen teilen sich die Randpunkte exakt.
 *
 * Luftvolumen: Wandflächen (Traktrix, Klothoide, gerade Wand) + Mundkappe (Kugelkappe um den Fokus, Pol auf der
 * Achse) + Throat-Scheibe. Schale: Außenkörper (Kontur im Abstand t, wie der Außenkörper des Radialhorns in der
 * Draufsicht) + Innenseite (Luftvolumen, umgedreht, ohne Kappen) + Stirnring am Mund (senkrecht zur Wand) + Throat
 * bündig oder mit Flansch (flangeSurfaces aus horn-mesh.js, samt Rippen aus flange-ribs.js).
 */
import { hasTraktrix } from "./horn-math.js";
import {
  innerWall, contourRight, zipper, ring, resOf, TRAK_MIN_STEP, DEFAULT_RES, resolveFlange, flangeSurfaces, flangeRounds,
} from "./horn-mesh.js";
import { flangeRibs } from "./flange-ribs.js";

/** Winkel der Spalten um die Achse: steps Schritte je Viertel (q = 0 … 3), von 0 bis 2π. */
const quadrantAngles = (q, steps) => Array.from({ length: steps + 1 }, (_, j) => Math.PI / 2 * (q * steps + j) / steps);
const around = (x, z, angles) => angles.map(a => [x * Math.cos(a), x * Math.sin(a), z]);

/** Außenrichtung weg von der Achse (Wandflächen). */
const radialOut = ([x, h]) => { const r = Math.hypot(x, h) || 1; return [x / r, h / r, 0]; };
const flip = f => p => f(p).map(v => -v);

/**
 * Flächen einer Kontur (Punkte [x, z] von innen nach außen entlang der Wand) als vier Viertel.
 * @param name     Namensstamm
 * @param section  "traktrix" | "klothoide" | "linear" | …
 */
function revolved(meridian, steps, name, section, outward) {
  return [0, 1, 2, 3].map(q => {
    const angles = quadrantAngles(q, steps);
    return { name: `${name}Q${q}`, section, grid: meridian.map(([x, z]) => around(x, z, angles)), outward };
  });
}

/** Zeilen [i1, i2] einer Kontur (beide eingeschlossen) als eigener Abschnitt. */
const part = (points, from, to) => points.slice(from, to + 1);

/**
 * Flächen eines Wandzugs in Abschnitten: Traktrix, Klothoide, gerade Wand.
 * @param points     Kontur [x, z] vom Throat bis zum Mund
 * @param lineStart  Index des ersten Punkts der geraden Wand
 * @param kloStart   Index, an dem die Klothoide beginnt (null ohne Klothoide)
 */
function wallSurfaces(points, lineStart, kloStart, steps, prefix, outward) {
  const out = [];
  const last = points.length - 1;
  const trakEnd = kloStart ?? lineStart;
  if (trakEnd > 0) out.push(...revolved(part(points, 0, trakEnd), steps, `${prefix}trakWall`, "traktrix", outward));
  if (kloStart !== null && lineStart > kloStart) out.push(...revolved(part(points, kloStart, lineStart), steps, `${prefix}kloWall`, "klothoide", outward));
  if (last > lineStart) out.push(...revolved(part(points, lineStart, last), steps, `${prefix}linWall`, "linear", outward));
  return out;
}

/** Wandkontur (innen) samt Abschnittsgrenzen für das Luftvolumen. */
function airMeridian(s, rt, res) {
  const { axial } = resOf(res);
  const w = innerWall(s, rt, axial, TRAK_MIN_STEP);
  return { points: w.points, lineStart: hasTraktrix(s) ? w.lineStart : 0, kloStart: w.kloStart };
}

/** Fächer von der Mitte (auf der Achse) zu einem Ring, nach außen (Richtung) orientiert. */
const disc = (centre, ringPoints) => ringPoints.map((p, i) => [centre, p, ringPoints[(i + 1) % ringPoints.length]]);

/**
 * Luftvolumen des runden Horns als geschlossener Körper (Wand, Mundkappe, Throat-Scheibe).
 * @returns {{ surfaces: object[], throatLoop: number[][] }}  throatLoop: geschlossener Randzug am Throat [x, h, z]
 */
export function buildRoundHornGeometry(s, rt, res = DEFAULT_RES) {
  const { round: steps, radial } = resOf(res);
  const { points, lineStart, kloStart } = airMeridian(s, rt, res);
  const mouth = points[points.length - 1];

  // Mundkappe: Kugel um den Fokus von der Wand (φ = α) bis zum Scheitel auf der Achse (Pol)
  const rings = Math.max(8, radial >> 1);
  const cap = Array.from({ length: rings + 1 }, (_, k) => {
    const phi = s.alpha2 * (1 - k / rings);
    return k === 0 ? mouth : [s.arcR * Math.sin(phi), s.zFocus + s.arcR * Math.cos(phi)];
  });
  const capOut = ([x, h, z]) => [x, h, z - s.zFocus];

  const throatRing = ring(0, 0, rt, 0, 4 * steps);
  return {
    surfaces: [
      ...wallSurfaces(points, lineStart, kloStart, steps, "", radialOut),
      ...revolved(cap, steps, "capMouth", "cap", capOut),
      { name: "capThroat", section: "cap", triangles: disc([0, 0, 0], throatRing), outward: () => [0, 0, -1] },
    ],
    throatLoop: [...throatRing, throatRing[0]],
  };
}

/**
 * Außenkörper der Schale ab z = zStart (Flansch davor): Kontur im Abstand t (contourRight), dann die Parallele der
 * geraden Wand bis zur Mundkante E = Mundpunkt + t·Wandnormale.
 * @returns {{ surfaces: object[], throatLoop: number[][], mouthEdge: number[], start: number[] }}
 */
function roundOuterBody(s, rt, t, res, zStart) {
  const { round: steps, axial } = resOf(res);
  const { pts, kloStart } = contourRight(s, rt, t, axial, zStart);
  const E = [s.xMouth + t * Math.cos(s.alpha2), s.zMouth - t * Math.sin(s.alpha2)];
  const points = [...pts, E];
  // Abschnitte: Klothoide ab kloStart, die Gerade beginnt am letzten Punkt der Kontur; ohne Klothoide ist alles
  // Traktrix bis zur Geraden (oder nur die Gerade, wenn es keine Traktrix gibt oder sie schon vorbei ist)
  const lineStart = Math.max(0, pts.length - 1);
  const surfaces = wallSurfaces(points, lineStart, kloStart, steps, "outer.", radialOut);
  const first = points[0];
  const throatRing = ring(0, 0, first[0], first[1], 4 * steps);
  return { surfaces, throatLoop: [...throatRing, throatRing[0]], mouthEdge: E, start: first };
}

/**
 * Flansch gegen den Außenkörper des runden Horns auflösen (wie flangeLayout; der Randzug ist ein Kreis).
 */
export function roundFlangeLayout(s, rt, t, flange, res = DEFAULT_RES) {
  const outer = roundOuterBody(s, rt, t, res, flange.thickness);
  return resolveFlange(outer.throatLoop.slice(0, -1), flange, res);
}

/**
 * Schale des runden Horns mit Wandstärke t (senkrecht zur Wand), optional mit Flansch und Stützrippen.
 * @param flange  Flansch (roundFlangeLayout) oder dessen Vorgaben (wird dann aufgelöst) oder null
 * @returns {{ surfaces: object[], ribs: object | null }}  wie buildShellGeometry
 */
export function buildRoundShellGeometry(s, rt, t, flange = null, res = DEFAULT_RES) {
  const { round: steps, flange: nRim } = resOf(res);
  const layout = flange && (flange.centers ? flange : roundFlangeLayout(s, rt, t, flange, res));
  const air = buildRoundHornGeometry(s, rt, res);
  const { points, lineStart, kloStart } = airMeridian(s, rt, res);
  const outer = roundOuterBody(s, rt, t, res, layout ? layout.thickness : 0);

  const inner = wallSurfaces(points, lineStart, kloStart, steps, "inner.", flip(radialOut));
  const outerWall = outer.surfaces;

  // Stirnring am Mund: senkrecht zur Wand von der Innenkante M zur Außenkante E (Kegelfläche), Normale längs der Wand
  const M = points[points.length - 1], sa = Math.sin(s.alpha2), ca = Math.cos(s.alpha2);
  const rimOut = ([x, h]) => { const r = Math.hypot(x, h) || 1; return [sa * x / r, sa * h / r, ca]; };
  const rimMouth = revolved([M, outer.mouthEdge], steps, "rimMouth", "rim", rimOut);

  // Throat: bündig (ebener Ring von der Wand zur Außenkante) oder Flansch
  const throat = layout
    ? flangeSurfaces(layout, air.throatLoop, outer.throatLoop, res)
    : [{ name: "rimThroat", section: "rim", triangles: zipper(air.throatLoop, outer.throatLoop), outward: () => [0, 0, -1] }];

  // Stützrippen: eigene geschlossene Körper, im Außenkörper verankert (wie beim Radialhorn)
  const ribs = layout?.ribs ? flangeRibs(outerWall, layout, nRim, t, flangeRounds(layout, nRim).rim) : null;

  return {
    surfaces: [...outerWall, ...inner, ...throat, ...(ribs?.surfaces ?? []), ...rimMouth],
    ribs: ribs && { count: ribs.count, length: ribs.length, overlap: ribs.overlap, shapes: ribs.shapes, thickness: layout.ribs.thickness },
  };
}
