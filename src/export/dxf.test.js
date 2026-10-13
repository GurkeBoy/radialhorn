import { describe, it, expect } from "vitest";
import { solveHorn, computeFillet } from "../horn-math.js";
import { buildDXF } from "./dxf.js";

const RT = 25.4, H_MOUTH = 200;
const s = solveHorn(500, 60, RT, 120, 100);
const ALL = { draufsicht: true, mundbogen: true, fokus: true, seitenprofil: true, uebergang: true };
const design = (extra = {}) => ({ s, rt: RT, hMouth: H_MOUTH, curve: "exponential", hypexT: 0.5, fillet: null, ...extra });

/** DXF in Entities zerlegen: [{ type, codes: [[code, value], …] }]. */
function parse(dxf) {
  const lines = dxf.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  expect(lines.length % 2).toBe(0);   // immer Paare aus Gruppencode und Wert
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) pairs.push([lines[i], lines[i + 1]]);
  const entities = [];
  for (const [code, value] of pairs) {
    if (code === "0") entities.push({ type: value, codes: [] });
    else entities[entities.length - 1].codes.push([code, value]);
  }
  return entities;
}
const get = (e, code) => e.codes.filter(([c]) => c === code).map(([, v]) => parseFloat(v));
const layerOf = e => e.codes.find(([c]) => c === "8")?.[1];
const count = (entities, type, layer) => entities.filter(e => e.type === type && layerOf(e) === layer).length;

