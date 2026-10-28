// Stützrippen am Flansch: dreieckige Rippen auf der Hornseite der Platte, mittig zwischen den
// Bohrungen (so viele wie Bohrungen), vom Flanschrand zur Außenwand der Schale.
//
// Jede Rippe liegt in einer Ebene durch die Hornachse (Winkel φ) und ist dort ein Vieleck in
// (ρ, z): unten die Plattenfläche, außen der Flanschrand (nie darüber hinaus), oben die Schräge
// zur Wand, innen die Außenwand der Schale – gemessen an ihrem Schnitt mit dem 3D-Außenkörper
// (Strahl vom Ursprung unter φ in jeder Schnittebene z), also mit allen Verrundungen, der
// Klothoide und dem runden Throat. Zum Strang extrudiert um die Rippendicke w. Das Vieleck
// reicht ein Stück in Wand (e) und Platte (d) hinein, damit der Slicer die Teile verschmilzt;
// dieser Überlapp wird im Volumen herausgerechnet (overlap).
//
// Koordinaten wie horn-mesh.js: [x, h, z], Ursprung auf der Hornachse in der Throat-Ebene.

export const RIB_SAMPLES = 24;          // Schnittebenen entlang der Rippe
const RIB_START = 0.05;                 // erste Schnittebene über der Plattenfläche [mm]
const RIB_TOP_MARGIN = 3;               // so viel muss zwischen Wand und Flanschrand bleiben [mm]
const RIB_EMBED_WALL = 4;               // Eintauchtiefe in die Wand, höchstens [mm]
const RIB_EMBED_PLATE = 1;              // Eintauchtiefe in die Platte, höchstens [mm]

/** Dreiecke eines Gitters [i][j] → [x, h, z]; Orientierung egal (nur zum Schneiden). */
function gridTriangles(grid) {
  const tris = [];
  for (let i = 0; i < grid.length - 1; i++) {
    for (let j = 0; j < grid[i].length - 1; j++) {
      const a = grid[i][j], b = grid[i][j + 1], c = grid[i + 1][j + 1], d = grid[i + 1][j];
      tris.push([a, b, c], [a, c, d]);
    }
  }
  return tris;
}

/** Alle Dreiecke der Flächen des Außenkörpers (Gitter oder fertige Dreiecke). */
export const surfaceTriangles = surfaces => surfaces.flatMap(f => f.grid ? gridTriangles(f.grid) : f.triangles ?? []);

/** Strecken [[x, h], [x, h]] des Schnitts der Dreiecke mit der Ebene z. */
export function sliceSegments(tris, z) {
  const segs = [];
  for (const tri of tris) {
    const d = tri.map(p => p[2] - z);
    if (!(Math.min(...d) < 0 && Math.max(...d) >= 0)) continue;
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3], da = d[k], db = d[(k + 1) % 3];
      if ((da < 0) === (db < 0)) continue;
      const f = da / (da - db);
      pts.push([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])]);
    }
    if (pts.length === 2) segs.push(pts);
  }
  return segs;
}

/**
 * Weitester Schnittpunkt des Strahls (Richtung (c, s)) mit den Strecken, sonst null. Der Strahl
 * beginnt im Ursprung, mit side ≠ 0 um side seitlich versetzt (senkrecht zur Richtung); der
 * Rückgabewert ist der Abstand ρ entlang der Richtung.
 */
export function rayReach(segs, c, s, side = 0) {
  let best = null;
  const ox = -s * side, oy = c * side;
  for (const [a0, b0] of segs) {
    const a = [a0[0] - ox, a0[1] - oy], b = [b0[0] - ox, b0[1] - oy];
    const ex = b[0] - a[0], eh = b[1] - a[1];
    const den = c * eh - s * ex;                    // d × e
    if (Math.abs(den) < 1e-12) continue;
    const t = (a[0] * eh - a[1] * ex) / den;        // (a × e) / (d × e)
    const u = (a[0] * s - a[1] * c) / den;          // (a × d) / (d × e)
    if (u >= 0 && u <= 1 && t > 0 && (best === null || t > best)) best = t;
  }
  return best;
}

