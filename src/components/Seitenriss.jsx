// Seitenriss (vertikaler Schnitt): Throat, Aufweitung, optionale Verrundung, Treiber, Raumecke.
import { memo, useMemo, useRef } from "react";
import { useT } from "../i18n.js";
import { hasTraktrix } from "../horn-math.js";
import { COLOR, DOT, FONT, S, raumDash, raumDashCenter } from "../theme.js";
import { linspace, nestedLayers, fmtLength } from "../utils.js";
import { useSize, useZoomPan } from "../hooks.js";
import { ZoomControls, ArrowMarker, ViewTitle } from "./ui.jsx";
import { Dim } from "./Dim.jsx";
import { FlanschSchnitt } from "./FlanschSchnitt.jsx";
import { WandSchnitt } from "./WandSchnitt.jsx";
import { shellProfileOutline } from "../horn-mesh.js";

const DIM_LEADER = 24;   // Länge der Radius-Leitlinie außerhalb der Wand [px]

/**
 * @param profile  z ↦ halbe Höhe inkl. Verrundung (makeProfile)
 * @param fillet   Verrundung (computeFillet) oder null – nur für Markierungen
 * @param flange   aufgelöster Throat-Flansch (flangeLayout) oder null
 * @param wall     Wandstärke [mm]; > 0 zeichnet den Schnitt durch die Schale
 */
