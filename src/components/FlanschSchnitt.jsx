// Schnitt durch den Throat-Flansch: je Seite die Fläche zwischen Luftkanal und Flanschrand.
import { COLOR } from "../theme.js";
import { svgPath } from "../utils.js";

/**
 * Begrenzung der rechten Flansch-Schnittfläche in Geometriekoordinaten [halbe Breite, z]:
 * innen der Luftkanal (inner, nach z sortiert) von z = 0 bis zur Dicke d, außen der Rand R.
 */
function flangeSection(inner, R, d) {
  const at = z => {
    const k = inner.findIndex(p => p[1] >= z);
    if (k <= 0) return k === 0 ? inner[0][0] : inner[inner.length - 1][0];
    const [x0, z0] = inner[k - 1], [x1, z1] = inner[k];
    return x0 + (x1 - x0) * (z - z0) / (z1 - z0 || 1);
  };
  const mid = inner.filter(([, z]) => z > 0 && z < d);
  return [[at(0), 0], ...mid, [at(d), d], [R, d], [R, 0]];
}

/**
 * @param inner  Luftkanal [halbe Breite, z] (rechte Seite, nach z sortiert)
 * @param flange aufgelöster Flansch (flangeLayout)
 * @param map    (halbe Breite, z) ↦ Bildschirmpunkt
 */
export function FlanschSchnitt({ inner, flange, map }) {
  const section = flangeSection(inner, flange.diameter / 2, flange.thickness);
  return [1, -1].map(sign =>
    <path key={sign} d={svgPath(section.map(([x, z]) => map(sign * x, z))) + " Z"}
      fill={COLOR.fillFlansch} stroke={COLOR.flansch} strokeWidth="1.2" strokeLinejoin="round" />
  );
}
