// Körper im STEP im Web Worker vereinen (step-fuse.worker.js); der Worker wird nur für einen Export gestartet.

/**
 * @param step      STEP-Text (hornStep)
 * @param fileName  Dateiname für den STEP-Kopf
 * @returns {Promise<{ step: string, bodies: number, volume: number }>}
 */
export function fuseStepInWorker(step, fileName) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./step-fuse.worker.js", import.meta.url), { type: "module" });
    const done = fn => value => { worker.terminate(); fn(value); };
    worker.onmessage = ({ data }) => (data.error ? done(reject)(new Error(data.error)) : done(resolve)(data.result));
    worker.onerror = event => done(reject)(new Error(event.message || "Worker nicht startbar"));
    worker.postMessage({ step, fileName });
  });
}
