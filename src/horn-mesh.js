/**
 * 3D-Körper des Horns als strukturierte Flächengitter: Luftvolumen und Schale.
 *
 * Konstruktion des Luftvolumens
 *   - Traktrix-Sektion: senkrechte Wände entlang der Traktrix, Grundfläche wie in der
 *     Draufsicht (bis zum inneren Teilkreis um den Fokus).
 *   - Gerader Bereich: senkrechte Wände im Öffnungswinkel; Deckel und Boden entstehen durch
 *     Rotation des Seitenprofils um die senkrechte Achse durch den Fokus.
 *   - Eine Regel für den ganzen Körper: halbe Höhe h(x, z) = Profil(zFocus + Abstand zum
 *     Fokus), hinter dem Fokus Profil(z + |x|) (focusRadius). Im Prisma ergibt das rt; mit
 *     Verrundung steigt der Deckel im Ringband vor dem inneren Teilkreis wie im Seitenriss an.
 *
 * Schale (Wandstärke t senkrecht zur Fläche, scharfe Außenkanten, bündige Enden)
 *   - Außenkörper = derselbe Aufbau mit versetzter Kontur (Parallelkurve der Traktrix bzw.
 *     Parallele der geraden Wand im Abstand t, beschnitten bei z = 0) und senkrecht um t
 *     versetztem Profil (offsetHeight).
 *   - Schale = Außenkörper + Luftvolumen mit umgedrehten Flächen + Ringflächen am Throat
 *     (Ebene z = 0) und am Mund (Zylinder r = arcR).
 *
 * Koordinaten der Gitterpunkte: [X, Y, Z] = [x (Breite), h (Höhe), z (Achse)] in mm.
 * Nachbarflächen teilen sich an den Nähten exakt dieselben Randpunkte (wasserdicht).
 */
import { hasTraktrix, hasClothoid, entrancePoints, focusRadius } from "./horn-math.js";
import { ShapeUtils, Vector2 } from "three";
import { linspace } from "./utils.js";

const DEFAULT_RES = { angular: 60, radial: 80, axial: 40 };

/**
 * Halbe Höhe der senkrecht um t versetzten Profilkurve als Funktion des Abstands r zum
 * Fokus: Hout(r) = max über r' von h(r') + √(t² − (r − r')²), die Einhüllende aller Kreise
 * mit Radius t um die Profilpunkte. Knicke und Verrundungen mit Radius < t ergeben so
 * automatisch eine saubere Kante. Hinter dem Mund wird das Profil tangential verlängert,
 * damit die Wand am Mundbogen gerade abgeschnitten wird.
 *
 * @param hAt   r ↦ halbe Höhe innen
 * @param rMax  Mundradius arcR
 */
export function offsetHeight(hAt, rMax, t) {
  const dr = t / 150;   // Abtastung; genau genug für die scharfe Außenkante an Knicken
  const slopeEnd = (hAt(rMax) - hAt(rMax - dr)) / dr;
  const hExt = r => r < 0 ? hAt(0) : r > rMax ? hAt(rMax) + slopeEnd * (r - rMax) : hAt(r);
  const w = Math.round(t / dr);
  const src = Array.from({ length: Math.ceil(rMax / dr) + 2 + 2 * w }, (_, i) => hExt((i - w) * dr));
  const table = Array.from({ length: Math.ceil(rMax / dr) + 2 }, (_, i) => {   // r = i·dr
    let best = -Infinity;
    for (let k = -w; k <= w; k++) {
      const d = k * dr;
      best = Math.max(best, src[i + w + k] + Math.sqrt(Math.max(0, t * t - d * d)));
    }
    return best;
  });
  return r => {
    const x = Math.max(0, r) / dr, i = Math.min(Math.floor(x), table.length - 2), f = x - i;
    return table[i] * (1 - f) + table[i + 1] * f;
  };
}

/**
 * Rechte Innenwand der Draufsicht [x, z] als Polygonzug: Eingang (Traktrix, ggf. Klothoide),
 * dann gerade Wand bis zum Mund. lineStart = Index des Beginns der Geraden, kloStart = Index
 * des Beginns der Klothoide (oder null).
 */
function innerWall(s, rt, n = 400) {
  const entrance = hasTraktrix(s) ? entrancePoints(s, n, Math.max(8, n >> 1)) : [[rt, 0]];
  entrance[0] = [rt, 0];
  return {
    points: [...entrance, [s.xMouth, s.zMouth]],
    lineStart: entrance.length - 1,
    kloStart: hasClothoid(s) ? n : null,
  };
}

/**
 * Rechte Kontur der Draufsicht [x, z] vom Throat (z = 0) bis zum Ende der Traktrix-Sektion,
 * um t nach außen versetzt. Für t > 0 ist das die Einhüllende der Kreise mit Radius t um die
 * Wandpunkte, X(z) = max x_i + √(t² − (z − z_i)²): an stark gekrümmten Stellen der Traktrix
 * (Krümmungsradius < t) schneidet sie die Schlaufe der einfachen Parallelkurve ab. Endet dort,
 * wo die Einhüllende in die Parallele der geraden Wand übergeht – normalerweise im versetzten
 * Übergangspunkt, bei sehr großen Wandstärken weiter vorn. Die Kontur beginnt in der Ebene
 * z0 (0 oder Flanschdicke); liegt dieser Punkt davor, besteht sie nur aus dem Schnittpunkt
 * der Parallelen mit z = z0.
 */
/**
 * Einhüllende der Kreise mit Radius t um die rechte Innenwand (Eingang aus wall, dann gerade
 * Wand): z ↦ X(z) = max x_i + √(t² − (z − z_i)²). Nur Stützpunkte mit |z − z_i| ≤ t tragen bei –
 * Fenster per binärer Suche (mit kleiner Reserve, die exakte Prüfung bleibt). Liegt bei sehr
 * kleinem t kein Stützpunkt im Fenster, gilt der zwischen den Nachbarn interpolierte Wandpunkt.
 */
function wallEnvelope(s, wall, t) {
  // gerade Wand dicht abtasten, damit die Einhüllende dort exakt die Parallele ist
  const line = linspace(0, 1, 2000).map(f => [s.xTrans + f * (s.xMouth - s.xTrans), s.zTrans + f * (s.zMouth - s.zTrans)]);
  const samples = [...wall.slice(0, -1), ...line];   // nach z aufsteigend
  const firstAtLeast = z => {
    let lo = 0, hi = samples.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; samples[mid][1] < z ? (lo = mid + 1) : (hi = mid); }
    return lo;
  };
  return z => {
    let best = -Infinity;
    for (let i = firstAtLeast(z - t - 1e-6); i < samples.length && samples[i][1] <= z + t + 1e-6; i++) {
      const [x, zi] = samples[i], d = z - zi;
      if (Math.abs(d) <= t) best = Math.max(best, x + Math.sqrt(t * t - d * d));
    }
    if (best > -Infinity) return best;
    const k = Math.min(Math.max(firstAtLeast(z), 1), samples.length - 1);
    const [xa, za] = samples[k - 1], [xb, zb] = samples[k];
    return xa + (xb - xa) * (z - za) / (zb - za || 1) + t;
  };
}