const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Dreieck so drehen, dass seine Normale in Richtung dir zeigt; entartete (Fläche 0) entfallen. */
function oriented(a, b, c, dir) {
  const n = cross3([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
  if (Math.hypot(...n) < 1e-12) return [];
  return [n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] >= 0 ? [a, b, c] : [a, c, b]];
}

/**
 * Geschlossener Strang aus dem Vieleck poly [[ρ, z], …] (gegen den Uhrzeigersinn, einfach, vom Punkt
 * poly[1] aus sternförmig): Seitenflächen bei ±w/2 als Fächer um poly[1], Mantel je Kante.
 * Alle Ecken des Vielecks bleiben Ecken der Dreiecke (keine T-Stöße). Null, wenn der Fächer
 * nicht aufgeht (Vieleck nicht sternförmig).
 * @returns {number[][][][] | null}  ebene Flächen, je eine Liste von Dreiecken
 */
function extrude(poly, phi, w) {
  const u = [Math.cos(phi), Math.sin(phi)], v = [-Math.sin(phi), Math.cos(phi)];
  const at = ([rho, z], side) => [rho * u[0] + side * v[0], rho * u[1] + side * v[1], z];
  const n = poly.length, hub = 1;
  // Fächer (hub, k, k+1) für k = 2 … n−2, dazu (hub, n−1, 0)
  const fan = [];
  for (let k = 2; k < n - 1; k++) fan.push([hub, k, k + 1]);
  fan.push([hub, n - 1, 0]);
  const area = ([a, b, c]) => (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) - (poly[b][1] - poly[a][1]) * (poly[c][0] - poly[a][0]);
  if (!fan.every(f => area(f) > 1e-9)) return null;

  // ebene Flächen: die beiden Seiten (Fächer) und je Kante des Vielecks ein Rechteck
  const faces = [[], []];
  for (const [a, b, c] of fan) {
    faces[0].push(...oriented(at(poly[a], w / 2), at(poly[b], w / 2), at(poly[c], w / 2), [v[0], v[1], 0]));
    faces[1].push(...oriented(at(poly[a], -w / 2), at(poly[b], -w / 2), at(poly[c], -w / 2), [-v[0], -v[1], 0]));
  }
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const dir = [(q[1] - p[1]) * u[0], (q[1] - p[1]) * u[1], -(q[0] - p[0])];   // nach außen: (dz, −dρ) in (ρ, z)
    const a = at(p, w / 2), b = at(q, w / 2), c = at(q, -w / 2), d = at(p, -w / 2);
    faces.push([...oriented(a, b, c, dir), ...oriented(a, c, d, dir)]);
  }
  return faces;
}

/**
 * Rippen zu einem aufgelösten Flansch.
 * @param surfaces  Flächen des Außenkörpers der Schale (surfacesOf), ab z = Plattendicke
 * @param layout    flangeLayout-Ergebnis mit ribs { thickness, length }
 * @param nRim      Ecken des Flanschrands (res.flange)
 * @param wall      Wandstärke der Schale [mm]
 * @param rimRound  Verrundung des Flanschrands auf der Hornseite [mm]: die Rippen enden davor
 * @returns {{ surfaces: object[], shapes: { phi, poly }[], overlap: number, count: number, length: number }}
 *   surfaces: je Rippe ein geschlossener Körper (section "flansch"); overlap: Volumen [mm³], das
 *   die Rippen in Platte und Wand hinein überlappen; length: kürzeste wirksame Länge entlang des
 *   Horns [mm] (0 ohne Rippen); count: erzeugte Rippen; shapes: Winkel φ [rad] und Vieleck [[ρ, z], …]
 *   je Rippe (für die Zeichnung)
 */
