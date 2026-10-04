// CSV-Export des Frequenzgangs (Simulation).
import { abs, arg } from "../simulation.js";
import { downloadFile } from "./download.js";

const deg = z => arg(z) * 180 / Math.PI;

/**
 * Simulationsergebnis (simulate) als CSV: Komma als Trenner, Dezimalpunkt, eine Kopfzeile.
 * Halsimpedanz normiert auf ρc/S_Hals.
 */
export function buildCSV(r) {
  const head = "f_Hz,SPL_dB,SPL_Phase_deg,Zel_Ohm,Zel_Phase_deg,Zel_Re_Ohm,Zel_Im_Ohm,Zthroat_Re_norm,Zthroat_Im_norm";
  const rows = r.f.map((f, i) => [
    f.toFixed(3), r.spl[i].toFixed(3), r.phase[i].toFixed(2),
    abs(r.zel[i]).toFixed(4), deg(r.zel[i]).toFixed(2), r.zel[i].re.toFixed(4), r.zel[i].im.toFixed(4),
    r.zThroat[i].re.toFixed(5), r.zThroat[i].im.toFixed(5),
  ].join(","));
  return [head, ...rows].join("\n") + "\n";
}

export function exportCSV(result) {
  downloadFile(buildCSV(result), "radialhorn-frequenzgang.csv", "text/csv");
}