function contourRight(s, rt, t, axial, z0 = 0) {
  const wall = innerWall(s, rt, 2000).points;
  if (t === 0) {
    if (!hasTraktrix(s)) return { pts: [[rt, 0]], kloStart: null };
    const w = innerWall(s, rt, axial);
    return { pts: w.points.slice(0, -1), kloStart: w.kloStart };
  }
  // Beginn der Klothoide auf der versetzten Kontur: Wandpunkt + t·Normale (cos θ, −sin θ)
  const c = hasClothoid(s) ? s.clothoid : null;
  const zKlo = c ? c.start[1] - t * Math.sin(c.theta0) : null;
  const withKlo = pts => ({ pts, kloStart: zKlo === null || zKlo <= z0 ? null : Math.max(1, pts.findIndex(p => p[1] >= zKlo)) });
  // versetzter Übergangspunkt: Übergang + t·Normale der Wand (cos α, −sin α)
  const xs = s.xTrans + t * Math.cos(s.alpha2), zs = s.zTrans - t * Math.sin(s.alpha2);
  if (!hasTraktrix(s) || zs <= z0) return { pts: [[xs + (z0 - zs) * Math.tan(s.alpha2), z0]], kloStart: null };

  const envelope = wallEnvelope(s, wall, t);
  // Übergang der Einhüllenden in die Parallele L(z) suchen (ab dem versetzten Übergangspunkt)
  const tan = Math.tan(s.alpha2);
  const L = z => xs + (z - zs) * tan;
  const above = z => envelope(z) - L(z) > 1e-9;
  let zEnd = zs;
  if (above(zs)) {
    let lo = zs, hi = zs + t;
    while (above(hi)) { lo = hi; hi += t; }
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; above(mid) ? (lo = mid) : (hi = mid); }
    zEnd = hi;
  }
  if (zEnd <= z0) return { pts: [[L(z0), z0]], kloStart: null };
  const pts = linspace(z0, zEnd, axial).map(z => [envelope(z), z]);
  pts[axial] = [L(zEnd), zEnd];
  return withKlo(pts);
}

/**
 * Außenhöhe der Schale als Funktion des Grundrisspunkts (x, z): scharfe Außenkanten.
 *   - Über der Grundfläche des Luftvolumens: senkrechte Aufdickung des Deckels um t –
 *     ebener Anteil rt + t, ansteigender Anteil (Verrundung, Aufweitung) als Einhüllende
 *     der Kreise um die Deckelpunkte; im Öffnungssektor rein radial (offsetHeight).
 *   - Außerhalb (über den Seitenwänden): Wert am nächsten Wandpunkt, also der Deckel
 *     senkrecht zur Wand bis zur Außenkante verlängert.
 */
function outerHeightField(s, rt, hAt, t) {
  const radial = offsetHeight(hAt, s.arcR, t);
  const rise = linspace(0, s.arcR, Math.ceil(s.arcR / (t / 50)))
    .map(r => [r, hAt(r)])
    .filter(([, h]) => h > rt + 1e-9);                    // ansteigender Teil des Deckels
  const polarOf = (x, z) => [focusRadius(s, x, z), Math.atan2(Math.abs(x), z - s.zFocus)];

  // Aufdickung über der Grundfläche: im Sektor radial, daneben über den echten Abstand
  const inside = (r, phi) => {
    const delta = phi - s.alpha2;
    if (delta <= 0) return radial(r);
    const c = Math.cos(delta);
    let best = rt + t;
    // rise ist nach r sortiert: nur Stützpunkte mit |r2 − r| ≤ t (Fenster mit Reserve, exakte Prüfung bleibt)
    let lo = 0, hi = rise.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; rise[mid][0] < r - t - 1e-6 ? (lo = mid + 1) : (hi = mid); }
    for (let i = lo; i < rise.length && rise[i][0] <= r + t + 1e-6; i++) {
      const [r2, h2] = rise[i];
      if (Math.abs(r2 - r) > t) continue;
      const d2 = r * r + r2 * r2 - 2 * r * r2 * c;
      if (d2 < t * t) best = Math.max(best, h2 + Math.sqrt(t * t - d2));
    }
    return best;
  };

  const { points: wall, lineStart } = innerWall(s, rt);
  const xWall = z => {                                      // Traktrix-Breite bei z (z ≤ zTrans)
    let i = 1;
    while (i < lineStart && wall[i][1] < z) i++;
    const [a, b] = [wall[i - 1], wall[i]], f = (z - a[1]) / ((b[1] - a[1]) || 1);
    return a[0] + f * (b[0] - a[0]);
  };
  const isInside = (ax, z, phi) =>
    phi <= s.alpha2 + 1e-12 || (hasTraktrix(s) && z >= 0 && z <= s.zTrans && ax <= xWall(z) + 1e-9);

  // Nächster Punkt auf der Innenwand (Segment i = wall[i−1] → wall[i]). Die Wand steigt in z
  // monoton, der Abstand ist mindestens der z-Abstand: Suche ab dem Segment auf Höhe z nach
  // beiden Seiten, bis der z-Abstand den besten Abstand übersteigt. Bei Gleichstand gewinnt
  // wie bei der vollständigen Suche das vordere Segment.
  const nearest = (px, pz) => {
    let bestD = Infinity, bestI = 0, qx = 0, qz = 0;
    const visit = i => {
      const ax = wall[i - 1][0], az = wall[i - 1][1], abx = wall[i][0] - ax, abz = wall[i][1] - az;
      const f = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / (abx ** 2 + abz ** 2)));
      const cx = ax + f * abx, cz = az + f * abz;
      const d = Math.hypot(px - cx, pz - cz);
      if (d < bestD || (d === bestD && i < bestI)) { bestD = d; bestI = i; qx = cx; qz = cz; }
    };
    let lo = 1, hi = wall.length - 1;                 // erstes Segment, dessen Ende ≥ pz liegt
    while (lo < hi) { const mid = (lo + hi) >> 1; wall[mid][1] < pz ? (lo = mid + 1) : (hi = mid); }
    for (let i = lo; i < wall.length && wall[i - 1][1] - pz <= bestD; i++) visit(i);
    for (let i = lo - 1; i >= 1 && pz - wall[i][1] <= bestD; i--) visit(i);
    return { qx, qz, onLine: bestI > lineStart };
  };

  return (x, z) => {
    const ax = Math.abs(x);
    const [r, phi] = polarOf(ax, z);
    if (isInside(ax, z, phi)) return inside(r, phi);
    const { qx, qz, onLine } = nearest(ax, z);
    const [rq, phiq] = polarOf(qx, qz);
    return onLine ? radial(rq) : inside(rq, phiq);
  };
}

