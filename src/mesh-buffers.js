// 3D-Netz als kompakte Puffer (Float32Array) je Sektion: Grundlage für die 3D-Ansicht. Läuft im
// Web Worker (mesh.worker.js), damit Slider und 2D-Ansichten beim Neuaufbau nicht stocken; die
// Eingaben sind reine Daten (klonbar), die Profilfunktion wird hier aus ihnen neu gebaut.
import { makeProfile } from "./horn-math.js";
import { buildHornGeometry, buildShellGeometry, triangulate, gridLines, DRAFT_RES } from "./horn-mesh.js";

/**
 * @param input  { s, rt, hMouth, curve, hypexT, fillet, wall, flange, edgeR, morph, sections, quality }
 *               sections: Liste der gewünschten Sektionen (z.B. ohne die Kappen des Luftvolumens);
 *               quality "draft": grobes Netz (DRAFT_RES), flach schattiert – beim Ziehen; sonst fein
 *               und geglättet
 * @returns {{ sections: { section, positions, normals, lines }[], buffers: ArrayBuffer[] }}
 *   positions/normals: je Dreieck 9 Werte (Normalen geglättet, siehe smoothNormals); lines: je
 *   Gitterstrecke 6 Werte; buffers: zum Übertragen
 */
export function meshBuffers({ s, rt, hMouth, curve, hypexT, fillet, wall, flange, edgeR = 0, morph = null, sections, quality = "fine" }) {
  const draft = quality === "draft", res = draft ? DRAFT_RES : undefined;
  const profile = makeProfile(s, rt, hMouth, curve, hypexT, fillet);
  const geometry = wall > 0
    ? buildShellGeometry(s, rt, profile, fillet, wall, flange, edgeR, morph, res)
    : buildHornGeometry(s, rt, profile, fillet, morph, res);

  const out = [];
  for (const section of sections) {
    const surfaces = geometry.surfaces.filter(f => f.section === section);
    if (!surfaces.length) continue;
    const tris = surfaces.flatMap(triangulate);
    const positions = new Float32Array(tris.length * 9);
    tris.forEach((tri, k) => tri.forEach((p, m) => positions.set(p, k * 9 + m * 3)));
    const normals = draft ? flatNormals(tris) : smoothNormals(tris);
    const segs = surfaces.flatMap(gridLines);
    const lines = new Float32Array(segs.length * 6);
    segs.forEach(([p, q], k) => lines.set([p[0], p[1], p[2], q[0], q[1], q[2]], k * 6));
    out.push({ section, positions, normals, lines });
  }
  return { sections: out, buffers: out.flatMap(x => [x.positions.buffer, x.normals.buffer, x.lines.buffer]) };
}

/** Normale je Dreieck (flach), für den Entwurf. */
export function flatNormals(tris) {
  const normals = new Float32Array(tris.length * 9);
  tris.forEach(([a, b, c], k) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    for (let m = 0; m < 3; m++) normals.set([nx / len, ny / len, nz / len], k * 9 + m * 3);
  });
  return normals;
}

const CREASE = Math.cos(30 * Math.PI / 180);   // stärker geneigte Nachbardreiecke bilden eine Kante

/**
 * Normalen je Dreiecksecke, geglättet: Mittel der Flächennormalen aller Dreiecke an diesem Punkt
 * (nach Fläche gewichtet), soweit sie weniger als 30° gegen das eigene Dreieck geneigt sind. Die
 * Facetten gekrümmter Flächen (Rundungen in 16 Stücken à 5,6°, Gitterzeilen) erscheinen so glatt,
 * echte Kanten (Deckel ↔ Seitenwand, Throat-Ring, Stirnflächen) bleiben scharf. Nur Darstellung –
 * die Geometrie bleibt dieselbe.
 * @returns {Float32Array}  je Dreieck 9 Werte
 */
export function smoothNormals(tris) {
  const n = tris.length, corners = n * 3;
  const area = new Float64Array(n * 3), unit = new Float64Array(n * 3);   // 2·Fläche·Normale, Einheitsnormale
  tris.forEach(([a, b, c], k) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    area[k * 3] = nx; area[k * 3 + 1] = ny; area[k * 3 + 2] = nz;
    unit[k * 3] = nx / len; unit[k * 3 + 1] = ny / len; unit[k * 3 + 2] = nz / len;
  });

  // Punkt-Nummer je Ecke: gleiche Koordinaten (auf 1e-4 mm) = gleicher Punkt. Hashtabelle mit
  // offener Adressierung auf ganzzahligen Koordinaten (Text-Schlüssel kosteten ≈ 0,4 s)
  const size = 1 << Math.ceil(Math.log2(corners * 2 + 2)), mask = size - 1;
  const slot = new Int32Array(size).fill(-1);
  const qx = new Int32Array(corners), qy = new Int32Array(corners), qz = new Int32Array(corners);
  const vertexOf = new Int32Array(corners);
  let vertices = 0;
  for (let k = 0; k < n; k++) {
    for (let m = 0; m < 3; m++) {
      const p = tris[k][m];
      const x = Math.round(p[0] * 1e4), y = Math.round(p[1] * 1e4), z = Math.round(p[2] * 1e4);
      let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
      while (slot[h] >= 0 && !(qx[slot[h]] === x && qy[slot[h]] === y && qz[slot[h]] === z)) h = (h + 1) & mask;
      if (slot[h] < 0) { slot[h] = vertices; qx[vertices] = x; qy[vertices] = y; qz[vertices] = z; vertices++; }
      vertexOf[k * 3 + m] = slot[h];
    }
  }
  // Dreiecke je Punkt als kompakte Liste (Anfang je Punkt in start)
  const start = new Int32Array(vertices + 1);
  for (let c = 0; c < corners; c++) start[vertexOf[c] + 1]++;
  for (let v = 0; v < vertices; v++) start[v + 1] += start[v];
  const fill = start.slice(0, vertices), triOf = new Int32Array(corners);
  for (let c = 0; c < corners; c++) triOf[fill[vertexOf[c]]++] = (c / 3) | 0;

  const normals = new Float32Array(n * 9);
  for (let c = 0; c < corners; c++) {
    const k = (c / 3) | 0, v = vertexOf[c];
    const ux = unit[k * 3], uy = unit[k * 3 + 1], uz = unit[k * 3 + 2];
    let sx = 0, sy = 0, sz = 0;
    for (let i = start[v]; i < start[v + 1]; i++) {
      const j = triOf[i];
      if (unit[j * 3] * ux + unit[j * 3 + 1] * uy + unit[j * 3 + 2] * uz < CREASE) continue;
      sx += area[j * 3]; sy += area[j * 3 + 1]; sz += area[j * 3 + 2];
    }
    const len = Math.hypot(sx, sy, sz);
    if (len > 0) { normals[c * 3] = sx / len; normals[c * 3 + 1] = sy / len; normals[c * 3 + 2] = sz / len; }
    else { normals[c * 3] = ux; normals[c * 3 + 1] = uy; normals[c * 3 + 2] = uz; }
  }
  return normals;
}
