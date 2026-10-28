/**
 * Bemaßung der 2D-Ansichten: Lagen nach den Regeln (layoutDims) und die Regeln selbst, geprüft an
 * beiden Ansichten über viele Geometrien – ein neues Maß, das sie verletzt, fällt hier auf.
 */
import { describe, it, expect } from "vitest";
import { layoutDims, topViewDims, sideViewDims, labelWidth, DIM_FIRST, DIM_STEP } from "./dim-layout.js";
import { createGeometryEngine } from "./geometry.js";
import { DESIGN_DEFAULTS } from "./project.js";
import { makeProfile } from "./horn-math.js";

const EDGES = { left: 0, right: 100, top: 0, bottom: 100 };
const bottom = (id, from, to, label = "") => ({ id, side: "bottom", p1: [from, 50], p2: [to, 50], label });
const layerOf = (out, id) => out.find(d => d.id === id).layer;

describe("layoutDims", () => {
  it("Beschriftung: mittig, solange frei; ein zu kurzes Kettenglied rückt eine Lage nach außen", () => {
    const right = { ...EDGES, right: 300 };
    // allein: auch ein zu kurzes Maß behält seinen Text mittig
    const alone = layoutDims([bottom("b", 200, 212, "12 mm")], right)[0];
    expect([alone.text.at, alone.text.outside, alone.layer]).toEqual([206, false, 0]);
    // Kette 0–50 | 50–54: mittig stieße „4 mm“ an „50 mm“ – das kurze Glied rückt nach außen, Text mittig
    const out = layoutDims([bottom("a", 0, 50, "50 mm"), bottom("b", 50, 54, "4 mm")], right);
    const [a, b] = ["a", "b"].map(id => out.find(d => d.id === id));
    expect([a.layer, a.text.at, b.layer, b.text.at]).toEqual([0, 25, 1, 52]);
    expect(b.text.hi - b.text.lo).toBeCloseTo(labelWidth("4 mm"), 9);
    // Draufsicht mit Klothoide, kleine Ansicht wie im Screenshot: Traktrix 120 mm (36 px) | Klothoide
    // 12 mm (4 px), beide im Eingang – die Klothoide rückt eine Lage nach außen, der Eingang noch eine
    const klo = layoutDims([bottom("trak", 0, 36, "120 mm"), bottom("klo", 36, 40, "12 mm"), bottom("entrance", 0, 65, "216 mm")], right);
    expect(["trak", "klo", "entrance"].map(id => layerOf(klo, id))).toEqual([0, 1, 2]);
    // genug Platz (Traktrix 120 px): die Kette bleibt auf einer Lage
    const roomy = layoutDims([bottom("trak", 0, 120, "120 mm"), bottom("klo", 120, 124, "12 mm"), bottom("entrance", 0, 180, "216 mm")], right);
    expect(["trak", "klo", "entrance"].map(id => layerOf(roomy, id))).toEqual([0, 0, 1]);
    // Hilfslinie eines äußeren Maßes durch den Text: er bleibt trotzdem mittig an seiner Linie
    const ext = layoutDims([bottom("in", 40, 44, "Ø 25.4 mm"), bottom("out", 30, 60, "30 mm")], right);
    expect(ext.find(d => d.id === "in").text).toMatchObject({ at: 42, outside: false });
  });

  it("umschlossenes Maß innen, umschließendes außen – unabhängig von der Reihenfolge", () => {
    for (const dims of [[bottom("L", 0, 100), bottom("t", 10, 20)], [bottom("t", 10, 20), bottom("L", 0, 100)]]) {
      const out = layoutDims(dims, EDGES);
      expect([layerOf(out, "t"), layerOf(out, "L")]).toEqual([0, 1]);
      expect(out.find(d => d.id === "t").arrowPos).toBe(100 + DIM_FIRST);
      expect(out.find(d => d.id === "L").arrowPos).toBe(100 + DIM_FIRST + DIM_STEP);
    }
  });

  it("Kette: sich berührende Maße teilen eine Lage; teilweise Überlappung trennt", () => {
    const chain = layoutDims([bottom("a", 0, 30), bottom("b", 30, 60), bottom("c", 60, 100)], EDGES);
    expect(chain.map(d => d.layer)).toEqual([0, 0, 0]);
    const partial = layoutDims([bottom("a", 0, 40), bottom("b", 30, 80)], EDGES);
    expect(new Set(partial.map(d => d.layer)).size).toBe(2);
  });

  it("Seiten getrennt, Richtung nach außen, Ausrichtung passend", () => {
    const out = layoutDims([
      { id: "l", side: "left", p1: [10, 0], p2: [10, 50] },
      { id: "t", side: "top", p1: [0, 10], p2: [50, 10] },
    ], EDGES);
    expect(out.map(d => [d.arrowPos, d.orient, d.layer])).toEqual([[-DIM_FIRST, "v", 0], [-DIM_FIRST, "h", 0]]);
  });
});

// ── Regeln an echten Geometrien ─────────────────────────────────────

const OPTIONS = [
  {}, { showRaumecke: false }, { showWandstaerke: true }, { showWandstaerke: true, flangeOn: true },
  { showWandstaerke: true, flangeOn: true, showRaumecke: false }, { showWandstaerke: true, flangeOn: true, flangeD: 260 },
  { showWandstaerke: true, flangeOn: true, edgeOn: true, morphOn: true, filletOn: true, clothoidOn: true },
  { clothoidOn: true, showRaumecke: false }, { Lt: 0 }, { Lt: 0, showRaumecke: false, showWandstaerke: true },
  { Lt: 150, filletOn: true, curve: "hypex" }, { openingAngle: 100, showWandstaerke: true, wandstaerke: 45 },
  { openingAngle: 160, throatDiam: 25.4, dw: 120, dh: 140 }, { L: 900, showWandstaerke: true, flangeOn: true },
];
// Abbildungen wie in den Ansichten: Draufsicht (x, z) → (x, y), Seitenriss (z, h) → (x, y); zwei Maßstäbe
const SCALES = [0.3, 0.4, 0.8, 1.5];

