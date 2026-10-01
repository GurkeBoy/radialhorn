// Draufsicht (horizontaler Schnitt): Traktrix, gerade Wand, Mundbogen, Raumecke, Treiber.
import { useRef } from "react";
import { hasTraktrix, hasClothoid, traktrixPoints, clothoidPoints, entrancePoints, linearWallPoints } from "../horn-math.js";
import { COLOR, DOT, FONT, S, raumDash } from "../theme.js";
import { svgPath } from "../utils.js";
import { useSize, useZoomPan } from "../hooks.js";
import { ZoomControls, ArrowMarker } from "./ui.jsx";
import { Dim, DimAligned } from "./Dim.jsx";
import { FlanschSchnitt } from "./FlanschSchnitt.jsx";

const TRAKTRIX_SAMPLES = 600;
const CLOTHOID_SAMPLES = 120;
const WALL_SAMPLES = 80;
const DIM_LAYER = 18, DIM_LAYER_STEP = 22;   // Bemaßungslagen [px], siehe CLAUDE.md

/** @param flange  aufgelöster Throat-Flansch (flangeLayout) oder null */
export function Draufsicht({ s, rt, dw, dh, L, showRaumecke, showWandstaerke, wandstaerke, flange }) {
  const containerRef = useRef(null);
  const { w: VW, h: VH } = useSize(containerRef);
  const zoom = useZoomPan(containerRef);

  if (!s || VW < 10 || VH < 10) return (
    <div ref={containerRef} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: COLOR.trans, fontSize: 12, fontFamily: FONT }}>
      {!s ? "⚠ Parameter ungültig" : ""}
    </div>
  );

  // ── Abbildung Geometrie (x, z) → Bildschirm ───────────────────────
  const raumeckeEndX = dw / 2 + (s.zApex - (-dh));
  const zMin = s.hatTipZ - 140;
  const zMax = s.zApex + Math.max(16, Math.ceil((s.zApex - zMin) * 30 / 432));
  const xMax = Math.max(s.xMouth, dw / 2, flange ? flange.diameter / 2 : 0, showRaumecke ? raumeckeEndX + 4 : 0) + 20;

  const ml = 50, mr = 58, mt = 22, mb = 22;
  const drawW = VW - ml - mr, drawH = VH - mt - mb;
  const { k, tx, ty } = zoom.view;
  const scale0 = Math.min(drawW / (2 * xMax), drawH / (zMax - zMin));
  const cx0 = ml + drawW / 2;
  const scale = scale0 * k;
  const cx = tx + k * cx0;
  const topOffset = ty + k * (mt + (drawH - (zMax - zMin) * scale0) / 2);
  const toX = x => cx + x * scale;
  const toY = z => topOffset + (z - zMin) * scale;

  // Wandpunkte: rechte Seite und gespiegelte linke Seite
  const screen = pts => ({
    right: pts.map(([x, z]) => [toX(x), toY(z)]),
    left:  pts.map(([x, z]) => [toX(-x), toY(z)]),
  });
  const trak = screen(traktrixPoints(s, TRAKTRIX_SAMPLES));
  const klo  = screen(clothoidPoints(s, CLOTHOID_SAMPLES));
  const wall = screen(linearWallPoints(s, WALL_SAMPLES));
  const entrance = { left: [...trak.left, ...klo.left.slice(1)], right: [...trak.right, ...klo.right.slice(1)] };
  // Fläche zwischen linker und rechter Wand
  const areaPath = ({ left, right }) => svgPath([...left, ...[...right].reverse()]) + " Z";

  const fy  = toY(s.zFocus);
  const mRx = toX(s.xMouth), mLx = toX(-s.xMouth), mY = toY(s.zMouth);
  const rp  = s.arcR * scale;
  const outerX = Math.max(s.xMouth, showRaumecke ? raumeckeEndX : dw / 2);
  const ax  = toX(-outerX) - 30;   // linke Maßlagen
  const bx  = toX(outerX) + 30;    // rechte Maßlagen
  const reRx = toX(raumeckeEndX), reLx = toX(-raumeckeEndX), reY = toY(s.zApex);
  const hatX = toX(0), hatY = toY(s.hatTipZ);
  const tLx = toX(-s.xTrans), tLy = toY(s.zTrans);

  // Seitenwand-Bemaßung: Abstand senkrecht zur Wand so, dass die Maßlinie außerhalb von
  // Raumecke, Treiber und Traktrix liegt – berücksichtigt nur, was in Wandrichtung neben
  // der Bemaßung liegt.
  const wallDimOff = (() => {
    const len = Math.hypot(cx - mLx, fy - mY);
    const ux = (cx - mLx) / len, uy = (fy - mY) / len;
    const nx = uy, ny = -ux;                     // wie in DimAligned: links von Mund → Fokus
    const obstacles = [...entrance.left];
    const seg = (x1, y1, x2, y2, n = 40) => {
      for (let i = 0; i <= n; i++) obstacles.push([x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
    };
    if (showRaumecke) seg(hatX, hatY, reLx, reY);
    seg(toX(-dw / 2), toY(-dh), toX(dw / 2), toY(-dh));
    seg(toX(-dw / 2), toY(-dh), toX(-dw / 2), toY(0));
    let need = 0;
    for (const [qx, qy] of obstacles) {
      const t = (qx - mLx) * ux + (qy - mY) * uy;
      if (t >= 0 && t <= len) need = Math.max(need, (qx - mLx) * nx + (qy - mY) * ny);
    }
    return Math.max(DIM_LAYER, need + DIM_LAYER);
  })();

  const angleR = Math.min(rp * 0.13, 26);   // Radius des Öffnungswinkel-Bogens
  const sinA = Math.sin(s.alpha2), cosA = Math.cos(s.alpha2);

  return (
    <div ref={containerRef} {...zoom.handlers}
      style={{ position: "relative", width: "100%", height: "100%", cursor: "grab", touchAction: "none", userSelect: "none" }}>
      <ZoomControls k={k} onReset={zoom.reset} />
      <svg width="100%" height="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: "block" }}>
        <defs><ArrowMarker id="arrH" /></defs>

        <line x1={cx} y1={toY(s.hatTipZ - 6)} x2={cx} y2={toY(s.zApex) + 32} stroke={COLOR.axis} strokeWidth="0.6" strokeDasharray="5 4" />
        <text x={cx0} y={14} textAnchor="middle" fontSize="9" fill={COLOR.text} fontFamily={FONT} letterSpacing="0.12em">DRAUFSICHT · HORIZONTALER SCHNITT</text>

        {showRaumecke && <>
          {[reRx, reLx].map(x => (
            <line key={x} x1={hatX} y1={hatY} x2={x} y2={reY} stroke={COLOR.raum} strokeWidth="1.2" strokeLinecap="butt" strokeDasharray={raumDash(scale)} />
          ))}
          {[[hatX, hatY], [toX(dw / 2), toY(-dh)], [toX(-dw / 2), toY(-dh)], [reRx, reY], [reLx, reY]].map(([x, y]) => (
            <circle key={`${x},${y}`} cx={x} cy={y} r={DOT} fill={COLOR.raum} />
          ))}
          <RightAngleMark x={toX(dw / 2)} y={toY(-dh)} dx={-1} dy={1} size={8} color={COLOR.raum} />
        </>}

        <Treiber toX={toX} toY={toY} dw={dw} dh={dh} scale={scale} cx={cx} />

        {trak.left.length > 1 && <path d={areaPath(entrance)} fill={COLOR.fillTrak} />}
        <path d={areaPath(wall)} fill={COLOR.fillHorn} />

        <path d={`M${cx},${fy} L${mRx},${mY} A${rp},${rp} 0 0 1 ${mLx},${mY} Z`} fill={COLOR.fillArc} />
        <path d={`M${mRx},${mY} A${rp},${rp} 0 0 1 ${mLx},${mY}`} fill="none" stroke={COLOR.arc} strokeWidth="1.4" />

        {hasTraktrix(s) && (() => {
          const irp = s.rInner * scale;
          return <path d={`M${toX(s.xTrans)},${tLy} A${irp},${irp} 0 0 1 ${tLx},${tLy}`}
            fill="none" stroke={COLOR.trak} strokeWidth="0.9" strokeDasharray="6 3" />;
        })()}

        {[mRx, mLx].map(x => <line key={x} x1={cx} y1={fy} x2={x} y2={mY} stroke={COLOR.arc} strokeWidth="0.7" strokeDasharray="4 3" />)}
        <circle cx={cx} cy={fy} r={DOT} fill={COLOR.arc} />
        <circle cx={cx} cy={toY(s.zApex)} r={DOT} fill={COLOR.arc} />
        {/* rechter Winkel zwischen Fokusstrahl und Mundbogen */}
        {(() => {
          const len = Math.hypot(mRx - cx, mY - fy);
          const wx = (mRx - cx) / len, wy = (mY - fy) / len;
          return <path d={`M${mRx-wx*7},${mY-wy*7} L${mRx-wx*7-wy*7},${mY-wy*7+wx*7} L${mRx-wy*7},${mY+wx*7}`}
            fill="none" stroke={COLOR.arc} strokeWidth="0.9" />;
        })()}

        <circle cx={toX(rt)} cy={toY(0)} r={DOT} fill={COLOR.trak} />
        <circle cx={toX(-rt)} cy={toY(0)} r={DOT} fill={COLOR.trak} />

        {trak.left.length > 1 && <>
          <path d={svgPath(trak.left)} {...S.trakWall} />
          <path d={svgPath(trak.right)} {...S.trakWall} />
        </>}
        {klo.left.length > 1 && <>
          <path d={svgPath(klo.left)} {...S.kloWall} />
          <path d={svgPath(klo.right)} {...S.kloWall} />
        </>}
        <path d={svgPath(wall.left)} {...S.hornWall} />
        <path d={svgPath(wall.right)} {...S.hornWall} />

        {showWandstaerke && wandstaerke > 0 && <Wandstaerke s={s} toX={toX} toY={toY} t={wandstaerke} />}
        {flange && <FlanschSchnitt flange={flange} map={(x, z) => [toX(x), toY(z)]}
          inner={hasTraktrix(s) ? [...entrancePoints(s, 200, 60), ...linearWallPoints(s, 20).slice(1)] : linearWallPoints(s, 20)} />}

        {/* Übergangspunkte: Traktrix → (Klothoide →) gerade Wand */}
        {[trak.right, trak.left, klo.right, klo.left].filter(side => side.length > 1).map(side => {
          const [x, y] = side[side.length - 1];
          return <circle key={`${x},${y}`} cx={x} cy={y} r={DOT} fill={COLOR.trans} />;
        })}

        <path d={`M${cx+angleR*sinA},${fy+angleR*cosA} A${angleR},${angleR} 0 0 1 ${cx-angleR*sinA},${fy+angleR*cosA}`}
          fill="none" stroke={COLOR.dim} strokeWidth="0.8" />
        <text x={cx} y={fy + angleR * 0.5} textAnchor="middle" fontSize="9" fill={COLOR.dim} fontFamily={FONT}>{s.openingAngle}°</text>

        {/* Links: Gesamtlänge L */}
        <Dim p1={[cx, hatY]} p2={[cx, toY(s.zApex)]}
          arrowPos={ax} color={COLOR.dimL} marker="url(#arrH)" label={`L=${L} mm`} sw="0.8" />

        {/* Rechts, 1. Lage: Kette Hut-Spitze → Treiberrückseite → Treiberfront; 2. Lage: Traktrix */}
        <Dim p1={[toX(dw/2), toY(-dh)]} p2={[toX(dw/2), toY(0)]} orient="v"
          arrowPos={bx} color={COLOR.dim} marker="url(#arrH)" label={`${dh} mm`} />
        <Dim p1={[hatX, hatY]} p2={[toX(dw/2), toY(-dh)]} orient="v"
          arrowPos={bx} color={COLOR.raum} marker="url(#arrH)" label={`${(dw/2).toFixed(0)} mm`} />
        {/* mit Klothoide: Kette weiter über Traktrix und Klothoide bis zum Beginn der Geraden (axial, an der Wand) */}
        {hasClothoid(s) && (() => {
          const [xa, za] = s.clothoid.start;
          return <>
            <Dim p1={[toX(rt), toY(0)]} p2={[toX(xa), toY(za)]} orient="v"
              arrowPos={bx} color={COLOR.trak} marker="url(#arrH)" label={`${za.toFixed(0)} mm`} />
            <Dim p1={[toX(xa), toY(za)]} p2={[toX(s.xTrans), toY(s.zTrans)]} orient="v"
              arrowPos={bx} color={COLOR.klo} marker="url(#arrH)" label={`${(s.zTrans - za).toFixed(0)} mm`} />
          </>;
        })()}
        {hasTraktrix(s) &&
          <Dim p1={[toX(rt), toY(0)]} p2={[cx, toY(s.zInnerApex)]}
            arrowPos={bx + DIM_LAYER_STEP} color={COLOR.trak} marker="url(#arrH)" label={`${s.zInnerApex.toFixed(0)} mm`} />
        }

        {/* Oben: Throat (1. Lage), Treiberbreite (2. Lage) */}
        <Dim p1={[toX(-rt), toY(0)]} p2={[toX(rt), toY(0)]}
          arrowPos={hatY - 16} color={COLOR.trak} marker="url(#arrH)" label={`Ø ${(rt*2).toFixed(1)} mm`} />
        <Dim p1={[toX(-dw/2), toY(-dh)]} p2={[toX(dw/2), toY(-dh)]}
          arrowPos={hatY - 38} color={COLOR.dim} marker="url(#arrH)" label={`${dw} mm`} />

        {/* Seitenwand parallel zur Wand: gerader Bereich (1. Lage), Fokus → Mund (2. Lage) */}
        <DimAligned p1={[mLx, mY]} p2={[tLx, tLy]} offset={wallDimOff}
          color={COLOR.horn} marker="url(#arrH)" label={`${(s.arcR - s.rInner).toFixed(1)} mm`} />
        <DimAligned p1={[mLx, mY]} p2={[cx, fy]} offset={wallDimOff + DIM_LAYER_STEP}
          color={COLOR.arc} marker="url(#arrH)" label={`${s.arcR.toFixed(1)} mm`} />

        {/* Unten: Mundbreite, Radius */}
        <line x1={mLx} y1={mY+16} x2={mRx} y2={mY+16} stroke={COLOR.dim} strokeWidth="0.7" markerStart="url(#arrH)" markerEnd="url(#arrH)" />
        <text x={cx} y={mY+27} textAnchor="middle" fontSize="9" fill={COLOR.dim} fontFamily={FONT}>{(2 * s.xMouth).toFixed(0)} mm</text>
        <text x={cx} y={toY(s.zApex)+28} textAnchor="middle" fontSize="9" fill={COLOR.dim} fontFamily={FONT}>R={s.arcR.toFixed(0)} mm</text>
      </svg>

      <Legend showWandstaerke={showWandstaerke} showClothoid={hasClothoid(s)} showFlange={!!flange} />
    </div>
  );
}

function Treiber({ toX, toY, dw, dh, scale, cx }) {
  const x0 = toX(-dw / 2), x1 = toX(dw / 2), y0 = toY(-dh), y1 = toY(0);
  return <>
    <rect x={x0} y={y0} width={dw * scale} height={dh * scale} fill={COLOR.drivPlanFill} stroke={COLOR.drivPlan} strokeWidth="1.3" rx="2" />
    <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={COLOR.drivPlanDiag} strokeWidth="0.5" opacity="0.5" />
    <line x1={x1} y1={y0} x2={x0} y2={y1} stroke={COLOR.drivPlanDiag} strokeWidth="0.5" opacity="0.5" />
    <text x={cx} y={toY(-dh / 2)} textAnchor="middle" dominantBaseline="central" fontSize="10" fill={COLOR.text} fontFamily={FONT}>Treiber</text>
  </>;
}

/** Winkelzeichen im Punkt (x, y), Schenkel in Richtung dx bzw. dy (±1). */
function RightAngleMark({ x, y, dx, dy, size, color }) {
  return <path d={`M${x + dx*size},${y} L${x + dx*size},${y + dy*size} L${x},${y + dy*size}`} fill="none" stroke={color} strokeWidth="0.9" />;
}

/** Wandstärke an der Mundkante, senkrecht zur geraden Wand nach außen. */
function Wandstaerke({ s, toX, toY, t }) {
  const dx = s.xMouth - s.xTrans, dz = s.zMouth - s.zTrans;
  const len = Math.hypot(dx, dz);
  const nx = dz / len * t, nz = -dx / len * t;
  return [1, -1].map(sign => {
    const x0 = toX(sign * s.xMouth), x1 = toX(sign * (s.xMouth + nx)), y0 = toY(s.zMouth), y1 = toY(s.zMouth + nz);
    return <g key={sign}>
      <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={COLOR.wand} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx={x1} cy={y1} r={DOT} fill={COLOR.wand} />
    </g>;
  });
}

function Legend({ showWandstaerke, showClothoid, showFlange }) {
  const items = [
    { col: COLOR.trak,     label: "Traktrix" },
    ...(showClothoid ? [{ col: COLOR.klo, label: "Klothoide" }] : []),
    { col: COLOR.horn,     label: "Lin. Bereich" },
    { col: COLOR.arc,      label: "Teilkreis" },
    { col: COLOR.trans,    label: "Übergang",   kind: "dot" },
    { col: COLOR.drivPlan, label: "Treiber",    kind: "fill" },
    { col: COLOR.raum,     label: "Raumecke",   dash: true },
    ...(showWandstaerke ? [{ col: COLOR.wand, label: "Wandstärke" }] : []),
    ...(showFlange ? [{ col: COLOR.flansch, label: "Flansch", kind: "fill" }] : []),
    { col: COLOR.dim,      label: "Bemaßung" },
  ];
  return (
    <div style={{ position: "absolute", bottom: 8, right: 8, display: "flex", flexDirection: "column", gap: 3 }}>
      {items.map(({ col, label, kind, dash }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {kind === "dot"
            ? <div style={{ width: 10, height: 10, borderRadius: "50%", background: col, flexShrink: 0 }} />
            : kind === "fill"
            ? <div style={{ width: 12, height: 7, background: col, opacity: 0.5, borderRadius: 1, flexShrink: 0 }} />
            : <svg width="12" height="6" style={{ flexShrink: 0 }}>
                <line x1="0" y1="3" x2="12" y2="3" stroke={col} strokeWidth="1.4" strokeDasharray={dash ? "4 2" : "none"} />
              </svg>}
          <span style={{ fontSize: 8, color: COLOR.dim, fontFamily: FONT, whiteSpace: "nowrap" }}>{label}</span>
        </div>
      ))}
    </div>
  );
}
