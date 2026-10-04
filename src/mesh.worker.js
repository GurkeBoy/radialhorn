// Web Worker: baut das 3D-Netz abseits des Haupt-Threads (siehe mesh-buffers.js).
import { meshBuffers } from "./mesh-buffers.js";

self.onmessage = ({ data: { id, input } }) => {
  try {
    const { sections, buffers } = meshBuffers(input);
    self.postMessage({ id, sections }, buffers);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