function views(over, scale) {
  const p = { ...DESIGN_DEFAULTS, ...over };
  const { values: v } = createGeometryEngine()(p);
  const rt = p.throatDiam / 2;
  const profile = makeProfile(v.s, rt, p.hMouth, p.curve, p.hypexT, v.fillet);
  const base = { s: v.s, rt, dw: p.dw, dh: p.dh, L: v.LClamped, showRaumecke: p.showRaumecke, flange: v.flange };
  const top = { ...base, shellOuter: v.shellOuter, toX: x => 600 + x * scale, toY: z => 300 + z * scale };
  const raumeckeHalf = Math.max(p.dw / 2, p.hMouth / 2 + v.wall, v.flange ? v.flange.diameter / 2 : 0) * 1.05;
  const side = { ...base, hMouth: p.hMouth, profile, wall: v.wall, shellCut: v.shellCut, raumeckeHalf, toX: z => 300 + z * scale, toY: h => 400 - h * scale };
  return {
    top: topViewDims(top),
    side: sideViewDims(side),
  };
}

/**
 * Verstöße gegen die Bemaßungsregeln, als lesbare Meldungen. Texte: keiner überdeckt einen anderen,
 * und jeder steht mittig an seiner eigenen Linie (zu kurze Kettenglieder rücken dafür nach außen).
 */
function violations({ dims, edges }) {
  const bad = [];
  const eps = 0.5;
  for (const d of dims) {
    const out = { left: edges.left - d.arrowPos, right: d.arrowPos - edges.right, top: edges.top - d.arrowPos, bottom: d.arrowPos - edges.bottom }[d.side];
    if (out < DIM_FIRST - eps) bad.push(`${d.id}: Maßlinie nur ${out.toFixed(1)} px außerhalb der Zeichnung`);
  }
  for (const a of dims) for (const b of dims) {
    if (a === b || a.side !== b.side) continue;
    const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
    if (a.layer === b.layer && overlap > eps && a.order < b.order) bad.push(`${a.id}/${b.id}: überlappen auf derselben Lage`);
    // Hilfslinien des äußeren Maßes b laufen durch die Lage von a: kein Ende von b innerhalb von a
    if (b.layer > a.layer) for (const end of [b.lo, b.hi]) if (end > a.lo + eps && end < a.hi - eps) bad.push(`${b.id}: Hilfslinie kreuzt die Maßlinie von ${a.id}`);
    if (b.layer > a.layer && a.hi - a.lo > b.hi - b.lo + eps && overlap > eps) bad.push(`${b.id} (kleiner) liegt außerhalb von ${a.id}`);
  }
  // Beschriftungen: auf einer Lage ohne Überlappung, ohne Hilfslinie eines äußeren Maßes darunter
  for (const a of dims) for (const b of dims) {
    if (a === b || a.side !== b.side) continue;
    if (a.layer === b.layer && a.order < b.order && Math.min(a.text.hi, b.text.hi) - Math.max(a.text.lo, b.text.lo) > eps) bad.push(`Texte ${a.id}/${b.id} überlappen`);
  }
  for (const d of dims) if (d.text.outside) bad.push(`Text von ${d.id} steht nicht an seiner Linie`);
  return bad;
}

describe("Bemaßungsregeln in Draufsicht und Seitenriss", () => {
  it("über viele Geometrien: außerhalb der Zeichnung, keine Kreuzung, kleineres innen", () => {
    const all = [];
    for (const over of OPTIONS) for (const scale of SCALES) {
      const v = views(over, scale);
      for (const [name, view] of Object.entries(v)) for (const msg of violations(view)) all.push(`${name} ${JSON.stringify(over)} ×${scale}: ${msg}`);
    }
    expect(all).toEqual([]);
  });

  it("ohne Raumecke: Maße am Treiber, nicht an der unsichtbaren Hut-Spitze", () => {
    const { top, side } = views({ showRaumecke: false }, 1);
    const p = DESIGN_DEFAULTS;
    expect(top.edges.top).toBe(300 - p.dh);                     // Treiberrückseite
    expect(side.edges.left).toBe(300 - p.dh);
    expect(top.dims.find(d => d.id === "hat")).toBeUndefined();
    expect(side.dims.find(d => d.id === "L").lo).toBe(300 - p.dh);
  });

  it("die Prüfung erkennt den alten Fehler: Flanschdicke außen, L innen", () => {
    const { side } = views({ showWandstaerke: true, flangeOn: true }, 1);
    const swapped = side.dims.map(d => d.id === "L" ? { ...d, layer: 0 } : d.id === "flangeT" ? { ...d, layer: 1 } : d);
    expect(violations({ ...side, dims: swapped }).join(" ")).toMatch(/flangeT: Hilfslinie kreuzt die Maßlinie von L/);
  });

  it("Flanschdicke innen, L außen; ohne Flansch L in der 1. Lage", () => {
    const withFlange = views({ showWandstaerke: true, flangeOn: true }, 1).side.dims;
    expect(layerOf(withFlange, "flangeT")).toBe(0);
    expect(layerOf(withFlange, "L")).toBe(1);
    expect(layerOf(views({}, 1).side.dims, "L")).toBe(0);
  });
});
