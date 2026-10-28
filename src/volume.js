// Volumen des Horns aus den geschlossenen 3D-Netzen (dieselben wie 3D-Ansicht, STL und STEP):
// Summe der vorzeichenbehafteten Tetraeder zum Ursprung (Divergenzsatz). Läuft im Web Worker
// (volume.worker.js, useVolumes).
import { makeProfile } from "./horn-math.js";
import { buildHornGeometry, buildShellGeometry, triangulate } from "./horn-mesh.js";

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Volumen [mm³] eines geschlossenen, einheitlich nach außen orientierten Dreiecksnetzes [[a, b, c], …]. */
export function meshVolume(tris) {
  let V = 0;
  for (const [a, b, c] of tris) {
    const n = cross(b, c);
    V += (a[0] * n[0] + a[1] * n[1] + a[2] * n[2]) / 6;
  }
  return V;
}

const volumeOf = geometry => meshVolume(geometry.surfaces.flatMap(triangulate));

/**
 * @param input  { s, rt, hMouth, curve, hypexT, fillet, morph, wall, flange, edgeR }
 * @returns {{ air: number, shell: number|null, outer: number|null }} in mm³; shell (Wandmaterial
 *   inkl. Flansch) und outer (Luft + Wand) nur bei wall > 0
 */
export function computeVolumes({ s, rt, hMouth, curve, hypexT, fillet, morph = null, wall, flange = null, edgeR = 0 }) {
  const profile = makeProfile(s, rt, hMouth, curve, hypexT, fillet);
  const air = volumeOf(buildHornGeometry(s, rt, profile, fillet, morph));
  if (!(wall > 0)) return { air, shell: null, outer: null };
  const geometry = buildShellGeometry(s, rt, profile, fillet, wall, flange, edgeR, morph);
  const shell = volumeOf(geometry) - (geometry.ribs?.overlap ?? 0);   // Rippen reichen in Platte und Wand hinein
  return { air, shell, outer: air + shell };
}