export const Seitenriss = memo(function Seitenriss({ s, rt, dw, dh, L, hMouth, profile, fillet, flange, wall = 0 }) {
  const tr = useT();
  const containerRef = useRef(null);
  const { w: VW, h: VH } = useSize(containerRef);
  const zoom = useZoomPan(containerRef);

  // Schnitt durch die Schale in Geometrie-Koordinaten: nur bei Geometrieänderung neu, nicht bei Zoom
  const zShell = flange ? flange.thickness : 0;
  const shellCut = useMemo(() => s && wall > 0 ? {
    inner: linspace(zShell, s.zApex, 300).map(z => [profile(z), z]),
    outer: shellProfileOutline(s, rt, profile, wall, zShell),
  } : null, [s, rt, profile, wall, zShell]);

  if (!s || VW < 10 || VH < 10) return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;

  // ── Abbildung Geometrie (z, h) → Bildschirm ───────────────────────
  const halfMax = Math.max(dw / 2, hMouth / 2 + wall, flange ? flange.diameter / 2 : 0) * 1.05;
  const zMin = s.hatTipZ - 10, zMax = s.zApex + 10;
  const mT = Math.min(80, VH * 0.45), mB = Math.min(flange ? 62 : 40, VH * 0.15);   // oben: Titel + zwei Maßlagen
  const scale0 = Math.min((VW - Math.min(80, VW * 0.12) * 2) / (zMax - zMin), (VH - mT - mB) / (2 * halfMax));
  const contentW = (zMax - zMin) * scale0;
  const cy = mT + (VH - mT - mB) / 2;
  const { k, tx, ty } = zoom.view;
  const scale = scale0 * k;
  const toX = z => tx + k * ((VW - contentW) / 2 + (z - zMin) * scale0);
  const toY = h => ty + k * (cy - h * scale0);

  // ── Wand: Sektionen bleiben an zInnerApex farblich getrennt; eine Verrundung liegt
  //    zur Hälfte in der Throat- (rosa), zur Hälfte in der Aufweitungssektion (grün) ──
  const trakOn = hasTraktrix(s);
  const zProfileStart = trakOn ? s.zInnerApex : 0;
  const zThroat = fillet ? [0, ...linspace(fillet.zT1, s.zInnerApex, 30)] : [0, s.zInnerApex];
  const zFlare  = fillet
    ? [...linspace(s.zInnerApex, fillet.zT2, 30), ...linspace(fillet.zT2, s.zApex, 120).slice(1)]
    : linspace(zProfileStart, s.zApex, 120);
  const wallPath = (zs, sign) => zs.map((z, i) => `${i === 0 ? "M" : "L"}${toX(z)},${toY(sign * profile(z))}`).join(" ");
  const hTrans = profile(s.zInnerApex);

  // Bemaßungslagen
  const dimMouthX  = toX(s.zApex) + 18;
  // links verschachtelt nach Größe: Throat, Treiber, Flansch – das kleinste innen
  const [throatLayer, drivLayer, flangeLayer] = nestedLayers([2 * rt, dw, flange ? flange.diameter : Infinity]);
  const leftDimX   = layer => toX(s.hatTipZ) - 18 - 22 * layer;
  const dimThroatX = leftDimX(throatLayer);
  const dimDrivX   = leftDimX(drivLayer);
  const dimFlangeX = leftDimX(flangeLayer);
  const dimLY      = toY(-halfMax) + 16;
  const dimTop1Y   = toY(halfMax) - 18;
  const dimTop2Y   = toY(halfMax) - 40;

  return (
    <div ref={containerRef} {...zoom.handlers}
      style={{ position: "relative", width: "100%", height: "100%", cursor: "grab", touchAction: "none", userSelect: "none" }}>
      <ViewTitle>{tr("view.sideTitle")}</ViewTitle>
      <ZoomControls k={k} onReset={zoom.reset} />
      <svg width="100%" height="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: "block" }}>
        <defs><ArrowMarker id="arrV" /></defs>

        <line x1={toX(s.hatTipZ)} y1={toY(0)} x2={toX(s.zApex)} y2={toY(0)} stroke={COLOR.axis} strokeWidth="0.6" strokeDasharray="5 4" />

        {/* Treiber */}
        <rect x={toX(-dh)} y={toY(dw/2)} width={dh*scale} height={dw*scale} fill={COLOR.drivFill} stroke={COLOR.driv} strokeWidth="1.3" rx="2" />
        <text x={toX(-dh/2)} y={toY(0)} {...S.label} textAnchor="middle" dominantBaseline="central" fill={COLOR.text}>{tr("view.driver")}</text>

        {/* Raumecke: von der Achse aus nach oben und unten, Strichmuster symmetrisch zur Achse */}
        {[halfMax, -halfMax].map(hEnd =>
          <line key={hEnd} x1={toX(s.hatTipZ)} y1={toY(0)} x2={toX(s.hatTipZ)} y2={toY(hEnd)}
            stroke={COLOR.raum} strokeWidth="1.2" strokeLinecap="butt"
            strokeDasharray={raumDash(scale)} strokeDashoffset={raumDashCenter(scale)} />
        )}

        <circle cx={toX(0)} cy={toY(rt)} r={DOT} fill={COLOR.trak} />
        <circle cx={toX(0)} cy={toY(-rt)} r={DOT} fill={COLOR.trak} />

        {trakOn && <>
          {[1, -1].map(sign =>
            <path key={sign} d={wallPath(zThroat, sign)} fill="none" stroke={COLOR.trak} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          )}
          <circle cx={toX(s.zInnerApex)} cy={toY(hTrans)} r={DOT} fill={COLOR.trans} />
          <circle cx={toX(s.zInnerApex)} cy={toY(-hTrans)} r={DOT} fill={COLOR.trans} />
          {fillet && <FilletMarks fillet={fillet} rt={rt} wall={wall} scale={scale} toX={toX} toY={toY} />}
        </>}

        {shellCut && <WandSchnitt inner={shellCut.inner} outer={shellCut.outer}
          closeThroat={!flange} map={(h, z) => [toX(z), toY(h)]} />}
        {flange && <FlanschSchnitt flange={flange} map={(h, z) => [toX(z), toY(h)]}
          inner={linspace(0, flange.thickness, 30).map(z => [profile(z), z])} />}

        <path d={wallPath(zFlare, 1)} {...S.hornWall} />
        <path d={wallPath(zFlare, -1)} {...S.hornWall} />
        <circle cx={toX(s.zApex)} cy={toY(hMouth/2)} r={DOT} fill={COLOR.arc} />
        <circle cx={toX(s.zApex)} cy={toY(-hMouth/2)} r={DOT} fill={COLOR.arc} />

        {/* Rechts: Mundhöhe, als Kette weiter mit der Wandstärke */}
        <Dim p1={[toX(s.zApex), toY(hMouth/2)]} p2={[toX(s.zApex), toY(-hMouth/2)]}
          arrowPos={dimMouthX} color={COLOR.arc} marker="url(#arrV)" label={`${hMouth} mm`} />
        {wall > 0 &&
          <Dim p1={[toX(s.zApex), toY(hMouth/2 + wall)]} p2={[toX(s.zApex), toY(hMouth/2)]}
            arrowPos={dimMouthX} color={COLOR.wand} marker="url(#arrV)" label={`${wall} mm`} />
        }
        {/* Links: Throat, Treiberbreite, Flansch-Ø – nach Größe verschachtelt */}
        <Dim p1={[toX(0), toY(rt)]} p2={[toX(0), toY(-rt)]}
          arrowPos={dimThroatX} color={COLOR.trak} marker="url(#arrV)" label={`Ø ${(rt*2).toFixed(1)} mm`} />
        <Dim p1={[toX(-dh), toY(dw/2)]} p2={[toX(-dh), toY(-dw/2)]}
          arrowPos={dimDrivX} color={COLOR.dim} marker="url(#arrV)" label={`${dw} mm`} />
        {/* Flansch-Ø (links, Lage nach Größe) und -Dicke (unten, 2. Lage) */}
        {flange && <>
          <Dim p1={[toX(0), toY(flange.diameter / 2)]} p2={[toX(0), toY(-flange.diameter / 2)]}
            arrowPos={dimFlangeX} color={COLOR.flansch} marker="url(#arrV)" label={`Ø ${flange.diameter.toFixed(0)} mm`} />
          <Dim p1={[toX(0), toY(-flange.diameter / 2)]} p2={[toX(flange.thickness), toY(-flange.diameter / 2)]} orient="h"
            arrowPos={dimLY + 22} color={COLOR.flansch} marker="url(#arrV)" label={`${flange.thickness} mm`} />
        </>}
        {/* Unten: Gesamtlänge */}
        <Dim p1={[toX(s.hatTipZ), toY(0)]} p2={[toX(s.zApex), toY(0)]}
          arrowPos={dimLY} color={COLOR.dim} marker="url(#arrV)" label={`L=${fmtLength(L)} mm`} sw="0.8" />
        {/* Oben, 1. Lage: Kette Hut-Spitze → Treiberrückseite → Treiberfront */}
        <Dim p1={[toX(s.hatTipZ), toY(dw/2)]} p2={[toX(-dh), toY(dw/2)]} orient="h"
          arrowPos={dimTop1Y} color={COLOR.raum} marker="url(#arrV)" label={`${(dw/2).toFixed(0)} mm`} />
        <Dim p1={[toX(-dh), toY(dw/2)]} p2={[toX(0), toY(dw/2)]}
          arrowPos={dimTop1Y} color={COLOR.driv} marker="url(#arrV)" label={`${dh} mm`} />
        {/* Oben, 2. Lage: Kette Traktrix → Mund (axiale Längen) */}
        {trakOn &&
          <Dim p1={[toX(0), toY(rt)]} p2={[toX(s.zInnerApex), toY(hTrans)]} orient="h"
            arrowPos={dimTop2Y} color={COLOR.trak} marker="url(#arrV)" label={`${s.zInnerApex.toFixed(0)} mm`} />
        }
        <Dim p1={[toX(zProfileStart), toY(profile(zProfileStart))]} p2={[toX(s.zApex), toY(hMouth/2)]} orient="h"
          arrowPos={dimTop2Y} color={COLOR.horn} marker="url(#arrV)" label={`${(s.zApex - zProfileStart).toFixed(0)} mm`} />
      </svg>
    </div>
  );
});

