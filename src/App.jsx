import { useState, useEffect, useCallback, useRef } from "react";

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

// ── Geometrie-Konstanten (werden zur Laufzeit gesetzt) ─────────────────────
let ALPHA2    = 70 * Math.PI / 180;
let T_TRANS   = Math.asinh(1 / Math.tan(ALPHA2));
let PHI_TOTAL = 2 * ALPHA2;

const zN = t => t - Math.tanh(t);
const xN = t => 1 / Math.cosh(t);

// ──────────────────────────────────────────────────────────────────
// SOLVER
// ──────────────────────────────────────────────────────────────────

function solveR0(Lt, rt) {
  const f = r0 => {
    if (r0 <= rt) return -Lt;
    const tTh = Math.acosh(r0 / rt);
    if (tTh <= T_TRANS) return -Lt;
    return r0 * (zN(tTh) - zN(T_TRANS)) - Lt;
  };
  let hi = rt * 2;
  for (let i = 0; i < 80 && f(hi) < 0; i++) hi *= 2;
  if (f(hi) < 0) return null;
  let lo = rt * (1 + 1e-9);
  for (let i = 0; i < 90; i++) {
    const m = (lo + hi) / 2;
    f(m) < 0 ? (lo = m) : (hi = m);
  }
  return (lo + hi) / 2;
}

function solveHorn(L, Lt, rt, dw, dh) {
  let r0 = null, tTh = null, xTrans, zTrans;

  if (Lt > 0.5) {
    r0 = solveR0(Lt, rt);
    if (!r0) return null;
    tTh    = Math.acosh(r0 / rt);
    xTrans = r0 * xN(T_TRANS);
    zTrans = Lt;
  } else {
    xTrans = rt;
    zTrans = 0;
  }

  const zFocus  = zTrans - xTrans / Math.tan(ALPHA2);
  const hatTipZ = -dh - dw / 2;
  const Rtarget = L - dh - dw / 2 - zFocus;
  if (Rtarget <= 0) return null;

  const a = zTrans - zFocus, b = xTrans, c = Math.tan(ALPHA2);
  const A = 1 + c * c, B = 2 * (a + b * c), C = a * a + b * b - Rtarget * Rtarget;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const Ls = (-B + Math.sqrt(disc)) / (2 * A);
  if (Ls < 0) return null;

  const zMouth = zTrans + Ls;
  const xMouth = xTrans + Ls * c;
  const arcR   = Math.sqrt((zMouth - zFocus) ** 2 + xMouth ** 2);
  const zApex  = zFocus + arcR;
  const arcLen = arcR * PHI_TOTAL;

  const rInner     = Math.sqrt((zTrans - zFocus) ** 2 + xTrans ** 2);
  const zInnerApex = zFocus + rInner;

  return {
    r0, tTh, Lt, Ls,
    xTrans, zTrans,
    xMouth, zMouth,
    zFocus, arcR, zApex,
    hatTipZ, arcLen,
    rInner, zInnerApex,
    Fv: zFocus,
  };
}

function minL(Lt, rt, dw, dh) {
  let xTrans, zTrans;
  if (Lt > 0.5) {
    const r0 = solveR0(Lt, rt);
    if (!r0) return dh + dw / 2 + 50;
    xTrans = r0 * xN(T_TRANS); zTrans = Lt;
  } else { xTrans = rt; zTrans = 0; }
  const zFocus = zTrans - xTrans / Math.tan(ALPHA2);
  const rInner = Math.sqrt((zTrans - zFocus) ** 2 + xTrans ** 2);
  return Math.ceil(dh + dw / 2 + zFocus + rInner) + 10;
}

function maxLt(L, rt, dw, dh) {
  if (!solveHorn(L, 0, rt, dw, dh)) return 0;
  let lo = 0, hi = L;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    solveHorn(L, mid, rt, dw, dh) ? (lo = mid) : (hi = mid);
  }
  return lo;
}

function maxLforRaumecke(Lt, rt, dw, dh, extraBreite = 0) {
  let xTrans, zTrans;
  if (Lt > 0.5) {
    const r0 = solveR0(Lt, rt);
    if (!r0) return null;
    xTrans = r0 * xN(T_TRANS); zTrans = Lt;
  } else { xTrans = rt; zTrans = 0; }
  const LsMax = (dw / 2 + dh + zTrans - xTrans - extraBreite) / (Math.tan(ALPHA2) - 1);
  if (LsMax <= 0) return null;
  let lo = minL(Lt, rt, dw, dh), hi = lo + 5000;
  for (let i = 0; i < 40; i++) {
    const sv = solveHorn(hi, Lt, rt, dw, dh);
    if (sv && sv.Ls >= LsMax) break;
    hi *= 2;
  }
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const sv  = solveHorn(mid, Lt, rt, dw, dh);
    sv && sv.Ls < LsMax ? (lo = mid) : (hi = mid);
  }
  return (lo + hi) / 2;
}

function minLtForRaumecke(L, rt, dw, dh, extraBreite = 0) {
  const check = lt => { const r = maxLforRaumecke(lt, rt, dw, dh, extraBreite); return r !== null && r >= L; };
  if (check(0)) return 0;
  let lo = 0, hi = L;
  if (!check(hi)) return null;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; check(m) ? (hi = m) : (lo = m); }
  return hi;
}

// ──────────────────────────────────────────────────────────────────
// VERTIKALES PROFIL
// ──────────────────────────────────────────────────────────────────

