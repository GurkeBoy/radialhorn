// Lamellen: dünne senkrechte Platten im Horn, die die Wellenfront in Sektoren teilen und den Schall weiter streuen.
//
// Eine Lamelle folgt den Wellenfronten der Draufsicht (horn-math.js, wavefrontAt): in jedem Querschnitt ein Kreisbogen
// mit Halbwinkel θ, den sie im festen Winkelverhältnis f = φ/α teilt – ihr Punkt liegt bei ψ = f·θ auf dem Bogen. So steht
// sie der Wellenfront überall senkrecht und teilt sie in gleiche Anteile. Im geraden Bereich der Wand (Bogen um den Fokus,
// θ = α) ist das ein Strahl vom Fokus unter dem Winkel φ = f·α; im Eingang (Traktrix, Klothoide, Bogen) läuft sie
// gekrümmt vom Throat dorthin. n Lamellen teilen jede Wellenfront in n + 1 gleiche Winkel: fᵢ = −1 + 2·i/(n + 1).
//
// Die Wellenfronten werden durch ihre Achsenstelle z (der Bogen schneidet die Hornachse bei z) gekennzeichnet – das Maß
// „z“ der Regler. Die Hornbreite an der Wellenfront ist 2·xWall (Sehne zwischen den Wänden), die lichte Kanalbreite
// zwischen zwei Lamellen 2·R·sin(θ/(n + 1)) − Dicke.
//
// Die Höhe jeder Lamelle (Boden und Deckel des Luftkanals an ihrer Stelle) wird aus dem Netz des Luftvolumens gelesen
// (senkrechter Strahl durch die Mittellinie): Verrundungen, runder Throat, Klothoide und gerundete Mundecken gelten ohne
// eigene Formel. Oben und unten reicht die Lamelle ein Stück in die Wand hinein, damit Slicer und CAD die Teile
// verschmelzen; dieser Überlapp wird im Volumen herausgerechnet.
//
// Koordinaten wie horn-mesh.js: [x, h, z], Ursprung auf der Hornachse in der Throat-Ebene.
import { surfaceTriangles } from "./flange-ribs.js";
import { wavefrontAtAxis } from "./horn-math.js";

export const VANE_START_MODES = ["z", "width", "channel"];
export const VANE_END_MODES = ["mouth", "z", "channel"];

const MIN_LENGTH = 5;          // kürzeste Lamelle (Unterschied der Achsenstellen) [mm]
const MIN_CHANNEL = 1;         // kleinste lichte Kanalbreite am Beginn [mm]
export const TIP_WIDTH = 0.4;         // Breite der Spitze [mm]: eine Düsenbahn, so schmal druckt ein 0,4-mm-Drucker noch sauber
export const TIP_MAX_SHARE = 0.4;     // eine Spitze nimmt höchstens diesen Anteil der Lamellenlänge ein
export const VANE_SAMPLES = 32;       // Stützstellen entlang der Lamelle
const EMBED_MAX = 3;           // Eintauchtiefe in die Wand, höchstens [mm]
const EMBED_FRACTION = 0.4;    // … und höchstens dieser Anteil der Wandstärke
const SAME_NORMAL = 1e-9;      // Normalen gelten als gleich (ebene Fläche)
const BISECTIONS = 60;
const LIMIT_TOLERANCE = 0.5;   // so weit darf ein Maß außerhalb des Bereichs liegen, ohne dass eine Begrenzung gemeldet wird [mm]

/** Anteile fᵢ der Lamellen am Halbwinkel der Wellenfront, symmetrisch zur Achse. */
const fractions = n => Array.from({ length: n }, (_, i) => -1 + 2 * (i + 1) / (n + 1));

/** Maße der Wellenfront bei der Achsenstelle zAxis: Hornbreite und lichte Kanalbreite zwischen zwei Lamellen. */
function measures(s, n, thickness, zAxis) {
  const w = wavefrontAtAxis(s, zAxis);
  return { w, width: 2 * w.xWall, channel: 2 * w.radius * Math.sin(w.halfAngle / (n + 1)) - thickness };
}

/**
 * Achsenstelle zu einem Maß (alle wachsen mit z): z selbst, Hornbreite oder lichte Kanalbreite – gesucht per Halbieren,
 * auf den Bereich [lo0, hi0] begrenzt. limited: das Maß lag merklich außerhalb.
 */
