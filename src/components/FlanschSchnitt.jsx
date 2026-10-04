// Schnitt durch den Throat-Flansch: je Seite die Fläche zwischen Luftkanal und Flanschrand.
import { COLOR } from "../theme.js";
import { svgPath } from "../utils.js";
import { flangeSectionOutline } from "../horn-mesh.js";

/**
 * @param inner  Luftkanal [halbe Breite, z] (rechte Seite, nach z sortiert)
 * @param flange aufgelöster Flansch (flangeLayout)
 * @param map    (halbe Breite, z) ↦ Bildschirmpunkt
 */
export function FlanschSchnitt({ inner, flange, map }) {
  const section = flangeSectionOutline(inner, flange.diameter / 2, flange.thickness);
  return [1, -1].map(sign =>
    <path key={sign} d={svgPath(section.map(([x, z]) => map(sign * x, z))) + " Z"}
      fill={COLOR.fillFlansch} stroke={COLOR.flansch} strokeWidth="1.2" strokeLinejoin="round" />
  );
}
