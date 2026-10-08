// Diagramm der Querschnittsfläche A(z) = B·H mit Daten-Zoom.
import { memo, useMemo, useRef } from "react";
import { useT } from "../i18n.js";
import { hasTraktrix, crossSection } from "../horn-math.js";
import { COLOR, FONT, S } from "../theme.js";
import { clamp, niceTicks, svgPath } from "../utils.js";
import { useZoomPan } from "../hooks.js";
import { ZoomControls } from "./ui.jsx";

const VW = 310, VH = 200;                        // viewBox; das SVG skaliert auf die Kartenbreite
const ml = 38, mr = 8, mt = 26, mb = 20;         // Plotrand
const pw = VW - ml - mr, ph = VH - mt - mb;
const HEADROOM = 1.08;                           // Luft über dem Maximum
const PART_COLOR = { traktrix: COLOR.trak, klothoide: COLOR.klo, linear: COLOR.horn };

/** @param profile  z ↦ halbe Höhe inkl. Verrundung (makeProfile) */
export const Querschnitt = memo(function Querschnitt({ s, profile, morph }) {
  const tr = useT();
  const svgRef = useRef(null);
  const zoom = useZoomPan(svgRef, {
    minZoom: 1,
    unitsPerPx: () => VW / (svgRef.current?.clientWidth || VW),
  });
  const pts = useMemo(() => crossSection(s, profile, 100, null, morph), [s, profile, morph]);

  const zStart = pts[0].z, zMouth = pts[pts.length - 1].z;
  const peak = Math.max(...pts.map(p => p.A));
  const aMax = peak * HEADROOM;
  const zTrans = hasTraktrix(s) ? s.zInnerApex : null;

  // Daten → Plot (Basis) → Zoom/Pan
  const { k, tx, ty } = zoom.view;
  const gx  = z => tx + k * (ml + ((z - zStart) / (zMouth - zStart)) * pw);
  const gy  = a => ty + k * (mt + (1 - a / aMax) * ph);
  const zAt = X => zStart + (((X - tx) / k) - ml) / pw * (zMouth - zStart);
  const aAt = Y => aMax * (1 - (((Y - ty) / k) - mt) / ph);
  const inX = x => x >= ml - 0.5 && x <= VW - mr + 0.5;
  const inY = y => y >= mt - 0.5 && y <= VH - mb + 0.5;
  const zoomed = k !== 1 || tx !== 0 || ty !== 0;

  // Achsen sitzen im Datenursprung und wandern beim Verschieben mit; läuft der Ursprung
  // aus dem Bild, bleiben sie am Plotrand sichtbar
  const axX = clamp(gx(zStart), ml, VW - mr);
  const axY = clamp(gy(0), mt, VH - mb);

  // Markante Werte immer; beim Zoomen zusätzlich runde Zwischenwerte des sichtbaren Bereichs
  const xMarks = [
    { z: zStart, col: COLOR.tick },
    ...(zTrans !== null ? [{ z: zTrans, col: COLOR.trak }] : []),
    { z: zMouth, col: COLOR.horn },
  ];
  const yMarks = [0, peak / 2, peak];
  const xTicks = [...xMarks, ...(zoomed
    ? niceTicks(zAt(ml), zAt(VW - mr)).filter(z => xMarks.every(m => Math.abs(gx(m.z) - gx(z)) > 16)).map(z => ({ z, col: COLOR.tick }))
    : [])].filter(t => inX(gx(t.z)));
  const yTicks = [...yMarks, ...(zoomed
    ? niceTicks(aAt(VH - mb), aAt(mt)).filter(a => yMarks.every(m => Math.abs(gy(m) - gy(a)) > 8))
    : [])].filter(a => inY(gy(a)));

  // Kurve in Sektionen (Traktrix / gerade Wand) mit gemeinsamem Übergangspunkt
  const segments = [];
  for (let i = 0; i < pts.length; i++) {
    if (i === 0 || pts[i].part !== pts[i - 1].part) {
      segments.push({ part: pts[i].part, pts: i === 0 ? [] : [pts[i - 1]] });
    }
    segments[segments.length - 1].pts.push(pts[i]);
  }

  return (
    <div style={{ position: "relative", margin: "0 -8px 6px" }}>
      <ZoomControls k={k} onReset={zoom.reset} top={0} right={8} compact />
      <svg ref={svgRef} {...zoom.handlers} viewBox={`0 0 ${VW} ${VH}`}
        style={{ width: "100%", display: "block", cursor: "grab", touchAction: "none", userSelect: "none" }}>
        <defs>
          <clipPath id="csPlot"><rect x={ml} y={mt} width={pw} height={ph} /></clipPath>
        </defs>
        <text x={ml} y={10} {...S.label} textAnchor="start" fontSize="8" fill={COLOR.text} letterSpacing="0.1em">{tr("cs.axes")}</text>
        <line x1={axX} y1={mt} x2={axX} y2={VH-mb} stroke={COLOR.axis} strokeWidth="0.7" />
        <line x1={ml} y1={axY} x2={VW-mr} y2={axY} stroke={COLOR.axis} strokeWidth="0.7" />
        <g clipPath="url(#csPlot)">
          {zTrans !== null && <>
            <line x1={gx(zTrans)} y1={mt} x2={gx(zTrans)} y2={VH-mb} stroke={COLOR.trak} strokeWidth="0.6" strokeDasharray="3 2" opacity="0.4" />
            {/* unsichtbare, breitere Trefferfläche für den Hinweis */}
            <line x1={gx(zTrans)} y1={mt} x2={gx(zTrans)} y2={VH-mb} stroke="transparent" strokeWidth="6" style={{ pointerEvents: "stroke" }}>
              <title>{tr("cs.kinkTitle", { z: zTrans.toFixed(0) })}</title>
            </line>
          </>}
          {segments.map((seg, i) => (
            <path key={i} d={svgPath(seg.pts.map(p => [gx(p.z), gy(p.A)]), 1)} fill="none"
              stroke={PART_COLOR[seg.part]} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
        </g>
        {yTicks.map(a => <g key={a}>
          <line x1={axX-3} y1={gy(a)} x2={axX} y2={gy(a)} stroke={COLOR.axis} strokeWidth="0.5" />
          <text x={axX-5} y={gy(a)} textAnchor="end" dominantBaseline="central" fontSize="7" fill={COLOR.tick} fontFamily={FONT}>{a.toFixed(0)}</text>
        </g>)}
        {xTicks.map(t => <g key={t.z}>
          <line x1={gx(t.z)} y1={axY} x2={gx(t.z)} y2={axY+3} stroke={COLOR.axis} strokeWidth="0.5" />
          <text x={gx(t.z)} y={axY+11} textAnchor="middle" fontSize="7" fill={t.col} fontFamily={FONT}>{t.z.toFixed(0)}</text>
        </g>)}
      </svg>
    </div>
  );
});