const CORNER_COLUMNS = 8;   // Spalten je Eckstreifen über den Seitenwänden (nur Außenkörper)

/**
 * Grundfläche des Eingangs zwischen Throat-Linie B (unten) und Naht-Bogen T (oben), seitlich
 * die zur Achse symmetrischen Konturen L = −R. Zeile i ist die Mischung (1 − u)·B + u·T, in x
 * gestreckt und in z verschoben, sodass ihre Enden genau auf L[i] und R[i] liegen. Anders als
 * eine Coons-Fläche faltet das nicht, wenn der Bogen viel breiter ist als die Kontur in der
 * Mitte (lange Traktrix): B und T steigen in x monoton, also auch jede Zeile. Ränder exakt.
 */
function entranceLoft(B, T, L, R, us) {
  const nV = B.length - 1;
  return us.map((u, i) => {
    if (i === 0) return B;
    if (i === us.length - 1) return T;
    const mix = B.map((b, j) => [(1 - u) * b[0] + u * T[j][0], (1 - u) * b[1] + u * T[j][1]]);
    const sx = R[i][0] / mix[nV][0], dz = R[i][1] - mix[nV][1];
    return mix.map(([x, z], j) => j === 0 ? L[i] : j === nV ? R[i] : [x * sx, z + dz]);
  });
}

/**
 * Coons-Fläche aus vier Randkurven (Punkte [x, z]): unten B(v), oben T(v), links L(u), rechts R(u);
 * us/vs = Parameter der Zeilen/Spalten. Randzeilen und -spalten werden exakt übernommen.
 */
function coons(B, T, L, R, us, vs) {
  const nU = us.length - 1, nV = vs.length - 1;
  const c00 = B[0], c01 = B[nV], c10 = T[0], c11 = T[nV];
  return us.map((u, i) => vs.map((v, j) => {
    if (i === 0) return B[j];
    if (i === nU) return T[j];
    if (j === 0) return L[i];
    if (j === nV) return R[i];
    return [0, 1].map(k =>
      (1 - u) * B[j][k] + u * T[j][k] + (1 - v) * L[i][k] + v * R[i][k]
      - ((1 - u) * (1 - v) * c00[k] + (1 - u) * v * c01[k] + u * (1 - v) * c10[k] + u * v * c11[k]));
  }));
}

/**
 * Ein Körper aus Grundfläche und Höhenfunktion (x, z) ↦ halbe Höhe.
 * t = 0: Luftvolumen, t > 0: Außenkörper der Schale.
 *
 * Grundfläche in Teilen: Traktrix-Grundfläche (Coons, bis zur Naht auf einem Kreis um den
 * Fokus), Öffnungssektor (Polargitter |φ| ≤ α bis zum Mundbogen) und – nur außen – je ein
 * Eckstreifen über den Seitenwänden (zwischen Wand und Außenkante), der wie die Seitenwand
 * senkrecht zur Wand an der Mundkante endet.
 */
function body(s, rt, t, height, fillet, { angular, radial, axial }, zStart = 0) {
  const polar = (r, phi) => [r * Math.sin(phi), s.zFocus + r * Math.cos(phi)];
  const lift = grid => grid.map(row => row.map(([x, z]) => [x, height(x, z), z]));
  const corner = t > 0 ? CORNER_COLUMNS : 0;

  // Naht zwischen Traktrix-Grundfläche und Rest: Kreis um den Fokus durch das Konturende
  const { pts: contour, kloStart } = contourRight(s, rt, t, axial, zStart);
  const end = contour[contour.length - 1];
  const rSeam = t === 0 && hasTraktrix(s) ? s.rInner : Math.hypot(end[0], end[1] - s.zFocus);
  const phiSeam = s.alpha2 + Math.asin(Math.min(1, t / rSeam));
  const centerPhis = linspace(-s.alpha2, s.alpha2, angular);
  const cornerPhis = linspace(s.alpha2, phiSeam, corner);                  // α … φ an der Außenkante
  const arcPhis = [...cornerPhis.map(p => -p).reverse().slice(0, -1), ...centerPhis, ...cornerPhis.slice(1)];
  const arc = arcPhis.map(phi => polar(rSeam, phi));
  const nCols = arc.length - 1;

  // Grundfläche des Eingangs: Throat-Kante, Naht, linke/rechte Kontur; mit Klothoide in
  // zwei Flächen geteilt (gemeinsame Zeile am Beginn der Klothoide)
  const side = contour.length > 1 ? [...contour] : [contour[0], contour[0]];
  side[side.length - 1] = arc[nCols];
  if (!hasTraktrix(s)) side[0] = arc[nCols];
  const x0 = side[0][0];
  const throat = linspace(-x0, x0, nCols).map(x => [x, zStart]);
  const entranceTop = lift(entranceLoft(throat, arc, side.map(([x, z]) => [-x, z]), side, linspace(0, 1, side.length - 1)));
  const split = kloStart !== null && kloStart > 0 && kloStart < entranceTop.length - 1;
  const trakTop = split ? entranceTop.slice(0, kloStart + 1) : entranceTop;
  const kloTop = split ? entranceTop.slice(kloStart) : null;

  // Öffnungssektor: Polargitter um den Fokus, im Verrundungsbereich verdichtet
  let radii = linspace(rSeam, s.arcR, radial);
  if (fillet) {
    const rT2 = fillet.zT2 - s.zFocus;
    if (rT2 > rSeam) radii = [...new Set([...radii, ...linspace(rSeam, Math.min(rT2, s.arcR), 20)])].sort((a, b) => a - b);
  }
  const sector = radii.map(r => centerPhis.map(phi => polar(r, phi)));
  const linTop = lift(sector);

  // Eckstreifen rechts (außen): unten Naht, oben Endlinie Mundkante → Mundkante + t·Normale,
  // links Strahl φ = α, rechts Parallele der Wand
  let cornerR = null;
  if (corner) {
    const M = sector[sector.length - 1][angular];
    const E = [M[0] + t * Math.cos(s.alpha2), M[1] - t * Math.sin(s.alpha2)];
    const S = arc[nCols];
    const us = radii.map(r => (r - rSeam) / (s.arcR - rSeam));
    const vs = linspace(0, 1, corner);
    cornerR = coons(
      cornerPhis.map(phi => polar(rSeam, phi)),
      vs.map(v => [M[0] + v * (E[0] - M[0]), M[1] + v * (E[1] - M[1])]),
      sector.map(row => row[angular]),
      us.map(u => [S[0] + u * (E[0] - S[0]), S[1] + u * (E[1] - S[1])]),
      us, vs);
  }
  const cornerTopR = cornerR && lift(cornerR);
  const cornerTopL = cornerR && lift(cornerR.map(row => row.map(([x, z]) => [-x, z])));

  const mirrorY = grid => grid && grid.map(row => row.map(([x, y, z]) => [x, -y, z]));
  const column = (grid, j) => grid.map(row => row[j]);
  const last = grid => grid[grid.length - 1];
  const wall = (top, bottom) => top.map((p, k) => [bottom[k], p]);
  const trakBottom = mirrorY(trakTop), linBottom = mirrorY(linTop), kloBottom = mirrorY(kloTop);
  const cornerBottomR = mirrorY(cornerTopR), cornerBottomL = mirrorY(cornerTopL);
  // Seitenwände des geraden Bereichs: innen auf dem Strahl φ = ±α, außen auf der Parallelen
  const [wallTopL, wallBotL, wallTopR, wallBotR] = corner
    ? [column(cornerTopL, corner), column(cornerBottomL, corner), column(cornerTopR, corner), column(cornerBottomR, corner)]
    : [column(linTop, 0), column(linBottom, 0), column(linTop, angular), column(linBottom, angular)];
  return {
    trakTop, trakBottom, kloTop, kloBottom, linTop, linBottom, cornerTopL, cornerTopR, cornerBottomL, cornerBottomR,
    trakWallL: wall(column(trakTop, 0), column(trakBottom, 0)),
    trakWallR: wall(column(trakTop, nCols), column(trakBottom, nCols)),
    kloWallL: kloTop && wall(column(kloTop, 0), column(kloBottom, 0)),
    kloWallR: kloTop && wall(column(kloTop, nCols), column(kloBottom, nCols)),
    linWallL: wall(wallTopL, wallBotL),
    linWallR: wall(wallTopR, wallBotR),
    capThroat: wall(trakTop[0], trakBottom[0]),
    capMouth:  wall(last(linTop), last(linBottom)),
    throatLoop: closedLoop(trakTop[0], trakBottom[0]),
    mouth: { top: last(linTop), bottom: last(linBottom),
             cornerTopL: cornerTopL && last(cornerTopL), cornerTopR: cornerTopR && last(cornerTopR),
             cornerBottomL: cornerBottomL && last(cornerBottomL), cornerBottomR: cornerBottomR && last(cornerBottomR) },
  };
}

