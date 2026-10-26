// STEP-Export (ISO 10303-21, AP214): geschlossener Volumenkörper aus glatten B-Spline-Flächen.
//
// Jede Gitterfläche des Körpers (horn-mesh.js) wird eine B-Spline-Fläche exakt durch ihre
// Gitterpunkte (ebene Gitter: PLANE). Die Kanten sind die Ränder der Gitter: Nachbarflächen teilen
// sich dort exakt dieselben Randpunkte, eine Kante wird daran erkannt und als B-Spline-Kurve durch
// diese Punkte einmal geschrieben. Fläche und Kante gehen durch dieselben Punkte, liegen
// dazwischen aber nur innerhalb einer kleinen Toleranz aufeinander (eigene Parametrisierung).
//
// Achsen wie beim STL: X = Breite, Y = Hornachse, Z = Höhe, mm.
import { fitBSpline, fitBSplineSurface } from "./bspline.js";
import { hornGeometry } from "./stl.js";
import { triangulate } from "../horn-mesh.js";
import { downloadFile } from "./download.js";

const toCad = ([x, h, z]) => [x, z, h];
const KEY_DIGITS = 5;     // Rundung für das Wiedererkennen gemeinsamer Punkte [mm]
const SAME = 1e-7;        // Punkte gelten als gleich [mm]
const PLANAR = 1e-4;      // größter Abstand zur Ebene für eine PLANE [mm]

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const same = (a, b) => Math.abs(a[0] - b[0]) < SAME && Math.abs(a[1] - b[1]) < SAME && Math.abs(a[2] - b[2]) < SAME;
const key = p => p.map(c => (Math.abs(c) < 0.5 * 10 ** -KEY_DIGITS ? 0 : c).toFixed(KEY_DIGITS)).join(",");

/** Aufeinanderfolgende doppelte Zeilen und Spalten entfernen (zusammenfallende Gitterzeilen). */
function cleanGrid(grid) {
  const rows = grid.filter((row, i) => i === 0 || !row.every((p, j) => same(p, grid[i - 1][j])));
  const keep = rows[0].map((_, j) => j === 0 || !rows.every(row => same(row[j], row[j - 1])));
  return rows.map(row => row.filter((_, j) => keep[j]));
}

const ON_CIRCLE = 1e-6;   // größter Abstand zum Kreis bzw. Zylinder für CIRCLE / CYLINDRICAL_SURFACE [mm]
const unit = v => { const l = Math.hypot(...v); return v.map(x => x / l); };

/**
 * Kreis durch alle Punkte (mindestens 5, in einer Ebene, alle im Abstand r vom Mittelpunkt) oder
 * null. normal so, dass die Punkte gegen den Uhrzeigersinn um sie laufen; ref zeigt zum ersten Punkt.
 */
export function circleOf(pts) {
  if (pts.length < 5) return null;
  const n = pts.length, a = pts[0], b = pts[Math.floor(n / 3)], c = pts[Math.floor(2 * n / 3)];
  const ab = sub(b, a), ac = sub(c, a), w = cross(ab, ac), ww = dot(w, w);
  if (!(ww > 1e-12 * dot(ab, ab) * dot(ac, ac))) return null;   // kollinear
  // Umkreismittelpunkt: a + ((|ac|²·(w × ab)) + (|ab|²·(ac × w))) / (2|w|²)
  const t1 = cross(w, ab).map(x => x * dot(ac, ac)), t2 = cross(ac, w).map(x => x * dot(ab, ab));
  const center = a.map((x, k) => x + (t1[k] + t2[k]) / (2 * ww));
  const r = Math.hypot(...sub(a, center));
  let normal = unit(w);
  if (!pts.every(p => Math.abs(Math.hypot(...sub(p, center)) - r) < ON_CIRCLE && Math.abs(dot(sub(p, center), normal)) < ON_CIRCLE)) return null;
  if (dot(cross(sub(pts[0], center), sub(pts[1], center)), normal) < 0) normal = normal.map(v => -v);
  return { center, normal, r, ref: unit(sub(pts[0], center)) };
}

