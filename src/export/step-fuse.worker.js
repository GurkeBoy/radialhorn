// Web Worker: Körper im STEP vereinen (step-fuse.js). OpenCascade (ca. 23 MB Wasm) wird erst hier geladen, nur beim Export.
import initOC from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import { fuseStepBodies } from "./step-fuse.js";

let ready = null;
const openCascade = () => (ready ??= initOC({ locateFile: () => wasmUrl }));

self.onmessage = async ({ data: { step, fileName } }) => {
  try {
    self.postMessage({ result: fuseStepBodies(await openCascade(), step, fileName) });
  } catch (error) {
    self.postMessage({ error: String(error?.message ?? error) });
  }
};
