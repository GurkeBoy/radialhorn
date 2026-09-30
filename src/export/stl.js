// STL-Export des Luftvolumens (Innenform des Horns als geschlossener Körper, mm).
import { buildHornGeometry, triangulate } from "../horn-mesh.js";
import { downloadFile } from "./download.js";

// STL-Achsen: X = Breite, Y = Hornachse, Z = Höhe (Z nach oben, wie in CAD üblich).
// Der Tausch von Y und Z spiegelt – deshalb wird dabei auch die Umlaufrichtung getauscht.
const toStl = ([x, h, z]) => [x, z, h];

/** Binäre STL aus Dreiecken [a, b, c] (gegen den Uhrzeigersinn von außen gesehen, [x, h, z]). */
export function stlBinary(triangles, header = "Radialhorn") {
  const buf = new ArrayBuffer(84 + 50 * triangles.length);
  const view = new DataView(buf);
  const text = new TextEncoder().encode(header.slice(0, 80));
  new Uint8Array(buf, 0, text.length).set(text);
  view.setUint32(80, triangles.length, true);
  let o = 84;
  const put = v => { for (const c of v) { view.setFloat32(o, c, true); o += 4; } };
  for (const tri of triangles) {
    const [a, c, b] = tri.map(toStl);   // Spiegelung → Umlaufrichtung tauschen
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const len = Math.hypot(...n) || 1;
    put(n.map(x => x / len));
    for (const p of [a, b, c]) put(p);
    o += 2;   // Attribut-Bytes
  }
  return buf;
}

/** Alle Dreiecke des geschlossenen Luftvolumens (inkl. Kappen an Throat und Mund). */
export function hornTriangles({ s, rt, profile, fillet }) {
  return buildHornGeometry(s, rt, profile, fillet).surfaces.flatMap(triangulate);
}

export function exportSTL(design) {
  const { s, rt } = design;
  const fname = `radialhorn_${Math.round(s.openingAngle)}deg_L${Math.round(s.zApex - s.hatTipZ)}_T${(rt * 2).toFixed(0)}mm_luftvolumen.stl`;
  downloadFile(stlBinary(hornTriangles(design)), fname, "model/stl");
}
