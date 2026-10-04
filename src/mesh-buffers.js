// 3D-Netz als kompakte Puffer (Float32Array) je Sektion: Grundlage für die 3D-Ansicht. Läuft im
// Web Worker (mesh.worker.js), damit Slider und 2D-Ansichten beim Neuaufbau nicht stocken; die
// Eingaben sind reine Daten (klonbar), die Profilfunktion wird hier aus ihnen neu gebaut.
import { makeProfile } from "./horn-math.js";
import { buildHornGeometry, buildShellGeometry, triangulate, gridLines } from "./horn-mesh.js";

/**
 * @param input  { s, rt, hMouth, curve, hypexT, fillet, wall, flange, sections }
 *               sections: Liste der gewünschten Sektionen (z.B. ohne die Kappen des Luftvolumens)
 * @returns {{ sections: { section, positions, normals, lines }[], buffers: ArrayBuffer[] }}
 *   positions/normals: je Dreieck 9 Werte (Normale flach je Dreieck, wie computeVertexNormals
 *   bei Dreiecken ohne Index); lines: je Gitterstrecke 6 Werte; buffers: zum Übertragen
 */
export function meshBuffers({ s, rt, hMouth, curve, hypexT, fillet, wall, flange, sections }) {
  const profile = makeProfile(s, rt, hMouth, curve, hypexT, fillet);
  const geometry = wall > 0
    ? buildShellGeometry(s, rt, profile, fillet, wall, flange)
    : buildHornGeometry(s, rt, profile, fillet);

  const out = [];
  for (const section of sections) {
    const surfaces = geometry.surfaces.filter(f => f.section === section);
    if (!surfaces.length) continue;
    const tris = surfaces.flatMap(triangulate);
    const positions = new Float32Array(tris.length * 9), normals = new Float32Array(tris.length * 9);
    tris.forEach(([a, b, c], k) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const o = k * 9;
      for (const [m, p] of [[0, a], [3, b], [6, c]]) {
        positions[o + m] = p[0]; positions[o + m + 1] = p[1]; positions[o + m + 2] = p[2];
        normals[o + m] = nx; normals[o + m + 1] = ny; normals[o + m + 2] = nz;
      }
    });
    const segs = surfaces.flatMap(gridLines);
    const lines = new Float32Array(segs.length * 6);
    segs.forEach(([p, q], k) => lines.set([p[0], p[1], p[2], q[0], q[1], q[2]], k * 6));
    out.push({ section, positions, normals, lines });
  }
  return { sections: out, buffers: out.flatMap(x => [x.positions.buffer, x.normals.buffer, x.lines.buffer]) };
}
