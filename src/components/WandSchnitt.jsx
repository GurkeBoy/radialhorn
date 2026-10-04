// Schnitt durch die Schale (Wandstärke): je Seite die Fläche zwischen Innenwand und Außenkontur.
import { COLOR } from "../theme.js";
import { svgPath } from "../utils.js";

/**
 * @param inner        Innenwand [halbe Breite, z] von der Startebene bis zum Mund (rechte Seite)
 * @param outer        Außenkontur [halbe Breite, z] von der Startebene bis zum Ende am Mund
 * @param closeThroat  Stirnfläche am Throat zeichnen (ohne Flansch; mit Flansch schließt dieser an)
 * @param map          (halbe Breite, z) ↦ Bildschirmpunkt
 */
export function WandSchnitt({ inner, outer, closeThroat, map }) {
  return [1, -1].map(sign => {
    const pt = ([a, z]) => map(sign * a, z);
    const area = [...inner, ...[...outer].reverse()].map(pt);
    const edge = [...(closeThroat ? [inner[0]] : []), ...outer, inner[inner.length - 1]].map(pt);
    return <g key={sign}>
      <path d={svgPath(area) + " Z"} fill={COLOR.fillWand} stroke="none" />
      <path d={svgPath(edge)} fill="none" stroke={COLOR.wand} strokeWidth="1.4" strokeLinejoin="round" />
    </g>;
  });
}