/**
 * Zylinder durch ein Gitter aus zwei gleich großen Kreisbögen auf gemeinsamer Achse (Flanschrand,
 * Bohrungen, Mundflächen) oder null. sameSense: Außenrichtung der Fläche zeigt von der Achse weg.
 */
function cylinderOf(grid) {
  const arcs = grid.length === 2 ? [grid[0], grid[1]] : grid[0].length === 2 ? [grid.map(r => r[0]), grid.map(r => r[1])] : null;
  if (!arcs) return null;
  const [c0, c1] = arcs.map(circleOf);
  if (!c0 || !c1 || Math.abs(c0.r - c1.r) > ON_CIRCLE || Math.abs(Math.abs(dot(c0.normal, c1.normal)) - 1) > 1e-9) return null;
  const d = sub(c1.center, c0.center);
  if (Math.hypot(...cross(d, c0.normal)) > ON_CIRCLE) return null;   // Mittelpunkte nicht auf einer Achse
  // Außenrichtung (Su × Sv der ersten Zelle) gegen die radiale Richtung
  const p = grid[0][0], n = cross(sub(grid[0][1], grid[1][0]), sub(grid[1][1], p));
  const radial = sub(p, c0.center).map((x, k) => x - dot(sub(p, c0.center), c0.normal) * c0.normal[k]);
  return { center: c0.center, axis: c0.normal, ref: unit(radial), r: c0.r, sameSense: dot(n, radial) > 0 };
}

const transpose = grid => grid[0].map((_, j) => grid.map(row => row[j]));
const dedupe = pts => pts.filter((p, k) => k === 0 || !same(p, pts[k - 1]));

/**
 * Gitter an Zeilen teilen, die auf einen Punkt zusammenfallen (Pol): Rundungsstreifen mit
 * Radius 0 am Ende des Übergangs rund → eckig – dort hat der Streifen keine Fläche mehr. Stücke
 * aus nur Polzeilen entfallen; jedes andere Stück hat höchstens an seinen Enden einen Pol.
 */
function splitAtPoles(grid) {
  const pole = row => row.every(p => same(p, row[0]));
  const pieces = [];
  let from = 0;
  for (let i = 1; i < grid.length; i++) {
    if (pole(grid[i]) || i === grid.length - 1) {
      const piece = grid.slice(from, i + 1);
      if (!piece.every(pole)) pieces.push(piece);
      from = i;
    }
  }
  return pieces;
}

/** Gitterflächen (ggf. mehrere, siehe splitAtPoles): aufräumen, nach außen ausrichten, Ränder. */
function gridFaces(patch) {
  const pieces = splitAtPoles(cleanGrid(patch.grid)).flatMap(g => splitAtPoles(transpose(g)).map(transpose));
  return pieces.map((grid, k) => gridFace({ ...patch, name: pieces.length > 1 ? `${patch.name}.${k}` : patch.name }, cleanGrid(grid)));
}

/** Eine Gitterfläche; null ohne Ausdehnung. outward: Punkt ↦ Außenrichtung oder fester Vektor (direction). */
function gridFace({ name, outward, direction }, grid) {
  if (grid.length < 2 || grid[0].length < 2) return null;
  // Orientierung: Normale Su × Sv (u entlang der Spalten, v entlang der Zeilen) nach außen
  let flux = 0, area = [0, 0, 0];
  for (let i = 0; i < grid.length - 1; i++) {
    for (let j = 0; j < grid[i].length - 1; j++) {
      const a = grid[i][j], c = grid[i + 1][j + 1];
      // (b − d) × (c − a) = 2·Su × Sv der Zelle, über die Diagonalen auch an Polen
      const n = cross(sub(grid[i][j + 1], grid[i + 1][j]), sub(c, a));
      const m = [0, 1, 2].map(k => (a[k] + c[k]) / 2);
      if (outward) flux += dot(n, outward(m));
      area = [area[0] + n[0], area[1] + n[1], area[2] + n[2]];
    }
  }
  if (!outward) flux = dot(area, direction);
  if (flux === 0) return null;
  if (flux < 0) { grid = transpose(grid); area = area.map(v => -v); }   // Transponieren dreht die Normale um

  // Randschleife gegen den Uhrzeigersinn im (u, v)-Parameterraum; zusammengefallene Seite (Pol)
  // entfällt. dir/reverse: welche Flächenparameter der Rand trägt (siehe buildBrep)
  const last = grid.length - 1, lastCol = grid[0].length - 1;
  const sides = [
    { pts: grid[0], dir: "u", reverse: false },
    { pts: grid.map(row => row[lastCol]), dir: "v", reverse: false },
    { pts: [...grid[last]].reverse(), dir: "u", reverse: true },
    { pts: grid.map(row => row[0]).reverse(), dir: "v", reverse: true },
  ].filter(({ pts }) => dedupe(pts).length > 1);
  return { name, grid, planar: planeOf(grid.flat(), area), outer: { sides }, holes: [] };
}