/** Geschlossener Randzug aus oberer und (rückwärts) unterer Randzeile. */
function closedLoop(topRow, bottomRow) {
  const loop = [...topRow, ...[...bottomRow].reverse()];
  return [...loop, loop[0]];
}

/**
 * Ebene Ringfläche zwischen zwei geschlossenen Randzügen gleicher Umlaufrichtung mit
 * entsprechenden Startpunkten (Reißverschluss nach anteiliger Bogenlänge).
 */
function zipper(a, b) {
  const params = loop => {
    const d = [0];
    for (let i = 1; i < loop.length; i++) d.push(d[i - 1] + Math.hypot(...loop[i].map((v, k) => v - loop[i - 1][k])));
    return d.map(x => x / d[d.length - 1]);
  };
  const ta = params(a), tb = params(b), tris = [];
  let i = 0, j = 0;
  while (i < a.length - 1 || j < b.length - 1) {
    if (j === b.length - 1 || (i < a.length - 1 && ta[i + 1] <= tb[j + 1])) { tris.push([a[i], a[i + 1], b[j]]); i++; }
    else { tris.push([a[i], b[j + 1], b[j]]); j++; }
  }
  return tris;
}

/** Fächer um den Schwerpunkt eines ebenen, konvexen Randzugs (ohne Wiederholung des Startpunkts). */
function fan(loop) {
  const c = [0, 1, 2].map(k => loop.reduce((sum, p) => sum + p[k], 0) / loop.length);
  return loop.map((p, i) => [c, p, loop[(i + 1) % loop.length]]);
}

const up = () => [0, 1, 0], down = () => [0, -1, 0];
const sideways = ([x]) => [Math.sign(x), 0, 0];
const flip = f => p => f(p).map(v => -v);

/** Flächen eines Körpers mit Außenrichtungen; invert für die Innenseite einer Schale. */
function surfacesOf(b, invert = false) {
  const o = invert ? flip : f => f;
  const list = [
    { name: "trakTop",    section: "traktrix", grid: b.trakTop,    outward: o(up) },
    { name: "trakBottom", section: "traktrix", grid: b.trakBottom, outward: o(down) },
    { name: "trakWallL",  section: "traktrix", grid: b.trakWallL,  outward: o(sideways) },
    { name: "trakWallR",  section: "traktrix", grid: b.trakWallR,  outward: o(sideways) },
    { name: "linTop",     section: "linear",   grid: b.linTop,     outward: o(up) },
    { name: "linBottom",  section: "linear",   grid: b.linBottom,  outward: o(down) },
    { name: "linWallL",   section: "linear",   grid: b.linWallL,   outward: o(sideways) },
    { name: "linWallR",   section: "linear",   grid: b.linWallR,   outward: o(sideways) },
  ];
  if (b.kloTop) {
    list.push(
      { name: "kloTop",    section: "klothoide", grid: b.kloTop,    outward: o(up) },
      { name: "kloBottom", section: "klothoide", grid: b.kloBottom, outward: o(down) },
      { name: "kloWallL",  section: "klothoide", grid: b.kloWallL,  outward: o(sideways) },
      { name: "kloWallR",  section: "klothoide", grid: b.kloWallR,  outward: o(sideways) },
    );
  }
  if (b.cornerTopR) {
    list.push(
      { name: "cornerTopL",    section: "linear", grid: b.cornerTopL,    outward: o(up) },
      { name: "cornerTopR",    section: "linear", grid: b.cornerTopR,    outward: o(up) },
      { name: "cornerBottomL", section: "linear", grid: b.cornerBottomL, outward: o(down) },
      { name: "cornerBottomR", section: "linear", grid: b.cornerBottomR, outward: o(down) },
    );
  }
  // gerundete Längskanten: Dreiecke schon nach außen orientiert (edgeTriangles)
  list.push(...(b.edges ?? []));
  return list;
}

/**
 * Luftvolumen als geschlossener Körper (inkl. Kappen an Throat und Mund).
 * @param s        Lösung aus solveHorn
 * @param rt       Throat-Radius (halbe Throat-Breite und -Höhe)
 * @param profile  z ↦ halbe Höhe (makeProfile, inkl. Verrundung)
 * @param fillet   Verrundung oder null – verdichtet das Gitter im Verrundungsbereich
 * @returns {{ surfaces: { name, section, grid?, triangles?, outward }[] }}
 *   grid: Zeilen × Spalten von Punkten oder triangles: fertige Dreiecke;
 *   section: "traktrix" | "klothoide" | "linear" | "cap"; outward: Punkt ↦ ungefähre Außenrichtung
 */
