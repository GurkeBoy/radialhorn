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
    const positions = pack(surfaces.flatMap(triangulate));
    const normals = draft ? flatNormals(positions) : smoothNormals(positions);
    const lines = pack(surfaces.flatMap(gridLines));
    out.push({ section, positions, normals, lines });
  }
  return { sections: out, buffers: out.flatMap(x => [x.positions.buffer, x.normals.buffer, x.lines.buffer]) };
}

/** Dreiecke [[a, b, c], …] oder Strecken [[p, q], …] als Float32Array, je Punkt 3 Werte. */
export function pack(items) {
  const out = new Float32Array(items.length * (items[0]?.length ?? 0) * 3);
  let o = 0;
  for (const item of items) for (const p of item) { out[o++] = p[0]; out[o++] = p[1]; out[o++] = p[2]; }
  return out;
}

/**
 * Normale n = (b − a) × (c − a) des Dreiecks k (Puffer positions, je Dreieck 9 Werte), nicht
 * normiert, nach out[o…o+2].
 */
function cross(positions, k, out, o) {
  const i = k * 9;
  const ux = positions[i + 3] - positions[i], uy = positions[i + 4] - positions[i + 1], uz = positions[i + 5] - positions[i + 2];
  const vx = positions[i + 6] - positions[i], vy = positions[i + 7] - positions[i + 1], vz = positions[i + 8] - positions[i + 2];
  out[o] = uy * vz - uz * vy; out[o + 1] = uz * vx - ux * vz; out[o + 2] = ux * vy - uy * vx;
}

/** Normale je Dreieck (flach), für den Entwurf. positions: je Dreieck 9 Werte (pack). */
export function flatNormals(positions) {
  const n = positions.length / 9, normals = new Float32Array(n * 9), c = new Float64Array(3);
  for (let k = 0; k < n; k++) {
    cross(positions, k, c, 0);
    const len = Math.hypot(c[0], c[1], c[2]) || 1;
    for (let m = 0; m < 9; m += 3) { normals[k * 9 + m] = c[0] / len; normals[k * 9 + m + 1] = c[1] / len; normals[k * 9 + m + 2] = c[2] / len; }
  }
  return normals;
}

const CREASE = Math.cos(30 * Math.PI / 180);   // stärker geneigte Nachbardreiecke bilden eine Kante

/**
 * Normalen je Dreiecksecke, geglättet: Mittel der Flächennormalen aller Dreiecke an diesem Punkt
 * (nach Fläche gewichtet), soweit sie weniger als 30° gegen das eigene Dreieck geneigt sind. Die
 * Facetten gekrümmter Flächen (Rundungen in 16 Stücken à 5,6°, Gitterzeilen) erscheinen so glatt,
 * echte Kanten (Deckel ↔ Seitenwand, Throat-Ring, Stirnflächen) bleiben scharf. Nur Darstellung –
 * die Geometrie bleibt dieselbe.
 * @param positions  je Dreieck 9 Werte (pack)
 * @returns {Float32Array}  je Dreieck 9 Werte
 */
export function smoothNormals(positions) {
  const n = positions.length / 9, corners = n * 3;
  const area = new Float64Array(n * 3), unit = new Float64Array(n * 3);   // 2·Fläche·Normale, Einheitsnormale
  for (let k = 0; k < n; k++) {
    cross(positions, k, area, k * 3);
    const len = Math.hypot(area[k * 3], area[k * 3 + 1], area[k * 3 + 2]) || 1;
    for (let i = 0; i < 3; i++) unit[k * 3 + i] = area[k * 3 + i] / len;
  }

  // Punkt-Nummer je Ecke: gleiche Koordinaten (auf 1e-4 mm) = gleicher Punkt. Hashtabelle mit
  // offener Adressierung auf ganzzahligen Koordinaten (Text-Schlüssel kosteten ≈ 0,4 s)
  const size = 1 << Math.ceil(Math.log2(corners * 2 + 2)), mask = size - 1;
  const slot = new Int32Array(size).fill(-1);
  const qx = new Int32Array(corners), qy = new Int32Array(corners), qz = new Int32Array(corners);
  const vertexOf = new Int32Array(corners);
  let vertices = 0;
  for (let c = 0; c < corners; c++) {
    const x = Math.round(positions[c * 3] * 1e4), y = Math.round(positions[c * 3 + 1] * 1e4), z = Math.round(positions[c * 3 + 2] * 1e4);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;
    while (slot[h] >= 0 && !(qx[slot[h]] === x && qy[slot[h]] === y && qz[slot[h]] === z)) h = (h + 1) & mask;
    if (slot[h] < 0) { slot[h] = vertices; qx[vertices] = x; qy[vertices] = y; qz[vertices] = z; vertices++; }
    vertexOf[c] = slot[h];
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