/**
 * Ebene Dreiecksfläche (Ringe, Stirnflächen): Ränder aus den Dreieckskanten, die nur einmal
 * vorkommen – mit nach außen orientierten Dreiecken läuft der Außenrand gegen, ein Lochrand im
 * Uhrzeigersinn um die Normale. Größte Schleife = Außenrand. corners: jeder Randpunkt ist eine
 * Ecke (ebene Vielecke wie die Rippen; sonst müssten Nachbarflächen ihre Ecken schon kennen).
 */
function triangleFace({ name, triangles, corners = false }) {
  const tris = triangles.filter(([a, b, c]) => !same(a, b) && !same(b, c) && !same(c, a));
  const directed = new Map();
  for (const t of tris) for (let k = 0; k < 3; k++) directed.set(key(t[k]) + ";" + key(t[(k + 1) % 3]), t[k]);
  const next = new Map();
  for (const [k, a] of directed) {
    const [ka, kb] = k.split(";");
    if (!directed.has(kb + ";" + ka)) next.set(ka, { a, kb });
  }
  const loops = [];
  while (next.size) {
    const [start] = next.keys();
    const loop = [];
    for (let k = start; next.has(k);) { const { a, kb } = next.get(k); next.delete(k); loop.push(a); k = kb; }
    loops.push(loop);
  }
  let area = [0, 0, 0];
  for (const [a, b, c] of tris) { const n = cross(sub(b, a), sub(c, a)); area = [area[0] + n[0], area[1] + n[1], area[2] + n[2]]; }
  const planar = planeOf(tris.flat(), area);
  if (!planar) throw new Error(`STEP: gekrümmte Dreiecksfläche noch nicht unterstützt (${name})`);
  const size = loop => Math.abs(dot(loop.reduce((s, p, i) => {
    const n = cross(p, loop[(i + 1) % loop.length]);
    return [s[0] + n[0], s[1] + n[1], s[2] + n[2]];
  }, [0, 0, 0]), planar.normal));
  loops.sort((x, y) => size(y) - size(x));
  return { name, planar, corners, outer: { loop: loops[0] }, holes: loops.slice(1).map(loop => ({ loop })) };
}

/** Ebene durch die Punkte (Normale aus der Flächensumme) oder null. */
function planeOf(pts, area) {
  const len = Math.hypot(...area);
  if (!(len > 0)) return null;
  const normal = area.map(v => v / len);
  const origin = [0, 1, 2].map(k => pts.reduce((s, p) => s + p[k], 0) / pts.length);
  return pts.every(p => Math.abs(dot(sub(p, origin), normal)) < PLANAR) ? { origin, normal } : null;
}

/**
 * Topologie: Flächen mit Randschleifen, Kanten, Ecken. Ecken sind die Gitterecken aller Flächen;
 * jeder Rand wird an jeder Ecke geteilt, die auf ihm liegt (T-Stöße, z.B. die Naht des äußeren
 * Traktrix-Deckels, an die Eckstreifen und gerader Bereich anschließen; Ränder von
 * Dreiecksflächen). Eine Kante = gleiche Punktfolge, vorwärts oder rückwärts.
 * @param patches  [{ name, grid, outward | direction } | { name, triangles (nach außen orientiert) }]
 * @returns {{ faces: { name, grid?, fit?, planar, cylinder, bounds: { edge, forward }[][] }[], edges, vertices, problems: string[] }}
 *   edges[].circle / faces[].cylinder: analytisch erkannt (circleOf, cylinderOf), sonst null
 *   bounds[0] Außenrand, weitere: Löcher. problems: Kanten, die nicht genau zweimal gegenläufig
 *   vorkommen (Körper nicht geschlossen)
 */