export function buildHornGeometry(s, rt, profile, fillet = null, res = DEFAULT_RES) {
  const air = body(s, rt, 0, (x, z) => profile(s.zFocus + focusRadius(s, x, z)), fillet, res);
  const radialOut = ([x, , z]) => [x, 0, z - s.zFocus];
  return {
    surfaces: [
      ...surfacesOf(air),
      { name: "capThroat", section: "cap", grid: air.capThroat, outward: () => [0, 0, -1] },
      { name: "capMouth",  section: "cap", grid: air.capMouth,  outward: radialOut },
    ],
  };
}

const FLANGE_SEGMENTS = 96, HOLE_SEGMENTS = 24;

/** Mittelpunkte der Flanschbohrungen [x, h]; erste Bohrung unter angle (Grad) gegen die Breitenachse. */
export function boltHoleCenters({ count, circle, angle }) {
  return Array.from({ length: count }, (_, i) => {
    const a = (angle + 360 * i / count) * Math.PI / 180;
    return [circle / 2 * Math.cos(a), circle / 2 * Math.sin(a)];
  });
}

/** Kleinster Abstand eines Punkts zu einem geschlossenen Polygonzug und ob er innen liegt. */
function polygonDistance([px, py], poly) {
  let d = Infinity, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    if ((ay > py) !== (by > py) && px < ax + (py - ay) * (bx - ax) / (by - ay)) inside = !inside;
    const abx = bx - ax, aby = by - ay;
    const f = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1)));
    d = Math.min(d, Math.hypot(px - ax - f * abx, py - ay - f * aby));
  }
  return { d, inside };
}

/**
 * Löst die Flanschvorgaben gegen die Schale auf. Der Flansch muss den Außenkörper an seinem
 * Beginn (z = Dicke) umschließen – ein kleinerer Ø wird auf dieses Minimum angehoben. Ohne
 * Ø (diameter = null) gilt fallback (z.B. die Treiberbreite), mindestens aber das Minimum
 * plus Platz für die Bohrungen bzw. der vorgegebene Lochkreis plus Rand. Ohne Lochkreis (circle = null) liegt er mittig zwischen
 * Außenkörper und Flanschrand. Bohrungen, die nicht ganz im Flansch und außerhalb der
 * Schale liegen, entfallen.
 * @param flange  { diameter | null, fallback?, thickness, holes: { count, circle | null, diameter, angle } }
 * @returns {{ diameter, thickness, holes, centers: [x, h][], conflicts: [x, h][], minDiameter, limited, invalidHoles }}
 *   centers: gebohrte Löcher; conflicts: Bohrbild-Positionen, die nicht gebohrt werden können
 *   (in der Schale oder über den Rand) – nur zur Anzeige
 */
export function flangeLayout(s, rt, profile, fillet, t, flange, edgeR = 0, res = DEFAULT_RES) {
  const outer = outerBody(s, rt, profile, fillet, t, res, flange.thickness, edgeR);
  const loop = outer.throatLoop.slice(0, -1);
  const minDiameter = 2 * Math.max(...loop.map(([x, h]) => Math.hypot(x, h)));
  const holeRing = flange.holes.count > 0 ? 4 * flange.holes.diameter + 4 : 0;   // Bohrung + Stege
  const holeFit = flange.holes.count > 0 && flange.holes.circle ? flange.holes.circle + 2 * flange.holes.diameter + 2 : 0;
  const wanted = flange.diameter ?? Math.max(flange.fallback ?? 0, minDiameter + holeRing, holeFit);
  const diameter = Math.max(wanted, minDiameter);
  const holes = { ...flange.holes, circle: flange.holes.circle ?? (minDiameter + diameter) / 2 };
  const r = diameter / 2, rh = holes.diameter / 2;
  const all = holes.count > 0 ? boltHoleCenters(holes) : [];
  const fits = c => {
    if (Math.hypot(...c) + rh > r - 0.5) return false;
    const { d, inside } = polygonDistance(c, loop);
    return !inside && d > rh + 0.5;
  };
  const centers = all.filter(fits), conflicts = all.filter(c => !fits(c));
  return {
    diameter, thickness: flange.thickness, holes, centers, conflicts,
    minDiameter, limited: wanted < minDiameter, invalidHoles: all.length - centers.length,
  };
}

/**
 * Außenkörper der Schale, optional ab der Ebene zStart (Flansch davor). Die letzten Ergebnisse
 * werden zwischengespeichert: flangeLayout und buildShellGeometry brauchen bei jeder Änderung
 * denselben Körper (gleiche Objekte s, profile, fillet, res).
 */
const outerCache = [];
function outerBody(s, rt, profile, fillet, t, res, zStart = 0, edgeR = 0) {
  const key = [s, rt, profile, fillet, t, res, zStart, edgeR];
  const hit = outerCache.find(e => e.key.every((v, i) => v === key[i]));
  if (hit) return hit.body;
  const hAt = r => profile(s.zFocus + r);
  const capHeight = hAt(s.arcR) + t;
  const field = outerHeightField(s, rt, hAt, t);
  const height = (x, z) => Math.min(field(x, z), capHeight);
  // Gerundete Längskanten: Deckel und Boden enden um den Radius vor der Außenkante (Kontur im
  // Abstand t − r, Höhe weiter die der vollen Wandstärke); Rundung und Seitenwand ergänzt roundEdges
  const tPlan = edgeR > 0 ? Math.max(t - Math.min(edgeR, t), EDGE_MIN_INSET) : t;
  const result = body(s, rt, tPlan, height, fillet, res, zStart);
  if (edgeR > 0) roundEdges(result, s, t - tPlan, wallEnvelope(s, innerWall(s, rt, 2000).points, t));
  outerCache.unshift({ key, body: result });
  outerCache.length = Math.min(outerCache.length, 4);
  return result;
}

const EDGE_MIN_INSET = 0.05;   // Deckel endet mindestens so weit vor der Wandlinie [mm] (Radius = t)

/**
 * Dreiecke eines Rundungsstreifens (Zeile = Viertelkreis ab der Deckelkante Q), nach außen
 * orientiert über den Kreismittelpunkt der Zeile (Q − r senkrecht zur Deckelseite). Ein fester
 * Richtungshinweis reicht hier nicht: wo der Deckel steil ansteigt, kippt die Flächennormale weit
 * in Längsrichtung.
 */