/**
 * Tangentenpunkte der Verrundung und Radiusmaß: kurze Leitlinie auf der Radiallinie durch die
 * Bogenmitte, Pfeil am Bogen, Richtung Mittelpunkt – nur so lang, dass die Beschriftung außerhalb
 * der Wand (und der Schale) steht, statt bis zum oft weit entfernten Mittelpunkt. Am unteren
 * Bogen, oben kreuzen die Hilfslinien der axialen Maße (Traktrix → Mund).
 */
function FilletMarks({ fillet, rt, wall, scale, toX, toY }) {
  const a2 = Math.atan2(fillet.hT2 - fillet.hc, fillet.zT2 - fillet.zc);   // T1 liegt bei −90°
  const mid = (-Math.PI / 2 + a2) / 2;
  // unterer Bogen: Spiegelbild des oberen (Mittelpunkt bei −hc)
  const mx = toX(fillet.zc + fillet.R * Math.cos(mid)), my = toY(-(fillet.hc + fillet.R * Math.sin(mid)));
  const cx = toX(fillet.zc), cy = toY(-fillet.hc);
  const dist = Math.hypot(cx - mx, cy - my);
  const len = Math.min(dist, wall * scale + DIM_LEADER);
  const ux = (cx - mx) / dist, uy = (cy - my) / dist;
  const ex = mx + ux * len, ey = my + uy * len;
  return <>
    {[1, -1].map(sign => <g key={sign}>
      <circle cx={toX(fillet.zT1)} cy={toY(sign * rt)}         r={DOT * 0.7} fill={COLOR.trak} />
      <circle cx={toX(fillet.zT2)} cy={toY(sign * fillet.hT2)} r={DOT * 0.7} fill={COLOR.horn} />
    </g>)}
    <line x1={mx} y1={my} x2={ex} y2={ey} strokeWidth="0.7" stroke={COLOR.trans} markerStart="url(#arrV)" />
    <text x={ex + ux * 8} y={ey + uy * 8} {...S.label} textAnchor="middle" dominantBaseline="central" fill={COLOR.trans}>
      R {fillet.R.toFixed(fillet.R % 1 ? 1 : 0)}
    </text>
  </>;
}