export function buildBrep(patches) {
  const raw = patches.flatMap(p => p.grid ? gridFaces(p) : [triangleFace(p)]).filter(Boolean);

  const vertices = new Map(), edges = new Map();
  const vertex = p => {
    const k = key(p);
    if (!vertices.has(k)) vertices.set(k, { id: vertices.size, point: p });
    return vertices.get(k);
  };
  for (const f of raw) for (const { pts } of f.outer.sides ?? []) { vertex(pts[0]); vertex(pts[pts.length - 1]); }
  for (const f of raw) if (f.corners) for (const { loop } of [f.outer, ...f.holes]) loop.forEach(vertex);

  // Kante mit Parametern der ersten gekrümmten Fläche daran: Randkurve der Fläche, wenn der Rand
  // ungeteilt ist, sonst nahe daran (ohne: Sehnenlänge, Abweichung zur Fläche bis ≈ 0,01 mm)
  const useEdge = ({ pts, params }) => {
    const k = pts.map(key).join(";"), kr = [...pts].reverse().map(key).join(";");
    const take = (e, forward) => {
      e.uses.push(forward);
      if (!e.params && params) e.params = forward ? params : params.map(x => 1 - x).reverse();
      return { edge: e, forward };
    };
    if (edges.has(k)) return take(edges.get(k), true);
    if (edges.has(kr)) return take(edges.get(kr), false);
    const e = { id: edges.size, points: pts, params: null, start: vertex(pts[0]), end: vertex(pts[pts.length - 1]), uses: [] };
    edges.set(k, e);
    return take(e, true);
  };
  // offener Zug: doppelte Punkte weg, an inneren Ecken teilen, Parameter je Teil auf 0 … 1
  const splitPath = ({ pts: all, params: allParams }) => {
    const idx = all.map((_, k) => k).filter(k => k === 0 || !same(all[k], all[k - 1]));
    const pts = idx.map(k => all[k]), params = allParams && idx.map(k => allParams[k]);
    const parts = [];
    let from = 0;
    for (let k = 1; k < pts.length; k++) {
      if (k === pts.length - 1 || vertices.has(key(pts[k]))) {
        const t = params?.slice(from, k + 1);
        parts.push({ pts: pts.slice(from, k + 1), params: t && t.map(x => (x - t[0]) / (t[t.length - 1] - t[0])) });
        from = k;
      }
    }
    return parts;
  };
  // geschlossene Schleife (ohne wiederholten Startpunkt): ab der ersten Ecke teilen
  const splitLoop = loop => {
    let first = loop.findIndex(p => vertices.has(key(p)));
    if (first < 0) { vertex(loop[0]); first = 0; }
    return splitPath({ pts: [...loop.slice(first), ...loop.slice(0, first), loop[first]] });
  };
  const bound = b => (b.sides ? b.sides.flatMap(splitPath) : splitLoop(b.loop)).map(useEdge);

  // Gekrümmte Gitterflächen geben ihren Rändern die Flächenparameter mit. Gibt es für einen
  // ungeteilten Rand schon eine Kante mit Parametern (gleiche Punktzahl), übernimmt die Fläche
  // diese für die Richtung – dann passen beide Flächen an der Kante genau (z.B. Eckstreifen am
  // geraden Bereich: dieselben Zeilen). Reihenfolge: große Flächen, dann Regelflächen (2 Zeilen
  // oder Spalten, z.B. senkrechte Wände – Parameter in Längsrichtung frei), ebene zuletzt.
  const ruled = f => f.grid.length === 2 || f.grid[0].length === 2;
  const rank = f => !f.grid || f.planar ? 2 : ruled(f) ? 1 : 0;
  const existing = pts => {
    const d = dedupe(pts), k = d.map(key).join(";"), kr = [...d].reverse().map(key).join(";");
    if (edges.get(k)?.params) return edges.get(k).params;
    if (edges.get(kr)?.params) return edges.get(kr).params.map(x => 1 - x).reverse();
    return null;
  };
  const faces = new Array(raw.length);
  const size = f => f.grid ? f.grid.length * f.grid[0].length : 0;
  for (const i of raw.map((_, i) => i).sort((a, b) => rank(raw[a]) - rank(raw[b]) || size(raw[b]) - size(raw[a]))) {
    const f = raw[i];
    let fit = null;
    if (rank(f) < 2) {
      const imposed = {};
      for (const dir of ["u", "v"]) {
        const known = f.outer.sides.filter(sd => sd.dir === dir).map(sd => {
          const t = existing(sd.pts);
          return t && (sd.reverse ? t.map(x => 1 - x).reverse() : t);
        }).filter(t => t && t.length === (dir === "u" ? f.grid[0].length : f.grid.length));
        if (known.length) imposed[dir] = known[0].map((_, k) => known.reduce((s, t) => s + t[k], 0) / known.length);
      }
      fit = fitBSplineSurface(f.grid, imposed);
      for (const sd of f.outer.sides) {
        const t = fit.params[sd.dir];
        sd.params = sd.reverse ? t.map(x => 1 - x).reverse() : t;
      }
    }
    faces[i] = { name: f.name, grid: f.grid, fit, planar: f.planar, bounds: [f.outer, ...f.holes].map(bound) };
  }

  for (const e of edges.values()) e.circle = circleOf(e.points);
  for (const f of faces) f.cylinder = !f.planar && f.grid ? cylinderOf(f.grid) : null;

  const problems = [];
  for (const e of edges.values()) {
    if (e.uses.length !== 2 || e.uses[0] === e.uses[1]) problems.push(`Kante ${e.id}: ${e.uses.length}× (${e.uses.join(",")})`);
  }
  return { faces, edges: [...edges.values()], vertices: [...vertices.values()], problems };
}