export function flangeRibs(surfaces, layout, nRim, wall, rimRound = 0) {
  const { ribs, holes, thickness: th } = layout;
  const none = { surfaces: [], shapes: [], overlap: 0, count: 0, length: 0 };
  const w = ribs?.thickness, count = holes?.count;
  if (!(w > 0) || !(ribs.length > RIB_START) || !(count > 0)) return none;

  const rim = (layout.diameter / 2 - rimRound) * Math.cos(Math.PI / nRim);   // Flanschrand (vor der Verrundung): einbeschriebener Kreis
  const rEnd = Math.sqrt(Math.max(0, rim ** 2 - (w / 2) ** 2)) - 0.05;
  const dPlate = Math.min(RIB_EMBED_PLATE, th / 2);
  const tris = surfaceTriangles(surfaces);
  const levels = Array.from({ length: RIB_SAMPLES + 1 }, (_, k) => th + RIB_START + (ribs.length - RIB_START) * k / RIB_SAMPLES);
  const slices = levels.map(z => sliceSegments(tris, z));

  const out = [], shapes = [];
  let overlap = 0, shortest = Infinity;
  for (let i = 0; i < count; i++) {
    const phi = (holes.angle + 360 * (i + 0.5) / count) * Math.PI / 180;
    const c = Math.cos(phi), s = Math.sin(phi);
    const reach = [];
    for (const segs of slices) {
      const rho = rayReach(segs, c, s);
      if (rho === null || rho > rEnd - RIB_TOP_MARGIN) break;
      reach.push(rho);
    }
    const K = reach.length - 1;
    if (K < 2) { shortest = 0; continue; }
    // Seitlich weicht die Wand zurück (gerundete Ecke): die Einbettung muss auch an den Seiten der Rippe
    // bis in die Wand reichen. Wand in 5 Abständen quer zur Rippe messen (side = −hw … hw).
    const hw = w / 2, sides = [-1, -0.5, 0, 0.5, 1].map(f => f * hw);
    const wallAt = sides.map(side => reach.map((rho, k) => rayReach(slices[k], c, s, side) ?? rho));   // [Seite][Stufe]
    const e0 = Math.min(RIB_EMBED_WALL, 0.4 * wall);
    const embed = reach.map((rho, k) => Math.min(e0 + Math.max(0, rho - Math.min(wallAt[0][k], wallAt[4][k])), 0.95 * wall));
    const inner = reach.map((rho, k) => [rho - embed[k], k === 0 ? th : levels[k]]);   // von der Platte nach oben
    const zb = th - dPlate;
    // gegen den Uhrzeigersinn: Ende unten, Ende oben (= Plattenfläche), Spitze, Innenkante nach unten, Boden
    const poly = [[rEnd, zb], [rEnd, th], ...inner.slice().reverse(), [inner[0][0], zb]];
    const solid = extrude(poly, phi, w);
    if (!solid) { shortest = 0; continue; }
    shapes.push({ phi, poly });
    out.push({ name: `flangeRib${i}`, section: "flansch", oriented: true, rib: true, triangles: solid.flat(), faces: solid });
    // Überlapp mit Platte und Wand: Platte unter der Plattenfläche, Wand über Stufen und Breite (Trapez)
    const widthAt = (k, j) => Math.max(0, wallAt[j][k] - inner[k][0]);
    const across = k => hw / 2 * (widthAt(k, 0) / 2 + widthAt(k, 1) + widthAt(k, 2) + widthAt(k, 3) + widthAt(k, 4) / 2);
    let wallOverlap = 0;
    for (let k = 0; k < K; k++) wallOverlap += (inner[k + 1][1] - inner[k][1]) * (across(k) + across(k + 1)) / 2;
    overlap += wallOverlap + w * (rEnd - inner[0][0]) * dPlate;
    shortest = Math.min(shortest, levels[K] - th);
  }
  return { surfaces: out, shapes, overlap, count: out.length, length: out.length ? shortest : 0 };
}