function edgeTriangles(grid, r) {
  const center = ([x, y, z]) => [x, y - Math.sign(y) * r, z];
  const tris = [];
  for (let i = 0; i < grid.length - 1; i++) {
    const c = center(grid[i][0]).map((v, k) => (v + center(grid[i + 1][0])[k]) / 2);
    for (let j = 0; j < grid[i].length - 1; j++) {
      const p = grid[i][j], q = grid[i][j + 1], u = grid[i + 1][j + 1], v = grid[i + 1][j];
      for (const [a, b, d] of [[p, q, u], [p, u, v]]) {
        const e1 = b.map((x, k) => x - a[k]), e2 = d.map((x, k) => x - a[k]);
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (Math.hypot(...n) < 1e-12) continue;
        const m = [0, 1, 2].map(k => (a[k] + b[k] + d[k]) / 3 - c[k]);
        tris.push(n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0 ? [a, b, d] : [a, d, b]);
      }
    }
  }
  return tris;
}
const EDGE_STEPS = 8;          // Unterteilung des Viertelkreises einer gerundeten Kante

/**
 * Rundet die vier Längskanten des Außenkörpers (Seitenwand ↔ Deckel/Boden) mit Radius r. b ist
 * mit der Kontur im Abstand t − r gebaut; seine Deckelkante Q wird zum Anfang der Rundung. Je
 * Kantenpunkt liegt ein Viertelkreis in der Ebene aus Wandnormale n (waagerecht) und Senkrechter:
 * Mittelpunkt Q − r·oben, von Q (waagerecht tangential an den Deckel – quer zur Kante ist der
 * Deckel eben) bis W = Q + r·n − r·oben (senkrecht tangential an die Seitenwand im Abstand t).
 * Ersetzt die Seitenwände (jetzt zwischen den unteren und oberen W), ergänzt die Rundungsflächen
 * je Sektion und schließt Throat-Randzug und Mund-Stirnflächen um die gerundeten Ecken.
 * Am Throat ist n rein seitlich, damit der Randzug in der Throat- bzw. Flanschebene bleibt; im
 * geraden Bereich ist n die Wandnormale, die Stirnfläche am Mund bleibt eben.
 * Ist die Traktrix enger gekrümmt als die Wandstärke, bildet Q + r·n eine Schlaufe (wie die
 * einfache Parallelkurve, siehe contourRight): dort liegt W auf der Einhüllenden im Abstand t,
 * in z nicht rückläufig; der Viertelkreis wird dann zur Ellipse zwischen Q und W.
 */
function roundEdges(b, s, r, envelope) {
  const n = b.trakTop[0].length - 1, column = (grid, j) => grid.map(row => row[j]);
  const nLine = [Math.cos(s.alpha2), -Math.sin(s.alpha2)];
  // Kantenzug rechts oben je Sektion; Eingang (Traktrix, Klothoide) und gerader Bereich
  const parts = [
    { key: "trak", section: "traktrix", top: b.trakTop },
    ...(b.kloTop ? [{ key: "klo", section: "klothoide", top: b.kloTop }] : []),
    { key: "lin", section: "linear", top: b.cornerTopR, col: CORNER_COLUMNS, topL: b.cornerTopL },
  ];
  // Wandnormalen des Eingangs aus den Nachbarpunkten, über die Sektionsgrenze hinweg
  const entrance = parts.filter(p => p.key !== "lin").flatMap((p, i) => column(p.top, n).slice(i ? 1 : 0));
  // Wandnormale: Eingang aus den Nachbarpunkten, Übergang und gerader Bereich die der Geraden.
  // Am Throat rein seitlich (Randzug bleibt in der Throat- bzw. Flanschebene), über 2r vom Throat
  // aus in die Wandnormale übergeblendet: sie dreht je mm höchstens um 1/(2r), die Rundung faltet
  // nicht – auch nicht, wenn der Eingang sehr kurz ist (ohne Traktrix)
  const z0 = entrance[0][2];
  const blend = ([nx, nz], z) => {
    const w = Math.min(1, Math.max(0, (z - z0) / (2 * r)));
    const bx = (1 - w) + w * nx, bz = w * nz, l = Math.hypot(bx, bz);
    return [bx / l, bz / l];
  };
  const entranceNormal = entrance.map((q, k) => {
    if (k === 0 || k === entrance.length - 1) return blend(k ? nLine : [1, 0], q[2]);
    const a = entrance[k - 1], c = entrance[k + 1], dx = c[0] - a[0], dz = c[2] - a[2], len = Math.hypot(dx, dz);
    return blend([dz / len, -dx / len], q[2]);
  });
  // Viertelkreis (bzw. Ellipse) von Q bis W = [wx, wh, wz]; Endpunkte exakt
  const arc = ([qx, qh, qz], [wx, wh, wz]) => linspace(Math.PI / 2, 0, EDGE_STEPS).map((th, j) => j === 0
    ? [qx, qh, qz]
    : j === EDGE_STEPS ? [wx, wh, wz]
    : [qx + Math.cos(th) * (wx - qx), wh + (qh - wh) * Math.sin(th), qz + Math.cos(th) * (wz - qz)]);
  // Unterkante W der Rundung (rechte Seite, Draufsicht) für eine Folge von Kantenpunkten
  const wallLine = (qs, normals) => {
    let zPrev = -Infinity;
    const tol = 1e-3 * r;
    return qs.map(([qx, , qz], k) => {
      const wx = qx + r * normals[k][0], wz = qz + r * normals[k][1];
      if (wz >= zPrev && wx >= envelope(wz) - tol) { zPrev = wz; return [wx, wz]; }
      const z = Math.max(wz, zPrev);
      zPrev = z;
      return [envelope(z), z];
    });
  };
  const mirrorY = grid => grid.map(row => row.map(([x, y, z]) => [x, -y, z]));

  // Unterkante über die ganze Kante in einem Zug (Sektionsgrenzen teilen ihre Punkte)
  const rightCols = parts.map(part => column(part.top, part.col ?? n));
  const linCol = rightCols[rightCols.length - 1];
  const allQ = [...entrance, ...linCol.slice(1)];
  const allN = [...entranceNormal, ...linCol.slice(1).map(q => blend(nLine, q[2]))];
  // Höhe der Unterkante: r unter Q. Fällt W in der Ecke auf den Punkt der Vorzeile, übernimmt es
  // auch deren Höhe – die Wandzelle dazwischen entartet dann sauber zu einem Punkt
  // (auch, wenn er ihm bis auf Rundungsfehler nahekommt – sonst entstehen hauchdünne Dreiecke)
  const allW = [];
  wallLine(allQ, allN).forEach(([wx, wz], k) => {
    const prev = allW[k - 1];
    allW.push(prev && Math.hypot(prev[0] - wx, prev[2] - wz) < 1e-3 * r ? prev : [wx, allQ[k][1] - r, wz]);
  });

  let offset = 0;
  b.edges = [];
  const rounded = {};
  parts.forEach((part, pi) => {
    const rightCol = rightCols[pi], leftCol = column(part.key === "lin" ? part.topL : part.top, part.col ?? 0);
    const wR = allW.slice(offset, offset + rightCol.length);
    offset += rightCol.length - 1;
    const topR = rightCol.map((q, k) => arc(q, wR[k])), topL = leftCol.map((q, k) => arc(q, [-wR[k][0], wR[k][1], wR[k][2]]));
    const botR = mirrorY(topR), botL = mirrorY(topL);
    const W = grid => grid.map(row => row[EDGE_STEPS]);
    const wall = (top, bottom) => top.map((p, k) => [bottom[k], p]);
    b[`${part.key}WallR`] = wall(W(topR), W(botR));
    b[`${part.key}WallL`] = wall(W(topL), W(botL));
    const name = part.key[0].toUpperCase() + part.key.slice(1);
    const strip = (label, grid) => ({ name: `edge${name}${label}`, section: part.section, grid, triangles: edgeTriangles(grid, r), oriented: true });
    b.edges.push(strip("TopR", topR), strip("TopL", topL), strip("BottomR", botR), strip("BottomL", botL));
    rounded[part.key] = { topR, topL, botR, botL };
  });

  // Throat: Randzug um die gerundeten Ecken (oben links → rechts, Rundung, Wand, Rundung, unten zurück)
  const t0 = rounded.trak, top = b.trakTop[0], bottom = b.trakBottom[0];
  const loop = [
    ...top, ...t0.topR[0].slice(1), ...[...t0.botR[0]].reverse(),
    ...[...bottom].reverse().slice(1), ...t0.botL[0].slice(1), ...[...t0.topL[0]].reverse().slice(0, -1),
  ];
  b.throatLoop = [...loop, loop[0]];
  // Mund: Eckzeilen um die Rundung bis zur Seitenwand verlängert (Stirnflächen der Seitenwände)
  const lin = rounded.lin, endRow = grid => grid[grid.length - 1].slice(1);
  b.mouth.cornerTopR = [...b.mouth.cornerTopR, ...endRow(lin.topR)];
  b.mouth.cornerTopL = [...b.mouth.cornerTopL, ...endRow(lin.topL)];
  b.mouth.cornerBottomR = [...b.mouth.cornerBottomR, ...endRow(lin.botR)];
  b.mouth.cornerBottomL = [...b.mouth.cornerBottomL, ...endRow(lin.botL)];
}