function verticalHalfHeight(z, s, rt, hMouth, curve, hypexT) {
  const h0 = rt;
  const h1 = hMouth / 2;
  const z0 = s.zInnerApex;
  const z1 = s.zApex;

  if (z <= z0) return h0;
  if (z >= z1) return h1;

  const u = (z - z0) / (z1 - z0);

  if (curve === "linear") {
    return h0 + (h1 - h0) * u;
  }
  if (curve === "exponential") {
    if (h0 <= 0) return h1;
    return h0 * Math.exp(Math.log(h1 / h0) * u);
  }
  if (curve === "hypex") {
    const T = hypexT;
    const ratio = h1 / h0;
    if (ratio <= 0) return h0;
    let m;
    const fVal = mv => Math.cosh(mv) + T * Math.sinh(mv);
    if (Math.abs(ratio - 1) < 1e-9) {
      m = 0;
    } else if (ratio > 1) {
      let lo = 0, hi = Math.log(ratio * 2 + 2) + 1;
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        fVal(mid) < ratio ? (lo = mid) : (hi = mid);
      }
      m = (lo + hi) / 2;
    } else {
      return h0 + (h1 - h0) * u;
    }
    if (m < 1e-10) return h0 + (h1 - h0) * u;
    return h0 * fVal(m * u);
  }
  return h0 + (h1 - h0) * u;
}

// ──────────────────────────────────────────────────────────────────
// EXPORT: Punktgenerierung + DXF/PDF
// ──────────────────────────────────────────────────────────────────

