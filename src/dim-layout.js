// Bemaßung der 2D-Ansichten: welche Maße es gibt (topViewDims, sideViewDims) und auf welcher Lage
// sie liegen (layoutDims) – berechnet nach den Bemaßungsregeln (CLAUDE.md), nicht je Maß festgelegt.
// Rein funktional und ohne React, damit Tests die Regeln über viele Geometrien prüfen können
// (dim-layout.test.js). Die schrägen Wandmaße der Draufsicht (DimAligned, wallDimOff) sind nicht
// Teil davon; sie weichen ihren Hindernissen selbst aus.
import { hasTraktrix, hasClothoid } from "./horn-math.js";
import { COLOR } from "./theme.js";
import { fmtLength } from "./utils.js";

/** Abstand der 1. Lage vom äußersten Punkt der Zeichnung und Lagenabstand [px]. */
export const DIM_FIRST = 18, DIM_STEP = 22;

/**
 * Beschriftung: Breite aus der Zeichenzahl – DM Mono hat feste Zeichenbreite 0,6 em (im Browser
 * gemessen: 5,4 px je Zeichen bei 9 px, wie S.label). TEXT_PAD Luft je Seite, ARROW Platz je Pfeilspitze [px].
 */
export const LABEL_FONT = 9;
const CHAR_W = 0.6 * LABEL_FONT, TEXT_PAD = 3, ARROW = 5;
export const labelWidth = label => [...label].length * CHAR_W + 2 * TEXT_PAD;

/** Seiten, auf denen Maße liegen; links/rechts senkrechte Maßlinien, oben/unten waagerechte. */
const SIDES = ["left", "right", "top", "bottom"];
const isVertical = side => side === "left" || side === "right";

/**
 * Lagen je Seite vergeben. Ein Maß belegt entlang seiner Seite die Strecke zwischen p1 und p2
 * (links/rechts in y, oben/unten in x). Regeln:
 *   - Umschließt ein Maß ein anderes, liegt es weiter außen (das kleinere innen) – sonst kreuzten
 *     die Hilfslinien des äußeren die Maßlinie des inneren.
 *   - Berühren sich Maße nur, teilen sie sich eine Lage (Kette).
 *   - Überlappen sie teilweise, kommen sie auf verschiedene Lagen (eine Kreuzung ist dann nicht
 *     zu vermeiden; der Test meldet es).
 *   - Ist ein Kettenglied zu kurz für seinen Text und stieße der mittig an den Text eines
 *     Nachbarn derselben Lage, rückt das Maß eine Lage nach außen (von zwei solchen das kürzere);
 *     was es umschließt, liegt dann weiterhin innen, was es umschließt hat, wieder außen. Ist
 *     genug Platz, bleibt die Kette auf einer Lage.
 * Umgesetzt: nach Länge aufsteigend, jedes Maß eine Lage über allen schon gesetzten, mit denen
 * es sich um mehr als eps überlappt, aber mindestens auf seiner Mindestlage; danach so oft neu,
 * bis kein mittiger Text mehr an einen Nachbartext stößt.
 * @param dims   [{ id, side, p1: [x, y], p2: [x, y], label, … }] in Bildschirmkoordinaten
 * @param edges  { left, right, top, bottom }  äußerster Punkt der Zeichnung je Seite (Bildschirm)
 * @returns dims mit layer, arrowPos (Lage der Maßlinie), orient ("v" | "h"), lo/hi (belegte
 *   Strecke), text { at, lo, hi, outside } (Platz der Beschriftung entlang der Maßlinie)
 */
export function layoutDims(dims, edges, { first = DIM_FIRST, step = DIM_STEP, eps = 0.5 } = {}) {
  const out = dims.map((d, i) => {
    const vertical = isVertical(d.side);
    const a = vertical ? d.p1[1] : d.p1[0], b = vertical ? d.p2[1] : d.p2[0];
    return { ...d, order: i, lo: Math.min(a, b), hi: Math.max(a, b), orient: vertical ? "v" : "h" };
  });
  for (const side of SIDES) {
    const own = out.filter(d => d.side === side).sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo) || a.order - b.order);
    const minLayer = new Map();
    for (let round = 0; round < 3 * own.length + 1; round++) {
      const placed = [];
      for (const d of own) {
        d.layer = minLayer.get(d) ?? 0;
        for (const q of placed) if (Math.min(d.hi, q.hi) - Math.max(d.lo, q.lo) > eps) d.layer = Math.max(d.layer, q.layer + 1);
        placed.push(d);
      }
      const crowded = crowdedLabels(own);
      if (!crowded.length) break;
      for (const d of crowded) minLayer.set(d, d.layer + 1);
    }
    const dir = side === "left" || side === "top" ? -1 : 1;
    for (const d of own) d.arrowPos = edges[side] + dir * (first + step * d.layer);
    placeLabels(own);
  }
  return out;
}

