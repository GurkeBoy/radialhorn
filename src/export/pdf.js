// PDF-Datenblatt: maßstäbliche Zeichnungen (Draufsicht, Seitenriss) und Kennwerte als
// HTML, das in einem neuen Fenster geöffnet und über den Druckdialog als PDF gespeichert
// wird. Die Hut-Spitze der Raumecke wird nicht gezeichnet; Längenmaße zeigen deshalb die
// gezeichnete Strecke, L steht in den Kennwerten.
import {
  hasTraktrix, traktrixPoints, linearWallPoints, mouthArea, verticalMouthAngle,
} from "../horn-math.js";
import { linspace, svgPath } from "../utils.js";
import { downloadFile } from "./download.js";

const SCALES = [1, 2, 5, 10, 20, 50];
const SHEET_MM = 170;             // verfügbare Zeichnungsbreite auf A4
const C = { dim: "#7c5cff", dimText: "#5a4bbf", line: "#1a1a24", axis: "#c8c8d0", arc: "#7c5cff" };
const CURVE_LABELS = { linear: "Linear", exponential: "Exponential", hypex: "Hypex" };

/** Kontur der Draufsicht (rechte Hälfte) als Punkte [x, z]. */
function planOutline(s) {
  const trak = traktrixPoints(s, 500);
  const wall = linearWallPoints(s, 50);
  return trak.length ? [...trak, ...wall.slice(1)] : wall;
}

/** Kontur des Seitenrisses (obere Hälfte) als Punkte [z, h]. */
function sideOutline(s, rt, profile, fillet) {
  if (fillet) return [[0, rt], ...linspace(fillet.zT1, s.zApex, 500).map(z => [z, profile(z)])];
  const throat = hasTraktrix(s) ? [[0, rt], [s.zInnerApex, rt]] : [];
  return [...throat, ...linspace(hasTraktrix(s) ? s.zInnerApex : 0, s.zApex, 500).map(z => [z, profile(z)])];
}

/** Bemaßungs-Primitive in Zeichnungseinheiten (mm) für einen Maßstab. */
function dimensioning(massstab) {
  const ts = massstab * 2.4, tick = massstab * 1.2;
  const line = (x1, y1, x2, y2, w = 0.25) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.dim}" stroke-width="${w}"/>`;
  const f = v => v.toFixed(2);

  const dimH = (x1, x2, y, label, below) => `
    ${line(x1, y, x2, y)}
    ${line(x1, y - tick, x1, y + tick)}
    ${line(x2, y - tick, x2, y + tick)}
    <text x="${(x1 + x2) / 2}" y="${y + (below ? ts * 1.1 : -ts * 0.5)}" font-size="${ts}" fill="${C.dimText}" text-anchor="middle" font-family="monospace">${label}</text>`;

  const dimV = (y1, y2, x, label, right) => {
    const tx = x + (right ? ts * 0.6 : -ts * 0.6), my = (y1 + y2) / 2;
    return `
    ${line(x, y1, x, y2)}
    ${line(x - tick, y1, x + tick, y1)}
    ${line(x - tick, y2, x + tick, y2)}
    <text x="${tx}" y="${my}" font-size="${ts}" fill="${C.dimText}" text-anchor="${right ? "start" : "end"}" dominant-baseline="middle" font-family="monospace" transform="rotate(-90 ${tx} ${my})">${label}</text>`;
  };

  // Schräge Bemaßung parallel zur Strecke; offset positiv = links von (x1,y1) → (x2,y2)
  const dimParallel = (x1, y1, x2, y2, offset, label) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 0.01) return "";
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const nx = uy, ny = -ux;
    const d1x = x1 + nx * offset, d1y = y1 + ny * offset;
    const d2x = x2 + nx * offset, d2y = y2 + ny * offset;
    let angle = Math.atan2(uy, ux) * 180 / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    const tx = (d1x + d2x) / 2 + nx * ts * 0.9, ty = (d1y + d2y) / 2 + ny * ts * 0.9;
    const sg = Math.sign(offset || 1) * 0.8;
    return `
    ${line(f(x1 + nx * sg), f(y1 + ny * sg), f(d1x + nx * sg), f(d1y + ny * sg), 0.15)}
    ${line(f(x2 + nx * sg), f(y2 + ny * sg), f(d2x + nx * sg), f(d2y + ny * sg), 0.15)}
    ${line(f(d1x), f(d1y), f(d2x), f(d2y))}
    ${line(f(d1x - uy * tick), f(d1y + ux * tick), f(d1x + uy * tick), f(d1y - ux * tick))}
    ${line(f(d2x - uy * tick), f(d2y + ux * tick), f(d2x + uy * tick), f(d2y - ux * tick))}
    <text x="${f(tx)}" y="${f(ty)}" font-size="${ts}" fill="${C.dimText}" text-anchor="middle" dominant-baseline="central" font-family="monospace" transform="rotate(${angle.toFixed(1)} ${f(tx)} ${f(ty)})">${label}</text>`;
  };

  return { dimH, dimV, dimParallel };
}

