/**
 * 3D-Körper des Horns (Luftvolumen) als strukturierte Flächengitter.
 *
 * Konstruktion
 *   - Traktrix-Sektion: senkrechte Wände entlang der Traktrix, Grundfläche wie in der
 *     Draufsicht (bis zum inneren Teilkreis um den Fokus).
 *   - Gerader Bereich: senkrechte Wände im Öffnungswinkel; Deckel und Boden entstehen durch
 *     Rotation des Seitenprofils um die senkrechte Achse durch den Fokus.
 *   - Eine Regel für den ganzen Körper: halbe Höhe h(x, z) = Profil(zFocus + Abstand zum
 *     Fokus). Im Prisma ergibt das rt; mit Verrundung steigt der Deckel im Ringband vor
 *     dem inneren Teilkreis wie im Seitenriss an.
 *
 * Koordinaten der Gitterpunkte: [X, Y, Z] = [x (Breite), h (Höhe), z (Achse)] in mm.
 * Nachbarflächen teilen sich an den Nähten exakt dieselben Randpunkte (wasserdicht).
 */
import { hasTraktrix, traktrixPoints } from "./horn-math.js";
import { linspace } from "./utils.js";

/**
 * @param s        Lösung aus solveHorn
 * @param rt       Throat-Radius (halbe Throat-Breite und -Höhe)
 * @param profile  z ↦ halbe Höhe (makeProfile, inkl. Verrundung)
 * @param fillet   Verrundung oder null – verdichtet das Gitter im Verrundungsbereich
 * @returns {{ surfaces: { name, section, grid, outward }[] }}
 *   grid: Zeilen × Spalten von Punkten; section: "traktrix" | "linear" | "cap";
 *   outward: Punkt ↦ ungefähre Außenrichtung (für die Orientierung der Dreiecke)
 */