function axisOf(s, n, thickness, mode, value, [lo0, hi0, floor]) {
  // z-Maß: alles von der Throat-Ebene (0) bis zur ersten Wellenfront gilt als Beginn am Throat
  if (mode === "z") return { z: Math.min(Math.max(value, lo0), hi0), limited: value < floor - LIMIT_TOLERANCE || value > hi0 + LIMIT_TOLERANCE };
  const at = z => measures(s, n, thickness, z)[mode];
  const first = at(lo0), last = at(hi0);
  if (value <= first) return { z: lo0, limited: value < first - LIMIT_TOLERANCE };
  if (value >= last) return { z: hi0, limited: value > last + LIMIT_TOLERANCE };
  let lo = lo0, hi = hi0;
  for (let i = 0; i < BISECTIONS; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    at(mid) < value ? (lo = mid) : (hi = mid);
  }
  return { z: (lo + hi) / 2, limited: false };
}

/**
 * Achsenstellen, zwischen denen eine Lamelle liegen kann: von der Throat-Wellenfront bis zum Mund, mit mindestens MIN_CHANNEL
 * lichter Breite – [von, bis, Untergrenze des z-Maßes]; die Untergrenze ist 0 (Throat-Ebene), solange die Lamellen am Throat
 * beginnen dürfen, sonst die erste zulässige Wellenfront.
 */
function axisRange(s, n, thickness) {
  const zMouth = s.zApex;
  const zThroat = wavefrontAtAxis(s, -Infinity).zAxis;
  let zMin = zThroat;
  if (measures(s, n, thickness, zMin).channel < MIN_CHANNEL) {
    let lo = zMin, hi = zMouth;
    for (let i = 0; i < BISECTIONS; i++) {
      const mid = (lo + hi) / 2;
      if (mid === lo || mid === hi) break;
      measures(s, n, thickness, mid).channel < MIN_CHANNEL ? (lo = mid) : (hi = mid);
    }
    zMin = hi;
  }
  return [zMin, zMouth, zMin === zThroat ? Math.min(0, zThroat) : zMin];
}

const MODE_VALUE = { z: (_, z) => z, width: m => m.width, channel: m => m.channel };

/**
 * Das Maß mode zur Achsenstelle zAxis (Umkehrung von resolveVanes' Eingabe, z. B. beim Wechsel der Betriebsart,
 * ohne dass sich die Lamelle ändert).
 */
export function vaneValue(s, count, thickness, mode, zAxis) {
  return MODE_VALUE[mode](measures(s, Math.round(count), thickness, zAxis), zAxis);
}

/** Zulässiger Bereich je Maß [von, bis] (Regler): vom Throat bis zum Mund. */
export function vaneRanges(s, count, thickness) {
  const n = Math.round(count), [zMin, zMax, zFloor] = axisRange(s, n, thickness);
  const range = mode => [vaneValue(s, n, thickness, mode, zMin), vaneValue(s, n, thickness, mode, zMax)];
  return { z: [zFloor, zMax], width: range("width"), channel: range("channel") };
}

/**
 * Lamellen zu einer Lösung auflösen und auf das Machbare begrenzen.
 * @param s     Lösung aus solveHorn
 * @param spec  { count, thickness, start: { mode: "z" | "width" | "channel", value }, end: { mode: "mouth" | "z" | "channel", value },
 *              tip?: { start: boolean, end: boolean, length } } – tip: Beginn/Ende laufen in der Draufsicht über length [mm] auf TIP_WIDTH zu
 *              Ende "channel": hier ist der Kanal so breit geworden, dass die Lamelle enden darf
 * @returns {object | null}  null ohne Lamellen (rundes Horn, Anzahl 0, Dicke 0); sonst
 *   { count, thickness, fractions, delta, zStart, zEnd, atThroat, widthStart, widthEnd, channelStart, channelEnd,
 *     startLimited, endLimited, ok, paths } – Winkel im Bogenmaß, Längen in mm; delta = Sektorwinkel am Mund; zStart/zEnd =
 *   Achsenstellen der ersten und letzten Wellenfront; atThroat: die Lamellen beginnen an der Throat-Wellenfront und sind
 *   bis in die Throat-Ebene (z = 0) verlängert; paths = je Lamelle die Mittellinie [[x, z], …] mit VANE_SAMPLES + 1 Punkten
 *   (atThroat: ein Punkt mehr, in der Throat-Ebene; leer, wenn nicht ok); ok = lang genug für eine Lamelle;
 *   widths = je Lamelle die Dicke an jedem Punkt des Weges; tip = { start, end, length } mit der wirksamen Spitzenlänge
 *   (mit Spitze kommen Punkte am Ende der Spitze hinzu)
 */
