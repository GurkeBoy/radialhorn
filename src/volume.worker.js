// Web Worker: Volumen abseits des Haupt-Threads (useVolumes in hooks.js).
import { computeVolumes } from "./volume.js";

self.onmessage = ({ data: { input } }) => {
  try {
    self.postMessage({ output: computeVolumes(input) });
  } catch (error) {
    self.postMessage({ error: String(error?.message ?? error) });
  }
};
