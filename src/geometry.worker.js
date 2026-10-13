// Web Worker: abgeleitete Geometrie abseits des Haupt-Threads (siehe geometry.js). Der Kern
// bleibt zwischen den Nachrichten erhalten – seine Zwischenspeicher sind der eigentliche Gewinn.
import { createGeometryEngine } from "./geometry.js";

const compute = createGeometryEngine();

self.onmessage = ({ data: { params } }) => {
  try {
    const { values, versions } = compute(params);
    self.postMessage({ params, values, versions });
  } catch (error) {
    self.postMessage({ params, error: String(error?.message ?? error) });
  }
};
