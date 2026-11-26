// Volumen des Horns aus den geschlossenen 3D-Netzen (dieselben wie 3D-Ansicht, STL und STEP):
// Summe der vorzeichenbehafteten Tetraeder zum Ursprung (Divergenzsatz). Läuft im Web Worker
// (volume.worker.js, useVolumes).
import { makeProfile } from "./horn-math.js";
import { triangulate } from "./horn-mesh.js";
import { buildAir, buildShell } from "./bodies.js";

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

/**
 * Rauminhalt [mm³] und Schwerpunkt [x, h, z] eines geschlossenen, einheitlich nach außen orientierten Netzes: Summe der
 * vorzeichenbehafteten Tetraeder zum Ursprung, jeder mit seinem Schwerpunkt (a + b + c)/4 gewichtet. Nullvolumen: Schwerpunkt null.
 */
export function meshMoments(tris) {
  let V = 0, mx = 0, my = 0, mz = 0;
  for (const [a, b, c] of tris) {
    const n = cross(b, c), v = (a[0] * n[0] + a[1] * n[1] + a[2] * n[2]) / 6;
    V += v;
    mx += v * (a[0] + b[0] + c[0]) / 4; my += v * (a[1] + b[1] + c[1]) / 4; mz += v * (a[2] + b[2] + c[2]) / 4;
  }
  return { volume: V, centroid: V ? [mx / V, my / V, mz / V] : null };
}

const momentsOf = geometry => meshMoments(geometry.surfaces.flatMap(triangulate));

/**
 * @param input  { s, rt, hMouth, curve, hypexT, fillet, morph, wall, flange, edgeR, vanes }
 * @returns {{ air: number, shell: number|null, outer: number|null, airCentroid: number[], shellCentroid: number[]|null }}
 *   Rauminhalte in mm³; shell (Wandmaterial inkl. Flansch) und outer (Luft + Wand) nur bei wall > 0; Schwerpunkte
 *   [x, h, z] in mm (Schale: gleichmäßige Dichte; Rippen überlappen die Wand ein wenig, ihr Überlapp zählt im Moment doppelt)
 */
export function computeVolumes({ s, rt, hMouth, curve, hypexT, fillet, morph = null, wall, flange = null, edgeR = 0, vanes = null }) {
  const profile = makeProfile(s, rt, hMouth, curve, hypexT, fillet);
  const airMoments = momentsOf(buildAir(s, rt, profile, fillet, morph));
  if (!(wall > 0)) return { air: airMoments.volume, shell: null, outer: null, airCentroid: airMoments.centroid, shellCentroid: null };
  const geometry = buildShell(s, rt, profile, fillet, wall, flange, edgeR, morph, undefined, vanes);
  const shellMoments = momentsOf(geometry);
  // Rippen und Lamellen reichen in Platte bzw. Wand hinein; Lamellen nehmen dem Luftkanal ihr Volumen
  const shell = shellMoments.volume - (geometry.ribs?.overlap ?? 0) - (geometry.vanes?.overlap ?? 0);
  const air = airMoments.volume - (geometry.vanes?.cavity ?? 0);
  return { air, shell, outer: air + shell, airCentroid: airMoments.centroid, shellCentroid: shellMoments.centroid };
}
