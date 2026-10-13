// Web Worker: Frequenzgang abseits des Haupt-Threads (useSimulation in hooks.js). Der Kern bleibt
// zwischen den Nachrichten erhalten – er hält S(x), solange sich die Geometrie nicht ändert.
import { createSimulationEngine } from "./simulation.js";

const run = createSimulationEngine();

self.onmessage = ({ data: { input } }) => {
  try {
    self.postMessage({ output: run(input) });
  } catch (error) {
    self.postMessage({ error: String(error?.message ?? error) });
  }
};