/**
 * Flächen des geschlossenen Körpers in CAD-Achsen: Gitterflächen und ebene Dreiecksflächen.
 * Rundungsstreifen (runder Throat, gerundete Kanten) haben ein Gitter und fertig orientierte
 * Dreiecke: ihre Außenrichtung ist die Summe der Dreiecksnormalen.
 */
export function hornPatches(design) {
  return patchesOf(hornGeometry(design).surfaces);
}

/** Flächen des Körpers ohne die Rippen (surfaces aus hornGeometry), in CAD-Achsen. */
function patchesOf(surfaces) {
  return surfaces.filter(f => !f.rib).map(f => {
    // nach außen orientiert; der Achsentausch spiegelt, deshalb Umlaufrichtung tauschen
    const triangles = () => triangulate(f).map(([a, b, c]) => [a, c, b].map(toCad));
    if (!f.grid) return { name: f.name, triangles: triangles() };
    const grid = f.grid.map(row => row.map(toCad));
    if (f.outward) return { name: f.name, grid, outward: p => toCad(f.outward(toCad(p))) };   // toCad ist seine eigene Umkehrung
    const direction = triangles().reduce((s, [a, b, c]) => {
      const n = cross(sub(b, a), sub(c, a));
      return [s[0] + n[0], s[1] + n[1], s[2] + n[2]];
    }, [0, 0, 0]);
    return { name: f.name, grid, direction };
  });
}

/** Flächen der Stützrippen (ribPatchesOf) zum Entwurf. */
export const ribPatches = design => ribPatchesOf(hornGeometry(design).surfaces);

/**
 * Stützrippen des Flanschs (flange-ribs.js): je Rippe die Flächen eines eigenen geschlossenen
 * Körpers (ebene Vielecke), in CAD-Achsen. Sie durchdringen Platte und Wand ein Stück; das CAD
 * verschmilzt sie bei Bedarf.
 */
function ribPatchesOf(surfaces) {
  return surfaces.filter(f => f.rib).map(f => f.faces.map((tris, k) => ({
    name: `${f.name}.${k}`, corners: true, triangles: tris.map(([a, b, c]) => [a, c, b].map(toCad)),
  })));
}

