// Bemaßungen für die SVG-Ansichten. Regeln (siehe CLAUDE.md): Hilfslinien gestrichelt,
// 2 px vom Geometriepunkt bis 2 px über die Maßlinie; Text 8 px neben der Maßlinie auf
// der Außenseite; Farbe = Farbe des bemaßten Elements.
import { S } from "../theme.js";

/**
 * Waagerechte oder senkrechte Bemaßung zwischen p1 und p2.
 * Orientierung aus der größeren Ausdehnung (|dy| ≥ |dx| → senkrecht), bei 45°-Strecken
 * per orient="v" | "h" erzwingen.
 * @param arrowPos  Lage der Maßlinie: x bei senkrechter, y bei waagerechter Bemaßung
 */
export function Dim({ p1, p2, arrowPos, color, marker, label, sw = "0.7", orient }) {
  const [x1, y1] = p1, [x2, y2] = p2;
  const vertical = orient ? orient === "v" : Math.abs(y2 - y1) >= Math.abs(x2 - x1);

  if (vertical) {
    const ax = arrowPos;
    const d  = ax < (x1 + x2) / 2 ? -1 : 1;
    const tx = ax + d * 8, my = (y1 + y2) / 2;
    return <>
      <line x1={x1 + d*2} y1={y1} x2={ax + d*2} y2={y1} {...S.dimRef} stroke={color} />
      <line x1={x2 + d*2} y1={y2} x2={ax + d*2} y2={y2} {...S.dimRef} stroke={color} />
      <line x1={ax} y1={y1} x2={ax} y2={y2} strokeWidth={sw} stroke={color} markerStart={marker} markerEnd={marker} />
      <text x={tx} y={my} {...S.label} textAnchor="middle" dominantBaseline="central" fill={color}
        transform={`rotate(-90,${tx},${my})`}>{label}</text>
    </>;
  }

  const ay = arrowPos;
  const d  = ay < (y1 + y2) / 2 ? -1 : 1;
  const mx = (x1 + x2) / 2, ty = d > 0 ? ay + 11 : ay - 8;
  return <>
    <line x1={x1} y1={y1 + d*2} x2={x1} y2={ay + d*2} {...S.dimRef} stroke={color} />
    <line x1={x2} y1={y2 + d*2} x2={x2} y2={ay + d*2} {...S.dimRef} stroke={color} />
    <line x1={x1} y1={ay} x2={x2} y2={ay} strokeWidth={sw} stroke={color} markerStart={marker} markerEnd={marker} />
    <text x={mx} y={ty} {...S.label} textAnchor="middle" fill={color}>{label}</text>
  </>;
}

/**
 * Schräge Bemaßung parallel zur Strecke p1 → p2.
 * @param offset  Abstand der Maßlinie [px], positiv = links der Richtung p1 → p2
 *                (Bildschirmkoordinaten, y nach unten)
 */
export function DimAligned({ p1, p2, offset, color, marker, label, sw = "0.7" }) {
  const [x1, y1] = p1, [x2, y2] = p2;
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1) return null;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const nx = uy, ny = -ux;
  const d = Math.sign(offset) || 1;
  const [e0x, e0y] = [nx * d * 2, ny * d * 2];
  const [e1x, e1y] = [nx * (offset + d * 2), ny * (offset + d * 2)];
  const a1 = [x1 + nx * offset, y1 + ny * offset], a2 = [x2 + nx * offset, y2 + ny * offset];
  const tOff = offset + d * 8;
  const tx = (x1 + x2) / 2 + nx * tOff, ty = (y1 + y2) / 2 + ny * tOff;
  let ang = Math.atan2(uy, ux) * 180 / Math.PI;
  if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;   // Text nie auf dem Kopf
  return <>
    <line x1={x1 + e0x} y1={y1 + e0y} x2={x1 + e1x} y2={y1 + e1y} {...S.dimRef} stroke={color} />
    <line x1={x2 + e0x} y1={y2 + e0y} x2={x2 + e1x} y2={y2 + e1y} {...S.dimRef} stroke={color} />
    <line x1={a1[0]} y1={a1[1]} x2={a2[0]} y2={a2[1]} strokeWidth={sw} stroke={color} markerStart={marker} markerEnd={marker} />
    <text x={tx} y={ty} {...S.label} textAnchor="middle" dominantBaseline="central" fill={color}
      transform={`rotate(${ang},${tx},${ty})`}>{label}</text>
  </>;
}