export function buildHornGeometry(s, rt, profile, fillet = null, { angular = 60, radial = 80, axial = 40 } = {}) {
  const hAt = r => profile(s.zFocus + r);                  // halbe Höhe im Abstand r vom Fokus
  const heightXZ = (x, z) => hAt(Math.hypot(x, z - s.zFocus));
  const phis = linspace(-s.alpha2, s.alpha2, angular);
  const polar = (r, phi) => [r * Math.sin(phi), s.zFocus + r * Math.cos(phi)];

  // Radien des geraden Bereichs, im Verrundungsbereich verdichtet
  let radii = linspace(s.rInner, s.arcR, radial);
  if (fillet) {
    const rT2 = fillet.zT2 - s.zFocus;
    radii = [...new Set([...radii, ...linspace(s.rInner, Math.min(rT2, s.arcR), 20)])].sort((a, b) => a - b);
  }

  // ── Grundfläche der Traktrix-Sektion (x, z) als Coons-Fläche ─────────────────
  // Ränder: Throat-Kante (u = 0), innerer Teilkreis (u = 1), linke/rechte Traktrix.
  const trak = hasTraktrix(s) ? traktrixPoints(s, axial) : [[rt, 0], [rt, 0]];
  const nU = trak.length - 1;
  trak[0] = [rt, 0];                                      // Throat exakt
  const arc = phis.map(phi => polar(s.rInner, phi));      // innerer Teilkreis = Rand des Polargitters
  trak[nU] = arc[angular];                                // Übergang exakt auf dem Teilkreis
  const throatX = linspace(-rt, rt, angular);

  const base = [];                                        // base[i][j] = [x, z]
  for (let i = 0; i <= nU; i++) {
    const u = i / nU, row = [];
    const L = [-trak[i][0], trak[i][1]], R = trak[i];
    for (let j = 0; j <= angular; j++) {
      const v = j / angular;
      if (i === 0) { row.push([throatX[j], 0]); continue; }
      if (i === nU) { row.push(arc[j]); continue; }
      if (j === 0) { row.push(L); continue; }
      if (j === angular) { row.push(R); continue; }
      const B = [throatX[j], 0], T = arc[j];
      const c00 = [-rt, 0], c01 = [rt, 0], c10 = arc[0], c11 = arc[angular];
      row.push([0, 1].map(k =>
        (1 - u) * B[k] + u * T[k] + (1 - v) * L[k] + v * R[k]
        - ((1 - u) * (1 - v) * c00[k] + (1 - u) * v * c01[k] + u * (1 - v) * c10[k] + u * v * c11[k])));
    }
    base.push(row);
  }

  // Höhe der Traktrix-Grundfläche; auf dem Teilkreis exakt wie im Polargitter
  const baseHeight = (i, [x, z]) => i === nU ? hAt(s.rInner) : heightXZ(x, z);
  const trakTop    = base.map((row, i) => row.map(p => [p[0],  baseHeight(i, p), p[1]]));
  const trakBottom = trakTop.map(row => row.map(([x, y, z]) => [x, -y, z]));

  // ── Deckel/Boden des geraden Bereichs: Polargitter um den Fokus ──────────────
  const linTop    = radii.map(r => phis.map(phi => { const [x, z] = polar(r, phi); return [x, hAt(r), z]; }));
  const linBottom = linTop.map(row => row.map(([x, y, z]) => [x, -y, z]));

  // ── Senkrechte Wände (je Seite ein Streifen von unten nach oben) ─────────────
  const wall = (topRow, bottomRow) => topRow.map((p, k) => [bottomRow[k], p]);
  const column = (grid, j) => grid.map(row => row[j]);
  const trakWallL = wall(column(trakTop, 0), column(trakBottom, 0));
  const trakWallR = wall(column(trakTop, angular), column(trakBottom, angular));
  const linWallL  = wall(column(linTop, 0), column(linBottom, 0));
  const linWallR  = wall(column(linTop, angular), column(linBottom, angular));

  // ── Kappen am Throat und am Mund (schließen das Volumen, nur für die STL) ────
  const capThroat = wall(trakTop[0], trakBottom[0]);
  const capMouth  = wall(linTop[linTop.length - 1], linBottom[linBottom.length - 1]);

  const up = () => [0, 1, 0], down = () => [0, -1, 0];
  const side = ([x]) => [Math.sign(x), 0, 0];
  const radial_ = ([x, , z]) => [x, 0, z - s.zFocus];
  return {
    surfaces: [
      { name: "trakTop",    section: "traktrix", grid: trakTop,    outward: up },
      { name: "trakBottom", section: "traktrix", grid: trakBottom, outward: down },
      { name: "trakWallL",  section: "traktrix", grid: trakWallL,  outward: side },
      { name: "trakWallR",  section: "traktrix", grid: trakWallR,  outward: side },
      { name: "linTop",     section: "linear",   grid: linTop,     outward: up },
      { name: "linBottom",  section: "linear",   grid: linBottom,  outward: down },
      { name: "linWallL",   section: "linear",   grid: linWallL,   outward: side },
      { name: "linWallR",   section: "linear",   grid: linWallR,   outward: side },
      { name: "capThroat",  section: "cap",      grid: capThroat,  outward: () => [0, 0, -1] },
      { name: "capMouth",   section: "cap",      grid: capMouth,   outward: radial_ },
    ],
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Dreiecke einer Gitterfläche, nach außen orientiert (Normale zeigt in outward-Richtung).
 * Entartete Dreiecke (z.B. an zusammenfallenden Randpunkten) werden ausgelassen.
 * @returns {number[][][]}  Liste von Dreiecken [a, b, c]
 */
export function triangulate({ grid, outward }) {
  const tris = [];
  const add = (a, b, c) => {
    const n = cross(sub(b, a), sub(c, a));
    if (Math.hypot(...n) < 1e-12) return;
    const centroid = [0, 1, 2].map(k => (a[k] + b[k] + c[k]) / 3);
    tris.push(dot(n, outward(centroid)) >= 0 ? [a, b, c] : [a, c, b]);
  };
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
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      if (j + 1 < grid[i].length) segs.push([grid[i][j], grid[i][j + 1]]);
      if (i + 1 < grid.length) segs.push([grid[i][j], grid[i + 1][j]]);
    }
  }
  return segs;
}