export function resolveVanes(s, spec) {
  if (!s || s.round || !spec || !(spec.count >= 1) || !(spec.thickness > 0)) return null;
  const n = Math.round(spec.count), t = spec.thickness, range = axisRange(s, n, t);
  const start = axisOf(s, n, t, spec.start.mode, spec.start.value, range);
  const end = spec.end.mode === "mouth" ? { z: range[1], limited: false } : axisOf(s, n, t, spec.end.mode, spec.end.value, range);
  const zStart = start.z, zEnd = end.z, ok = zEnd - zStart >= MIN_LENGTH, atThroat = zStart === range[0] && range[2] <= 0;
  const a = measures(s, n, t, zStart), b = measures(s, n, t, zEnd), f = fractions(n);

  let paths = [];
  if (ok) {
    paths = f.map(() => []);
    for (let k = 0; k <= VANE_SAMPLES; k++) {
      const { zCenter, radius, halfAngle } = k === 0 ? a.w : k === VANE_SAMPLES ? b.w : measures(s, n, t, zStart + (zEnd - zStart) * k / VANE_SAMPLES).w;
      f.forEach((fi, i) => paths[i].push([radius * Math.sin(fi * halfAngle), zCenter + radius * Math.cos(fi * halfAngle)]));
    }
    // Die Throat-Wellenfront schneidet die Achse ein paar Millimeter hinter der Throat-Ebene (r0 groß, Bogen flach): bis
    // in die Ebene verlängern, in Richtung des ersten Stücks
    if (atThroat) for (const p of paths) {
      const [x0, z0] = p[0], [x1, z1] = p[1];
      if (z0 > 1e-9) p.unshift([x0 - (x1 - x0) / ((z1 - z0) || 1) * z0, 0]);
    }
  }
  const tip = { start: !!spec.tip?.start && t > TIP_WIDTH, end: !!spec.tip?.end && t > TIP_WIDTH, length: 0 };
  let widths = paths.map(p => p.map(() => t));
  if (ok && (tip.start || tip.end) && spec.tip.length > 0) {
    let shortest = Infinity;
    paths = paths.map((p, i) => {
      const r = tapered(p, t, tip.start ? spec.tip.length : 0, tip.end ? spec.tip.length : 0);
      widths[i] = r.widths;
      shortest = Math.min(shortest, r.length);
      return r.path;
    });
    tip.length = shortest;
  }
  return {
    count: n, thickness: t, fractions: f, delta: 2 * s.alpha2 / (n + 1),
    zStart, zEnd, atThroat, widthStart: a.width, widthEnd: b.width, channelStart: a.channel, channelEnd: b.channel,
    startLimited: start.limited, endLimited: end.limited,
    ok, paths, widths, tip,
  };
}

/**
 * Weg und Dicken mit Spitzen: die Dicke läuft vom Ende über die Länge L (höchstens TIP_MAX_SHARE der Weglänge) linear von
 * TIP_WIDTH auf die volle Dicke; am Ende der Spitze kommt ein Punkt hinzu.
 * @returns {{ path, widths, length }}  length = kürzeste wirksame Spitzenlänge
 */
function tapered(path, t, startL, endL) {
  const cum = [0];
  for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]));
  const total = cum[cum.length - 1], cap = TIP_MAX_SHARE * total;
  const ls = Math.min(startL, cap), le = Math.min(endL, cap);
  const marks = [...cum];
  if (ls > 1e-6) marks.push(ls);
  if (le > 1e-6) marks.push(total - le);
  marks.sort((a, b) => a - b);
  const pts = [], widths = [];
  let seg = 0;
  for (const [i, a] of marks.entries()) {
    if (i && a - marks[i - 1] < 1e-6) continue;
    while (seg < path.length - 2 && cum[seg + 1] < a) seg++;
    const span = cum[seg + 1] - cum[seg] || 1, u = Math.min(1, Math.max(0, (a - cum[seg]) / span));
    pts.push({ a, p: [path[seg][0] + u * (path[seg + 1][0] - path[seg][0]), path[seg][1] + u * (path[seg + 1][1] - path[seg][1])] });
    widths.push(Math.min(t,
      ls > 0 ? TIP_WIDTH + (t - TIP_WIDTH) * a / ls : t,
      le > 0 ? TIP_WIDTH + (t - TIP_WIDTH) * (total - a) / le : t));
  }
  return { path: pts.map(q => q.p), widths, length: Math.min(ls || Infinity, le || Infinity) };
}

