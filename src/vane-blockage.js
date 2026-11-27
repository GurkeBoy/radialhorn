// Fläche, die Lamellen einer Wellenfront wegnehmen – eigenes kleines Modul (nur horn-math), damit Simulation und Querschnitt
// (auch im Web Worker) nicht das ganze Lamellen-/Netz-Gerüst von vanes.js mitladen.
import { focusRadius } from "./horn-math.js";

/**
 * Fläche [mm²], die die Lamellen einer Wellenfront wegnehmen: je laufender Lamelle Dicke × volle Höhe 2·h an ihrem Punkt auf
 * dem Bogen (ψ = f·θ; h aus derselben Regel wie beim Körper, Profil(zFocus + Abstand zum Fokus)). Die Lamelle steht senkrecht auf
 * der Wellenfront, ihre Dicke liegt also in der Bogenrichtung; die Dicke an dem Punkt (auch an den Spitzen) kommt vom nächsten
 * Stück ihres Weges. Eine Lamelle läuft an einer Wellenfront, wenn deren Achsenstelle zwischen Beginn und Ende der Lamelle liegt.
 * @param profile  z ↦ halbe Höhe (makeProfile)
 * @returns {((wf: { zCenter, radius, halfAngle, zAxis }) => number) | null}  null ohne Lamellen
 */
export function vaneBlockage(s, vanes, profile) {
  if (!vanes?.ok || !vanes.paths?.length) return null;
  const items = vanes.paths.map((path, i) => ({ f: vanes.fractions[i], z0: vanes.starts?.[i] ?? vanes.zStart, path, w: vanes.widths[i] }));
  const widthAt = (v, x, z) => {
    let best = Infinity, width = v.w[0];
    for (let k = 0; k + 1 < v.path.length; k++) {
      const [ax, az] = v.path[k], [bx, bz] = v.path[k + 1], dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
      const u = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2));
      const d = Math.hypot(x - (ax + u * dx), z - (az + u * dz));
      if (d < best) { best = d; width = v.w[k] + u * (v.w[k + 1] - v.w[k]); }
    }
    return width;
  };
  return wf => {
    let sum = 0;
    for (const v of items) {
      if (wf.zAxis < v.z0 - 1e-9 || wf.zAxis > vanes.zEnd + 1e-9) continue;
      const psi = v.f * wf.halfAngle, x = wf.radius * Math.sin(psi), z = wf.zCenter + wf.radius * Math.cos(psi);
      sum += widthAt(v, x, z) * 2 * profile(s.zFocus + focusRadius(s, x, z));
    }
    return sum;
  };
}