/** Passt die Beschriftung mit beiden Pfeilspitzen zwischen die Enden des Maßes? */
const labelFits = d => labelWidth(d.label ?? "") + 2 * ARROW <= d.hi - d.lo;

/**
 * Maße, die eine Lage nach außen rücken sollen: auf derselben Lage stoßen die mittigen Texte
 * zweier Maße aneinander – rücken muss das, dessen Text nicht zwischen die eigenen Pfeile passt
 * (passen beide nicht: das kürzere). Ein passender Text bleibt in seinem Maß und kann den
 * Nachbarn nicht stören; zwei passende stoßen nie aneinander.
 */
function crowdedLabels(own) {
  const centered = d => { const w = labelWidth(d.label ?? ""), mid = (d.lo + d.hi) / 2; return [mid - w / 2, mid + w / 2]; };
  const move = new Set();
  for (const a of own) for (const b of own) {
    if (a.order >= b.order || a.layer !== b.layer || move.has(a) || move.has(b)) continue;
    const [alo, ahi] = centered(a), [blo, bhi] = centered(b);
    if (Math.min(ahi, bhi) - Math.max(alo, blo) <= 0) continue;
    const candidates = [a, b].filter(d => !labelFits(d));
    if (candidates.length) move.add(candidates.sort((x, y) => (x.hi - x.lo) - (y.hi - y.lo))[0]);
  }
  return [...move];
}

/**
 * Platz der Beschriftung entlang der Maßlinie (text: { at, lo, hi, outside }): mittig an der
 * eigenen Linie – auch wenn sie breiter ist als das Maß und eine gestrichelte Hilfslinie schneidet.
 * Dafür rücken zu kurze Kettenglieder eine Lage nach außen (crowdedLabels): jeder Text soll an
 * seiner Linie stehen, nicht seitlich daneben, wo man ihn dem Nachbarn zuordnet. Nur wenn er
 * mittig doch einen anderen Text derselben Lage überdecken würde, rückt er direkt hinter das
 * freiere Ende neben die Pfeilspitze.
 * @param own  Maße einer Seite, mit Lage
 */
function placeLabels(own) {
  const span = (at, w) => ({ at, lo: at - w / 2, hi: at + w / 2 });
  for (const layer of new Set(own.map(d => d.layer))) {
    const here = own.filter(d => d.layer === layer);
    const taken = [];
    const hits = t => taken.filter(o => Math.min(t.hi, o.hi) - Math.max(t.lo, o.lo) > 0).length;
    // passende Texte zuerst (sie stehen sicher mittig), dann die übrigen von kurz nach lang
    const order = [...here.filter(labelFits), ...here.filter(d => !labelFits(d)).sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo))];
    for (const d of order) {
      const w = labelWidth(d.label ?? ""), mid = (d.lo + d.hi) / 2;
      const options = [span(mid, w), span(d.hi + ARROW + w / 2, w), span(d.lo - ARROW - w / 2, w)];
      const best = options.find(o => hits(o) === 0) ?? options[0];
      d.text = { ...best, outside: best !== options[0] };
      taken.push(d.text);
    }
  }
}

/**
 * Wie weit die Maße samt Beschriftung über die Zeichenfläche (0 … VW, 0 … VH) hinausragen, je
 * Seite [px] (0, wenn sie hineinpassen; pad Luft zum Rand). Die Ansichten vergrößern damit ihre
 * Ränder, wenn mehr Lagen nötig sind: Text 8 px neben der Maßlinie (Dim), halbe Schrifthöhe bzw.
 * Ober-/Unterlänge dazu.
 */
export function dimsOverflow(dims, VW, VH, pad = 4) {
  const over = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const d of dims) {
    if (d.side === "left") over.left = Math.max(over.left, pad - (d.arrowPos - 8 - LABEL_FONT / 2 - 1));
    if (d.side === "right") over.right = Math.max(over.right, d.arrowPos + 8 + LABEL_FONT / 2 + 1 + pad - VW);
    if (d.side === "top") over.top = Math.max(over.top, pad - (d.arrowPos - 8 - LABEL_FONT));
    if (d.side === "bottom") over.bottom = Math.max(over.bottom, d.arrowPos + 11 + 3 + pad - VH);
  }
  return over;
}

/** Äußerste Punkte je Seite aus Bildschirmpunkten [x, y]. */
export function edgesOf(points) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