/** Normalen der Mittellinie (senkrecht zur Tangente, nach +x), aus den Nachbarpunkten; Länge 1. */
function pathNormals(path) {
  return path.map((_, k) => {
    const a = path[Math.max(0, k - 1)], b = path[Math.min(path.length - 1, k + 1)];
    const tx = b[0] - a[0], tz = b[1] - a[1], len = Math.hypot(tx, tz) || 1;
    return [tz / len, -tx / len];
  });
}

/** Umriss der Lamelle in der Draufsicht: die beiden Seitenlinien (±Dicke/2 senkrecht zur Mittellinie) [[x, z], …]; thickness: Zahl oder Dicke je Punkt. */
export function vaneOutline(path, thickness) {
  const n = pathNormals(path), h = k => (Array.isArray(thickness) ? thickness[k] : thickness) / 2;
  return {
    left: path.map(([x, z], k) => [x - h(k) * n[k][0], z - h(k) * n[k][1]]),
    right: path.map(([x, z], k) => [x + h(k) * n[k][0], z + h(k) * n[k][1]]),
  };
}

/**
 * Höchste und tiefste Höhe des Luftkanals über dem Punkt (x, z): senkrechter Strahl gegen die Dreiecke (Beleg: die
 * Dreiecke von Deckel und Boden; senkrechte Wände zählen nicht). Null, wenn der Punkt nicht über dem Kanal liegt.
 */
function heightsAt(tris, x, z) {
  let top = -Infinity, bottom = Infinity;
  const eps = 1e-9;
  for (const [A, B, C] of tris) {
    if ((x < A[0] - eps && x < B[0] - eps && x < C[0] - eps) || (x > A[0] + eps && x > B[0] + eps && x > C[0] + eps)) continue;
    if ((z < A[2] - eps && z < B[2] - eps && z < C[2] - eps) || (z > A[2] + eps && z > B[2] + eps && z > C[2] + eps)) continue;
    const d = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / d;
    const l2 = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -eps || l2 < -eps || l3 < -eps) continue;
    const h = l1 * A[1] + l2 * B[1] + l3 * C[1];
    top = Math.max(top, h);
    bottom = Math.min(bottom, h);
  }
  return top === -Infinity ? null : { top, bottom };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossOf = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Dreieck so drehen, dass seine Normale in Richtung dir zeigt; entartete (Fläche 0) entfallen. */
function oriented(a, b, c, dir) {
  const n = crossOf(sub(b, a), sub(c, a));
  if (Math.hypot(...n) < 1e-12) return [];
  return [n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] >= 0 ? [a, b, c] : [a, c, b]];
}

/** Viereck a, b, c, d (in Umlaufreihenfolge) als zwei Dreiecke, nach dir orientiert. */
const quad = (a, b, c, d, dir) => [...oriented(a, b, c, dir), ...oriented(a, c, d, dir)];

/** Rauminhalt eines geschlossenen, nach außen orientierten Dreiecksnetzes. */
function volumeOf(tris) {
  let v = 0;
  for (const [a, b, c] of tris) {
    const n = crossOf(b, c);
    v += (a[0] * n[0] + a[1] * n[1] + a[2] * n[2]) / 6;
  }
  return v;
}

/**
 * Lamellen als eigene geschlossene Körper.
 * @param s       Lösung aus solveHorn
 * @param airTris Dreiecke des Luftkanals (Flächen ohne die Kappen)
 * @param vanes   resolveVanes-Ergebnis
 * @param wall    Wandstärke [mm]
 * @returns {{ surfaces: object[], overlap: number, cavity: number, count: number }}
 *   surfaces: je Lamelle ein Körper aus ebenen Flächen (section "lamellen", faces für STEP);
 *   overlap: Volumen [mm³], das die Lamellen in Deckel und Boden hinein überlappen (steckt doppelt im Netz-Volumen);
 *   cavity: Volumen [mm³] der Lamellen im Luftkanal (so viel weniger Luft)
 */
