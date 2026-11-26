// Lamellen: dünne senkrechte Platten im Horn, die die Wellenfront in Sektoren teilen und den Schall weiter streuen.
//
// Jede Lamelle liegt in einer Ebene durch die senkrechte Achse im Fokus (Winkel φ zur Hornachse): eine Gerade in
// der Draufsicht, die der Wellenfront (Kreisbogen um den Fokus) überall senkrecht begegnet. Bei n Lamellen teilen
// sie den Öffnungswinkel 2α in n + 1 gleich breite Sektoren, φᵢ = −α + i·Δ mit Δ = 2α/(n + 1). Im geraden Bereich der
// Wand ist der Querschnitt genau dieser Sektor – die Lamellen liegen dort überall im Luftraum.
//
// Entlang der Lamelle zählt der Abstand r vom Fokus. Das Höhenprofil des Horns hängt in dieser Konstruktion nur an r
// (horn-mesh.js: halbe Höhe = Profil(zFocus + r)); die Lamelle ist deshalb eine Fläche in (r, h) zwischen Boden und
// Deckel des Luftkanals. Beide werden wirklich aus dem Netz des Luftvolumens gelesen (Schnitt mit der Lamellenebene), also mit
// Verrundungen, Klothoide und gerundeten Mundecken. Oben und unten reicht sie ein Stück in die Wand hinein, damit
// Slicer und CAD die Teile verschmelzen; dieser Überlapp wird im Volumen herausgerechnet.
//
// Koordinaten wie horn-mesh.js: [x, h, z], Ursprung auf der Hornachse in der Throat-Ebene.
import { surfaceTriangles } from "./flange-ribs.js";

export const VANE_START_MODES = ["z", "width", "channel"];
export const VANE_END_MODES = ["mouth", "z", "channel"];

const MIN_LENGTH = 5;          // kürzeste Lamelle [mm]
const MIN_CHANNEL = 1;         // kleinste lichte Kanalbreite am Beginn [mm]
export const VANE_SAMPLES = 32;       // Stützstellen entlang der Lamelle
const EMBED_MAX = 3;           // Eintauchtiefe in die Wand, höchstens [mm]
const EMBED_FRACTION = 0.4;    // … und höchstens dieser Anteil der Wandstärke

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

/** Gemeinsame Größen aus Lösung, Anzahl und Dicke: Sektorwinkel, kleinster und größter Abstand vom Fokus. */
function frame(s, count, thickness) {
  const n = Math.round(count), alpha = s.alpha2, delta = 2 * alpha / (n + 1), sinHalf = Math.sin(delta / 2);
  // Der Sektor beginnt hinter dem Eingang (rInner); davor ist der Querschnitt noch kein Sektor. Zwischen zwei Lamellen
  // müssen mindestens MIN_CHANNEL lichte Breite bleiben.
  const rMin = Math.max(s.rInner, (thickness + MIN_CHANNEL) / (2 * sinHalf));
  return { n, alpha, delta, sinHalf, sinAlpha: Math.sin(alpha), rMin, rMax: s.arcR };
}

/**
 * Abstand r vom Fokus zu einem Maß:
 *   z        axiale Stelle (Abstand vom Throat), an der die Wellenfront die Achse schneidet: r = z − zFocus
 *   width    Hornbreite an dieser Wellenfront, Sehne zwischen den Wänden: 2·r·sin α
 *   channel  lichte Kanalbreite zwischen zwei Lamellen (Sehne minus Dicke): 2·r·sin(Δ/2) − Dicke
 */
export function vaneRadius(s, count, thickness, mode, value) {
  const f = frame(s, count, thickness);
  return mode === "z" ? value - s.zFocus : mode === "width" ? value / (2 * f.sinAlpha) : (value + thickness) / (2 * f.sinHalf);
}

/** Umkehrung von vaneRadius: das Maß mode zum Abstand r (z. B. beim Wechsel der Betriebsart, ohne dass sich die Lamelle ändert). */
export function vaneValue(s, count, thickness, mode, r) {
  const f = frame(s, count, thickness);
  return mode === "z" ? s.zFocus + r : mode === "width" ? 2 * r * f.sinAlpha : 2 * r * f.sinHalf - thickness;
}

