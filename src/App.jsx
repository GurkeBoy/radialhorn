import { useState, useEffect, useCallback, useRef } from "react";
import {
  ALPHA2, T_TRANS,
  setOpeningAngle as applyOpeningAngle,   // eigener Name: App hat einen State-Setter setOpeningAngle
  zN, xN, solveHorn, minL, maxLt, maxLforRaumecke, minLtForRaumecke,
  verticalHalfHeight, computeFillet,
} from "./horn-math.js";

// Hook: misst die Größe eines DOM-Elements via ResizeObserver
function useSize(ref) {
  const [size, setSize] = useState({ w: 540, h: 480 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// Hook: Zoom (Mausrad, um den Cursor) und Verschieben (Klick+Drag) einer Ansicht.
// Liefert eine Bildschirm-Transformation p' = t + k·p, die auf die
// Basis-Abbildung (Standard-Zoom, zentriert) angewendet wird.
const ZOOM_MIN = 0.25, ZOOM_MAX = 20;
const VIEW_RESET = { k: 1, tx: 0, ty: 0 };

// Optionen: minZoom (Diagramme: nicht kleiner als 100 %), unitsPerPx (Umrechnung
// Bildschirm-px → eigene Koordinaten, z.B. bei per viewBox skaliertem SVG).
function useZoomPan(ref, { minZoom = ZOOM_MIN, unitsPerPx = () => 1 } = {}) {
  const [view, setView] = useState(VIEW_RESET);
  const drag = useRef(null);

  // Wheel-Listener nativ und nicht passiv, damit preventDefault das Scrollen verhindert.
  // Ohne Dependency-Array: das Element hinter ref kann zwischen Renders wechseln.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const u = unitsPerPx();
      const mx = (e.clientX - r.left) * u, my = (e.clientY - r.top) * u;
      const factor = Math.exp(-e.deltaY * 0.0015);
      setView(v => {
        const k = Math.min(ZOOM_MAX, Math.max(minZoom, v.k * factor));
        if (minZoom >= 1 && k <= 1) return VIEW_RESET;   // Diagramm: bei 100 % wieder ganz sichtbar
        const f = k / v.k;
        return { k, tx: mx - (mx - v.tx) * f, ty: my - (my - v.ty) * f };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const onPointerDown = e => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = e => {
    if (!drag.current) return;
    const u = unitsPerPx();
    const dx = (e.clientX - drag.current.x) * u, dy = (e.clientY - drag.current.y) * u;
    drag.current = { x: e.clientX, y: e.clientY };
    setView(v => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const onPointerUp = () => { drag.current = null; };

  return {
    view,
    reset: () => setView(VIEW_RESET),
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}

// Zoomstufe + Zurücksetzen, oben rechts (Standard: links neben dem Vollbild-Button).
// compact: kleinere Variante für den Querschnittsgraphen in der Seitenleiste.
function ZoomControls({ k, onReset, top = 6, right = 36, compact = false }) {
  const stop = e => e.stopPropagation();
  const h = compact ? 18 : 24, fs = compact ? 9 : 10;
  return (
    <div onPointerDown={stop} style={{
      position: "absolute", top, right, zIndex: 10, display: "flex", gap: 4, alignItems: "center",
    }}>
      <span style={{
        background: "rgba(20,20,20,0.85)", border: "1px solid #303030", borderRadius: 4,
        color: "#6e6e6e", fontSize: fs, fontFamily: "'DM Mono', monospace",
        height: h, boxSizing: "border-box", padding: "0 6px", display: "flex", alignItems: "center",
      }}>
        {Math.round(k * 100)} %
      </span>
      <button onClick={onReset} title="Zoom zurücksetzen" style={{
        background: "rgba(20,20,20,0.85)", border: "1px solid #303030", borderRadius: 4,
        color: "#6e6e6e", cursor: "pointer", height: h, padding: compact ? "0 5px" : "0 7px",
        fontSize: fs, fontFamily: "'DM Mono', monospace",
      }}>
        ⟲ Reset
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// GEOMETRIE (Solver, Grenzen, vertikales Profil, Verrundung) → horn-math.js
// ──────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────
// EXPORT: Punktgenerierung + DXF/PDF
// ──────────────────────────────────────────────────────────────────

function genDraufsichtWand(s) {
  const pts = [];
  if (s.Lt > 0.5) {
    for (let i = 0; i <= 500; i++) {
      const t = s.tTh + (T_TRANS - s.tTh) * i / 500;
      const z = s.r0 * (zN(s.tTh) - zN(t));
      const x = s.r0 * xN(t);
      pts.push([x, z]);
    }
  } else {
    pts.push([s.xTrans, s.zTrans]);
  }
  for (let i = 1; i <= 50; i++) {
    const f = i / 50;
    const z = s.zTrans + f * s.Ls;
    const x = s.xTrans + f * s.Ls * Math.tan(ALPHA2);
    pts.push([x, z]);
  }
  return pts;
}

// Traktrix-Kurve und gerader Kegelabschnitt getrennt (für DXF-Export: unterschiedliche
// Entity-Typen je nach tatsächlicher Geometrie, statt alles als eine facettierte Polylinie).
function genDraufsichtWandSplit(s) {
  const trak = [];
  if (s.Lt > 0.5) {
    for (let i = 0; i <= 80; i++) {
      const t = s.tTh + (T_TRANS - s.tTh) * i / 80;
      const z = s.r0 * (zN(s.tTh) - zN(t));
      const x = s.r0 * xN(t);
      trak.push([x, z]);
    }
  }
  return { trak, coneStart: [s.xTrans, s.zTrans], coneEnd: [s.xMouth, s.zMouth] };
}


// Gleichmäßig verteilte Werte von a bis b (n Intervalle)
const linspace = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);

function genSeitenprofilThroat(s, rt) {
  if (s.Lt <= 0.5) return [];
  return [[0, rt], [s.zInnerApex, rt]];
}

function genSeitenprofilFlare(s, rt, hMouth, curve, hypexT, n = 100, zFrom = null) {
  const pts = [];
  const zStart = zFrom ?? (s.Lt > 0.5 ? s.zInnerApex : 0);
  for (let i = 0; i <= n; i++) {
    const z = zStart + (s.zApex - zStart) * i / n;
    const h = verticalHalfHeight(z, s, rt, hMouth, curve, hypexT);
    pts.push([z, h]);
  }
  return pts;
}

function genSeitenprofil(s, rt, hMouth, curve, hypexT, fillet = null) {
  if (!fillet) return [...genSeitenprofilThroat(s, rt), ...genSeitenprofilFlare(s, rt, hMouth, curve, hypexT, 500)];
  // Mit Verrundung: Throat bis T1, dann Bogen und Aufweitung als ein Linienzug
  return [[0, rt], ...linspace(fillet.zT1, s.zApex, 500)
    .map(z => [z, verticalHalfHeight(z, s, rt, hMouth, curve, hypexT, fillet)])];
}

// ──────────────────────────────────────────────────────────────────
// DXF: kubische B-Spline-Interpolation (Piegl & Tiller, "The NURBS Book", Kap. 9.2.1)
// Erzeugt eine echte analytische SPLINE-Entity (Kontrollpunkte + Knotenvektor) durch
// die gegebenen Punkte, statt sie als facettierte Polylinie zu exportieren. Das ist
// der Grund, warum aus DXF-Kurven erzeugte Solids in CAD-Systemen (z.B. NX) bislang
// eckig/facettiert statt glatt wurden: POLYLINE/VERTEX ist immer stückweise linear.
// ──────────────────────────────────────────────────────────────────

function findSpan(n, p, u, U) {
  if (u >= U[n + 1]) return n;
  if (u <= U[p]) return p;
  let lo = p, hi = n + 1, mid = Math.floor((lo + hi) / 2);
  while (u < U[mid] || u >= U[mid + 1]) {
    if (u < U[mid]) hi = mid; else lo = mid;
    mid = Math.floor((lo + hi) / 2);
  }
  return mid;
}

function basisFuns(span, u, p, U) {
  const N = [1];
  const left = [0], right = [0];
  for (let j = 1; j <= p; j++) {
    left[j] = u - U[span + 1 - j];
    right[j] = U[span + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const temp = N[r] / (right[r + 1] + left[j - r]);
      N[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    N[j] = saved;
  }
  return N;
}

// Passt einen geklemmten kubischen B-Spline (Sehnenlängen-Parametrisierung, Averaging-
// Knotenvektor) exakt durch alle Punkte. Löst dazu ein lineares Gleichungssystem
// (Gauß-Elimination mit Partial Pivoting, gemeinsame Matrix für alle Dimensionen).
function fitBSpline(ptsIn) {
  const pts = [ptsIn[0]];
  for (let i = 1; i < ptsIn.length; i++) {
    const a = pts[pts.length - 1], b = ptsIn[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] || 0) - (a[2] || 0));
    if (d > 1e-6) pts.push(b);
  }
  const n = pts.length - 1;
  const p = Math.min(3, n);
  if (p < 1) return null;
  const dim = pts[0].length;

  const dist = [0];
  let total = 0;
  for (let k = 1; k <= n; k++) {
    let d = 0;
    for (let c = 0; c < dim; c++) d += (pts[k][c] - pts[k - 1][c]) ** 2;
    total += Math.sqrt(d);
    dist.push(total);
  }
  const t = dist.map(d => (total > 0 ? d / total : 0));
  t[0] = 0; t[n] = 1;

  const m = n + p + 1;
  const U = new Array(m + 1);
  for (let i = 0; i <= p; i++) U[i] = 0;
  for (let i = 0; i <= p; i++) U[m - i] = 1;
  for (let j = 1; j <= n - p; j++) {
    let s = 0;
    for (let i = j; i <= j + p - 1; i++) s += t[i];
    U[j + p] = s / p;
  }

  const N = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  for (let k = 0; k <= n; k++) {
    const span = findSpan(n, p, t[k], U);
    const basis = basisFuns(span, t[k], p, U);
    for (let i = 0; i <= p; i++) N[k][span - p + i] = basis[i];
  }

  const rhs = Array.from({ length: dim }, (_, c) => pts.map(pt => pt[c] || 0));
  const A = N.map(row => row.slice());
  for (let col = 0; col <= n; col++) {
    let piv = col;
    for (let r = col + 1; r <= n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (piv !== col) {
      [A[col], A[piv]] = [A[piv], A[col]];
      for (let c = 0; c < dim; c++) [rhs[c][col], rhs[c][piv]] = [rhs[c][piv], rhs[c][col]];
    }
    const pv = A[col][col];
    for (let r = col + 1; r <= n; r++) {
      const f = A[r][col] / pv;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
      for (let c = 0; c < dim; c++) rhs[c][r] -= f * rhs[c][col];
    }
  }
  const P = Array.from({ length: n + 1 }, () => new Array(dim).fill(0));
  for (let r = n; r >= 0; r--) {
    for (let c = 0; c < dim; c++) {
      let sum = rhs[c][r];
      for (let cc = r + 1; cc <= n; cc++) sum -= A[r][cc] * P[cc][c];
      P[r][c] = sum / A[r][r];
    }
  }
  return { degree: p, knots: U, controlPoints: P, fitPoints: pts };
}

function dxfSpline(pts, layer) {
  const fit = fitBSpline(pts);
  if (!fit) return "";
  const { degree, knots, controlPoints, fitPoints } = fit;
  let s = `0\nSPLINE\n8\n${layer}\n100\nAcDbSpline\n210\n0\n220\n0\n230\n1\n`;
  s += `70\n8\n71\n${degree}\n72\n${knots.length}\n73\n${controlPoints.length}\n74\n${fitPoints.length}\n`;
  for (const k of knots) s += `40\n${k.toFixed(8)}\n`;
  for (const cp of controlPoints) s += `10\n${cp[0].toFixed(4)}\n20\n${cp[1].toFixed(4)}\n30\n${(cp[2] || 0).toFixed(4)}\n`;
  for (const fp of fitPoints) s += `11\n${fp[0].toFixed(4)}\n21\n${fp[1].toFixed(4)}\n31\n${(fp[2] || 0).toFixed(4)}\n`;
  return s;
}

function dxfLine(p1, p2, layer) {
  return `0\nLINE\n8\n${layer}\n10\n${p1[0].toFixed(4)}\n20\n${p1[1].toFixed(4)}\n30\n${(p1[2] || 0).toFixed(4)}\n11\n${p2[0].toFixed(4)}\n21\n${p2[1].toFixed(4)}\n31\n${(p2[2] || 0).toFixed(4)}\n`;
}

// normal: Extrusionsrichtung (OCS). Für Bögen im Seitenprofil (Ebene y = 0) wird
// (0,-1,0) verwendet: nach dem Arbitrary-Axis-Algorithmus ist dann OCS-x = Welt-X
// und OCS-y = Welt-Z, cx/cy/Winkel also direkt in (z, h) angebbar.
function dxfArc(cx, cy, r, startDeg, endDeg, layer, normal = null) {
  const ext = normal ? `210\n${normal[0]}\n220\n${normal[1]}\n230\n${normal[2]}\n` : "";
  return `0\nARC\n8\n${layer}\n100\nAcDbCircle\n10\n${cx.toFixed(4)}\n20\n${cy.toFixed(4)}\n30\n0\n40\n${r.toFixed(4)}\n${ext}100\nAcDbArc\n50\n${startDeg.toFixed(4)}\n51\n${endDeg.toFixed(4)}\n`;
}

function dxfPoint(x, y, layer, z = 0) {
  return `0\nPOINT\n8\n${layer}\n10\n${x.toFixed(4)}\n20\n${y.toFixed(4)}\n30\n${z.toFixed(4)}\n`;
}

function buildDXF(sections) {
  let body = "";
  for (const sec of sections) {
    if (sec.type === "point") body += dxfPoint(sec.x, sec.y, sec.layer, sec.z ?? 0);
    else if (sec.type === "line") body += dxfLine(sec.p1, sec.p2, sec.layer);
    else if (sec.type === "spline") body += dxfSpline(sec.pts, sec.layer);
    else if (sec.type === "arc") body += dxfArc(sec.cx, sec.cy, sec.r, sec.start, sec.end, sec.layer, sec.normal);
  }
  return `0\nSECTION\n2\nENTITIES\n${body}0\nENDSEC\n0\nEOF\n`;
}

function downloadFile(content, filename, mime) {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    return true;
  } catch (e) {
    try {
      const a = document.createElement("a");
      a.href = "data:" + mime + ";charset=utf-8," + encodeURIComponent(content);
      a.download = filename; a.click();
      return true;
    } catch (e2) { return false; }
  }
}

function exportPDF(s, rt, dw, dh, L, hMouth, curve, hypexT, openingAngle, showRaumecke, showWandstaerke, wandstaerke, opts) {
  const scales = [1, 2, 5, 10, 20, 50];
  const wallPts = genDraufsichtWand(s);
  const maxX = Math.max(...wallPts.map(p => p[0])) * 2;
  const maxZ = s.zApex;
  const profPts = genSeitenprofil(s, rt, hMouth, curve, hypexT, opts.fillet);
  const profMaxH = Math.max(...profPts.map(p => p[1])) * 2;

  const sheetMM = 170;
  const drawMax = Math.max(maxX, maxZ, profMaxH);
  const massstab = scales.find(sc => drawMax / sc <= sheetMM) || 100;
  const mm2px = 96 / 25.4 / massstab;

  const pathFromPts = pts => pts.map((p, i) => `${i===0?'M':'L'}${(p[0]).toFixed(2)},${(p[1]).toFixed(2)}`).join(" ");

  const DIM = "#7c5cff", DIMTXT = "#5a4bbf";
  const ts = massstab * 2.4;
  const tick = massstab * 1.2;
  const dimH = (x1, x2, y, label, below) => `
    <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${DIM}" stroke-width="0.25"/>
    <line x1="${x1}" y1="${y-tick}" x2="${x1}" y2="${y+tick}" stroke="${DIM}" stroke-width="0.25"/>
    <line x1="${x2}" y1="${y-tick}" x2="${x2}" y2="${y+tick}" stroke="${DIM}" stroke-width="0.25"/>
    <text x="${(x1+x2)/2}" y="${y + (below ? ts*1.1 : -ts*0.5)}" font-size="${ts}" fill="${DIMTXT}" text-anchor="middle" font-family="monospace">${label}</text>`;
  const dimV = (y1, y2, x, label, right) => `
    <line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${DIM}" stroke-width="0.25"/>
    <line x1="${x-tick}" y1="${y1}" x2="${x+tick}" y2="${y1}" stroke="${DIM}" stroke-width="0.25"/>
    <line x1="${x-tick}" y1="${y2}" x2="${x+tick}" y2="${y2}" stroke="${DIM}" stroke-width="0.25"/>
    <text x="${x + (right ? ts*0.6 : -ts*0.6)}" y="${(y1+y2)/2}" font-size="${ts}" fill="${DIMTXT}" text-anchor="${right ? 'start' : 'end'}" dominant-baseline="middle" font-family="monospace" transform="rotate(-90 ${x + (right ? ts*0.6 : -ts*0.6)} ${(y1+y2)/2})">${label}</text>`;
  // Schräge Bemaßung parallel zur Strecke; offset positiv = links von (x1,y1)→(x2,y2)
  const dimParallel = (x1, y1, x2, y2, offset, label) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 0.01) return '';
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const nx = uy, ny = -ux;
    const d1x = x1 + nx*offset, d1y = y1 + ny*offset;
    const d2x = x2 + nx*offset, d2y = y2 + ny*offset;
    let angle = Math.atan2(uy, ux) * 180 / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    const tx = (d1x + d2x)/2 + nx*ts*0.9, ty = (d1y + d2y)/2 + ny*ts*0.9;
    const sg = Math.sign(offset || 1) * 0.8;
    const f = v => v.toFixed(2);
    return `
    <line x1="${f(x1+nx*sg)}" y1="${f(y1+ny*sg)}" x2="${f(d1x+nx*sg)}" y2="${f(d1y+ny*sg)}" stroke="${DIM}" stroke-width="0.15"/>
    <line x1="${f(x2+nx*sg)}" y1="${f(y2+ny*sg)}" x2="${f(d2x+nx*sg)}" y2="${f(d2y+ny*sg)}" stroke="${DIM}" stroke-width="0.15"/>
    <line x1="${f(d1x)}" y1="${f(d1y)}" x2="${f(d2x)}" y2="${f(d2y)}" stroke="${DIM}" stroke-width="0.25"/>
    <line x1="${f(d1x-uy*tick)}" y1="${f(d1y+ux*tick)}" x2="${f(d1x+uy*tick)}" y2="${f(d1y-ux*tick)}" stroke="${DIM}" stroke-width="0.25"/>
    <line x1="${f(d2x-uy*tick)}" y1="${f(d2y+ux*tick)}" x2="${f(d2x+uy*tick)}" y2="${f(d2y-ux*tick)}" stroke="${DIM}" stroke-width="0.25"/>
    <text x="${f(tx)}" y="${f(ty)}" font-size="${ts}" fill="${DIMTXT}" text-anchor="middle" dominant-baseline="central" font-family="monospace" transform="rotate(${angle.toFixed(1)} ${f(tx)} ${f(ty)})">${label}</text>`;
  };

  const dimPad = massstab * 14;
  const dsTopPad = massstab * 8;
  const dsW = maxX + 20 + dimPad * 2, dsH = maxZ + dsTopPad + dimPad;
  const dsOX = dsW / 2, dsOY = dsTopPad;
  const wallR = wallPts.map(([x, z]) => [dsOX + x, dsOY + z]);
  const wallL = wallPts.map(([x, z]) => [dsOX - x, dsOY + z]);
  const arcPts = [];
  for (let i = 0; i <= 60; i++) {
    const a = -ALPHA2 + 2 * ALPHA2 * i / 60;
    arcPts.push([dsOX + s.arcR * Math.sin(a), dsOY + s.zFocus + s.arcR * Math.cos(a)]);
  }
  const halfMundB = Math.max(...wallPts.map(p => p[0]));
  const mundB = (2 * halfMundB).toFixed(0);
  const dsSVG = `
    <svg width="${dsW * mm2px}px" height="${dsH * mm2px}px" viewBox="0 0 ${dsW} ${dsH}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${dsOX}" y1="${dsOY}" x2="${dsOX}" y2="${dsOY + maxZ}" stroke="#c8c8d0" stroke-width="0.2" stroke-dasharray="3 2"/>
      ${opts.draufsicht ? `<path d="${pathFromPts(wallR)}" fill="none" stroke="#1a1a24" stroke-width="0.5"/>
      <path d="${pathFromPts(wallL)}" fill="none" stroke="#1a1a24" stroke-width="0.5"/>` : ''}
      ${opts.mundbogen ? `<path d="${pathFromPts(arcPts)}" fill="none" stroke="#7c5cff" stroke-width="0.5"/>` : ''}
      ${opts.fokus ? `<circle cx="${dsOX}" cy="${dsOY + s.zFocus}" r="0.7" fill="#7c5cff"/>` : ''}
      ${opts.bemassung ? dimH(dsOX - rt, dsOX + rt, dsOY - massstab*5, "Ø" + (rt*2).toFixed(1), false) : ''}
      ${opts.bemassung ? dimH(dsOX - halfMundB, dsOX + halfMundB, dsOY + maxZ + massstab*5, mundB, true) : ''}
      ${opts.bemassung ? dimV(dsOY, dsOY + maxZ, dsOX - halfMundB - dimPad*0.5, s.zApex.toFixed(0), false) : ''}
      ${opts.bemassung && s.Lt > 0.5 ? dimV(dsOY, dsOY + s.zInnerApex, dsOX + halfMundB + dimPad*0.5, s.zInnerApex.toFixed(0), true) : ''}
      ${opts.bemassung ? dimParallel(dsOX - s.xMouth, dsOY + s.zMouth, dsOX - s.xTrans, dsOY + s.zTrans, massstab*5, (s.arcR - s.rInner).toFixed(0)) : ''}
    </svg>`;

  const spLeftPad = massstab * 8;
  const spW = maxZ + spLeftPad + dimPad, spH = profMaxH + 20 + dimPad * 2;
  const spOX = spLeftPad, spOY = spH / 2;
  const spZStart = s.Lt > 0.5 ? s.zInnerApex : 0;
  const profU = profPts.map(([z, h]) => [spOX + z, spOY - h]);
  const profD = profPts.map(([z, h]) => [spOX + z, spOY + h]);
  const spSVG = `
    <svg width="${spW * mm2px}px" height="${spH * mm2px}px" viewBox="0 0 ${spW} ${spH}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${spOX}" y1="${spOY}" x2="${spOX + maxZ}" y2="${spOY}" stroke="#c8c8d0" stroke-width="0.2" stroke-dasharray="3 2"/>
      ${opts.seitenprofil ? `<path d="${pathFromPts(profU)}" fill="none" stroke="#1a1a24" stroke-width="0.5"/>
      <path d="${pathFromPts(profD)}" fill="none" stroke="#1a1a24" stroke-width="0.5"/>` : ''}
      ${opts.bemassung ? dimV(spOY - hMouth/2, spOY + hMouth/2, spOX + maxZ + massstab*5, hMouth + "", true) : ''}
      ${opts.bemassung ? dimV(spOY - rt, spOY + rt, spOX - massstab*5, "Ø" + (rt*2).toFixed(1), false) : ''}
      ${opts.bemassung ? dimH(spOX, spOX + maxZ, spOY + profMaxH/2 + massstab*8, s.zApex.toFixed(0), true) : ''}
      ${opts.bemassung && s.Lt > 0.5 ? dimH(spOX, spOX + s.zInnerApex, spOY - profMaxH/2 - massstab*5, s.zInnerApex.toFixed(0), false) : ''}
      ${opts.bemassung ? dimH(spOX + spZStart, spOX + s.zApex, spOY - profMaxH/2 - massstab*5, (s.zApex - spZStart).toFixed(0), false) : ''}
    </svg>`;

  const aMouth = (s.arcR * 2 * ALPHA2 * hMouth / 1e6).toFixed(4);
  const dzv = Math.max(0.5, (s.zApex - (s.Lt > 0.5 ? s.zInnerApex : 0)) * 0.01);
  const slope = (verticalHalfHeight(s.zApex, s, rt, hMouth, curve, hypexT, opts.fillet) - verticalHalfHeight(s.zApex - dzv, s, rt, hMouth, curve, hypexT, opts.fillet)) / dzv;
  const vertAngle = (2 * Math.atan(slope) * 180 / Math.PI).toFixed(1);
  const curveLabels = { linear: "Linear", exponential: "Exponential", hypex: "Hypex" };
  const today = new Date().toLocaleDateString("de-DE");

  const kv = [
    ["Öffnungswinkel horiz.", openingAngle + " °"],
    ["Öffnungswinkel vert.", vertAngle + " °"],
    ["Gesamtlänge L", L + " mm"],
    ["Traktrix-Länge", s.Lt.toFixed(0) + " mm"],
    ["Throat Ø", (rt * 2).toFixed(1) + " mm"],
    ["Mundbreite", mundB + " mm"],
    ["Mund-Höhe", hMouth + " mm"],
    ["Mundfläche A", aMouth + " m²"],
    ["Teilkreis-Radius", s.arcR.toFixed(1) + " mm"],
    ["Aufweitung", curveLabels[curve] + (curve === "hypex" ? ` (T=${hypexT})` : "")],
    ["Verrundung Übergang", opts.fillet ? "R " + opts.fillet.R.toFixed(1) + " mm" : "–"],
    ["Raumecke", showRaumecke ? "ja" : "nein"],
    ["Wandstärke", showWandstaerke ? wandstaerke + " mm" : "–"],
  ];

  const kvRows = kv.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Radialhorn – Datenblatt</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: 'DM Mono', ui-monospace, monospace; color: #1a1a24; margin: 0; background: #fff; }
  .page { padding: 16mm 18mm; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a24; padding-bottom: 5mm; margin-bottom: 7mm; }
  .title { font-size: 22pt; font-weight: 700; letter-spacing: 0.08em; color: #1a1a24; line-height: 1; }
  .subtitle { font-size: 8pt; letter-spacing: 0.25em; color: #7c5cff; margin-top: 2mm; }
  .docmeta { text-align: right; font-size: 8pt; color: #888; line-height: 1.7; }
  .docmeta b { color: #1a1a24; }
  .scale-badge { display: inline-block; background: #7c5cff; color: #fff; font-size: 11pt; font-weight: 700; padding: 1.5mm 4mm; border-radius: 2mm; letter-spacing: 0.05em; }
  .grid { display: grid; grid-template-columns: 1fr 1.6fr; gap: 8mm; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  td { padding: 1.6mm 2mm; border-bottom: 1px solid #ececf2; }
  td:first-child { color: #888; }
  td:last-child { text-align: right; font-weight: 700; }
  .section-label { font-size: 8pt; letter-spacing: 0.2em; color: #7c5cff; margin: 0 0 3mm; font-weight: 700; }
  .drawing { border: 1px solid #ececf2; border-radius: 3mm; padding: 6mm; background: #fafafb; text-align: center; margin-bottom: 6mm; }
  .footer { margin-top: 8mm; padding-top: 4mm; border-top: 1px solid #ececf2; font-size: 7.5pt; color: #aaa; display: flex; justify-content: space-between; }
  .hint { background: #f0eeff; color: #5a4bbf; padding: 3mm 4mm; border-radius: 2mm; font-size: 8.5pt; margin-bottom: 6mm; }
  @media print { .hint { display: none; } .page { padding: 14mm 16mm; } }
</style></head>
<body>
  <div class="page">
    <div class="hint">💡 Speichern als PDF: <b>Strg/Cmd + P</b> → "Als PDF speichern". Bei 100 % Druckgröße ist der Maßstab 1:${massstab} exakt.</div>
    <div class="header">
      <div>
        <div class="title">RADIALHORN</div>
        <div class="subtitle">TECHNISCHES DATENBLATT</div>
      </div>
      <div class="docmeta">
        <span class="scale-badge">1 : ${massstab}</span><br>
        <b>Datum</b> ${today}<br>
        <b>Einheit</b> Millimeter
      </div>
    </div>
    <div class="grid">
      <div>
        <div class="section-label">KENNWERTE</div>
        <table>${kvRows}</table>
      </div>
      <div>
        ${opts.draufsicht || opts.mundbogen || opts.fokus ? `<div class="section-label">DRAUFSICHT · HORIZONTALSCHNITT</div>
        <div class="drawing">${dsSVG}</div>` : ''}
        ${opts.seitenprofil ? `<div class="section-label">SEITENRISS · VERTIKALSCHNITT</div>
        <div class="drawing">${spSVG}</div>` : ''}
      </div>
    </div>
    <div class="footer">
      <span>Radialhorn-Konfigurator · Traktrix + linearer Bereich + Teilkreis</span>
      <span>L = Raumecke (Hut-Spitze) → Teilkreis-Scheitelpunkt</span>
    </div>
  </div>
</body></html>`;

  let win = null;
  try { win = window.open("", "_blank"); } catch (e) { win = null; }
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => { try { win.print(); } catch (e) {} }, 400);
  } else {
    downloadFile(html, `radialhorn_${openingAngle}deg_L${L}_datenblatt.html`, "text/html");
  }
}

function exportDXF(s, rt, hMouth, curve, hypexT, opts) {
  const sections = [];
  if (opts.draufsicht) {
    const { trak, coneStart, coneEnd } = genDraufsichtWandSplit(s);
    for (const sign of [1, -1]) {
      if (trak.length > 1) {
        sections.push({ type: "spline", pts: trak.map(([x, z]) => [z, sign * x]), layer: "Draufsicht_Wand" });
      }
      sections.push({
        type: "line",
        p1: [coneStart[1], sign * coneStart[0]],
        p2: [coneEnd[1],   sign * coneEnd[0]],
        layer: "Draufsicht_Wand",
      });
    }
  }
  if (opts.mundbogen) {
    sections.push({
      type: "arc", cx: s.zFocus, cy: 0, r: s.arcR,
      start: -ALPHA2 * 180 / Math.PI, end: ALPHA2 * 180 / Math.PI,
      layer: "Mundbogen",
    });
  }
  if (opts.fokus) {
    sections.push({ type: "point", x: s.zFocus, y: 0, layer: "Fokus" });
  }
  if (opts.seitenprofil) {
    const fl     = opts.fillet;
    // Mit Verrundung: Throat endet an T1, Aufweitung beginnt an T2, dazwischen ein ARC
    const throat = fl ? [[0, rt], [fl.zT1, rt]] : genSeitenprofilThroat(s, rt);
    const flare  = genSeitenprofilFlare(s, rt, hMouth, curve, hypexT, 100, fl ? fl.zT2 : null);
    if (fl) {
      const a2 = Math.atan2(fl.hT2 - fl.hc, fl.zT2 - fl.zc) * 180 / Math.PI;   // −90° … 0°
      sections.push({ type: "arc", cx: fl.zc, cy:  fl.hc, r: fl.R, start: 270, end: 360 + a2, normal: [0, -1, 0], layer: "Seitenprofil_Verrundung" });
      sections.push({ type: "arc", cx: fl.zc, cy: -fl.hc, r: fl.R, start: -a2, end: 90,       normal: [0, -1, 0], layer: "Seitenprofil_Verrundung" });
    }
    if (throat.length) {
      for (const sign of [1, -1]) {
        sections.push({ type: "line", p1: [throat[0][0], 0, sign * throat[0][1]], p2: [throat[1][0], 0, sign * throat[1][1]], layer: "Seitenprofil_Throat" });
      }
    }
    for (const sign of [1, -1]) {
      if (curve === "linear") {
        const a = flare[0], b = flare[flare.length - 1];
        sections.push({ type: "line", p1: [a[0], 0, sign * a[1]], p2: [b[0], 0, sign * b[1]], layer: "Seitenprofil_Flare" });
      } else {
        sections.push({ type: "spline", pts: flare.map(([z, h]) => [z, 0, sign * h]), layer: "Seitenprofil_Flare" });
      }
    }
  }
  if (opts.uebergang && s.Lt > 0.5) {
    // Draufsicht: Beginn Traktrix (Throat)
    sections.push({ type: "point", x: 0,             y:  rt,        layer: "Uebergang" });
    sections.push({ type: "point", x: 0,             y: -rt,        layer: "Uebergang" });
    // Draufsicht: Traktrix → linearer Bereich
    sections.push({ type: "point", x: s.zTrans,      y:  s.xTrans,  layer: "Uebergang" });
    sections.push({ type: "point", x: s.zTrans,      y: -s.xTrans,  layer: "Uebergang" });
    // Seitenprofil: Beginn Traktrix (Throat)
    sections.push({ type: "point", x: 0,            y: 0, z:  rt, layer: "Uebergang" });
    sections.push({ type: "point", x: 0,            y: 0, z: -rt, layer: "Uebergang" });
    // Seitenprofil: Throat → vertikale Öffnung
    sections.push({ type: "point", x: s.zInnerApex, y: 0, z:  rt, layer: "Uebergang" });
    sections.push({ type: "point", x: s.zInnerApex, y: 0, z: -rt, layer: "Uebergang" });
    // Seitenprofil: Tangentenpunkte der Verrundung
    if (opts.fillet) {
      const fl = opts.fillet;
      for (const sign of [1, -1]) {
        sections.push({ type: "point", x: fl.zT1, y: 0, z: sign * rt,     layer: "Uebergang" });
        sections.push({ type: "point", x: fl.zT2, y: 0, z: sign * fl.hT2, layer: "Uebergang" });
      }
    }
    // Draufsicht: Ende linearer Bereich (Mund)
    sections.push({ type: "point", x: s.zMouth,     y:  s.xMouth, layer: "Uebergang" });
    sections.push({ type: "point", x: s.zMouth,     y: -s.xMouth, layer: "Uebergang" });
    // Seitenprofil: Ende linearer Bereich (Mund)
    sections.push({ type: "point", x: s.zApex,      y: 0, z:  hMouth / 2, layer: "Uebergang" });
    sections.push({ type: "point", x: s.zApex,      y: 0, z: -hMouth / 2, layer: "Uebergang" });
  }
  const dxf   = buildDXF(sections);
  const deg   = Math.round(ALPHA2 * 2 * 180 / Math.PI);
  const fname = `radialhorn_${deg}deg_L${Math.round(s.zApex - s.hatTipZ)}_T${(rt*2).toFixed(0)}mm.dxf`;
  downloadFile(dxf, fname, "application/dxf");
}

// ──────────────────────────────────────────────────────────────────
// KONSTANTEN
// ──────────────────────────────────────────────────────────────────

const DOT = 2.5;

const COLOR = {
  trak:     "#f9a8d4",
  horn:     "#86efac",
  arc:      "#d6cbb8",
  raum:     "#fdba74",
  dim:      "#5a5a78",
  dimL:     "#6868a0",
  trans:    "#fca5a5",
  driv:     "#888898",
  text:     "#5a5a5a",
  axisH:    "#3a3a3a",
  axisS:    "#3a3a3a",
  drivFill: "rgba(26,26,26,0.55)",
  wand:     "#fcd34d",
};

const S = {
  trakWall: { fill: "none", stroke: COLOR.trak, strokeWidth: "1.4", strokeLinejoin: "round" },
  hornWall: { fill: "none", stroke: COLOR.horn, strokeWidth: "1.4", strokeLinejoin: "round" },
  dimRef:   { strokeWidth: "0.35", strokeDasharray: "3 3" },
  dimArrow: { strokeWidth: "0.7" },
  label:    { fontSize: "9", fontFamily: "'DM Mono', monospace" },
};

function ptsToPath(pts, xi, yi) {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[xi]},${p[yi]}`).join(" ");
}

const THROAT_SIZES = [
  { label: '1"',  val: 25.4 },
  { label: '1½"', val: 38.1 },
  { label: '2"',  val: 50.8 },
  { label: '3"',  val: 76.2 },
];

const CURVES = ["linear", "exponential", "hypex"];
const CURVE_LABELS = { linear: "Linear", exponential: "Exponential", hypex: "Hypex" };

// ──────────────────────────────────────────────────────────────────
// UI-PRIMITIVE
// ──────────────────────────────────────────────────────────────────

function Slider({ label, value, min, max, step, unit, onChange }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = useCallback(() => {
    const v = parseFloat(draft);
    if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
    else setDraft(String(value));
  }, [draft, min, max, value, onChange]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ minWidth: 128, fontSize: 11, color: "#8a8a8a", fontFamily: "'DM Mono', monospace" }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={Math.min(Math.max(value, min), max)}
        onChange={e => { onChange(parseFloat(e.target.value)); setDraft(e.target.value); }}
        style={{ flex: 1, minWidth: 0, accentColor: "#d6cbb8" }} />
      <input type="number" min={min} max={max} step={step} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); }}
        style={{ width: 62, padding: "2px 6px", background: "#1c1c1c", border: "1px solid #303030", borderRadius: 4, color: "#e4e4e4", fontSize: 11, fontFamily: "'DM Mono', monospace", boxSizing: "border-box" }} />
      <span style={{ minWidth: 24, fontSize: 10, color: "#6e6e6e" }}>{unit}</span>
    </div>
  );
}

function Toggle({ label, checked, onChange, color = "#d6cbb8" }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 8 }}>
      <div onClick={() => onChange(!checked)} style={{
        width: 36, height: 20, borderRadius: 10, position: "relative", transition: "background 0.2s",
        background: checked ? color : "#303030", flexShrink: 0,
      }}>
        <div style={{
          position: "absolute", top: 2, left: checked ? 16 : 2, width: 14, height: 14,
          borderRadius: "50%", background: "#fff", transition: "left 0.2s",
        }} />
      </div>
      <span style={{ fontSize: 11, color: checked ? color : "#6e6e6e", fontFamily: "'DM Mono', monospace", userSelect: "none" }}>
        {label}
      </span>
    </label>
  );
}

function SegBtn({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)} style={{
          flex: 1, padding: "4px 0", borderRadius: 4, fontSize: 10, cursor: "pointer",
          border: value === o ? "1px solid #d6cbb8" : "1px solid #303030",
          background: value === o ? "rgba(214,203,184,0.15)" : "#1c1c1c",
          color: value === o ? "#d6cbb8" : "#6e6e6e",
          fontFamily: "'DM Mono', monospace", letterSpacing: "0.05em",
        }}>{CURVE_LABELS[o]}</button>
      ))}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ background: "#1c1c1c", border: "1px solid #2e2e2e", borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontSize: 9, color: "#404040", marginBottom: 3, letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#d6cbb8" }}>{value}</div>
    </div>
  );
}

function Warn({ children }) {
  return <div style={{ fontSize: 9, color: "#fca5a5", marginTop: -4, marginBottom: 4, paddingLeft: 134 }}>{children}</div>;
}

// ──────────────────────────────────────────────────────────────────
// DRAUFSICHT SVG
// ──────────────────────────────────────────────────────────────────

function HornSVG({ s, rt, dw, dh, L, showRaumecke, showWandstaerke, wandstaerke, openingAngle }) {
  const containerRef = useRef(null);
  const { w: VW, h: VH } = useSize(containerRef);
  const zoom = useZoomPan(containerRef);

  if (!s || VW < 10 || VH < 10) return (
    <div ref={containerRef} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#fca5a5", fontSize: 12, fontFamily: "'DM Mono', monospace" }}>
      {!s ? "⚠ Parameter ungültig" : ""}
    </div>
  );

  const hatTipZ    = s.hatTipZ;
  const raumeckeEndX = dw / 2 + (s.zApex - (-dh));

  const zMin = hatTipZ - 140;
  const zMax = s.zApex + Math.max(16, Math.ceil((s.zApex - zMin) * 30 / 432));
  const xMaxGeom = Math.max(s.xMouth, dw / 2);
  const xMaxRaum = showRaumecke ? raumeckeEndX + 4 : 0;
  const xMax = Math.max(xMaxGeom, xMaxRaum) + 20;

  const ml = 50, mr = 58, mt = 22, mb = 22;
  const drawW = VW - ml - mr;
  const drawH = VH - mt - mb;
  const { k, tx, ty } = zoom.view;
  const scale0 = Math.min(drawW / (2 * xMax), drawH / (zMax - zMin));
  const cx0 = ml + drawW / 2;
  const scale = scale0 * k;
  const cx = tx + k * cx0;
  const topOffset = ty + k * (mt + (drawH - (zMax - zMin) * scale0) / 2);
  const toX = x => cx + x * scale;
  const toY = z => topOffset + (z - zMin) * scale;

  const trakPts = [];
  if (s.Lt > 0.5 && s.r0 && s.tTh) {
    for (let i = 0; i <= 600; i++) {
      const t = s.tTh + (T_TRANS - s.tTh) * i / 600;
      const axial = s.r0 * (zN(s.tTh) - zN(t));
      const x = s.r0 * xN(t);
      trakPts.push([toX(x), toY(axial), toX(-x), toY(axial)]);
    }
  }

  const hornPts = [];
  for (let i = 0; i <= 80; i++) {
    const f = i / 80, z = s.zTrans + f * s.Ls, x = s.xTrans + f * s.Ls * Math.tan(ALPHA2);
    hornPts.push([toX(x), toY(z), toX(-x), toY(z)]);
  }

  const fillPts = pts => pts.length > 1
    ? ptsToPath(pts, 2, 3) + ` L${pts[pts.length-1][0]},${pts[pts.length-1][1]} ` +
      [...pts].reverse().map(p => `L${p[0]},${p[1]}`).join(" ") + ` L${pts[0][2]},${pts[0][3]} Z`
    : "";
  const fillHorn = hornPts.length > 1
    ? ptsToPath(hornPts, 2, 3) + " " + [...hornPts].reverse().map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ") + " Z"
    : "";

  const fx  = cx, fy = toY(s.zFocus);
  const mRx = toX(s.xMouth), mRy = toY(s.zMouth);
  const mLx = toX(-s.xMouth), mLy = toY(s.zMouth);
  const rp  = s.arcR * scale;
  const afr = Math.min(rp * 0.13, 26);
  const ax  = toX(-Math.max(s.xMouth, showRaumecke ? raumeckeEndX : dw / 2)) - 30;
  const bx  = toX(Math.max(s.xMouth, showRaumecke ? raumeckeEndX : dw / 2)) + 30;

  const reRx = toX(raumeckeEndX), reLx = toX(-raumeckeEndX), reY = toY(s.zApex);
  const hatX = toX(0), hatY = toY(hatTipZ);
  const ex = toX(dw / 2), ey = toY(-dh), qs = 8;
  const hat90 = `M${ex-qs},${ey} L${ex-qs},${ey+qs} L${ex},${ey+qs}`;
  const uR = trakPts.length > 1 ? trakPts[trakPts.length - 1] : null;
  const irp = s.rInner * scale;
  const tRx = toX(s.xTrans), tRy = toY(s.zTrans);
  const tLx = toX(-s.xTrans), tLy = toY(s.zTrans);

  // Abstand der Seitenwand-Bemaßung: Maßlinien liegen außerhalb der Zeichnung
  // (Raumecke, Treiber, Traktrix), 1. Lage 18px, 2. Lage +22px.
  // Gemessen senkrecht zur Wand, nach außen;
  // berücksichtigt wird nur, was in Wandrichtung neben der Bemaßung liegt.
  const wallDimOff = (() => {
    const len = Math.hypot(fx - mLx, fy - mLy);
    const ux = (fx - mLx) / len, uy = (fy - mLy) / len;
    const nx = uy, ny = -ux;                     // wie in DimAligned: links von Mund → Fokus
    const obst = [];
    const seg = (x1, y1, x2, y2, n = 40) => {
      for (let i = 0; i <= n; i++) obst.push([x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
    };
    if (showRaumecke) seg(hatX, hatY, reLx, reY);
    seg(toX(-dw / 2), toY(-dh), toX(dw / 2), toY(-dh));
    seg(toX(-dw / 2), toY(-dh), toX(-dw / 2), toY(0));
    trakPts.forEach(p => obst.push([p[2], p[3]]));
    let need = 0;
    for (const [qx, qy] of obst) {
      const t = (qx - mLx) * ux + (qy - mLy) * uy;
      if (t < 0 || t > len) continue;
      need = Math.max(need, (qx - mLx) * nx + (qy - mLy) * ny);
    }
    return Math.max(18, need + 18);              // 1. Lage: 18px außerhalb der Geometrie
  })();

  return (
    <div ref={containerRef} {...zoom.handlers}
      style={{ position: "relative", width: "100%", height: "100%", cursor: "grab", touchAction: "none", userSelect: "none" }}>
      <ZoomControls k={k} onReset={zoom.reset} />
      <svg width="100%" height="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: "block" }}>
        <defs>
          <marker id="arrH" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M2 1L8 5L2 9" fill="none" stroke="#5a5a78" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>

        <line x1={cx} y1={toY(hatTipZ - 6)} x2={cx} y2={toY(s.zApex) + 32} stroke="#3a3a3a" strokeWidth="0.6" strokeDasharray="5 4" />
        <text x={cx0} y={14} textAnchor="middle" fontSize="9" fill="#5a5a5a" fontFamily="'DM Mono', monospace" letterSpacing="0.12em">DRAUFSICHT · HORIZONTALER SCHNITT</text>

        {showRaumecke && <>
          <line x1={hatX} y1={hatY} x2={reRx} y2={reY} stroke={COLOR.raum} strokeWidth="1.2" strokeLinecap="butt" strokeDasharray={`${70*scale} ${9*scale} ${4*scale} ${9*scale}`} />
          <line x1={hatX} y1={hatY} x2={reLx} y2={reY} stroke={COLOR.raum} strokeWidth="1.2" strokeLinecap="butt" strokeDasharray={`${70*scale} ${9*scale} ${4*scale} ${9*scale}`} />
          <circle cx={hatX} cy={hatY} r={DOT} fill={COLOR.raum} />
          <circle cx={toX(dw / 2)} cy={toY(-dh)} r={DOT} fill={COLOR.raum} />
          <circle cx={toX(-dw / 2)} cy={toY(-dh)} r={DOT} fill={COLOR.raum} />
          <path d={hat90} fill="none" stroke={COLOR.raum} strokeWidth="0.9" />
          <circle cx={reRx} cy={reY} r={DOT} fill={COLOR.raum} />
          <circle cx={reLx} cy={reY} r={DOT} fill={COLOR.raum} />
        </>}

        <rect x={toX(-dw / 2)} y={toY(-dh)} width={dw * scale} height={dh * scale}
          fill="rgba(26,26,26,0.6)" stroke="#363650" strokeWidth="1.3" rx="2" />
        <line x1={toX(-dw/2)} y1={toY(-dh)} x2={toX(dw/2)} y2={toY(0)} stroke="#303048" strokeWidth="0.5" opacity="0.5" />
        <line x1={toX(dw/2)} y1={toY(-dh)} x2={toX(-dw/2)} y2={toY(0)} stroke="#303048" strokeWidth="0.5" opacity="0.5" />
        <text x={cx} y={toY(-dh / 2)} textAnchor="middle" dominantBaseline="central" fontSize="10" fill="#5a5a5a" fontFamily="'DM Mono', monospace">Treiber</text>

        {trakPts.length > 1 && <path d={fillPts(trakPts)} fill="rgba(249,168,212,0.09)" />}
        {hornPts.length > 1 && <path d={fillHorn} fill="rgba(134,239,172,0.08)" />}

        <path d={`M${fx},${fy} L${mRx},${mRy} A${rp},${rp} 0 0 1 ${mLx},${mLy} Z`} fill="rgba(147,197,253,0.06)" />
        <path d={`M${mRx},${mRy} A${rp},${rp} 0 0 1 ${mLx},${mLy}`} fill="none" stroke={COLOR.arc} strokeWidth="1.4" />

        {s.Lt > 0.5 && (
          <path d={`M${tRx},${tRy} A${irp},${irp} 0 0 1 ${tLx},${tLy}`}
            fill="none" stroke={COLOR.trak} strokeWidth="0.9" strokeDasharray="6 3" />
        )}

        <line x1={fx} y1={fy} x2={mRx} y2={mRy} stroke={COLOR.arc} strokeWidth="0.7" strokeDasharray="4 3" />
        <line x1={fx} y1={fy} x2={mLx} y2={mLy} stroke={COLOR.arc} strokeWidth="0.7" strokeDasharray="4 3" />
        <circle cx={fx} cy={fy} r={DOT} fill={COLOR.arc} />
        <circle cx={cx} cy={toY(s.zApex)} r={DOT} fill={COLOR.arc} />

        {(() => {
          const dvx = mRx - fx, dvy = mRy - fy, dl = Math.sqrt(dvx*dvx+dvy*dvy);
          const wx = dvx/dl, wy = dvy/dl, tx = -wy, ty = wx, q = 7;
          return <path d={`M${mRx-wx*q},${mRy-wy*q} L${mRx-wx*q+tx*q},${mRy-wy*q+ty*q} L${mRx+tx*q},${mRy+ty*q}`}
            fill="none" stroke={COLOR.arc} strokeWidth="0.9" />;
        })()}

        <circle cx={toX(rt)} cy={toY(0)} r={DOT} fill={COLOR.trak} />
        <circle cx={toX(-rt)} cy={toY(0)} r={DOT} fill={COLOR.trak} />

        {trakPts.length > 1 && <>
          <path d={ptsToPath(trakPts, 0, 1)} {...S.trakWall} />
          <path d={ptsToPath(trakPts, 2, 3)} {...S.trakWall} />
        </>}

        <path d={ptsToPath(hornPts, 0, 1)} {...S.hornWall} />
        <path d={ptsToPath(hornPts, 2, 3)} {...S.hornWall} />

        {showWandstaerke && wandstaerke > 0 && (() => {
          const wdx = s.xMouth - s.xTrans, wdz = s.zMouth - s.zTrans;
          const wlen = Math.sqrt(wdx*wdx + wdz*wdz);
          const nx = wdz / wlen, nz = -wdx / wlen;
          const wt = wandstaerke;
          return <>
            <line x1={toX(s.xMouth)} y1={toY(s.zMouth)} x2={toX(s.xMouth + nx*wt)} y2={toY(s.zMouth + nz*wt)} stroke={COLOR.wand} strokeWidth="1.4" strokeLinecap="round" />
            <line x1={toX(-s.xMouth)} y1={toY(s.zMouth)} x2={toX(-s.xMouth - nx*wt)} y2={toY(s.zMouth + nz*wt)} stroke={COLOR.wand} strokeWidth="1.4" strokeLinecap="round" />
            <circle cx={toX(s.xMouth + nx*wt)} cy={toY(s.zMouth + nz*wt)} r={DOT} fill={COLOR.wand} />
            <circle cx={toX(-s.xMouth - nx*wt)} cy={toY(s.zMouth + nz*wt)} r={DOT} fill={COLOR.wand} />
          </>;
        })()}

        {uR && <>
          <circle cx={uR[0]} cy={uR[1]} r={DOT} fill={COLOR.trans} />
          <circle cx={trakPts[trakPts.length-1][2]} cy={trakPts[trakPts.length-1][3]} r={DOT} fill={COLOR.trans} />
        </>}

        <path d={`M${cx+afr*Math.sin(ALPHA2)},${fy+afr*Math.cos(ALPHA2)} A${afr},${afr} 0 0 1 ${cx-afr*Math.sin(ALPHA2)},${fy+afr*Math.cos(ALPHA2)}`}
          fill="none" stroke="#5a5a78" strokeWidth="0.8" />
        <text x={cx} y={fy + afr * 0.5} textAnchor="middle" fontSize="9" fill="#5a5a78" fontFamily="'DM Mono', monospace">{openingAngle}°</text>

        <Dim p1={[cx, toY(hatTipZ)]} p2={[cx, toY(s.zApex)]}
          arrowPos={ax} color={COLOR.dimL} marker="url(#arrH)" label={`L=${L} mm`} sw="0.8" />

        {s.Lt > 0.5 &&
          <Dim p1={[toX(rt), toY(0)]} p2={[cx, toY(s.zInnerApex)]}
            arrowPos={bx + 22} color={COLOR.trak} marker="url(#arrH)" label={`${s.zInnerApex.toFixed(0)} mm`} />
        }

        <line x1={bx} y1={toY(-dh)} x2={bx} y2={toY(0)} stroke="#5a5a78" strokeWidth="0.7" markerStart="url(#arrH)" markerEnd="url(#arrH)" />
        <line x1={toX(dw/2)} y1={toY(-dh)} x2={bx} y2={toY(-dh)} stroke="#5a5a78" strokeWidth="0.35" strokeDasharray="3 3" />
        <text x={bx+8} y={(toY(-dh)+toY(0))/2} textAnchor="middle" dominantBaseline="central"
          fontSize="9" fill="#5a5a78" fontFamily="'DM Mono', monospace"
          transform={`rotate(-90,${bx+8},${(toY(-dh)+toY(0))/2})`}>{dh} mm</text>
        {/* Kette zur Treibertiefe: Hut-Spitze → Treiberrückseite */}
        <Dim p1={[hatX, hatY]} p2={[toX(dw/2), toY(-dh)]} orient="v"
          arrowPos={bx} color={COLOR.raum} marker="url(#arrH)" label={`${(dw/2).toFixed(0)} mm`} />

        <Dim p1={[toX(-dw/2), toY(-dh)]} p2={[toX(dw/2), toY(-dh)]}
          arrowPos={toY(hatTipZ) - 38} color={COLOR.dim}  marker="url(#arrH)" label={`${dw} mm`} />
        <Dim p1={[toX(-rt), toY(0)]}    p2={[toX(rt), toY(0)]}
          arrowPos={toY(hatTipZ) - 16}  color={COLOR.trak} marker="url(#arrH)" label={`Ø ${(rt*2).toFixed(1)} mm`} />

        {/* Seitenwand (linke Hälfte, parallel zur Wand): linearer Bereich und Fokus → Mund */}
        <DimAligned p1={[mLx, mLy]} p2={[tLx, tLy]} offset={wallDimOff}
          color={COLOR.horn} marker="url(#arrH)" label={`${(s.arcR - s.rInner).toFixed(1)} mm`} />
        <DimAligned p1={[mLx, mLy]} p2={[fx, fy]} offset={wallDimOff + 22}
          color={COLOR.arc} marker="url(#arrH)" label={`${s.arcR.toFixed(1)} mm`} />

        <line x1={toX(-s.xMouth)} y1={toY(s.zMouth)+16} x2={toX(s.xMouth)} y2={toY(s.zMouth)+16} stroke="#5a5a78" strokeWidth="0.7" markerStart="url(#arrH)" markerEnd="url(#arrH)" />
        <text x={cx} y={toY(s.zMouth)+27} textAnchor="middle" fontSize="9" fill="#5a5a78" fontFamily="'DM Mono', monospace">{(2 * s.xMouth).toFixed(0)} mm</text>
        <text x={cx} y={toY(s.zApex)+28} textAnchor="middle" fontSize="9" fill="#5a5a78" fontFamily="'DM Mono', monospace">R={s.arcR.toFixed(0)} mm</text>
      </svg>

      {/* Legende */}
      {(() => {
        const items = [
          { col: "#f9a8d4", label: "Traktrix",      dash: false },
          { col: "#86efac", label: "Lin. Bereich",  dash: false },
          { col: "#d6cbb8", label: "Teilkreis",     dash: false },
          { col: "#fca5a5", label: "Übergang",      dot: true   },
          { col: "#363650", label: "Treiber",       fill: true  },
          { col: "#fdba74", label: "Raumecke",      dash: true  },
          { col: "#fcd34d", label: "Wandstärke",    cond: showWandstaerke },
          { col: "#5a5a78", label: "Bemaßung",      dash: false },
        ].filter(i => i.cond !== false);
        return (
          <div style={{ position: "absolute", bottom: 8, right: 8, display: "flex", flexDirection: "column", gap: 3 }}>
            {items.map(item => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {item.dot
                  ? <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.col, flexShrink: 0 }} />
                  : item.fill
                  ? <div style={{ width: 12, height: 7, background: item.col, opacity: 0.5, borderRadius: 1, flexShrink: 0 }} />
                  : <svg width="12" height="6" style={{ flexShrink: 0 }}>
                      <line x1="0" y1="3" x2="12" y2="3" stroke={item.col} strokeWidth="1.4" strokeDasharray={item.dash ? "4 2" : "none"} />
                    </svg>
                }
                <span style={{ fontSize: 8, color: "#5a5a78", fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap" }}>{item.label}</span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// SEITENRISS SVG
// ──────────────────────────────────────────────────────────────────

function SeitenrissSVG({ s, rt, dw, dh, L, hMouth, curve, hypexT, fillet }) {
  const containerRef = useRef(null);
  const { w: VW, h: VH } = useSize(containerRef);
  const zoom = useZoomPan(containerRef);

  if (!s || VW < 10 || VH < 10) return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;

  const throatH = rt * 2;
  const halfMax = Math.max(dw / 2, hMouth / 2) * 1.05;
  const zMin = s.hatTipZ - 10;
  const zMax = s.zApex + 10;

  const portrait = VH > VW;
  // Querformat: oben Platz für Titel + zwei Maßlagen, unten für eine
  const mT = Math.min(72, VH * 0.3), mB = Math.min(40, VH * 0.15);
  const scale0 = portrait
    ? Math.min((VH - Math.min(80, VH*0.12) * 2) / (zMax - zMin), (VW - Math.min(68, VW*0.15) * 2) / (2 * halfMax))
    : Math.min((VW - Math.min(80, VW*0.12) * 2) / (zMax - zMin), (VH - mT - mB) / (2 * halfMax));

  const contentW = (zMax - zMin) * scale0;
  const contentH = 2 * halfMax * scale0;
  const cy = mT + (VH - mT - mB) / 2;

  // Basis-Abbildung (Standard-Zoom, zentriert), darauf die Zoom/Pan-Transformation
  const toX0 = portrait ? y => VW / 2 + y * scale0 : z => (VW - contentW) / 2 + (z - zMin) * scale0;
  const toY0 = portrait ? z => VH - (VH - contentW) / 2 - (z - zMin) * scale0 : y => cy - y * scale0;
  const { k, tx, ty } = zoom.view;
  const scale = scale0 * k;
  const toX = u => tx + k * toX0(u);
  const toY = u => ty + k * toY0(u);

  const ml = portrait ? (VW - contentH) / 2 : (VW - contentW) / 2;

  const vh = z => verticalHalfHeight(z, s, rt, hMouth, curve, hypexT, fillet);
  const zProfileStart = s.Lt > 0.5 ? s.zInnerApex : 0;
  // Sektionen bleiben farblich an zInnerApex getrennt; mit Verrundung liegt der Bogen
  // zur Hälfte in der Throat- (rosa) und zur Hälfte in der Aufweitungssektion (grün)
  const zThroat = fillet ? [0, ...linspace(fillet.zT1, s.zInnerApex, 30)] : [0, s.zInnerApex];
  const zFlare  = fillet
    ? [...linspace(s.zInnerApex, fillet.zT2, 30), ...linspace(fillet.zT2, s.zApex, 120).slice(1)]
    : linspace(zProfileStart, s.zApex, 120);
  const wallPath = (zs, sign) => zs.map((z, i) => `${i === 0 ? "M" : "L"}${toX(z)},${toY(sign * vh(z))}`).join(" ");
  const upperPath = wallPath(zFlare, 1), lowerPath = wallPath(zFlare, -1);
  const hTrans = vh(s.zInnerApex);

  const bxo        = toX(s.zApex) + 18;
  const dimThroatAx = toX(s.hatTipZ) - 18;
  const dimDrivAx   = toX(s.hatTipZ) - 40;
  const dimLAy      = toY(-halfMax) + 16;
  const dimDrivTopAy = toY(halfMax) - 18;
  const dimTrakAy   = toY(halfMax) - 40;

  return (
    <div ref={containerRef} {...zoom.handlers}
      style={{ position: "relative", width: "100%", height: "100%", cursor: "grab", touchAction: "none", userSelect: "none" }}>
      <ZoomControls k={k} onReset={zoom.reset} />
      <svg width="100%" height="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: "block" }}>
        <defs>
          <marker id="arrV" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M2 1L8 5L2 9" fill="none" stroke="#5a5a78" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>

        <text x={(ml + VW - ml) / 2} y={10} textAnchor="middle" fontSize="9" fill="#5a5a5a" fontFamily="'DM Mono', monospace" letterSpacing="0.12em">SEITENRISS · VERTIKALER SCHNITT</text>

        <line x1={toX(s.hatTipZ)} y1={toY(0)} x2={toX(s.zApex)} y2={toY(0)} stroke={COLOR.axisS} strokeWidth="0.6" strokeDasharray="5 4" />

        <rect x={toX(-dh)} y={toY(dw/2)} width={dh*scale} height={dw*scale}
          fill={COLOR.drivFill} stroke={COLOR.driv} strokeWidth="1.3" rx="2" />
        <line x1={toX(-dh)} y1={toY(dw/2)} x2={toX(0)} y2={toY(-dw/2)} stroke={COLOR.driv} strokeWidth="0.5" opacity="0.4" />
        <line x1={toX(0)} y1={toY(dw/2)} x2={toX(-dh)} y2={toY(-dw/2)} stroke={COLOR.driv} strokeWidth="0.5" opacity="0.4" />
        <text x={toX(-dh/2)} y={toY(0)} {...S.label} textAnchor="middle" dominantBaseline="central" fill={COLOR.text}>Treiber</text>

        {/* Raumecke: von der Achse aus nach oben und unten, Strichmuster symmetrisch zur Achse */}
        {[halfMax, -halfMax].map(yEnd =>
          <line key={yEnd} x1={toX(s.hatTipZ)} y1={toY(0)} x2={toX(s.hatTipZ)} y2={toY(yEnd)}
            stroke={COLOR.raum} strokeWidth="1.2" strokeLinecap="butt"
            strokeDasharray={`${70*scale} ${9*scale} ${4*scale} ${9*scale}`} strokeDashoffset={35*scale} />
        )}

        <circle cx={toX(0)} cy={toY(throatH/2)} r={DOT} fill={COLOR.trak} />
        <circle cx={toX(0)} cy={toY(-throatH/2)} r={DOT} fill={COLOR.trak} />

        {s.Lt > 0.5 && <>
          {[1, -1].map(sign =>
            <path key={sign} d={wallPath(zThroat, sign)} fill="none" stroke={COLOR.trak} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          )}
          <circle cx={toX(s.zInnerApex)} cy={toY(hTrans)} r={DOT} fill={COLOR.trans} />
          <circle cx={toX(s.zInnerApex)} cy={toY(-hTrans)} r={DOT} fill={COLOR.trans} />
          {fillet && <>
            {/* Tangentenpunkte der Verrundung + Radius-Angabe (oben, außerhalb der Wand) */}
            {[1, -1].map(sign => <g key={sign}>
              <circle cx={toX(fillet.zT1)} cy={toY(sign * rt)}         r={DOT * 0.7} fill={COLOR.trak} />
              <circle cx={toX(fillet.zT2)} cy={toY(sign * fillet.hT2)} r={DOT * 0.7} fill={COLOR.horn} />
            </g>)}
            <line x1={toX(fillet.zc)} y1={toY(fillet.hc)} x2={toX(s.zInnerApex)} y2={toY(hTrans)}
              {...S.dimRef} stroke={COLOR.trans} />
            <text x={toX(fillet.zc)} y={toY(fillet.hc) - 6} {...S.label} textAnchor="middle" fill={COLOR.trans}>
              R {fillet.R.toFixed(fillet.R % 1 ? 1 : 0)}
            </text>
          </>}
        </>}

        <path d={upperPath} {...S.hornWall} />
        <path d={lowerPath} {...S.hornWall} />

        <circle cx={toX(s.zApex)} cy={toY(hMouth/2)} r={DOT} fill={COLOR.arc} />
        <circle cx={toX(s.zApex)} cy={toY(-hMouth/2)} r={DOT} fill={COLOR.arc} />

        <Dim p1={[toX(s.zApex), toY(hMouth/2)]}  p2={[toX(s.zApex), toY(-hMouth/2)]}
          arrowPos={bxo}         color={COLOR.arc}  marker="url(#arrV)" label={`${hMouth} mm`} />
        <Dim p1={[toX(0), toY(throatH/2)]}       p2={[toX(0), toY(-throatH/2)]}
          arrowPos={dimThroatAx} color={COLOR.trak} marker="url(#arrV)" label={`Ø ${(rt*2).toFixed(1)} mm`} />
        <Dim p1={[toX(-dh), toY(dw/2)]}          p2={[toX(-dh), toY(-dw/2)]}
          arrowPos={dimDrivAx}   color={COLOR.dim}  marker="url(#arrV)" label={`${dw} mm`} />
        <Dim p1={[toX(s.hatTipZ), toY(0)]}       p2={[toX(s.zApex), toY(0)]}
          arrowPos={dimLAy}      color={COLOR.dim}  marker="url(#arrV)" label={`L=${L} mm`} sw="0.8" />
        {/* Oben 1. Lage: Kette Hut-Spitze → Treiberrückseite → Treiberfront */}
        <Dim p1={[toX(s.hatTipZ), toY(dw/2)]}    p2={[toX(-dh), toY(dw/2)]} orient={portrait ? "v" : "h"}
          arrowPos={dimDrivTopAy} color={COLOR.raum} marker="url(#arrV)" label={`${(dw/2).toFixed(0)} mm`} />
        <Dim p1={[toX(-dh), toY(dw/2)]}          p2={[toX(0), toY(dw/2)]}
          arrowPos={dimDrivTopAy} color={COLOR.driv} marker="url(#arrV)" label={`${dh} mm`} />
        {/* Oben 2. Lage: Kette Traktrix → Mund (axiale Längen) */}
        {s.Lt > 0.5 &&
          <Dim p1={[toX(0), toY(throatH/2)]}     p2={[toX(s.zInnerApex), toY(hTrans)]} orient="h"
            arrowPos={dimTrakAy} color={COLOR.trak} marker="url(#arrV)" label={`${s.zInnerApex.toFixed(0)} mm`} />
        }
        <Dim p1={[toX(zProfileStart), toY(vh(zProfileStart))]} orient="h"
          p2={[toX(s.zApex), toY(hMouth/2)]}
          arrowPos={dimTrakAy} color={COLOR.horn} marker="url(#arrV)" label={`${(s.zApex - zProfileStart).toFixed(0)} mm`} />
      </svg>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// BEMAASSUNG
// ──────────────────────────────────────────────────────────────────

// Universelle Bemaßungs-Komponente.
// Erkennt Orientierung automatisch aus p1/p2:
//   |dy| >= |dx|  →  senkrechte Ausdehnung → vertikale Maßlinie (links/rechts)
//   |dx| >  |dy|  →  waagerechte Ausdehnung → horizontale Maßlinie (oben/unten)
// arrowPos: absolute Koordinate der Maßlinie (x für vertikal, y für horizontal)
// orient:   optional "v"/"h" erzwingt die Orientierung (z.B. bei 45°-Strecken)
// Hilfslinien: 2px vom Geometriepunkt, 2px über die Maßlinie hinaus.
// Text:        8px (Seite) bzw. 11px (unten) / 8px (oben) von der Maßlinie.
function Dim({ p1, p2, arrowPos, color, marker, label, sw = "0.7", orient }) {
  const [x1, y1] = p1, [x2, y2] = p2;
  const vertical = orient ? orient === "v" : Math.abs(y2 - y1) >= Math.abs(x2 - x1);

  if (vertical) {
    // Senkrechte Ausdehnung → vertikale Maßlinie
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
  } else {
    // Waagerechte Ausdehnung → horizontale Maßlinie
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
}

// Schräge Bemaßung parallel zur Strecke p1→p2.
// offset: Abstand der Maßlinie in px, positiv = links der Richtung p1→p2 (Bildschirm).
// Text liegt parallel zur Maßlinie auf der Außenseite und steht nie auf dem Kopf.
function DimAligned({ p1, p2, offset, color, marker, label, sw = "0.7" }) {
  const [x1, y1] = p1, [x2, y2] = p2;
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 1) return null;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const nx = uy, ny = -ux;                       // links der Richtung (SVG: y nach unten)
  const d = Math.sign(offset) || 1;
  // Hilfslinien: 2px vom Geometriepunkt, 2px über die Maßlinie hinaus
  const [e0x, e0y] = [nx * d * 2, ny * d * 2];
  const [e1x, e1y] = [nx * (offset + d * 2), ny * (offset + d * 2)];
  const a1 = [x1 + nx * offset, y1 + ny * offset], a2 = [x2 + nx * offset, y2 + ny * offset];
  const tOff = offset + d * 8;
  const tx = (x1 + x2) / 2 + nx * tOff, ty = (y1 + y2) / 2 + ny * tOff;
  let ang = Math.atan2(uy, ux) * 180 / Math.PI;
  if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
  return <>
    <line x1={x1 + e0x} y1={y1 + e0y} x2={x1 + e1x} y2={y1 + e1y} {...S.dimRef} stroke={color} />
    <line x1={x2 + e0x} y1={y2 + e0y} x2={x2 + e1x} y2={y2 + e1y} {...S.dimRef} stroke={color} />
    <line x1={a1[0]} y1={a1[1]} x2={a2[0]} y2={a2[1]} strokeWidth={sw} stroke={color} markerStart={marker} markerEnd={marker} />
    <text x={tx} y={ty} {...S.label} textAnchor="middle" dominantBaseline="central" fill={color}
      transform={`rotate(${ang},${tx},${ty})`}>{label}</text>
  </>;
}

// ──────────────────────────────────────────────────────────────────
// QUERSCHNITT-GRAPH
// ──────────────────────────────────────────────────────────────────

// Ganzzahlige "runde" Tick-Werte (1/2/5 · 10^n) im Bereich [lo, hi]
function niceTicks(lo, hi, count = 4) {
  const span = hi - lo;
  if (!(span > 0)) return [];
  const raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(f => f * mag).find(st => st >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(v);
  return out;
}

function CrossSectionGraph({ s, rt, hMouth, curve, hypexT, fillet }) {
  const VW = 310, VH = 200;
  const ml = 38, mr = 8, mt = 26, mb = 20;
  const svgRef = useRef(null);
  const zoom = useZoomPan(svgRef, {
    minZoom: 1,
    unitsPerPx: () => VW / (svgRef.current?.clientWidth || VW),
  });

  // B(z) (Horizontal-Breite) wird an der Wand-Kontakt-Position der Wellenfront berechnet,
  // aber der A(z)-Graph braucht die Achsen-Position dieser Wellenfront (wo H(z) über
  // verticalHalfHeight ausgewertet wird). Im Kegelbereich ist das "zFocus + Abstand zum
  // Fokus" (Fokus-Kegel-Strahl, konstanter Winkel ALPHA2). Auf der Traktrix gibt es keinen
  // gemeinsamen Fokus – dort gilt die klassische Traktrix-Eigenschaft: die Tangente jedes
  // Kurvenpunkts trifft die Achse in einem eigenen "virtuellen Fokus", und das
  // Tangentensegment bis zum Kurvenpunkt hat konstant Länge r0. Achsen-Position also:
  // Tangentenfuß + r0 (siehe horn-math.cross-validate.test.js, "Traktrix – definierende
  // Eigenschaft"). Für z=0 (Treiber selbst) ist keine Wellenfront definiert; A(z) wird dort
  // auf den Wert an der kleinsten definierten Achsen-Position gehalten (siehe unten).
  const calcBZAxis = zw => {
    if (s.Lt > 0.5 && zw <= s.zTrans) {
      let lo = s.tTh, hi = T_TRANS;
      for (let i = 0; i < 60; i++) {
        const tm = (lo + hi) / 2;
        s.r0 * (zN(s.tTh) - zN(tm)) < zw ? (lo = tm) : (hi = tm);
      }
      const t = (lo + hi) / 2;
      const zAxis = s.r0 * (zN(s.tTh) - t + 1);
      return { B: 2 * s.r0 * Math.atan(1 / Math.sinh(t)), zAxis };
    }
    const frac  = (zw - s.zTrans) / (s.Ls || 1);
    const xWall = s.xTrans + frac * s.Ls * Math.tan(ALPHA2);
    const R = Math.sqrt((zw - s.zFocus) ** 2 + xWall ** 2);
    return { B: R * 2 * ALPHA2, zAxis: s.zFocus + R };
  };

  const pts = [];
  const zAchseTrans = s.Lt > 0.5 ? s.zInnerApex : null;

  // Gleichmäßige Stützstellen plus exakt der Übergang Traktrix → linear, damit der
  // Farbwechsel genau am Traktrix-Ende (zInnerApex) liegt und nicht einen Schritt davor
  const zWalls = Array.from({ length: 101 }, (_, i) => s.zMouth * i / 100);
  if (s.Lt > 0.5) zWalls.push(s.zTrans);
  zWalls.sort((a, b) => a - b);

  for (const zWall of zWalls) {
    const { B, zAxis } = calcBZAxis(zWall);
    const H = 2 * verticalHalfHeight(zAxis, s, rt, hMouth, curve, hypexT, fillet);
    const col = zWall <= s.zTrans ? COLOR.trak : COLOR.horn;
    pts.push({ z: zAxis, B: B * H, col });
  }

  if (pts.length < 2) return null;

  // Für z < pts[0].z (kleinste Position mit definierter Wellenfront) existiert keine
  // Wellenfront-Geometrie – A(z) wird bis z=0 (Treiberebene) flach auf diesem Wert gehalten.
  pts.unshift({ z: 0, B: pts[0].B, col: pts[0].col });

  const zStart = pts[0].z;
  const zMouth = pts[pts.length - 1].z;
  const bMax   = pts.reduce((m, p) => p.B > m ? p.B : m, 0) * 1.08;
  // Basis-Abbildung (Standard-Zoom), darauf Zoom/Pan; Achsen bleiben am Plotrahmen stehen
  const { k, tx, ty } = zoom.view;
  const pw = VW - ml - mr, ph = VH - mt - mb;
  const gx     = z => tx + k * (ml + ((z - zStart) / (zMouth - zStart)) * pw);
  const gy     = b => ty + k * (mt + (1 - b / bMax) * ph);
  const zAt    = X => zStart + (((X - tx) / k) - ml) / pw * (zMouth - zStart);
  const bAt    = Y => bMax * (1 - (((Y - ty) / k) - mt) / ph);
  const inX    = x => x >= ml - 0.5 && x <= VW - mr + 0.5;
  const inY    = y => y >= mt - 0.5 && y <= VH - mb + 0.5;
  const zoomed = k !== 1 || tx !== 0 || ty !== 0;
  // Achsen sitzen im Datenursprung (z = Start, A = 0) und wandern beim Verschieben mit;
  // läuft der Ursprung aus dem Bild, bleiben sie am Plotrand sichtbar
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const axX = clamp(gx(zStart), ml, VW - mr);
  const axY = clamp(gy(0), mt, VH - mb);

  // Markante Werte (Start, Traktrix-Ende, Mund; 0 / ½ / max) immer; beim Zoomen
  // zusätzlich runde Zwischenwerte für den sichtbaren Bereich
  const xMarks = [
    { z: zStart, label: zStart.toFixed(0), col: "#404040" },
    ...(s.Lt > 0.5 && zAchseTrans !== null ? [{ z: zAchseTrans, label: zAchseTrans.toFixed(0), col: COLOR.trak }] : []),
    { z: zMouth, label: zMouth.toFixed(0), col: COLOR.horn },
  ];
  const yMarks = [0, 0.5, 1].map(f => bMax / 1.08 * f);
  const xTicks = [...xMarks, ...(zoomed
    ? niceTicks(zAt(ml), zAt(VW - mr)).filter(z => xMarks.every(m => Math.abs(gx(m.z) - gx(z)) > 16))
        .map(z => ({ z, label: z.toFixed(0), col: "#404040" }))
    : [])].filter(t => inX(gx(t.z)));
  const yTicks = [...yMarks, ...(zoomed
    ? niceTicks(bAt(VH - mb), bAt(mt)).filter(b => yMarks.every(m => Math.abs(gy(m) - gy(b)) > 8))
    : [])].filter(b => inY(gy(b)));

  const segs = [];
  let cur = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].col !== pts[i-1].col) { segs.push(cur); cur = [{ ...pts[i-1], col: pts[i].col }]; }
    cur.push(pts[i]);
  }
  segs.push(cur);
  const mkPath = ps => ps.map((p, i) => `${i===0?'M':'L'}${gx(p.z).toFixed(1)},${gy(p.B).toFixed(1)}`).join(' ');

  return (
    <div style={{ position: "relative", background: "#1a1a1a", borderRadius: 8, border: "1px solid #292929", marginBottom: 8, padding: "4px 0 0 0" }}>
      <ZoomControls k={k} onReset={zoom.reset} top={4} right={6} compact />
      <svg ref={svgRef} {...zoom.handlers} viewBox={`0 0 ${VW} ${VH}`}
        style={{ width: "100%", display: "block", cursor: "grab", touchAction: "none", userSelect: "none" }}>
        <defs>
          <clipPath id="csPlot"><rect x={ml} y={mt} width={pw} height={ph} /></clipPath>
        </defs>
        <text x={ml} y={10} {...S.label} textAnchor="start" fontSize="8" fill={COLOR.text} letterSpacing="0.1em">QUERSCHNITT A(z) = B·H [mm²]</text>
        <line x1={axX} y1={mt} x2={axX} y2={VH-mb} stroke={COLOR.axisH} strokeWidth="0.7"/>
        <line x1={ml} y1={axY} x2={VW-mr} y2={axY} stroke={COLOR.axisH} strokeWidth="0.7"/>
        <g clipPath="url(#csPlot)">
          {zAchseTrans !== null && <line x1={gx(zAchseTrans)} y1={mt} x2={gx(zAchseTrans)} y2={VH-mb} stroke={COLOR.trak} strokeWidth="0.6" strokeDasharray="3 2" opacity="0.4"/>}
          {segs.map((seg, i) => <path key={i} d={mkPath(seg)} fill="none" stroke={seg[0].col} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round"/>)}
        </g>
        {yTicks.map(b => {
          const y = gy(b);
          return <g key={b}>
            <line x1={axX-3} y1={y} x2={axX} y2={y} stroke={COLOR.axisH} strokeWidth="0.5"/>
            <text x={axX-5} y={y} textAnchor="end" dominantBaseline="central" fontSize="7" fill="#404040" fontFamily="'DM Mono',monospace">{b.toFixed(0)}</text>
          </g>;
        })}
        {xTicks.map(t => <g key={t.z}>
          <line x1={gx(t.z)} y1={axY} x2={gx(t.z)} y2={axY+3} stroke={COLOR.axisH} strokeWidth="0.5"/>
          <text x={gx(t.z)} y={axY+11} textAnchor="middle" fontSize="7" fill={t.col} fontFamily="'DM Mono',monospace">{t.label}</text>
        </g>)}
      </svg>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// FULLSCREEN PANEL
// ──────────────────────────────────────────────────────────────────

function FullscreenPanel({ children }) {
  const [full, setFull] = useState(false);
  const btn = (
    <button onClick={() => setFull(f => !f)} style={{
      position: "absolute", top: 6, right: 6, zIndex: 10,
      background: "rgba(20,20,20,0.85)", border: "1px solid #303030",
      borderRadius: 4, color: "#6e6e6e", cursor: "pointer",
      width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 12, lineHeight: 1,
    }}>
      {full ? "✕" : "⤢"}
    </button>
  );
  if (full) return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#121212", display: "flex", flexDirection: "column" }}>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        {btn}{children}
      </div>
    </div>
  );
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {btn}{children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// APP
// ──────────────────────────────────────────────────────────────────

export default function App() {
  const [throatDiam,      setThroatDiam]      = useState(50.8);
  const [openingAngle,    setOpeningAngle]    = useState(140);
  const [L,               setL]               = useState(500);
  const [Lt,              setLt]              = useState(60);
  const [dw,              setDw]              = useState(120);
  const [dh,              setDh]              = useState(100);
  const [hMouth,          setHMouth]          = useState(200);
  const [curve,           setCurve]           = useState("exponential");
  const [hypexT,          setHypexT]          = useState(0.5);
  const [showRaumecke,    setShowRaumecke]    = useState(true);
  const [showWandstaerke, setShowWandstaerke] = useState(false);
  const [wandstaerke,     setWandstaerke]     = useState(20);
  const [expDraufsicht,   setExpDraufsicht]   = useState(true);
  const [expMundbogen,    setExpMundbogen]    = useState(true);
  const [expFokus,        setExpFokus]        = useState(true);
  const [expSeitenprofil, setExpSeitenprofil] = useState(true);
  const [expUebergang,    setExpUebergang]    = useState(true);
  const [expBemassung,    setExpBemassung]    = useState(true);
  const [filletOn,        setFilletOn]        = useState(false);
  const [filletR,         setFilletR]         = useState(100);

  const rt = throatDiam / 2;

  applyOpeningAngle(openingAngle);

  const extraBreite = showRaumecke && showWandstaerke
    ? (Math.cos(ALPHA2) + Math.sin(ALPHA2)) * wandstaerke
    : 0;

  const LtMax         = maxLt(L, rt, dw, dh);
  const LtMinRaumecke = showRaumecke ? minLtForRaumecke(L, rt, dw, dh, extraBreite) : null;
  const LtMin         = LtMinRaumecke !== null ? LtMinRaumecke : 0;
  const LtClamped     = Math.min(Math.max(Lt, LtMin), LtMax);

  const LMaxRaumecke  = showRaumecke ? maxLforRaumecke(LtClamped, rt, dw, dh, extraBreite) : null;
  const LClamped      = LMaxRaumecke !== null && L > LMaxRaumecke ? LMaxRaumecke : L;
  const Lmin          = minL(LtClamped, rt, dw, dh);
  const Lmax          = LMaxRaumecke !== null ? LMaxRaumecke : 1200;

  const atRaumeckeLimit = showRaumecke && LMaxRaumecke !== null && L >= LMaxRaumecke - 1;
  const atLtMax         = Lt > LtMax;
  const atLtMin         = showRaumecke && LtMinRaumecke !== null && Lt <= LtMin + 0.5;

  const s = solveHorn(LClamped, LtClamped, rt, dw, dh);
  const fillet = filletOn ? computeFillet(s, rt, hMouth, curve, hypexT, filletR) : null;

  return (
    <div style={{ background: "#121212", height: "100vh", overflow: "hidden", color: "#e4e4e4", fontFamily: "'DM Mono', monospace", display: "flex" }}>

      {/* Sidebar */}
      <div style={{ width: 368, flexShrink: 0, borderRight: "1px solid #262626", overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column" }}>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#d6cbb8", letterSpacing: "0.1em" }}>RADIALHORN</div>
          <div style={{ fontSize: 9, color: "#3a3a3a", letterSpacing: "0.2em", marginTop: 1 }}>KONFIGURATOR · {openingAngle}° · v4</div>
        </div>

        <div style={{ background: "#1a1a1a", borderRadius: 8, padding: "12px 14px", border: "1px solid #292929", marginBottom: 8 }}>
          <Toggle label="Raumecke" checked={showRaumecke} onChange={setShowRaumecke} />
          {showRaumecke && <div style={{ fontSize: 9, color: "#3a3a3a", paddingLeft: 46, marginTop: -6, marginBottom: 4 }}>Hornbreite auf Raumecken-Diagonale begrenzt</div>}
          <Toggle label="Wandstärke" checked={showWandstaerke} onChange={setShowWandstaerke} />
          {showWandstaerke && <Slider label="Wandstärke" value={wandstaerke} min={1} max={100} step={1} unit="mm" onChange={setWandstaerke} />}
        </div>

        <div style={{ background: "#1a1a1a", borderRadius: 8, padding: "12px 14px", border: "1px solid #292929", marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: "#3a3a3a", letterSpacing: "0.15em", marginBottom: 8 }}>THROAT</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {THROAT_SIZES.map(t => (
              <button key={t.val} onClick={() => setThroatDiam(t.val)} style={{
                padding: "4px 12px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                border: throatDiam === t.val ? "1px solid #d6cbb8" : "1px solid #303030",
                background: throatDiam === t.val ? "rgba(214,203,184,0.14)" : "#1e1e1e",
                color: throatDiam === t.val ? "#d6cbb8" : "#6e6e6e",
                fontFamily: "'DM Mono', monospace",
              }}>{t.label}</button>
            ))}
          </div>
        </div>

        <div style={{ background: "#1a1a1a", borderRadius: 8, padding: "12px 14px", border: "1px solid #292929", marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: "#3a3a3a", letterSpacing: "0.15em", marginBottom: 8 }}>HORNGEOMETRIE</div>
          <Slider label="Öffnungswinkel" value={openingAngle} min={60} max={160} step={1} unit="°" onChange={setOpeningAngle} />
          <Slider label="Gesamtlänge L" value={LClamped} min={Lmin} max={Lmax} step={5} unit="mm" onChange={setL} />
          {atRaumeckeLimit && <Warn>⚠ Raumecken-Limit ({LMaxRaumecke.toFixed(0)} mm)</Warn>}
          <Slider label="Traktrix-Länge Lₜ" value={LtClamped} min={LtMin} max={LtMax} step={1} unit="mm" onChange={setLt} />
          {atLtMax && <Warn>⚠ Lₜ-Maximum erreicht ({LtMax.toFixed(0)} mm)</Warn>}
          {atLtMin && <Warn>⚠ Lₜ-Minimum (Raumecke: {LtMin.toFixed(0)} mm)</Warn>}
        </div>

        <div style={{ background: "#1a1a1a", borderRadius: 8, padding: "12px 14px", border: "1px solid #292929", marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: "#3a3a3a", letterSpacing: "0.15em", marginBottom: 8 }}>TREIBER</div>
          <Slider label="Breite dw" value={dw} min={10} max={300} step={1} unit="mm" onChange={setDw} />
          <Slider label="Tiefe dh" value={dh} min={10} max={250} step={1} unit="mm" onChange={setDh} />
        </div>

        <div style={{ background: "#1a1a1a", borderRadius: 8, padding: "12px 14px", border: "1px solid #292929", marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: "#3a3a3a", letterSpacing: "0.15em", marginBottom: 8 }}>VERTIKALES PROFIL</div>
          <Slider label="Mund-Höhe hₘ" value={hMouth} min={Math.ceil(rt * 2)} max={600} step={1} unit="mm" onChange={setHMouth} />
          <div style={{ fontSize: 9, color: "#3a3a3a", letterSpacing: "0.12em", marginBottom: 6, marginTop: 4 }}>Aufweitungskurve</div>
          <SegBtn options={CURVES} value={curve} onChange={setCurve} />
          {curve === "hypex" && <Slider label="Hypex T" value={hypexT} min={0} max={2} step={0.05} unit="" onChange={setHypexT} />}
          <Toggle label="Verrundung Übergang" checked={filletOn} onChange={setFilletOn} />
          {filletOn && <Slider label="Radius r" value={filletR} min={1} max={1000} step={1} unit="mm" onChange={setFilletR} />}
          {filletOn && s && !(s.Lt > 0.5) && <Warn>Verrundung nur mit Traktrix-Eingang (Lₜ &gt; 0)</Warn>}
          {fillet?.limited && <Warn>Radius zu groß – begrenzt auf {fillet.R.toFixed(1)} mm</Warn>}
        </div>

        {s && (() => {
          const zEnd = s.zApex;
          const dz = Math.max(0.5, (s.zApex - (s.Lt > 0.5 ? s.zInnerApex : 0)) * 0.01);
          const slope = (verticalHalfHeight(zEnd, s, rt, hMouth, curve, hypexT, fillet) - verticalHalfHeight(zEnd - dz, s, rt, hMouth, curve, hypexT, fillet)) / dz;
          const vertAngle = 2 * Math.atan(slope) * 180 / Math.PI;
          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
              <Stat label="Mundbreite"   value={(2 * s.xMouth).toFixed(1) + " mm"} />
              <Stat label="Mund-Höhe"    value={hMouth + " mm"} />
              <Stat label="A(Mund)"      value={(s.arcR * 2 * ALPHA2 * hMouth / 1e6).toFixed(4) + " m²"} />
              <Stat label="Bogenlänge"   value={s.arcLen.toFixed(1) + " mm"} />
              <Stat label="Vert. Winkel" value={vertAngle.toFixed(1) + "°"} />
              <Stat label="Horiz. Winkel" value={openingAngle + "°"} />
            </div>
          );
        })()}

        {s && (() => {
          const c = 343000;
          const fcLow  = c / (2 * Math.PI * s.arcR);
          const fcHigh = c / (2 * rt);
          const B_mouth = s.arcR * 2 * ALPHA2;
          const hornLen = s.zApex - s.hatTipZ;
          const m = Math.log(B_mouth / (2 * rt)) / hornLen;
          const fcCut = c * m / (4 * Math.PI);
          const FreqStat = ({ label, value }) => (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
              <span style={{ fontSize: 10, color: "#6e6e6e", fontFamily: "'DM Mono', monospace" }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#9a9a9a", fontFamily: "'DM Mono', monospace" }}>
                {value >= 1000 ? (value / 1000).toFixed(2) + " k" : value.toFixed(0)} Hz
              </span>
            </div>
          );
          return (
            <div style={{ background: "#1a1a1a", borderRadius: 8, padding: "12px 14px", border: "1px solid #292929", marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: "#3a3a3a", letterSpacing: "0.15em", marginBottom: 8 }}>FREQUENZEN (NÄHERUNG)</div>
              <FreqStat label="fc_low  — Mund (λ=2πR)" value={fcLow}  />
              <FreqStat label="fc_cut  — Horn-Cutoff"   value={fcCut}  />
              <FreqStat label="fc_high — Throat (λ=2r)" value={fcHigh} />
              <div style={{ fontSize: 8, color: "#3a3a3a", marginTop: 6, lineHeight: 1.4 }}>
                Bandbreite: {fcLow.toFixed(0)} – {fcHigh >= 1000 ? (fcHigh/1000).toFixed(1)+"k" : fcHigh.toFixed(0)} Hz
              </div>
            </div>
          );
        })()}

        {s && <CrossSectionGraph s={s} rt={rt} hMouth={hMouth} curve={curve} hypexT={hypexT} fillet={fillet} />}

        {s && (
          <div style={{ background: "#1a1a1a", borderRadius: 8, padding: "12px 14px", border: "1px solid #292929", marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: "#3a3a3a", letterSpacing: "0.15em", marginBottom: 8 }}>EXPORT</div>
            <div style={{ fontSize: 9, color: "#3a3a3a", marginBottom: 6 }}>DXF — Kurven (mm)</div>
            <Toggle label="Draufsicht-Wände"  checked={expDraufsicht}   onChange={setExpDraufsicht} />
            <Toggle label="Mundbogen"          checked={expMundbogen}    onChange={setExpMundbogen} />
            <Toggle label="Fokuspunkt"         checked={expFokus}        onChange={setExpFokus} />
            <Toggle label="Seitenprofil"       checked={expSeitenprofil} onChange={setExpSeitenprofil} />
            <Toggle label="Übergangspunkt"     checked={expUebergang}    onChange={setExpUebergang} />
            <div style={{ fontSize: 9, color: "#3a3a3a", margin: "8px 0 6px" }}>PDF — zusätzlich zu Kurven oben</div>
            <Toggle label="Bemaßungen"         checked={expBemassung}    onChange={setExpBemassung} />
            <button onClick={() => exportDXF(s, rt, hMouth, curve, hypexT, { draufsicht: expDraufsicht, mundbogen: expMundbogen, fokus: expFokus, seitenprofil: expSeitenprofil, uebergang: expUebergang, fillet })}
              style={{ width: "100%", marginTop: 8, padding: "7px 0", borderRadius: 5, cursor: "pointer", border: "1px solid #d6cbb8", background: "rgba(214,203,184,0.15)", color: "#d6cbb8", fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: "0.05em" }}>
              ↓ DXF exportieren
            </button>
            <button onClick={() => exportPDF(s, rt, dw, dh, LClamped, hMouth, curve, hypexT, openingAngle, showRaumecke, showWandstaerke, wandstaerke, { draufsicht: expDraufsicht, mundbogen: expMundbogen, fokus: expFokus, seitenprofil: expSeitenprofil, bemassung: expBemassung, fillet })}
              style={{ width: "100%", marginTop: 6, padding: "7px 0", borderRadius: 5, cursor: "pointer", border: "1px solid #303030", background: "#1e1e1e", color: "#6e6e6e", fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: "0.05em" }}>
              ↓ PDF (Zeichnungen)
            </button>
          </div>
        )}
      </div>

      {/* Hauptbereich */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 10, gap: 8, overflow: "hidden", minWidth: 0 }}>
        <div style={{ flex: 6, background: "#161616", borderRadius: 8, border: "1px solid #262626", overflow: "hidden", minHeight: 0 }}>
          <FullscreenPanel>
            <HornSVG s={s} rt={rt} dw={dw} dh={dh} L={LClamped} showRaumecke={showRaumecke} showWandstaerke={showWandstaerke} wandstaerke={wandstaerke} openingAngle={openingAngle} />
          </FullscreenPanel>
        </div>
        <div style={{ flex: 5, background: "#161616", borderRadius: 8, border: "1px solid #262626", overflow: "hidden", minHeight: 0 }}>
          <FullscreenPanel>
            <SeitenrissSVG s={s} rt={rt} dw={dw} dh={dh} L={LClamped} hMouth={hMouth} curve={curve} hypexT={hypexT} fillet={fillet} />
          </FullscreenPanel>
        </div>
      </div>
    </div>
  );
}