/** Ring aus n Punkten [x, h, z] um (cx, ch) in der Ebene z. */
const ring = (cx, ch, radius, z, n) =>
  Array.from({ length: n }, (_, k) => {
    const a = 2 * Math.PI * k / n;
    return [cx + radius * Math.cos(a), ch + radius * Math.sin(a), z];
  });

const area2 = ([a, b, c]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

/**
 * Ebene Fläche aus Außenrand und Löchern (Punkte [x, h, z] gleicher Ebene), trianguliert und
 * so orientiert, dass die Normale in Richtung nz (±1) zeigt. earcut lässt kollineare
 * Randpunkte aus; sie werden in die Dreieckskante zurückgesetzt, auf der sie liegen, damit
 * die Fläche dicht an die angrenzenden Gitter anschließt (keine T-Stöße).
 */
function planarFace(contour, holes, nz) {
  const v2 = pts => pts.map(([x, h]) => new Vector2(x, h));
  const all = [contour, ...holes].flat();
  const idx = ShapeUtils.triangulateShape(v2(contour), holes.map(v2));
  let tris = idx.map(([a, b, c]) => [all[a], all[b], all[c]]);
  if (tris.length && area2(tris[0]) * nz < 0) tris = tris.map(([a, b, c]) => [a, c, b]);

  const used = new Set(idx.flat());
  for (const p of all.filter((_, i) => !used.has(i))) {
    for (let k = 0; k < tris.length; k++) {
      const tri = tris[k];
      const e = [0, 1, 2].find(j => onSegment(p, tri[j], tri[(j + 1) % 3]));
      if (e === undefined) continue;
      const [a, b, c] = [tri[e], tri[(e + 1) % 3], tri[(e + 2) % 3]];
      tris.splice(k, 1, [a, p, c], [p, b, c]);
      break;
    }
  }
  return tris;
}

/** Liegt p (in x, h) im Inneren der Strecke a–b? */
function onSegment(p, a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (Math.abs(area2([a, b, p])) > 1e-7 * len * len) return false;
  const f = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (len * len);
  return f > 1e-9 && f < 1 - 1e-9;
}

/** Mantel zwischen zwei gleich langen, geschlossenen Ringen (ohne wiederholten Startpunkt). */
const band = (a, b) => [[...a, a[0]], [...b, b[0]]];

/**
 * Flansch als Flächen: Rückseite (z = 0) mit Throat-Öffnung, Vorderseite (z = Dicke) um den
 * Außenkörper der Schale, Zylindermantel und Bohrungswände.
 * @param airLoop    Randzug des Luftvolumens am Throat (z = 0)
 * @param outerLoop  Randzug des Außenkörpers bei z = Dicke
 */
function flangeSurfaces(flange, airLoop, outerLoop) {
  const holes = flange.centers;
  const r = flange.diameter / 2, rh = flange.holes.diameter / 2, d = flange.thickness;
  const back = ring(0, 0, r, 0, FLANGE_SEGMENTS), front = ring(0, 0, r, d, FLANGE_SEGMENTS);
  const holesBack = holes.map(([x, h]) => ring(x, h, rh, 0, HOLE_SEGMENTS));
  const holesFront = holes.map(([x, h]) => ring(x, h, rh, d, HOLE_SEGMENTS));
  const open = loop => loop.slice(0, -1);
  return [
    { name: "flangeBack",  section: "flansch", oriented: true, triangles: planarFace(back, [open(airLoop), ...holesBack], -1) },
    { name: "flangeFront", section: "flansch", oriented: true, triangles: planarFace(front, [open(outerLoop), ...holesFront], 1) },
    { name: "flangeRim",   section: "flansch", outward: ([x, h]) => [x, h, 0], grid: band(back, front) },
    ...holes.map(([cx, ch], i) => ({
      name: `flangeHole${i}`, section: "flansch", outward: ([x, h]) => [cx - x, ch - h, 0],
      grid: band(holesBack[i], holesFront[i]),
    })),
  ];
}

/**
 * Außenkontur der Schale in der Draufsicht (Schnitt h = 0, rechte Seite) als [x, z]: dieselbe
 * Kontur wie der 3D-Außenkörper (Einhüllende, dann Parallele der geraden Wand), von zStart
 * (0 oder Flanschdicke) bis zum Ende der Seitenwand E = Mundkante + t·Wandnormale.
 */
export function shellPlanOutline(s, rt, t, zStart = 0, axial = 300) {
  const { pts } = contourRight(s, rt, t, axial, zStart);
  return [...pts, [s.xMouth + t * Math.cos(s.alpha2), s.zMouth - t * Math.sin(s.alpha2)]];
}

/**
 * Außenkontur der Schale im Seitenriss (Schnitt x = 0, obere Hälfte) als [h, z]: Höhe des
 * 3D-Außenkörpers auf der Achse (senkrechte Aufdickung, am Mund auf hMouth/2 + t begrenzt),
 * von zStart bis zum Mundscheitel.
 */
export function shellProfileOutline(s, rt, profile, t, zStart = 0, n = 300) {
  const hAt = r => profile(s.zFocus + r);
  const field = outerHeightField(s, rt, hAt, t);
  const cap = hAt(s.arcR) + t;
  return linspace(zStart, s.zApex, n).map(z => [Math.min(field(0, z), cap), z]);
}

/**
 * Begrenzung der rechten Flansch-Schnittfläche als [halbe Breite, z]: innen der Luftkanal
 * (inner, nach z sortiert) von z = 0 bis zur Dicke d, außen der Rand R.
 */
export function flangeSectionOutline(inner, R, d) {
  const at = z => {
    const k = inner.findIndex(p => p[1] >= z);
    if (k <= 0) return k === 0 ? inner[0][0] : inner[inner.length - 1][0];
    const [x0, z0] = inner[k - 1], [x1, z1] = inner[k];
    return x0 + (x1 - x0) * (z - z0) / (z1 - z0 || 1);
  };
  const mid = inner.filter(([, z]) => z > 0 && z < d);
  return [[at(0), 0], ...mid, [at(d), d], [R, d], [R, 0]];
}

/**
 * Schale mit Wandstärke t: Außenkörper, Innenseite (Luftvolumen, umgedreht) und Stirnflächen.
 * Deckel und Boden: außen höchstens hMouth/2 + t (am Mund senkrecht gemessen, waagerecht
 * abgeschnitten), Stirnfläche bündig auf dem Mundbogen. Seitenwände: über die volle Höhe,
 * Stirnfläche senkrecht zur Wand durch die Mundkante. Throat: bündig in der Ebene z = 0 oder
 * – mit flange { diameter, thickness, holes: { count, circle, diameter, angle } } – runder
 * Flansch von z = 0 bis zur Dicke; der Außenkörper beginnt dann erst dahinter. Ein bereits
 * aufgelöster Flansch (flangeLayout) wird direkt verwendet. edgeR > 0 rundet die vier äußeren
 * Längskanten (Seitenwand ↔ Deckel/Boden) mit diesem Radius, höchstens t.
 * @returns {{ surfaces: { name, section, grid?, triangles?, outward }[] }}  section: "traktrix" | "klothoide" | "linear" | "rim" | "flansch"
 */
export function buildShellGeometry(s, rt, profile, fillet, t, flange = null, edgeR = 0, res = DEFAULT_RES) {
  const hAt = r => profile(s.zFocus + r);
  const air = body(s, rt, 0, (x, z) => hAt(focusRadius(s, x, z)), fillet, res);
  const outer = outerBody(s, rt, profile, fillet, t, res, flange ? flange.thickness : 0, edgeR);
  const throatEnd = flange
    ? flangeSurfaces(flange.centers ? flange : flangeLayout(s, rt, profile, fillet, t, flange, edgeR, res), air.throatLoop, outer.throatLoop)
    : [{ name: "rimThroat", section: "rim", triangles: zipper(air.throatLoop, outer.throatLoop), outward: () => [0, 0, -1] }];

  const radialOut = ([x, , z]) => [x, 0, z - s.zFocus];
  const am = air.mouth, om = outer.mouth;
  // Stirnfläche einer Seitenwand: innen Wandende, oben/unten Deckel/Boden, außen Wandende
  const endFace = (innerTop, innerBottom, outerCenterTop, outerCenterBottom, cornerTop, cornerBottom) => fan([
    innerBottom, innerTop, outerCenterTop, ...cornerTop.slice(1), ...[...cornerBottom].reverse().slice(0, -1), outerCenterBottom,
  ]);
  const n = am.top.length - 1;
  const dir = sign => () => [sign * Math.sin(s.alpha2), 0, Math.cos(s.alpha2)];

  return {
    surfaces: [
      ...surfacesOf(outer).map(f => ({ ...f, name: "outer." + f.name })),
      ...surfacesOf(air, true).map(f => ({ ...f, name: "inner." + f.name })),
      ...throatEnd,
      { name: "rimMouthTop",    section: "rim", grid: [am.top, om.top],       outward: radialOut },
      { name: "rimMouthBottom", section: "rim", grid: [am.bottom, om.bottom], outward: radialOut },
      { name: "rimEndR", section: "rim", outward: dir(1),
        triangles: endFace(am.top[n], am.bottom[n], om.top[n], om.bottom[n], om.cornerTopR, om.cornerBottomR) },
      { name: "rimEndL", section: "rim", outward: dir(-1),
        triangles: endFace(am.top[0], am.bottom[0], om.top[0], om.bottom[0], om.cornerTopL, om.cornerBottomL) },
    ],
  };
}

/**
 * Dreiecke einer Gitterfläche, nach außen orientiert (Normale zeigt in outward-Richtung).
 * Entartete Dreiecke (z.B. an zusammenfallenden Randpunkten) werden ausgelassen.
 * oriented: fertige, bereits orientierte Dreiecke – unverändert übernommen.
 * @returns {number[][][]}  Liste von Dreiecken [a, b, c]
 */
export function triangulate({ grid, triangles, outward, oriented }) {
  if (oriented) return triangles;
  const tris = [];
  // skalar gerechnet (Normale n = (b − a) × (c − a)): wird für zehntausende Dreiecke aufgerufen
  const add = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-12) return;
    const o = outward([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]);
    tris.push(nx * o[0] + ny * o[1] + nz * o[2] >= 0 ? [a, b, c] : [a, c, b]);
  };
  if (triangles) { for (const [a, b, c] of triangles) add(a, b, c); return tris; }
  for (let i = 0; i < grid.length - 1; i++) {
    for (let j = 0; j < grid[i].length - 1; j++) {
      const a = grid[i][j], b = grid[i][j + 1], c = grid[i + 1][j + 1], d = grid[i + 1][j];
      add(a, b, c);
      add(a, c, d);
    }
  }
  return tris;
}

/** Gitterlinien (Zeilen und Spalten) einer Fläche als Liste von Strecken [p, q]. */
export function gridLines({ grid }) {
  const segs = [];
  if (!grid) return segs;
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      if (j + 1 < grid[i].length) segs.push([grid[i][j], grid[i][j + 1]]);
      if (i + 1 < grid.length) segs.push([grid[i][j], grid[i + 1][j]]);
    }
  }
  return segs;
}