function genDraufsichtWand(s) {
  const pts = [];
  if (s.Lt > 0.5) {
    for (let i = 0; i <= 80; i++) {
      const t = s.tTh + (T_TRANS - s.tTh) * i / 80;
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

function genSeitenprofilThroat(s, rt) {
  if (s.Lt <= 0.5) return [];
  return [[0, rt], [s.zInnerApex, rt]];
}

function genSeitenprofilFlare(s, rt, hMouth, curve, hypexT) {
  const pts = [];
  const zStart = s.Lt > 0.5 ? s.zInnerApex : 0;
  const n = 100;
  for (let i = 0; i <= n; i++) {
    const z = zStart + (s.zApex - zStart) * i / n;
    const h = verticalHalfHeight(z, s, rt, hMouth, curve, hypexT);
    pts.push([z, h]);
  }
  return pts;
}

function genSeitenprofil(s, rt, hMouth, curve, hypexT) {
  return [...genSeitenprofilThroat(s, rt), ...genSeitenprofilFlare(s, rt, hMouth, curve, hypexT)];
}

function dxfPolyline(pts, layer) {
  const is3D = pts.some(p => p[2] !== undefined && p[2] !== 0);
  const flag = is3D ? 8 : 0;
  let s = `0\nPOLYLINE\n8\n${layer}\n66\n1\n70\n${flag}\n`;
  for (const p of pts) {
    const a = p[0], b = p[1], c = p[2] || 0;
    const vflag = is3D ? 32 : 0;
    s += `0\nVERTEX\n8\n${layer}\n10\n${a.toFixed(4)}\n20\n${b.toFixed(4)}\n30\n${c.toFixed(4)}\n70\n${vflag}\n`;
  }
  s += `0\nSEQEND\n8\n${layer}\n`;
  return s;
}

function dxfPoint(x, y, layer, z = 0) {
  return `0\nPOINT\n8\n${layer}\n10\n${x.toFixed(4)}\n20\n${y.toFixed(4)}\n30\n${z.toFixed(4)}\n`;
}

function buildDXF(sections) {
  let body = "";
  for (const sec of sections) {
    if (sec.type === "polyline") body += dxfPolyline(sec.pts, sec.layer);
    else if (sec.type === "point") body += dxfPoint(sec.x, sec.y, sec.layer, sec.z ?? 0);
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

function exportPDF(s, rt, dw, dh, L, hMouth, curve, hypexT, openingAngle, showRaumecke, showWandstaerke, wandstaerke) {
  const scales = [1, 2, 5, 10, 20, 50];
  const wallPts = genDraufsichtWand(s);
  const maxX = Math.max(...wallPts.map(p => p[0])) * 2;
  const maxZ = s.zApex;
  const profPts = genSeitenprofil(s, rt, hMouth, curve, hypexT);
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

  const dimPad = massstab * 14;
  const dsW = maxX + 20 + dimPad * 2, dsH = maxZ + 20 + dimPad;
  const dsOX = dsW / 2, dsOY = 10;
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
      <path d="${pathFromPts(wallR)}" fill="none" stroke="#1a1a24" stroke-width="0.5"/>
      <path d="${pathFromPts(wallL)}" fill="none" stroke="#1a1a24" stroke-width="0.5"/>
      <path d="${pathFromPts(arcPts)}" fill="none" stroke="#7c5cff" stroke-width="0.5"/>
      <circle cx="${dsOX}" cy="${dsOY + s.zFocus}" r="0.7" fill="#7c5cff"/>
      ${dimH(dsOX - rt, dsOX + rt, dsOY - massstab*3, "Ø" + (rt*2).toFixed(1), false)}
      ${dimH(dsOX - halfMundB, dsOX + halfMundB, dsOY + maxZ + massstab*5, mundB, true)}
      ${dimV(dsOY, dsOY + maxZ, dsOX - halfMundB - dimPad*0.5, "L=" + L, false)}
    </svg>`;

  const spW = maxZ + 20 + dimPad, spH = profMaxH + 20 + dimPad * 2;
  const spOX = 10, spOY = spH / 2;
  const profU = profPts.map(([z, h]) => [spOX + z, spOY - h]);
  const profD = profPts.map(([z, h]) => [spOX + z, spOY + h]);
  const spSVG = `
    <svg width="${spW * mm2px}px" height="${spH * mm2px}px" viewBox="0 0 ${spW} ${spH}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${spOX}" y1="${spOY}" x2="${spOX + maxZ}" y2="${spOY}" stroke="#c8c8d0" stroke-width="0.2" stroke-dasharray="3 2"/>
      <path d="${pathFromPts(profU)}" fill="none" stroke="#1a1a24" stroke-width="0.5"/>
      <path d="${pathFromPts(profD)}" fill="none" stroke="#1a1a24" stroke-width="0.5"/>
      ${dimV(spOY - hMouth/2, spOY + hMouth/2, spOX + maxZ + massstab*5, hMouth + "", true)}
      ${dimV(spOY - rt, spOY + rt, spOX - massstab*3, "Ø" + (rt*2).toFixed(1), false)}
      ${dimH(spOX, spOX + maxZ, spOY + profMaxH/2 + massstab*8, "L=" + L, true)}
    </svg>`;

  const aMouth = (s.arcR * 2 * ALPHA2 * hMouth / 1e6).toFixed(4);
  const dzv = Math.max(0.5, (s.zApex - (s.Lt > 0.5 ? s.zInnerApex : 0)) * 0.01);
  const slope = (verticalHalfHeight(s.zApex, s, rt, hMouth, curve, hypexT) - verticalHalfHeight(s.zApex - dzv, s, rt, hMouth, curve, hypexT)) / dzv;
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
        <div class="section-label">DRAUFSICHT · HORIZONTALSCHNITT</div>
        <div class="drawing">${dsSVG}</div>
        <div class="section-label">SEITENRISS · VERTIKALSCHNITT</div>
        <div class="drawing">${spSVG}</div>
      </div>
    </div>
    <div class="footer">
      <span>Radialhorn-Konfigurator · Traktrix + linearer Bereich + Teilkreis</span>
      <span>Throat → Teilkreis-Scheitelpunkt = L</span>
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
    const wall = genDraufsichtWand(s);
    sections.push({ type: "polyline", pts: wall.map(([x, z]) => [z, x]),  layer: "Draufsicht_Wand" });
    sections.push({ type: "polyline", pts: wall.map(([x, z]) => [z, -x]), layer: "Draufsicht_Wand" });
  }
  if (opts.mundbogen) {
    const arc = [];
    for (let i = 0; i <= 80; i++) {
      const a = -ALPHA2 + 2 * ALPHA2 * i / 80;
      arc.push([s.zFocus + s.arcR * Math.cos(a), s.arcR * Math.sin(a)]);
    }
    sections.push({ type: "polyline", pts: arc, layer: "Mundbogen" });
  }
  if (opts.fokus) {
    sections.push({ type: "point", x: s.zFocus, y: 0, layer: "Fokus" });
  }
  if (opts.seitenprofil) {
    const throat = genSeitenprofilThroat(s, rt);
    const flare  = genSeitenprofilFlare(s, rt, hMouth, curve, hypexT);
    if (throat.length) {
      sections.push({ type: "polyline", pts: throat.map(([z, h]) => [z, 0,  h]), layer: "Seitenprofil_Throat" });
      sections.push({ type: "polyline", pts: throat.map(([z, h]) => [z, 0, -h]), layer: "Seitenprofil_Throat" });
    }
    sections.push({ type: "polyline", pts: flare.map(([z, h]) => [z, 0,  h]), layer: "Seitenprofil_Flare" });
    sections.push({ type: "polyline", pts: flare.map(([z, h]) => [z, 0, -h]), layer: "Seitenprofil_Flare" });
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
  arc:      "#a78bfa",
  raum:     "#fdba74",
  dim:      "#5a5a78",
  dimL:     "#6868a0",
  trans:    "#fca5a5",
  driv:     "#888898",
  text:     "#4a4a68",
  axisH:    "#2a2a3a",
  axisS:    "#2a2a38",
  drivFill: "rgba(22,22,36,0.55)",
  wand:     "#fcd34d",
};

const S = {
  trakWall: { fill: "none", stroke: COLOR.trak, strokeWidth: "2.2", strokeLinejoin: "round" },
  hornWall: { fill: "none", stroke: COLOR.horn, strokeWidth: "2.2", strokeLinejoin: "round" },
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
      <span style={{ minWidth: 128, fontSize: 11, color: "#8b8ba0", fontFamily: "'DM Mono', monospace" }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={Math.min(Math.max(value, min), max)}
        onChange={e => { onChange(parseFloat(e.target.value)); setDraft(e.target.value); }}
        style={{ flex: 1, minWidth: 0, accentColor: "#a78bfa" }} />
      <input type="number" min={min} max={max} step={step} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); }}
        style={{ width: 62, padding: "2px 6px", background: "#1a1a24", border: "1px solid #2e2e3e", borderRadius: 4, color: "#e0f0ff", fontSize: 11, fontFamily: "'DM Mono', monospace", boxSizing: "border-box" }} />
      <span style={{ minWidth: 24, fontSize: 10, color: "#5a5a78" }}>{unit}</span>
    </div>
  );
}

function Toggle({ label, checked, onChange, color = "#a78bfa" }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 8 }}>
      <div onClick={() => onChange(!checked)} style={{
        width: 36, height: 20, borderRadius: 10, position: "relative", transition: "background 0.2s",
        background: checked ? color : "#2e2e3e", flexShrink: 0,
      }}>
        <div style={{
          position: "absolute", top: 2, left: checked ? 16 : 2, width: 14, height: 14,
          borderRadius: "50%", background: "#fff", transition: "left 0.2s",
        }} />
      </div>
      <span style={{ fontSize: 11, color: checked ? color : "#5a5a78", fontFamily: "'DM Mono', monospace", userSelect: "none" }}>
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
          border: value === o ? "1px solid #a78bfa" : "1px solid #2e2e3e",
          background: value === o ? "rgba(167,139,250,0.15)" : "#1a1a24",
          color: value === o ? "#a78bfa" : "#5a5a78",
          fontFamily: "'DM Mono', monospace", letterSpacing: "0.05em",
        }}>{CURVE_LABELS[o]}</button>
      ))}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ background: "#18181f", border: "1px solid #2a2a38", borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontSize: 9, color: "#404058", marginBottom: 3, letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>{value}</div>
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
  const scale = Math.min(drawW / (2 * xMax), drawH / (zMax - zMin));
  const cx = ml + drawW / 2;
  const topOffset = mt + (drawH - (zMax - zMin) * scale) / 2;
  const toX = x => cx + x * scale;
  const toY = z => topOffset + (z - zMin) * scale;

  const trakPts = [];
  if (s.Lt > 0.5 && s.r0 && s.tTh) {
    for (let i = 0; i <= 180; i++) {
      const t = s.tTh + (T_TRANS - s.tTh) * i / 180;
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

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: "block" }}>
        <defs>
          <marker id="arrH" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M2 1L8 5L2 9" fill="none" stroke="#5a5a78" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>

        <line x1={cx} y1={toY(hatTipZ - 6)} x2={cx} y2={toY(s.zApex) + 32} stroke="#2a2a3a" strokeWidth="0.6" strokeDasharray="5 4" />
        <text x={cx} y={14} textAnchor="middle" fontSize="9" fill="#4a4a68" fontFamily="'DM Mono', monospace" letterSpacing="0.12em">DRAUFSICHT · HORIZONTALER SCHNITT</text>

        {showRaumecke && <>
          <line x1={hatX} y1={hatY} x2={reRx} y2={reY} stroke={COLOR.raum} strokeWidth="1.8" strokeLinecap="butt" strokeDasharray={`${70*scale} ${9*scale} ${4*scale} ${9*scale}`} />
          <line x1={hatX} y1={hatY} x2={reLx} y2={reY} stroke={COLOR.raum} strokeWidth="1.8" strokeLinecap="butt" strokeDasharray={`${70*scale} ${9*scale} ${4*scale} ${9*scale}`} />
          <circle cx={hatX} cy={hatY} r={DOT} fill={COLOR.raum} />
          <circle cx={toX(dw / 2)} cy={toY(-dh)} r={DOT} fill={COLOR.raum} />
          <circle cx={toX(-dw / 2)} cy={toY(-dh)} r={DOT} fill={COLOR.raum} />
          <path d={hat90} fill="none" stroke={COLOR.raum} strokeWidth="0.9" />
          <circle cx={reRx} cy={reY} r={DOT} fill={COLOR.raum} />
          <circle cx={reLx} cy={reY} r={DOT} fill={COLOR.raum} />
        </>}

        <rect x={toX(-dw / 2)} y={toY(-dh)} width={dw * scale} height={dh * scale}
          fill="rgba(22,22,36,0.6)" stroke="#363650" strokeWidth="1.3" rx="2" />
        <line x1={toX(-dw/2)} y1={toY(-dh)} x2={toX(dw/2)} y2={toY(0)} stroke="#303048" strokeWidth="0.5" opacity="0.5" />
        <line x1={toX(dw/2)} y1={toY(-dh)} x2={toX(-dw/2)} y2={toY(0)} stroke="#303048" strokeWidth="0.5" opacity="0.5" />
        <text x={cx} y={toY(-dh / 2)} textAnchor="middle" dominantBaseline="central" fontSize="10" fill="#4a4a68" fontFamily="'DM Mono', monospace">Treiber</text>

        {trakPts.length > 1 && <path d={fillPts(trakPts)} fill="rgba(249,168,212,0.09)" />}
        {hornPts.length > 1 && <path d={fillHorn} fill="rgba(134,239,172,0.08)" />}

        <path d={`M${fx},${fy} L${mRx},${mRy} A${rp},${rp} 0 0 1 ${mLx},${mLy} Z`} fill="rgba(147,197,253,0.06)" />
        <path d={`M${mRx},${mRy} A${rp},${rp} 0 0 1 ${mLx},${mLy}`} fill="none" stroke={COLOR.arc} strokeWidth="2.2" />

        {s.Lt > 0.5 && (
          <path d={`M${tRx},${tRy} A${irp},${irp} 0 0 1 ${tLx},${tLy}`}
            fill="none" stroke={COLOR.trak} strokeWidth="1.4" strokeDasharray="6 3" />
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
            <line x1={toX(s.xMouth)} y1={toY(s.zMouth)} x2={toX(s.xMouth + nx*wt)} y2={toY(s.zMouth + nz*wt)} stroke={COLOR.wand} strokeWidth="2.2" strokeLinecap="round" />
            <line x1={toX(-s.xMouth)} y1={toY(s.zMouth)} x2={toX(-s.xMouth - nx*wt)} y2={toY(s.zMouth + nz*wt)} stroke={COLOR.wand} strokeWidth="2.2" strokeLinecap="round" />
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

        <Dim p1={[toX(-dw/2), toY(-dh)]} p2={[toX(dw/2), toY(-dh)]}
          arrowPos={toY(hatTipZ) - 38} color={COLOR.dim}  marker="url(#arrH)" label={`${dw} mm`} />
        <Dim p1={[toX(-rt), toY(0)]}    p2={[toX(rt), toY(0)]}
          arrowPos={toY(hatTipZ) - 16}  color={COLOR.trak} marker="url(#arrH)" label={`Ø ${(rt*2).toFixed(1)} mm`} />

        <line x1={toX(-s.xMouth)} y1={toY(s.zMouth)+16} x2={toX(s.xMouth)} y2={toY(s.zMouth)+16} stroke="#5a5a78" strokeWidth="0.7" markerStart="url(#arrH)" markerEnd="url(#arrH)" />
        <text x={cx} y={toY(s.zMouth)+27} textAnchor="middle" fontSize="9" fill="#5a5a78" fontFamily="'DM Mono', monospace">{(2 * s.xMouth).toFixed(0)} mm</text>
        <text x={cx} y={toY(s.zApex)+28} textAnchor="middle" fontSize="9" fill="#5a5a78" fontFamily="'DM Mono', monospace">R={s.arcR.toFixed(0)} mm</text>
      </svg>

      {/* Legende */}
      {(() => {
        const items = [
          { col: "#f9a8d4", label: "Traktrix",      dash: false },
          { col: "#86efac", label: "Lin. Bereich",  dash: false },
          { col: "#a78bfa", label: "Teilkreis",     dash: false },
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
                      <line x1="0" y1="3" x2="12" y2="3" stroke={item.col} strokeWidth="2" strokeDasharray={item.dash ? "4 2" : "none"} />
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

function SeitenrissSVG({ s, rt, dw, dh, L, hMouth, curve, hypexT }) {
  const containerRef = useRef(null);
  const { w: VW, h: VH } = useSize(containerRef);

  if (!s || VW < 10 || VH < 10) return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;

  const throatH = rt * 2;
  const halfMax = Math.max(dw / 2, hMouth / 2) * 1.05;
  const zMin = s.hatTipZ - 10;
  const zMax = s.zApex + 10;

  const portrait = VH > VW;
  const scale = portrait
    ? Math.min((VH - Math.min(80, VH*0.12) * 2) / (zMax - zMin), (VW - Math.min(68, VW*0.15) * 2) / (2 * halfMax))
    : Math.min((VW - Math.min(80, VW*0.12) * 2) / (zMax - zMin), (VH - Math.min(68, VH*0.15) * 2) / (2 * halfMax));

  const contentW = (zMax - zMin) * scale;
  const contentH = 2 * halfMax * scale;
  const cy = VH / 2;

  const toX = portrait ? y => VW / 2 + y * scale : z => (VW - contentW) / 2 + (z - zMin) * scale;
  const toY = portrait ? z => VH - (VH - contentW) / 2 - (z - zMin) * scale : y => cy - y * scale;

  const ml = portrait ? (VW - contentH) / 2 : (VW - contentW) / 2;

  const nPts = 120;
  const profilePts = [];
  const zProfileStart = s.Lt > 0.5 ? s.zInnerApex : 0;
  for (let i = 0; i <= nPts; i++) {
    const z = zProfileStart + (s.zApex - zProfileStart) * i / nPts;
    const h = verticalHalfHeight(z, s, rt, hMouth, curve, hypexT);
    profilePts.push([toX(z), toY(h), toX(z), toY(-h)]);
  }

  const upperPath = profilePts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  const lowerPath = profilePts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[3]}`).join(" ");

  const bxo        = toX(s.zApex) + 18;
  const dimThroatAx = toX(s.hatTipZ) - 18;
  const dimDrivAx   = toX(s.hatTipZ) - 40;
  const dimLAy      = toY(-halfMax) + 16;
  const dimTrakAy   = toY(halfMax) - 36;

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: "block" }}>
        <defs>
          <marker id="arrV" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M2 1L8 5L2 9" fill="none" stroke="#5a5a78" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>

        <text x={(ml + VW - ml) / 2} y={10} textAnchor="middle" fontSize="9" fill="#4a4a68" fontFamily="'DM Mono', monospace" letterSpacing="0.12em">SEITENRISS · VERTIKALER SCHNITT</text>

        <line x1={toX(s.hatTipZ)} y1={toY(0)} x2={toX(s.zApex)} y2={toY(0)} stroke={COLOR.axisS} strokeWidth="0.6" strokeDasharray="5 4" />

        <rect x={toX(-dh)} y={toY(dw/2)} width={dh*scale} height={dw*scale}
          fill={COLOR.drivFill} stroke={COLOR.driv} strokeWidth="1.3" rx="2" />
        <line x1={toX(-dh)} y1={toY(dw/2)} x2={toX(0)} y2={toY(-dw/2)} stroke={COLOR.driv} strokeWidth="0.5" opacity="0.4" />
        <line x1={toX(0)} y1={toY(dw/2)} x2={toX(-dh)} y2={toY(-dw/2)} stroke={COLOR.driv} strokeWidth="0.5" opacity="0.4" />
        <text x={toX(-dh/2)} y={toY(0)} {...S.label} textAnchor="middle" dominantBaseline="central" fill={COLOR.text}>Treiber</text>

        <line x1={toX(s.hatTipZ)} y1={toY(-halfMax)} x2={toX(s.hatTipZ)} y2={toY(halfMax)}
          stroke={COLOR.raum} strokeWidth="1.8" strokeLinecap="butt"
          strokeDasharray={`${70*scale} ${9*scale} ${4*scale} ${9*scale}`} />

        <circle cx={toX(0)} cy={toY(throatH/2)} r={DOT} fill={COLOR.trak} />
        <circle cx={toX(0)} cy={toY(-throatH/2)} r={DOT} fill={COLOR.trak} />

        {s.Lt > 0.5 && <>
          <line x1={toX(0)} y1={toY(throatH/2)} x2={toX(s.zInnerApex)} y2={toY(throatH/2)} stroke={COLOR.trak} strokeWidth="1.8" strokeLinecap="round" />
          <line x1={toX(0)} y1={toY(-throatH/2)} x2={toX(s.zInnerApex)} y2={toY(-throatH/2)} stroke={COLOR.trak} strokeWidth="1.8" strokeLinecap="round" />
          <circle cx={toX(s.zInnerApex)} cy={toY(throatH/2)} r={DOT} fill={COLOR.trans} />
          <circle cx={toX(s.zInnerApex)} cy={toY(-throatH/2)} r={DOT} fill={COLOR.trans} />
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
        {s.Lt > 0.5 &&
          <Dim p1={[toX(0), toY(throatH/2)]}     p2={[toX(s.zInnerApex), toY(0)]}
            arrowPos={dimTrakAy} color={COLOR.trak} marker="url(#arrV)" label={`${s.zInnerApex.toFixed(0)} mm`} />
        }
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
// Hilfslinien: 2px vom Geometriepunkt, 2px über die Maßlinie hinaus.
// Text:        8px (Seite) bzw. 11px (unten) / 8px (oben) von der Maßlinie.
function Dim({ p1, p2, arrowPos, color, marker, label, sw = "0.7" }) {
  const [x1, y1] = p1, [x2, y2] = p2;

  if (Math.abs(y2 - y1) >= Math.abs(x2 - x1)) {
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

// ──────────────────────────────────────────────────────────────────
// QUERSCHNITT-GRAPH
// ──────────────────────────────────────────────────────────────────

function CrossSectionGraph({ s, rt, hMouth, curve, hypexT }) {
  const VW = 310, VH = 200;
  const ml = 38, mr = 8, mt = 16, mb = 20;

  const z_FV    = s.Lt > 0.5 ? -s.r0 * Math.tanh(s.tTh) : 0;
  const Rv_min  = Math.sqrt(z_FV ** 2 + rt * rt);
  const Rv_max  = Math.sqrt((s.zApex - z_FV) ** 2 + (hMouth / 2) ** 2);
  const hWall   = zw => verticalHalfHeight(zw, s, rt, hMouth, curve, hypexT);

  const findZwand = Rv => {
    const f = zw => (zw - z_FV) ** 2 + hWall(zw) ** 2 - Rv * Rv;
    let lo = 0, hi = s.zApex;
    if (f(lo) > 0 || f(hi) < 0) return null;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; f(mid) < 0 ? (lo = mid) : (hi = mid); }
    return (lo + hi) / 2;
  };

  const Rv_trans    = s.Lt > 0.5 ? Math.sqrt((s.r0 * (zN(s.tTh) - T_TRANS + 1) - z_FV) ** 2 + rt * rt) : 0;
  const zAchse_trans = z_FV + Rv_trans;

  const calcB = zw => {
    if (s.Lt > 0.5 && zw <= s.zTrans) {
      let lo = s.tTh, hi = T_TRANS;
      for (let i = 0; i < 60; i++) {
        const tm = (lo + hi) / 2;
        s.r0 * (zN(s.tTh) - zN(tm)) < zw ? (lo = tm) : (hi = tm);
      }
      return 2 * s.r0 * Math.atan(1 / Math.sinh((lo + hi) / 2));
    }
    const frac  = (zw - s.zTrans) / (s.Ls || 1);
    const xWall = s.xTrans + frac * s.Ls * Math.tan(ALPHA2);
    return Math.sqrt((zw - s.zFocus) ** 2 + xWall ** 2) * 2 * ALPHA2;
  };

  const z0  = z_FV + Rv_min;
  const pts = [];
  let zAchseTrans = null;

  for (let i = 0; i <= 100; i++) {
    const Rv      = Rv_min + (Rv_max - Rv_min) * i / 100;
    const zAchse  = z_FV + Rv;
    const zw      = findZwand(Rv);
    if (zw === null) continue;
    const h     = hWall(zw), dz2 = zw - z_FV;
    const theta = dz2 > 0 ? 2 * Math.atan(h / dz2) : Math.PI;
    const col   = zAchse <= zAchse_trans ? COLOR.trak : COLOR.horn;
    if (zAchseTrans === null && col === COLOR.horn) zAchseTrans = zAchse - z0;
    pts.push({ z: zAchse - z0, B: calcB(zw) * Rv * theta, col });
  }

  if (pts.length < 2) return null;
  pts[0].z = 0;

  const zMouth = pts[pts.length - 1].z;
  const bMax   = pts.reduce((m, p) => p.B > m ? p.B : m, 0) * 1.08;
  const gx     = z => ml + (z / zMouth) * (VW - ml - mr);
  const gy     = b => mt + (1 - b / bMax) * (VH - mt - mb);

  const segs = [];
  let cur = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].col !== pts[i-1].col) { segs.push(cur); cur = [{ ...pts[i-1], col: pts[i].col }]; }
    cur.push(pts[i]);
  }
  segs.push(cur);
  const mkPath = ps => ps.map((p, i) => `${i===0?'M':'L'}${gx(p.z).toFixed(1)},${gy(p.B).toFixed(1)}`).join(' ');

  return (
    <div style={{ background: "#16161f", borderRadius: 8, border: "1px solid #252535", marginBottom: 8, padding: "4px 0 0 0" }}>
      <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: "100%", display: "block" }}>
        <text x={(ml+VW-mr)/2} y={10} {...S.label} textAnchor="middle" fontSize="8" fill={COLOR.text} letterSpacing="0.1em">QUERSCHNITT A(z) = B·H [mm²]</text>
        <line x1={ml} y1={mt} x2={ml} y2={VH-mb} stroke={COLOR.axisH} strokeWidth="0.7"/>
        <line x1={ml} y1={VH-mb} x2={VW-mr} y2={VH-mb} stroke={COLOR.axisH} strokeWidth="0.7"/>
        {zAchseTrans !== null && <line x1={gx(zAchseTrans)} y1={mt} x2={gx(zAchseTrans)} y2={VH-mb} stroke={COLOR.trak} strokeWidth="0.6" strokeDasharray="3 2" opacity="0.4"/>}
        {segs.map((seg, i) => <path key={i} d={mkPath(seg)} fill="none" stroke={seg[0].col} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>)}
        {[0, 0.5, 1].map(f => {
          const b = bMax / 1.08 * f, y = gy(b);
          return <g key={f}>
            <line x1={ml-3} y1={y} x2={ml} y2={y} stroke={COLOR.axisH} strokeWidth="0.5"/>
            <text x={ml-5} y={y} textAnchor="end" dominantBaseline="central" fontSize="7" fill="#404058" fontFamily="'DM Mono',monospace">{b.toFixed(0)}</text>
          </g>;
        })}
        {[
          { z: 0,      label: "0",                 col: "#404058"  },
          ...(s.Lt > 0.5 && zAchseTrans !== null ? [{ z: zAchseTrans, label: `Lt=${s.Lt.toFixed(0)}`, col: COLOR.trak }] : []),
          { z: zMouth, label: zMouth.toFixed(0),   col: COLOR.horn },
        ].map(t => <g key={t.z}>
          <line x1={gx(t.z)} y1={VH-mb} x2={gx(t.z)} y2={VH-mb+3} stroke={COLOR.axisH} strokeWidth="0.5"/>
          <text x={gx(t.z)} y={VH-mb+11} textAnchor="middle" fontSize="7" fill={t.col} fontFamily="'DM Mono',monospace">{t.label}</text>
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
      background: "rgba(20,20,29,0.85)", border: "1px solid #2e2e3e",
      borderRadius: 4, color: "#5a5a78", cursor: "pointer",
      width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 12, lineHeight: 1,
    }}>
      {full ? "✕" : "⤢"}
    </button>
  );
  if (full) return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#0f0f17", display: "flex", flexDirection: "column" }}>
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
  const [expFokus,        setExpFokus]        = useState(true);
  const [expSeitenprofil, setExpSeitenprofil] = useState(true);
  const [expUebergang,    setExpUebergang]    = useState(true);

  const rt = throatDiam / 2;

  ALPHA2    = (openingAngle / 2) * Math.PI / 180;
  T_TRANS   = Math.asinh(1 / Math.tan(ALPHA2));
  PHI_TOTAL = openingAngle * Math.PI / 180;

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

  return (
    <div style={{ background: "#0f0f17", height: "100vh", overflow: "hidden", color: "#e2e2ec", fontFamily: "'DM Mono', monospace", display: "flex" }}>

      {/* Sidebar */}
      <div style={{ width: 368, flexShrink: 0, borderRight: "1px solid #222232", overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column" }}>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#a78bfa", letterSpacing: "0.1em" }}>RADIALHORN</div>
          <div style={{ fontSize: 9, color: "#3a3a58", letterSpacing: "0.2em", marginTop: 1 }}>KONFIGURATOR · {openingAngle}° · v4</div>
        </div>

        <div style={{ background: "#16161f", borderRadius: 8, padding: "12px 14px", border: "1px solid #252535", marginBottom: 8 }}>
          <Toggle label="Raumecke" checked={showRaumecke} onChange={setShowRaumecke} />
          {showRaumecke && <div style={{ fontSize: 9, color: "#3a3a58", paddingLeft: 46, marginTop: -6, marginBottom: 4 }}>Hornbreite auf Raumecken-Diagonale begrenzt</div>}
          <Toggle label="Wandstärke" checked={showWandstaerke} onChange={setShowWandstaerke} />
          {showWandstaerke && <Slider label="Wandstärke" value={wandstaerke} min={1} max={100} step={1} unit="mm" onChange={setWandstaerke} />}
        </div>

        <div style={{ background: "#16161f", borderRadius: 8, padding: "12px 14px", border: "1px solid #252535", marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: "#3a3a58", letterSpacing: "0.15em", marginBottom: 8 }}>THROAT</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {THROAT_SIZES.map(t => (
              <button key={t.val} onClick={() => setThroatDiam(t.val)} style={{
                padding: "4px 12px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                border: throatDiam === t.val ? "1px solid #a78bfa" : "1px solid #2e2e3e",
                background: throatDiam === t.val ? "rgba(167,139,250,0.14)" : "#1a1a26",
                color: throatDiam === t.val ? "#a78bfa" : "#5a5a78",
                fontFamily: "'DM Mono', monospace",
              }}>{t.label}</button>
            ))}
          </div>
        </div>

        <div style={{ background: "#16161f", borderRadius: 8, padding: "12px 14px", border: "1px solid #252535", marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: "#3a3a58", letterSpacing: "0.15em", marginBottom: 8 }}>HORNGEOMETRIE</div>
          <Slider label="Öffnungswinkel" value={openingAngle} min={60} max={160} step={1} unit="°" onChange={setOpeningAngle} />
          <Slider label="Gesamtlänge L" value={LClamped} min={Lmin} max={Lmax} step={5} unit="mm" onChange={setL} />
          {atRaumeckeLimit && <Warn>⚠ Raumecken-Limit ({LMaxRaumecke.toFixed(0)} mm)</Warn>}
          <Slider label="Traktrix-Länge Lₜ" value={LtClamped} min={LtMin} max={LtMax} step={1} unit="mm" onChange={setLt} />
          {atLtMax && <Warn>⚠ Lₜ-Maximum erreicht ({LtMax.toFixed(0)} mm)</Warn>}
          {atLtMin && <Warn>⚠ Lₜ-Minimum (Raumecke: {LtMin.toFixed(0)} mm)</Warn>}
        </div>

        <div style={{ background: "#16161f", borderRadius: 8, padding: "12px 14px", border: "1px solid #252535", marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: "#3a3a58", letterSpacing: "0.15em", marginBottom: 8 }}>TREIBER</div>
          <Slider label="Breite dw" value={dw} min={10} max={300} step={1} unit="mm" onChange={setDw} />
          <Slider label="Tiefe dh" value={dh} min={10} max={250} step={1} unit="mm" onChange={setDh} />
        </div>

        <div style={{ background: "#16161f", borderRadius: 8, padding: "12px 14px", border: "1px solid #252535", marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: "#3a3a58", letterSpacing: "0.15em", marginBottom: 8 }}>VERTIKALES PROFIL</div>
          <Slider label="Mund-Höhe hₘ" value={hMouth} min={Math.ceil(rt * 2)} max={600} step={1} unit="mm" onChange={setHMouth} />
          <div style={{ fontSize: 9, color: "#3a3a58", letterSpacing: "0.12em", marginBottom: 6, marginTop: 4 }}>Aufweitungskurve</div>
          <SegBtn options={CURVES} value={curve} onChange={setCurve} />
          {curve === "hypex" && <Slider label="Hypex T" value={hypexT} min={0} max={2} step={0.05} unit="" onChange={setHypexT} />}
        </div>

        {s && (() => {
          const zEnd = s.zApex;
          const dz = Math.max(0.5, (s.zApex - (s.Lt > 0.5 ? s.zInnerApex : 0)) * 0.01);
          const slope = (verticalHalfHeight(zEnd, s, rt, hMouth, curve, hypexT) - verticalHalfHeight(zEnd - dz, s, rt, hMouth, curve, hypexT)) / dz;
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
              <span style={{ fontSize: 10, color: "#5a5a78", fontFamily: "'DM Mono', monospace" }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#6868a0", fontFamily: "'DM Mono', monospace" }}>
                {value >= 1000 ? (value / 1000).toFixed(2) + " k" : value.toFixed(0)} Hz
              </span>
            </div>
          );
          return (
            <div style={{ background: "#16161f", borderRadius: 8, padding: "12px 14px", border: "1px solid #252535", marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: "#3a3a58", letterSpacing: "0.15em", marginBottom: 8 }}>FREQUENZEN (NÄHERUNG)</div>
              <FreqStat label="fc_low  — Mund (λ=2πR)" value={fcLow}  />
              <FreqStat label="fc_cut  — Horn-Cutoff"   value={fcCut}  />
              <FreqStat label="fc_high — Throat (λ=2r)" value={fcHigh} />
              <div style={{ fontSize: 8, color: "#2a2a3a", marginTop: 6, lineHeight: 1.4 }}>
                Bandbreite: {fcLow.toFixed(0)} – {fcHigh >= 1000 ? (fcHigh/1000).toFixed(1)+"k" : fcHigh.toFixed(0)} Hz
              </div>
            </div>
          );
        })()}

        {s && <CrossSectionGraph s={s} rt={rt} hMouth={hMouth} curve={curve} hypexT={hypexT} />}

        {s && (
          <div style={{ background: "#16161f", borderRadius: 8, padding: "12px 14px", border: "1px solid #252535", marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: "#3a3a58", letterSpacing: "0.15em", marginBottom: 8 }}>EXPORT</div>
            <div style={{ fontSize: 9, color: "#3a3a58", marginBottom: 6 }}>DXF — Kurven (mm)</div>
            <Toggle label="Draufsicht-Wände"  checked={expDraufsicht}   onChange={setExpDraufsicht} />
            <Toggle label="Fokuspunkt"         checked={expFokus}        onChange={setExpFokus} />
            <Toggle label="Seitenprofil"       checked={expSeitenprofil} onChange={setExpSeitenprofil} />
            <Toggle label="Übergangspunkt"     checked={expUebergang}    onChange={setExpUebergang} />
            <button onClick={() => exportDXF(s, rt, hMouth, curve, hypexT, { draufsicht: expDraufsicht, fokus: expFokus, seitenprofil: expSeitenprofil, uebergang: expUebergang })}
              style={{ width: "100%", marginTop: 8, padding: "7px 0", borderRadius: 5, cursor: "pointer", border: "1px solid #a78bfa", background: "rgba(167,139,250,0.15)", color: "#a78bfa", fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: "0.05em" }}>
              ↓ DXF exportieren
            </button>
            <button onClick={() => exportPDF(s, rt, dw, dh, LClamped, hMouth, curve, hypexT, openingAngle, showRaumecke, showWandstaerke, wandstaerke)}
              style={{ width: "100%", marginTop: 6, padding: "7px 0", borderRadius: 5, cursor: "pointer", border: "1px solid #2e2e3e", background: "#1a1a26", color: "#5a5a78", fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: "0.05em" }}>
              ↓ PDF (Zeichnungen)
            </button>
          </div>
        )}
      </div>

      {/* Hauptbereich */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 10, gap: 8, overflow: "hidden", minWidth: 0 }}>
        <div style={{ flex: 6, background: "#14141d", borderRadius: 8, border: "1px solid #222232", overflow: "hidden", minHeight: 0 }}>
          <FullscreenPanel>
            <HornSVG s={s} rt={rt} dw={dw} dh={dh} L={LClamped} showRaumecke={showRaumecke} showWandstaerke={showWandstaerke} wandstaerke={wandstaerke} openingAngle={openingAngle} />
          </FullscreenPanel>
        </div>
        <div style={{ flex: 5, background: "#14141d", borderRadius: 8, border: "1px solid #222232", overflow: "hidden", minHeight: 0 }}>
          <FullscreenPanel>
            <SeitenrissSVG s={s} rt={rt} dw={dw} dh={dh} L={LClamped} hMouth={hMouth} curve={curve} hypexT={hypexT} />
          </FullscreenPanel>
        </div>
      </div>
    </div>
  );
}
