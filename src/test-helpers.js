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
  // Jeder Punkt bekommt eine Nummer (Punkte gleich bis auf key-Rundung: dieselbe); Kanten sind Zahlenpaare.
  // Zeichenketten je Kante waren der Flaschenhals (ein Schalennetz hat ≈ 80 000 Dreiecke); das Ergebnis
  // ist dasselbe. Punkt-Objekte, die mehrere Dreiecke teilen (Gitterpunkte), werden nur einmal verschlüsselt.
  const idOfKey = new Map(), idOfPoint = new WeakMap();
  const idOf = p => {
    let id = idOfPoint.get(p);
    if (id === undefined) {
      const k = key(p);
      id = idOfKey.get(k);
      if (id === undefined) { id = idOfKey.size; idOfKey.set(k, id); }
      idOfPoint.set(p, id);
    }
    return id;
  };
  const BASE = 2 ** 26;                                  // Punktnummern < 2²⁶ (≈ 67 Mio.)
  const directed = new Map();
  for (const t of tris) {
    const a = idOf(t[0]), b = idOf(t[1]), c = idOf(t[2]);
    for (const e of [a * BASE + b, b * BASE + c, c * BASE + a]) directed.set(e, (directed.get(e) || 0) + 1);
  }
  let open = 0, flipped = 0;
  for (const [e, n] of directed) {
    const a = Math.floor(e / BASE), b = e - a * BASE;
    if (!directed.has(b * BASE + a)) open++;
    if (n > 1) flipped++;
  }
  return { open, flipped };
}

/** Zahl der Kanten ohne Gegenkante. */
export const openEdges = tris => edgeCheck(tris).open;