/** Ende der Raumecken-Wände in der Draufsicht (x bei zApex), wie gezeichnet. */
export const raumeckeEndX = (s, dw, dh) => dw / 2 + (s.zApex + dh);

/**
 * Punkte, die die Draufsicht zeichnet und die über die Maße hinausragen könnten [x, z] (mm):
 * Treiber, Mund, Raumecke, Außenkontur der Schale, Flansch.
 */
export function topViewOutline({ s, dw, dh, showRaumecke, flange, shellOuter }) {
  const pts = [];
  for (const sx of [1, -1]) {
    pts.push([sx * dw / 2, -dh], [sx * dw / 2, 0], [sx * s.xMouth, s.zMouth]);
    if (showRaumecke) pts.push([sx * raumeckeEndX(s, dw, dh), s.zApex]);
    for (const [x, z] of shellOuter ?? []) pts.push([sx * x, z]);
    if (flange) pts.push([sx * flange.diameter / 2, 0], [sx * flange.diameter / 2, flange.thickness]);
  }
  pts.push([0, s.zApex], [0, showRaumecke ? s.hatTipZ : -dh]);
  return pts;
}

/**
 * Maße der Draufsicht (ohne die schrägen Wandmaße), mit Lagen.
 *   links: L; rechts: Kette (Hut-Spitze →) Treiberrückseite → Treiberfront (→ Traktrix-Ende →
 *   Beginn der Geraden, mit Klothoide) und der Eingang auf der Achse; oben: Throat, Treiberbreite;
 *   unten: Mundbreite.
 * @param toX, toY  Abbildung mm → Bildschirm (x, z)
 */
export function topViewDims({ s, rt, dw, dh, L, showRaumecke, flange, shellOuter, toX, toY }) {
  const cx = toX(0), hat = [cx, toY(s.hatTipZ)];
  const dims = [
    // L beginnt mit Raumecke an der Hut-Spitze, ohne an der Ecke der Treiberrückseite auf der Seite des Maßes
    { id: "L", side: "left", p1: showRaumecke ? hat : [toX(-dw / 2), toY(-dh)], p2: [cx, toY(s.zApex)],
      color: COLOR.dimL, label: `L=${fmtLength(L)} mm`, sw: "0.8" },
    { id: "dh", side: "right", p1: [toX(dw / 2), toY(-dh)], p2: [toX(dw / 2), toY(0)], color: COLOR.dim, label: `${dh} mm` },
    { id: "throat", side: "top", p1: [toX(-rt), toY(0)], p2: [toX(rt), toY(0)], color: COLOR.trak, label: `Ø ${(rt * 2).toFixed(1)} mm` },
    { id: "dw", side: "top", p1: [toX(-dw / 2), toY(-dh)], p2: [toX(dw / 2), toY(-dh)], color: COLOR.dim, label: `${dw} mm` },
    { id: "mouth", side: "bottom", p1: [toX(-s.xMouth), toY(s.zMouth)], p2: [toX(s.xMouth), toY(s.zMouth)],
      color: COLOR.dim, label: `${(2 * s.xMouth).toFixed(0)} mm` },
  ];
  if (showRaumecke) dims.push({ id: "hat", side: "right", p1: hat, p2: [toX(dw / 2), toY(-dh)], color: COLOR.raum, label: `${(dw / 2).toFixed(0)} mm` });
  if (hasClothoid(s)) {
    const [xa, za] = s.clothoid.start;
    dims.push(
      { id: "trakWall", side: "right", p1: [toX(rt), toY(0)], p2: [toX(xa), toY(za)], color: COLOR.trak, label: `${za.toFixed(0)} mm` },
      { id: "klo", side: "right", p1: [toX(xa), toY(za)], p2: [toX(s.xTrans), toY(s.zTrans)], color: COLOR.klo, label: `${(s.zTrans - za).toFixed(0)} mm` },
    );
  }
  if (hasTraktrix(s)) {
    dims.push({ id: "entrance", side: "right", p1: [toX(rt), toY(0)], p2: [cx, toY(s.zInnerApex)], color: COLOR.trak, label: `${s.zInnerApex.toFixed(0)} mm` });
  }
  const edges = edgesOf(topViewOutline({ s, dw, dh, showRaumecke, flange, shellOuter }).map(([x, z]) => [toX(x), toY(z)]));
  return { dims: layoutDims(dims, edges), edges };
}

/**
 * Punkte, die der Seitenriss zeichnet und die über die Maße hinausragen könnten [z, h] (mm):
 * Treiber, Mund (mit Wandstärke), Außenkontur der Schale, Flansch, Raumecken-Linie (±raumeckeHalf).
 */