export function vaneBodies(s, airTris, vanes, wall) {
  const none = { surfaces: [], overlap: 0, cavity: 0, count: 0 };
  if (!vanes?.ok || !(wall > 0)) return none;
  const t = vanes.thickness, e = Math.min(EMBED_MAX, EMBED_FRACTION * wall);
  const surfaces = [];
  let overlap = 0, cavity = 0;

  vanes.paths.forEach((path, i) => {
    // Höhen an den Stützstellen; am Mundbogen liegt der Punkt knapp außerhalb der Facetten (Sehne statt Bogen): ein Stück nach innen suchen
    const rows = [];
    for (let k = 0; k < path.length; k++) {
      const inward = k === 0 ? path[1] : k === path.length - 1 ? path[k - 1] : null;   // Nachbar nach innen (nur an den Enden)
      const gap = inward && Math.hypot(inward[0] - path[k][0], inward[1] - path[k][1]);
      let hs = null;
      for (const back of inward ? [0, 0.05, 0.2, 0.5] : [0]) {
        const f = back / (gap || 1);
        hs = heightsAt(airTris, path[k][0] + (inward ? (inward[0] - path[k][0]) * f : 0), path[k][1] + (inward ? (inward[1] - path[k][1]) * f : 0));
        if (hs) break;
      }
      if (!hs) return;
      rows.push({ top: hs.top + e, bottom: hs.bottom - e });
    }

    const widths = vanes.widths?.[i] ?? path.map(() => t);
    const { left, right } = vaneOutline(path, widths), norms = pathNormals(path);
    const corner = (side, k) => [side[k][0], 0, side[k][1]];
    const at = (side, k, h) => { const p = corner(side, k); p[1] = h; return p; };
    const rowsP = rows.map((r, k) => ({ top: at(right, k, r.top), bottom: at(right, k, r.bottom) }));
    const rowsM = rows.map((r, k) => ({ top: at(left, k, r.top), bottom: at(left, k, r.bottom) }));
    const up = [0, 1, 0], down = [0, -1, 0];
    const K = path.length - 1, same = k => Math.hypot(norms[k][0] - norms[k + 1][0], norms[k][1] - norms[k + 1][1]) < SAME_NORMAL;

    // Seitenflächen: aufeinanderfolgende Stücke mit gleicher Richtung bilden eine ebene Fläche
    const side = (rowsS, dirOf, line) => {
      const faces = [];
      let current = null;
      const heading = k => { const dx = line[k + 1][0] - line[k][0], dz = line[k + 1][1] - line[k][1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
      for (let k = 0; k < K; k++) {
        const a = rowsS[k], b = rowsS[k + 1], tris = quad(a.bottom, b.bottom, b.top, a.top, dirOf(k));
        const [h0, h1] = k ? [heading(k - 1), heading(k)] : [[0, 0], [1, 1]];
        if (current && Math.hypot(h0[0] - h1[0], h0[1] - h1[1]) < SAME_NORMAL) current.push(...tris);
        else faces.push(current = tris);
      }
      return faces;
    };
    const faceDir = sign => k => [sign * (norms[k][0] + norms[k + 1][0]), 0, sign * (norms[k][1] + norms[k + 1][1])];
    // Deckel und Boden: Viereck, wenn die Normalen gleich sind (eben), sonst zwei Dreiecke
    const lid = (key, dir) => {
      const faces = [];
      for (let k = 0; k < K; k++) {
        const a = [rowsP[k][key], rowsP[k + 1][key], rowsM[k + 1][key], rowsM[k][key]];
        if (same(k)) faces.push(quad(...a, dir));
        else faces.push(oriented(a[0], a[1], a[2], dir), oriented(a[0], a[2], a[3], dir));
      }
      return faces;
    };
    const cap = (k, dir) => quad(rowsP[k].bottom, rowsM[k].bottom, rowsM[k].top, rowsP[k].top, dir);
    const tangent = k => { const a = path[Math.max(0, k - 1)], b = path[Math.min(K, k + 1)]; return [b[0] - a[0], 0, b[1] - a[1]]; };

    const faces = [
      ...side(rowsP, faceDir(1), right), ...side(rowsM, faceDir(-1), left),
      ...lid("top", up), ...lid("bottom", down),
      cap(0, tangent(0).map(v => -v)), cap(K, tangent(K)),
    ].filter(f => f.length);
    const triangles = faces.flat();
    surfaces.push({ name: `vane${i}`, section: "lamellen", oriented: true, rib: true, vane: true, triangles, faces });

    // Überlapp: 2e über die Grundfläche; Rest des Körpers liegt im Luftkanal
    let area = 0;   // Grundfläche der Lamelle in der Draufsicht (Länge × Dicke, mit Spitzen)
    for (let k = 0; k < K; k++) area += Math.hypot(path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]) * (widths[k] + widths[k + 1]) / 2;
    overlap += area * 2 * e;
    cavity += volumeOf(triangles) - area * 2 * e;
  });

  return { surfaces, overlap, cavity, count: surfaces.length };
}

/** Dreiecke des Luftkanals aus den Flächen des Körpers (Gitter oder fertige Dreiecke). */
export const airTriangles = surfaces => surfaceTriangles(surfaces);