describe("buildDXF", () => {
  it("Rahmen: ENTITIES-Sektion, EOF am Ende", () => {
    const e = parse(buildDXF(design(), ALL));
    expect(e[0].type).toBe("SECTION");
    expect(e[0].codes).toEqual([["2", "ENTITIES"]]);
    expect(e.at(-2).type).toBe("ENDSEC");
    expect(e.at(-1).type).toBe("EOF");
  });

  it("exakte Entities je Layer, keine Polylinien", () => {
    const e = parse(buildDXF(design(), ALL));
    expect(count(e, "SPLINE", "Draufsicht_Traktrix")).toBe(2);   // Traktrix links/rechts
    expect(count(e, "LINE", "Draufsicht_Gerade")).toBe(2);       // gerade Wand
    expect(count(e, "SPLINE", "Draufsicht_Klothoide")).toBe(0);  // ohne Klothoide
    expect(count(e, "ARC", "Mundbogen")).toBe(1);
    expect(count(e, "POINT", "Fokus")).toBe(1);
    expect(count(e, "LINE", "Seitenprofil_Throat")).toBe(2);
    expect(count(e, "SPLINE", "Seitenprofil_Flare")).toBe(2);
    expect(count(e, "POINT", "Uebergang")).toBe(12);
    expect(e.some(x => /POLYLINE/.test(x.type))).toBe(false);
  });

  it("lineare Aufweitung als LINE statt SPLINE", () => {
    const e = parse(buildDXF(design({ curve: "linear" }), ALL));
    expect(count(e, "LINE", "Seitenprofil_Flare")).toBe(2);
    expect(count(e, "SPLINE", "Seitenprofil_Flare")).toBe(0);
  });

  it("Mundbogen: Mittelpunkt im Fokus, Winkel ±halber Öffnungswinkel", () => {
    const arc = parse(buildDXF(design(), { mundbogen: true }))[1];
    expect(get(arc, "10")[0]).toBeCloseTo(s.zFocus, 3);
    expect(get(arc, "40")[0]).toBeCloseTo(s.arcR, 3);
    expect(get(arc, "50")[0]).toBeCloseTo(-70, 3);
    expect(get(arc, "51")[0]).toBeCloseTo(70, 3);
  });

  it("Verrundung: ARCs schließen lückenlos an Throat-Linie und Flare-Spline an", () => {
    const fillet = computeFillet(s, RT, H_MOUTH, "exponential", 0.5, 100);
    const e = parse(buildDXF(design({ fillet }), { seitenprofil: true }));
    const arc = e.find(x => x.type === "ARC" && get(x, "20")[0] > 0);
    // OCS mit Extrusion (0,−1,0): OCS-x = Welt-X, OCS-y = Welt-Z
    expect([get(arc, "210")[0], get(arc, "220")[0], get(arc, "230")[0]]).toEqual([0, -1, 0]);
    const [cx, cy, r] = [get(arc, "10")[0], get(arc, "20")[0], get(arc, "40")[0]];
    const at = deg => [cx + r * Math.cos(deg * Math.PI / 180), cy + r * Math.sin(deg * Math.PI / 180)];
    const start = at(get(arc, "50")[0]), end = at(get(arc, "51")[0]);

    const throat = e.find(x => x.type === "LINE" && layerOf(x) === "Seitenprofil_Throat" && get(x, "31")[0] > 0);
    expect(Math.hypot(start[0] - get(throat, "11")[0], start[1] - get(throat, "31")[0])).toBeLessThan(1e-3);

    const flare = e.find(x => x.type === "SPLINE" && get(x, "31")[0] > 0);
    expect(Math.hypot(end[0] - get(flare, "11")[0], end[1] - get(flare, "31")[0])).toBeLessThan(1e-3);
  });

  it("ohne Traktrix: keine Throat-Linie, keine Traktrix-Splines", () => {
    const s0 = solveHorn(500, 0, RT, 120, 100);
    const e = parse(buildDXF(design({ s: s0 }), ALL));
    expect(count(e, "SPLINE", "Draufsicht_Traktrix")).toBe(0);
    expect(count(e, "LINE", "Seitenprofil_Throat")).toBe(0);
  });

  it("Flansch: Kreise in der Ebene quer zur Achse, quadratische Öffnung, Bohrungen", () => {
    const flange = { diameter: 180, thickness: 10, holes: { count: 4, circle: 150, diameter: 6.5, angle: 45 },
      centers: [[53, 53], [-53, 53], [-53, -53], [53, -53]], conflicts: [[0, 40]] };
    const e = parse(buildDXF(design({ flange }), { flansch: true }));
    const circles = e.filter(x => x.type === "CIRCLE" && layerOf(x) === "Flansch");
    expect(circles).toHaveLength(2 + 4);
    for (const c of circles) expect([get(c, "210")[0], get(c, "220")[0], get(c, "230")[0]]).toEqual([1, 0, 0]);
    expect(circles.slice(0, 2).map(c => [get(c, "40")[0], get(c, "30")[0]])).toEqual([[90, 0], [90, 10]]);
    expect(get(circles[2], "10")[0]).toBeCloseTo(53, 6);
    expect(get(circles[2], "40")[0]).toBeCloseTo(3.25, 6);
    const lines = e.filter(x => x.type === "LINE" && layerOf(x) === "Flansch");
    expect(lines).toHaveLength(4);
    expect(count(e, "CIRCLE", "Flansch_Konflikt")).toBe(1);
    for (const l of lines) for (const v of [...get(l, "20"), ...get(l, "30")]) expect(Math.abs(v)).toBeCloseTo(RT, 6);
    expect(count(parse(buildDXF(design(), { flansch: true })), "CIRCLE", "Flansch")).toBe(0);   // ohne Flansch
  });

  it("Flansch mit rundem Throat: Öffnung als Kreis Ø 2·rt statt Quadrat", () => {
    const flange = { diameter: 180, thickness: 10, holes: { count: 0, circle: 150, diameter: 6.5, angle: 0 }, centers: [], conflicts: [] };
    const e = parse(buildDXF(design({ flange, morph: { r: RT, length: 50 } }), { flansch: true }));
    expect(count(e, "LINE", "Flansch")).toBe(0);
    const circles = e.filter(x => x.type === "CIRCLE" && layerOf(x) === "Flansch");
    expect(circles.map(c => get(c, "40")[0])).toEqual([90, 90, RT]);
  });

  it("ohne ausgewählte Layer nur der leere Rahmen", () => {
    expect(parse(buildDXF(design(), {})).map(e => e.type)).toEqual(["SECTION", "ENDSEC", "EOF"]);
  });
});