export function sideViewOutline({ s, dw, dh, hMouth, wall = 0, flange, shellCut, showRaumecke, raumeckeHalf }) {
  const pts = [];
  for (const sh of [1, -1]) {
    pts.push([-dh, sh * dw / 2], [0, sh * dw / 2], [s.zApex, sh * (hMouth / 2 + wall)]);
    for (const [h, z] of shellCut?.outer ?? []) pts.push([z, sh * h]);
    if (flange) pts.push([0, sh * flange.diameter / 2], [flange.thickness, sh * flange.diameter / 2]);
    if (showRaumecke) pts.push([s.hatTipZ, sh * raumeckeHalf]);
  }
  return pts;
}

/**
 * Maße des Seitenrisses, mit Lagen.
 *   rechts: Kette Mundhöhe → Wandstärke; links: Throat, Treiberbreite, Flansch-Ø; unten:
 *   Flanschdicke, L; oben: Kette (Hut-Spitze →) Treiberrückseite → Treiberfront → Traktrix → Mund.
 * @param profile       z ↦ halbe Höhe (makeProfile)
 * @param raumeckeHalf  halbe Länge der gezeichneten Raumecken-Linie [mm]
 * @param toX, toY      Abbildung mm → Bildschirm (z, h)
 */
export function sideViewDims({ s, rt, dw, dh, L, hMouth, profile, flange, wall = 0, shellCut, showRaumecke, raumeckeHalf, toX, toY }) {
  const zLStart = showRaumecke ? s.hatTipZ : -dh;   // Beginn von L (ohne Raumecke: Treiberrückseite)
  const zProfileStart = hasTraktrix(s) ? s.zInnerApex : 0;
  const dims = [
    { id: "mouth", side: "right", p1: [toX(s.zApex), toY(hMouth / 2)], p2: [toX(s.zApex), toY(-hMouth / 2)], color: COLOR.arc, label: `${hMouth} mm` },
    { id: "throat", side: "left", p1: [toX(0), toY(rt)], p2: [toX(0), toY(-rt)], color: COLOR.trak, label: `Ø ${(rt * 2).toFixed(1)} mm` },
    { id: "dw", side: "left", p1: [toX(-dh), toY(dw / 2)], p2: [toX(-dh), toY(-dw / 2)], color: COLOR.dim, label: `${dw} mm` },
    { id: "L", side: "bottom", p1: [toX(zLStart), toY(0)], p2: [toX(s.zApex), toY(0)], color: COLOR.dim, label: `L=${fmtLength(L)} mm`, sw: "0.8" },
    { id: "dh", side: "top", p1: [toX(-dh), toY(dw / 2)], p2: [toX(0), toY(dw / 2)], color: COLOR.driv, label: `${dh} mm` },
    { id: "flare", side: "top", p1: [toX(zProfileStart), toY(profile(zProfileStart))], p2: [toX(s.zApex), toY(hMouth / 2)],
      color: COLOR.horn, label: `${(s.zApex - zProfileStart).toFixed(0)} mm` },
  ];
  if (wall > 0) dims.push({ id: "wall", side: "right", p1: [toX(s.zApex), toY(hMouth / 2 + wall)], p2: [toX(s.zApex), toY(hMouth / 2)], color: COLOR.wand, label: `${wall} mm` });
  if (flange) {
    dims.push(
      { id: "flangeD", side: "left", p1: [toX(0), toY(flange.diameter / 2)], p2: [toX(0), toY(-flange.diameter / 2)],
        color: COLOR.flansch, label: `Ø ${flange.diameter.toFixed(0)} mm` },
      { id: "flangeT", side: "bottom", p1: [toX(0), toY(-flange.diameter / 2)], p2: [toX(flange.thickness), toY(-flange.diameter / 2)],
        color: COLOR.flansch, label: `${flange.thickness} mm` },
    );
  }
  if (showRaumecke) dims.push({ id: "hat", side: "top", p1: [toX(s.hatTipZ), toY(dw / 2)], p2: [toX(-dh), toY(dw / 2)], color: COLOR.raum, label: `${(dw / 2).toFixed(0)} mm` });
  if (hasTraktrix(s)) {
    dims.push({ id: "trak", side: "top", p1: [toX(0), toY(rt)], p2: [toX(s.zInnerApex), toY(profile(s.zInnerApex))], color: COLOR.trak, label: `${s.zInnerApex.toFixed(0)} mm` });
  }
  const edges = edgesOf(sideViewOutline({ s, dw, dh, hMouth, wall, flange, shellCut, showRaumecke, raumeckeHalf }).map(([z, h]) => [toX(z), toY(h)]));
  return { dims: layoutDims(dims, edges), edges };
}