/** Zulässiger Bereich je Maß [von, bis] (Regler): vom Ende des Eingangs bis zum Mund. */
export function vaneRanges(s, count, thickness) {
  const f = frame(s, count, thickness);
  const range = mode => [vaneValue(s, count, thickness, mode, f.rMin), vaneValue(s, count, thickness, mode, f.rMax)];
  return { z: range("z"), width: range("width"), channel: range("channel") };
}

/**
 * Lamellen zu einer Lösung auflösen und auf das Machbare begrenzen.
 * @param s     Lösung aus solveHorn
 * @param spec  { count, thickness, start: { mode: "z" | "width" | "channel", value }, end: { mode: "mouth" | "z" | "channel", value } }
 *              Ende "channel": hier ist der Kanal so breit geworden, dass die Lamelle enden darf
 * @returns {object | null}  null ohne Lamellen (rundes Horn, Anzahl 0, Dicke 0); sonst
 *   { count, thickness, delta, phis, rStart, rEnd, zStart, zEnd, widthStart, widthEnd, channelStart, channelEnd,
 *     startLimited, endLimited, ok }  – Winkel im Bogenmaß, Längen in mm; ok = lang genug für eine Lamelle
 */
export function resolveVanes(s, spec) {
  if (!s || s.round || !spec || !(spec.count >= 1) || !(spec.thickness > 0)) return null;
  const { count, thickness: t } = spec, f = frame(s, count, t);
  const rawStart = vaneRadius(s, count, t, spec.start.mode, spec.start.value);
  const rawEnd = spec.end.mode === "mouth" ? f.rMax : vaneRadius(s, count, t, spec.end.mode, spec.end.value);
  const rStart = clamp(rawStart, f.rMin, f.rMax), rEnd = clamp(rawEnd, f.rMin, f.rMax);
  return {
    count: f.n, thickness: t, delta: f.delta,
    phis: Array.from({ length: f.n }, (_, i) => -f.alpha + f.delta * (i + 1)),
    rStart, rEnd, zStart: s.zFocus + rStart, zEnd: s.zFocus + rEnd,
    widthStart: 2 * rStart * f.sinAlpha, widthEnd: 2 * rEnd * f.sinAlpha,
    channelStart: 2 * rStart * f.sinHalf - t, channelEnd: 2 * rEnd * f.sinHalf - t,
    startLimited: Math.abs(rawStart - rStart) > 1e-9, endLimited: Math.abs(rawEnd - rEnd) > 1e-9,
    ok: rEnd - rStart >= MIN_LENGTH,
  };
}

/**
 * Schnitt der Dreiecke mit der senkrechten Ebene durch den Fokus unter dem Winkel φ zur Hornachse: Strecken [[r, h], [r, h]],
 * r = Abstand vom Fokus entlang der Ebene (waagerecht), h = Höhe.
 */
function sliceRadial(tris, phi, zFocus) {
  const c = Math.cos(phi), sn = Math.sin(phi), segs = [];
  for (const tri of tris) {
    const d = [0, 1, 2].map(k => tri[k][0] * c - (tri[k][2] - zFocus) * sn);
    if (!(Math.min(d[0], d[1], d[2]) < 0 && Math.max(d[0], d[1], d[2]) >= 0)) continue;
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3], da = d[k], db = d[(k + 1) % 3];
      if ((da < 0) === (db < 0)) continue;
      const g = da / (da - db), x = a[0] + g * (b[0] - a[0]), z = a[2] + g * (b[2] - a[2]);
      pts.push([x * sn + (z - zFocus) * c, a[1] + g * (b[1] - a[1])]);
    }
    if (pts.length === 2) segs.push(pts);
  }
  return segs;
}