/**
 * Erzeugt das HTML des Datenblatts.
 * @param design  { s, rt, L, hMouth, curve, hypexT, fillet, profile,
 *                  showRaumecke, showWandstaerke, wandstaerke }
 * @param opts    { draufsicht, mundbogen, fokus, seitenprofil, bemassung }
 */
export function buildDatasheet(design, opts, date = new Date()) {
  const { s, rt, L, hMouth, curve, hypexT, fillet, profile, showRaumecke, showWandstaerke, wandstaerke } = design;
  const trakOn = hasTraktrix(s);
  const wallPts = planOutline(s);
  const profPts = sideOutline(s, rt, profile, fillet);
  const halfMundB = Math.max(...wallPts.map(p => p[0]));
  const maxX = halfMundB * 2;
  const maxZ = s.zApex;
  const profMaxH = Math.max(...profPts.map(p => p[1])) * 2;

  const massstab = SCALES.find(sc => Math.max(maxX, maxZ, profMaxH) / sc <= SHEET_MM) || 100;
  const mm2px = 96 / 25.4 / massstab;
  const { dimH, dimV, dimParallel } = dimensioning(massstab);
  const path = (pts, color) => `<path d="${svgPath(pts, 2)}" fill="none" stroke="${color}" stroke-width="0.5"/>`;
  const svg = (w, h, body) =>
    `<svg width="${w * mm2px}px" height="${h * mm2px}px" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  const dimPad = massstab * 14;
  const mundB = maxX.toFixed(0);

  // ── Draufsicht ──────────────────────────────────────────────────
  const dsTopPad = massstab * 8;
  const dsW = maxX + 20 + dimPad * 2, dsH = maxZ + dsTopPad + dimPad;
  const dsOX = dsW / 2, dsOY = dsTopPad;
  const arcPts = linspace(-s.alpha2, s.alpha2, 60)
    .map(a => [dsOX + s.arcR * Math.sin(a), dsOY + s.zFocus + s.arcR * Math.cos(a)]);
  const dsSVG = svg(dsW, dsH, `
      <line x1="${dsOX}" y1="${dsOY}" x2="${dsOX}" y2="${dsOY + maxZ}" stroke="${C.axis}" stroke-width="0.2" stroke-dasharray="3 2"/>
      ${opts.draufsicht ? [1, -1].map(sign => path(wallPts.map(([x, z]) => [dsOX + sign * x, dsOY + z]), C.line)).join("") : ""}
      ${opts.mundbogen ? path(arcPts, C.arc) : ""}
      ${opts.fokus ? `<circle cx="${dsOX}" cy="${dsOY + s.zFocus}" r="0.7" fill="${C.arc}"/>` : ""}
      ${opts.bemassung ? [
        dimH(dsOX - rt, dsOX + rt, dsOY - massstab * 5, "Ø" + (rt * 2).toFixed(1), false),
        dimH(dsOX - halfMundB, dsOX + halfMundB, dsOY + maxZ + massstab * 5, mundB, true),
        dimV(dsOY, dsOY + maxZ, dsOX - halfMundB - dimPad * 0.5, s.zApex.toFixed(0), false),
        trakOn ? dimV(dsOY, dsOY + s.zInnerApex, dsOX + halfMundB + dimPad * 0.5, s.zInnerApex.toFixed(0), true) : "",
        dimParallel(dsOX - s.xMouth, dsOY + s.zMouth, dsOX - s.xTrans, dsOY + s.zTrans, massstab * 5, (s.arcR - s.rInner).toFixed(0)),
      ].join("") : ""}`);

  // ── Seitenriss ──────────────────────────────────────────────────
  const spLeftPad = massstab * 8;
  const spW = maxZ + spLeftPad + dimPad, spH = profMaxH + 20 + dimPad * 2;
  const spOX = spLeftPad, spOY = spH / 2;
  const spZStart = trakOn ? s.zInnerApex : 0;
  const spTopY = spOY - profMaxH / 2 - massstab * 5;
  const spSVG = svg(spW, spH, `
      <line x1="${spOX}" y1="${spOY}" x2="${spOX + maxZ}" y2="${spOY}" stroke="${C.axis}" stroke-width="0.2" stroke-dasharray="3 2"/>
      ${opts.seitenprofil ? [1, -1].map(sign => path(profPts.map(([z, h]) => [spOX + z, spOY - sign * h]), C.line)).join("") : ""}
      ${opts.bemassung ? [
        dimV(spOY - hMouth / 2, spOY + hMouth / 2, spOX + maxZ + massstab * 5, hMouth + "", true),
        dimV(spOY - rt, spOY + rt, spOX - massstab * 5, "Ø" + (rt * 2).toFixed(1), false),
        dimH(spOX, spOX + maxZ, spOY + profMaxH / 2 + massstab * 8, s.zApex.toFixed(0), true),
        trakOn ? dimH(spOX, spOX + s.zInnerApex, spTopY, s.zInnerApex.toFixed(0), false) : "",
        dimH(spOX + spZStart, spOX + s.zApex, spTopY, (s.zApex - spZStart).toFixed(0), false),
      ].join("") : ""}`);

  // ── Kennwerte ───────────────────────────────────────────────────
  const kv = [
    ["Öffnungswinkel horiz.", s.openingAngle + " °"],
    ["Öffnungswinkel vert.",  verticalMouthAngle(s, profile).toFixed(1) + " °"],
    ["Gesamtlänge L",         L + " mm"],
    ["Traktrix-Länge",        s.Lt.toFixed(0) + " mm"],
    ["Throat Ø",              (rt * 2).toFixed(1) + " mm"],
    ["Mundbreite",            mundB + " mm"],
    ["Mund-Höhe",             hMouth + " mm"],
    ["Mundfläche A",          (mouthArea(s, hMouth) / 1e6).toFixed(4) + " m²"],
    ["Teilkreis-Radius",      s.arcR.toFixed(1) + " mm"],
    ["Aufweitung",            CURVE_LABELS[curve] + (curve === "hypex" ? ` (T=${hypexT})` : "")],
    ["Verrundung Übergang",   fillet ? "R " + fillet.R.toFixed(1) + " mm" : "–"],
    ["Raumecke",              showRaumecke ? "ja" : "nein"],
    ["Wandstärke",            showWandstaerke ? wandstaerke + " mm" : "–"],
  ];
  const kvRows = kv.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Radialhorn – Datenblatt</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: 'DM Mono', ui-monospace, monospace; color: ${C.line}; margin: 0; background: #fff; }
  .page { padding: 16mm 18mm; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid ${C.line}; padding-bottom: 5mm; margin-bottom: 7mm; }
  .title { font-size: 22pt; font-weight: 700; letter-spacing: 0.08em; color: ${C.line}; line-height: 1; }
  .subtitle { font-size: 8pt; letter-spacing: 0.25em; color: ${C.dim}; margin-top: 2mm; }
  .docmeta { text-align: right; font-size: 8pt; color: #888; line-height: 1.7; }
  .docmeta b { color: ${C.line}; }
  .scale-badge { display: inline-block; background: ${C.dim}; color: #fff; font-size: 11pt; font-weight: 700; padding: 1.5mm 4mm; border-radius: 2mm; letter-spacing: 0.05em; }
  .grid { display: grid; grid-template-columns: 1fr 1.6fr; gap: 8mm; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  td { padding: 1.6mm 2mm; border-bottom: 1px solid #ececf2; }
  td:first-child { color: #888; }
  td:last-child { text-align: right; font-weight: 700; }
  .section-label { font-size: 8pt; letter-spacing: 0.2em; color: ${C.dim}; margin: 0 0 3mm; font-weight: 700; }
  .drawing { border: 1px solid #ececf2; border-radius: 3mm; padding: 6mm; background: #fafafb; text-align: center; margin-bottom: 6mm; }
  .footer { margin-top: 8mm; padding-top: 4mm; border-top: 1px solid #ececf2; font-size: 7.5pt; color: #aaa; display: flex; justify-content: space-between; }
  .hint { background: #f0eeff; color: ${C.dimText}; padding: 3mm 4mm; border-radius: 2mm; font-size: 8.5pt; margin-bottom: 6mm; }
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
        <b>Datum</b> ${date.toLocaleDateString("de-DE")}<br>
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
        <div class="drawing">${dsSVG}</div>` : ""}
        ${opts.seitenprofil ? `<div class="section-label">SEITENRISS · VERTIKALSCHNITT</div>
        <div class="drawing">${spSVG}</div>` : ""}
      </div>
    </div>
    <div class="footer">
      <span>Radialhorn-Konfigurator · Traktrix + linearer Bereich + Teilkreis</span>
      <span>L = Raumecke (Hut-Spitze) → Teilkreis-Scheitelpunkt</span>
    </div>
  </div>
</body></html>`;
}

/** Öffnet das Datenblatt zum Drucken; ohne Pop-up-Erlaubnis als HTML-Datei. */
export function exportPDF(design, opts) {
  const html = buildDatasheet(design, opts);
  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 400);
  } else {
    downloadFile(html, `radialhorn_${design.s.openingAngle}deg_L${design.L}_datenblatt.html`, "text/html");
  }
}
