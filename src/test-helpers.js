// Gemeinsame Hilfen der Tests für 3D-Netze (keine Testdatei: kein *.test.js).
import { triangulate } from "./horn-mesh.js";
import { meshVolume } from "./volume.js";

/** Rundung der Koordinaten, mit der Punkte als „gleich“ gelten (1e-6 mm). */
export const key = p => p.map(v => Math.round(v * 1e6)).join(",");

export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Alle Dreiecke eines Körpers (Flächen aus buildHornGeometry / buildShellGeometry). */
export const trianglesOf = geo => geo.surfaces.flatMap(triangulate);

/** Volumen eines geschlossenen, nach außen orientierten Netzes (negativ bei nach innen zeigenden Flächen). */
export const signedVolume = meshVolume;

/**
 * Gerichtete Kanten zählen: geschlossen und konsistent orientiert ⇔ jede Kante genau einmal je Richtung.
 * open: Kanten ohne Gegenkante (Loch im Netz); flipped: dieselbe gerichtete Kante mehrfach (zwei Flächen
 * mit gleichem Umlaufsinn über der Kante, falsch herum oder doppelt).
 */
export function edgeCheck(tris) {
  const directed = new Map();
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const e = key(t[k]) + ">" + key(t[(k + 1) % 3]);
      directed.set(e, (directed.get(e) || 0) + 1);
    }
  }
  let open = 0, flipped = 0;
  for (const [e, n] of directed) {
    const [a, b] = e.split(">");
    if (!directed.get(b + ">" + a)) open++;
    if (n > 1) flipped++;
  }
  return { open, flipped };
}

/** Zahl der Kanten ohne Gegenkante. */
export const openEdges = tris => edgeCheck(tris).open;