/** Höchste und tiefste Höhe der Strecken an der Stelle r, null wenn keine Strecke dort liegt. */
function heightsAt(segs, r) {
  let top = -Infinity, bottom = Infinity;
  for (const [a, b] of segs) {
    if ((a[0] - r) * (b[0] - r) > 1e-12) continue;
    const dr = b[0] - a[0];
    for (const h of Math.abs(dr) < 1e-12 ? [a[1], b[1]] : [a[1] + (r - a[0]) / dr * (b[1] - a[1])]) {
      top = Math.max(top, h);
      bottom = Math.min(bottom, h);
    }
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

/**
 * Lamellen als eigene geschlossene Körper.
 * @param s       Lösung aus solveHorn
 * @param airTris Dreiecke des Luftvolumens (Flächen des Kanals ohne die Kappen)
 * @param vanes   resolveVanes-Ergebnis
 * @param wall    Wandstärke [mm]
 * @returns {{ surfaces: object[], shapes: { phi, rStart, rEnd }[], overlap: number, cavity: number, count: number }}
 *   surfaces: je Lamelle ein Körper aus ebenen Flächen (section "lamellen", faces für STEP);
 *   overlap: Volumen [mm³], das die Lamellen in Deckel und Boden hinein überlappen (steckt doppelt im Netz-Volumen);
 *   cavity: Volumen [mm³] der Lamellen im Luftkanal (so viel weniger Luft)
 */
export function vaneBodies(s, airTris, vanes, wall) {
  const none = { surfaces: [], shapes: [], overlap: 0, cavity: 0, count: 0 };
  if (!vanes?.ok || !(wall > 0)) return none;
  const t = vanes.thickness, e = Math.min(EMBED_MAX, EMBED_FRACTION * wall);
  const surfaces = [], shapes = [];
  let overlap = 0, cavity = 0;

  vanes.phis.forEach((phi, i) => {
    const segs = sliceRadial(airTris, phi, s.zFocus);
    if (!segs.length) return;
    // Die Gitterpunkte am Mund liegen auf dem Bogen, die Schnittstrecken dazwischen knapp davor: die Lamelle endet dort
    const rReach = segs.reduce((m, [a, b]) => Math.max(m, a[0], b[0]), -Infinity);
    const rStart = vanes.rStart, rEnd = Math.min(vanes.rEnd, rReach);
    if (!(rEnd - rStart >= MIN_LENGTH)) return;

    const c = Math.cos(phi), sn = Math.sin(phi), ray = [sn, 0, c], nrm = [c, 0, -sn];
    const at = (r, h, side) => [r * sn + side * t / 2 * nrm[0], h, s.zFocus + r * c + side * t / 2 * nrm[2]];
    const rows = [];   // je Stützstelle: [oben, unten] für beide Seiten
    for (let k = 0; k <= VANE_SAMPLES; k++) {
      const r = rStart + (rEnd - rStart) * k / VANE_SAMPLES, hs = heightsAt(segs, r);
      if (!hs) return;
      const top = hs.top + e, bottom = hs.bottom - e;
      rows.push({ top, bottom, p: [at(r, top, 1), at(r, bottom, 1)], m: [at(r, top, -1), at(r, bottom, -1)] });
    }

    const up = [0, 1, 0], down = [0, -1, 0], back = ray.map(v => -v), minus = nrm.map(v => -v);
    const sideP = [], sideM = [], top = [], bottom = [];
    for (let k = 0; k < VANE_SAMPLES; k++) {
      const a = rows[k], b = rows[k + 1];
      sideP.push(...quad(a.p[1], b.p[1], b.p[0], a.p[0], nrm));
      sideM.push(...quad(a.m[1], b.m[1], b.m[0], a.m[0], minus));
      top.push(quad(a.p[0], b.p[0], b.m[0], a.m[0], up));
      bottom.push(quad(a.p[1], b.p[1], b.m[1], a.m[1], down));
    }
    const first = rows[0], last = rows[VANE_SAMPLES];
    const faces = [
      sideP, sideM, ...top, ...bottom,
      quad(first.p[1], first.m[1], first.m[0], first.p[0], back),
      quad(last.p[1], last.m[1], last.m[0], last.p[0], ray),
    ];
    surfaces.push({ name: `vane${i}`, section: "lamellen", oriented: true, rib: true, vane: true, triangles: faces.flat(), faces });
    shapes.push({ phi, rStart, rEnd });

    // Fläche in (r, h) nach der Trapezregel, dieselbe Zerlegung wie das Netz; ein Stück 2·e davon steckt in Deckel und Boden
    const dr = (rEnd - rStart) / VANE_SAMPLES;
    let area = 0;
    for (let k = 0; k < VANE_SAMPLES; k++) area += (rows[k].top - rows[k].bottom + rows[k + 1].top - rows[k + 1].bottom) / 2 * dr;
    overlap += t * 2 * e * (rEnd - rStart);
    cavity += t * area - t * 2 * e * (rEnd - rStart);
  });

  return { surfaces, shapes, overlap, cavity, count: surfaces.length };
}

/** Dreiecke des Luftkanals aus den Flächen des Körpers (Gitter oder fertige Dreiecke). */
export const airTriangles = surfaces => surfaceTriangles(surfaces);
