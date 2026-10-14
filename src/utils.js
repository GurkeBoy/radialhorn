// Kleine, reine Hilfsfunktionen für Zeichnungen und Diagramme.

/** n+1 gleichmäßig verteilte Werte von a bis b. */
export const linspace = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Länge für Beschriftungen: höchstens eine Nachkommastelle, ohne unnötige Null (575.3, 500). */
export const fmtLength = v => String(Number(v.toFixed(1)));

/**
 * Polygonzug [a, z] (z aufsteigend) ab der Ebene z0: Punkte davor entfallen, der Schnittpunkt
 * mit z = z0 wird interpoliert.
 */
export function clipFromZ(points, z0) {
  const k = points.findIndex(p => p[1] >= z0);
  if (k < 0) return [];
  if (k === 0) return points;
  if (points[k][1] === z0) return points.slice(k);
  const [a0, za] = points[k - 1], [a1, zb] = points[k];
  const f = (z0 - za) / (zb - za || 1);
  return [[a0 + f * (a1 - a0), z0], ...points.slice(k)];
}

/**
 * SVG-Pfad (M/L) durch Punkte [x, y]. digits rundet die Koordinaten (für kompakte
 * Ausgabe, z.B. im PDF); ohne digits werden sie unverändert geschrieben.
 */
export function svgPath(points, digits) {
  const fmt = digits === undefined ? v => v : v => v.toFixed(digits);
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${fmt(x)},${fmt(y)}`).join(" ");
}

/** "Runde" Tick-Werte (1/2/5 · 10^n) im Bereich [lo, hi], etwa count Stück. */
export function niceTicks(lo, hi, count = 4) {
  const span = hi - lo;
  if (!(span > 0)) return [];
  const raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(f => f * mag).find(st => st >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(v);
  return out;
}