// ---------------------------------------------------------------------------------------------
// Schreiben (Part 21)

/** STEP-Zahl: immer mit Dezimalpunkt, ohne Exponent, ohne unnötige Nullen. */
function real(x, digits = 6) {
  let s = (Math.abs(x) < 0.5 * 10 ** -digits ? 0 : x).toFixed(digits);
  s = s.replace(/0+$/, "");
  return s;
}

/** Knotenvektor → verschiedene Knoten und Vielfachheiten. */
function knotGroups(U) {
  const knots = [], mults = [];
  for (const u of U) {
    if (knots.length && u === knots[knots.length - 1]) mults[mults.length - 1]++;
    else { knots.push(u); mults.push(1); }
  }
  return { knots, mults };
}

const str = s => `'${String(s).replace(/'/g, "''")}'`;
const list = items => `(${items.join(",")})`;

/**
 * STEP-Datei (AP214) aus einem B-Rep (buildBrep) oder einer Liste davon (je ein geschlossener Körper;
 * der erste trägt den Namen, die weiteren – die Rippen – "Name Rippe n").
 * @param model  brep | brep[]
 * @param {{ name?: string, fileName?: string, date?: string, author?: string }} meta
 */
export function stepFile(model, { name = "Radialhorn", fileName = "radialhorn.step", date = new Date().toISOString().slice(0, 19), author = "" } = {}) {
  const breps = Array.isArray(model) ? model : [model];
  const lines = [];
  let next = 1;
  const add = text => { const id = next++; lines.push(`#${id}=${text};`); return `#${id}`; };
  const point = p => add(`CARTESIAN_POINT('',${list(p.map(c => real(c)))})`);
  const direction = d => add(`DIRECTION('',${list(d.map(c => real(c, 12)))})`);

  const ctx = add("APPLICATION_CONTEXT('automotive design')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ctx})`);
  const pctx = add(`PRODUCT_CONTEXT('',${ctx},'mechanical')`);
  const product = add(`PRODUCT(${str(name)},${str(name)},'',(${pctx}))`);
  add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${product}))`);
  const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',${product})`);
  const pdctx = add(`PRODUCT_DEFINITION_CONTEXT('part definition',${ctx},'design')`);
  const pd = add(`PRODUCT_DEFINITION('design','',${pdf},${pdctx})`);
  const pds = add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
  const mm = add("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))");
  const rad = add("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))");
  const sr = add("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())");
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-3),${mm},'distance_accuracy_value','confusion accuracy')`);
  const gctx = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr}))REPRESENTATION_CONTEXT('',''))`);

  const writeSolid = (brep, solidName) => {
    const vertexRef = new Map(brep.vertices.map(v => [v, add(`VERTEX_POINT('',${point(v.point)})`)]));
    const placement3 = (origin, axis, ref) => add(`AXIS2_PLACEMENT_3D('',${point(origin)},${direction(axis)},${direction(ref)})`);
    const edgeRef = new Map(brep.edges.map(e => {
      if (e.circle) {
        const { center, normal, ref, r } = e.circle;
        const curve = add(`CIRCLE('',${placement3(center, normal, ref)},${real(r)})`);
        return [e, add(`EDGE_CURVE('',${vertexRef.get(e.start)},${vertexRef.get(e.end)},${curve},.T.)`)];
      }
      const fit = fitBSpline(e.points, e.params);
      const { knots, mults } = knotGroups(fit.knots);
      const cps = fit.controlPoints.map(point);
      const curve = add(`B_SPLINE_CURVE_WITH_KNOTS('',${fit.degree},${list(cps)},.UNSPECIFIED.,.F.,.F.,${list(mults)},${list(knots.map(k => real(k, 12)))},.UNSPECIFIED.)`);
      return [e, add(`EDGE_CURVE('',${vertexRef.get(e.start)},${vertexRef.get(e.end)},${curve},.T.)`)];
    }));

    const faceRefs = brep.faces.map(face => {
      let surface, sense = true;
      if (face.cylinder) {
        const { center, axis, ref, r, sameSense } = face.cylinder;
        surface = add(`CYLINDRICAL_SURFACE('',${placement3(center, axis, ref)},${real(r)})`);
        sense = sameSense;
      } else if (face.planar) {
        const { origin, normal } = face.planar;
        const helper = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const ref = cross(cross(normal, helper), normal);
        const l = Math.hypot(...ref);
        const axis = add(`AXIS2_PLACEMENT_3D('',${point(origin)},${direction(normal)},${direction(ref.map(v => v / l))})`);
        surface = add(`PLANE('',${axis})`);
      } else {
        const fit = face.fit ?? fitBSplineSurface(face.grid);
        const ku = knotGroups(fit.knotsU), kv = knotGroups(fit.knotsV);
        // STEP: control_points_list[u][v]
        const cp = fit.controlPoints[0].map((_, j) => list(fit.controlPoints.map(row => point(row[j]))));
        surface = add(`B_SPLINE_SURFACE_WITH_KNOTS('',${fit.degreeU},${fit.degreeV},${list(cp)},.UNSPECIFIED.,.F.,.F.,.F.,` +
          `${list(ku.mults)},${list(kv.mults)},${list(ku.knots.map(k => real(k, 12)))},${list(kv.knots.map(k => real(k, 12)))},.UNSPECIFIED.)`);
      }
      const bounds = face.bounds.map((loop, k) => {
        const oriented = loop.map(({ edge, forward }) => add(`ORIENTED_EDGE('',*,*,${edgeRef.get(edge)},${forward ? ".T." : ".F."})`));
        const ref = add(`EDGE_LOOP('',${list(oriented)})`);
        return add(`${k === 0 ? "FACE_OUTER_BOUND" : "FACE_BOUND"}('',${ref},.T.)`);
      });
      return add(`ADVANCED_FACE(${str(face.name)},${list(bounds)},${surface},${sense ? ".T." : ".F."})`);
    });

    const shell = add(`CLOSED_SHELL('',${list(faceRefs)})`);
    return add(`MANIFOLD_SOLID_BREP(${str(solidName)},${shell})`);
  };
  const solids = breps.map((b, k) => writeSolid(b, k === 0 ? name : `${name} Rippe ${k}`));
  const placement = add(`AXIS2_PLACEMENT_3D('',${point([0, 0, 0])},${direction([0, 0, 1])},${direction([1, 0, 0])})`);
  const rep = add(`ADVANCED_BREP_SHAPE_REPRESENTATION(${str(name)},(${placement},${solids.join(",")}),${gctx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);

  return [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION((${str(name)}),'2;1');`,
    `FILE_NAME(${str(fileName)},${str(date)},(${str(author)}),(''),'radialhorn','radialhorn','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    "ENDSEC;",
    "DATA;",
    ...lines,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}

/** Körper prüfen: wirft, wenn eine Kante nicht genau zweimal vorkommt (Körper nicht geschlossen). */
function closedBrep(patches, what) {
  const brep = buildBrep(patches);
  if (brep.problems.length) throw new Error(`STEP: ${what} nicht geschlossen – ${brep.problems.slice(0, 5).join("; ")}`);
  return brep;
}

/**
 * STEP-Inhalt: der geschlossene Körper, bei Stützrippen am Flansch dazu je Rippe ein eigener
 * geschlossener Körper; wirft bei einem offenen Körper.
 */
export function hornStep(design, meta) {
  const { surfaces } = hornGeometry(design);
  const body = closedBrep(patchesOf(surfaces), "Körper");
  const ribs = ribPatchesOf(surfaces).map((patches, k) => closedBrep(patches, `Rippe ${k + 1}`));
  return stepFile([body, ...ribs], meta);
}

export function exportSTEP(design) {
  const { s, rt, wall = 0 } = design;
  const kind = wall > 0 ? `schale_${wall}mm${design.flange ? "_flansch" : ""}` : "luftvolumen";
  const fname = `radialhorn_${Math.round(s.openingAngle)}deg_L${Math.round(design.L)}_T${(rt * 2).toFixed(0)}mm_${kind}.step`;
  return downloadFile(() => hornStep(design, { fileName: fname }), fname, "model/step");
}
