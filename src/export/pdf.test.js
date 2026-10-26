import { describe, it, expect } from "vitest";
import { solveHorn, makeProfile, computeFillet } from "../horn-math.js";
import { buildDatasheet } from "./pdf.js";

const RT = 25.4, H_MOUTH = 200;
const s = solveHorn(500, 60, RT, 120, 100);
const design = (extra = {}) => ({
  s, rt: RT, L: 500, hMouth: H_MOUTH, curve: "exponential", hypexT: 0.5, fillet: null,
  profile: makeProfile(s, RT, H_MOUTH, "exponential", 0.5),
  showRaumecke: true, showWandstaerke: false, wandstaerke: 20, ...extra,
});
const ALL = { draufsicht: true, mundbogen: true, fokus: true, seitenprofil: true, bemassung: true };
const DATE = new Date(2026, 9, 1);
const row = (html, key) => html.match(new RegExp(`<td>${key}</td><td>([^<]*)</td>`))?.[1];

describe("buildDatasheet", () => {
  it("DM Mono eingebettet (Normal + Medium als data:-URL), kein Fett über 500", () => {
    const h = buildDatasheet(design(), ALL, DATE);
    const faces = [...h.matchAll(/@font-face \{[^}]*font-weight: (\d+)[^}]*src: url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/g)];
    expect(faces.map(f => f[1])).toEqual(["400", "500"]);
    for (const f of faces) expect(f[2].length).toBeGreaterThan(15000);   // ≈ 15 KB Schrift → ≈ 20 KB Base64
    expect(h).not.toMatch(/font-weight: ?[6-9]00/);
    expect(h).not.toContain('font-family="monospace"');
  });

  it("Englisch: Kennwerte, Beschriftungen und Datum übersetzt, Zahlen gleich", () => {
    const en = buildDatasheet(design(), ALL, DATE, "en");
    expect(en).toContain('<html lang="en">');
    expect(row(en, "Opening angle horiz.")).toBe("140 °");
    expect(row(en, "Total length L")).toBe("500 mm from the tip of the room corner");
    expect(row(en, "Flare")).toBe("Exponential");
    expect(row(en, "Room corner")).toBe("yes");
    expect(en).toContain("<b>Date</b> 01/10/2026");
    expect(en).toContain("TECHNICAL DATASHEET");
    expect(en).not.toMatch(/Kennwerte|Datum|Raumecke|Öffnungswinkel/);
  });

  const html = buildDatasheet(design(), ALL, DATE);

  it("Kennwerte", () => {
    expect(row(html, "Öffnungswinkel horiz.")).toBe("140 °");
    expect(row(html, "Gesamtlänge L")).toBe("500 mm ab der Spitze der Raumecke");
    expect(row(html, "Throat Ø")).toBe("50.8 mm");
    expect(row(html, "Mundbreite")).toBe((2 * s.xMouth).toFixed(0) + " mm");
    expect(row(html, "Teilkreis-Radius")).toBe(s.arcR.toFixed(1) + " mm");
    expect(row(html, "Verrundung Übergang")).toBe("–");
    expect(html).toContain("<b>Datum</b> 1.10.2026");
  });

  it("wählt den kleinsten Normmaßstab, bei dem die Zeichnung aufs Blatt passt", () => {
    expect(html).toContain("1 : 5");   // größte Ausdehnung ≈ 575 mm → 1:5 (115 mm ≤ 170 mm)
  });

  it("beide Zeichnungen mit Bemaßung", () => {
    expect(html.match(/<svg /g)).toHaveLength(2);
    expect(html).toContain(">340<");   // gezeichnete Länge Throat → Scheitel
    expect(html).toContain(">110<");   // Traktrix axial
  });

  it("Verrundung erscheint in den Kennwerten", () => {
    const fillet = computeFillet(s, RT, H_MOUTH, "exponential", 0.5, 100);
    const withFillet = buildDatasheet(design({ fillet, profile: makeProfile(s, RT, H_MOUTH, "exponential", 0.5, fillet) }), ALL, DATE);
    expect(row(withFillet, "Verrundung Übergang")).toBe("R 100.0 mm");
  });

  it("abgewählte Kurven und Bemaßungen fehlen", () => {
    const bare = buildDatasheet(design(), { seitenprofil: true }, DATE);
    expect(bare).not.toContain("DRAUFSICHT");
    expect(bare).toContain("SEITENRISS");
    expect(bare).not.toContain(">340<");
  });

  it("Wandstärke: Schnitt durch die Schale in beiden Zeichnungen, Maß t", () => {
    const cuts = h => (h.match(/fill="#ececf2"/g) || []).length;
    expect(cuts(html)).toBe(0);                               // ohne Wandstärke keine Schnittflächen
    const withWall = buildDatasheet(design({ wall: 37, showWandstaerke: true, wandstaerke: 37 }), ALL, DATE);
    expect(cuts(withWall)).toBe(4);                           // 2 Zeichnungen × 2 Seiten
    expect(row(withWall, "Mundbreite")).toBe((2 * s.xMouth).toFixed(0) + " mm");   // Innenmaß
    expect(withWall.match(/>37</g)).toHaveLength(2);          // Maß t in Draufsicht und Seitenriss
    expect(cuts(buildDatasheet(design({ wall: 37 }), { ...ALL, bemassung: false }, DATE))).toBe(4);
  });

  it("Stützrippen als Kennwert: Zahl (= Bohrungen), Dicke, Länge", () => {
    const flange = { diameter: 182, thickness: 10, holes: { count: 4 }, ribs: { thickness: 4, length: 30 } };
    expect(row(buildDatasheet(design({ wall: 20, flange }), ALL, DATE), "Stützrippen")).toBe("4 × 4 mm, Länge 30 mm");
    expect(row(buildDatasheet(design({ wall: 20, flange }), ALL, DATE, "en"), "Support ribs")).toBe("4 × 4 mm, length 30 mm");
    expect(row(buildDatasheet(design({ wall: 20, flange: { ...flange, ribs: null } }), ALL, DATE), "Stützrippen")).toBeUndefined();
  });

  it("mit Flansch zusätzlich dessen Schnitt", () => {
    const flange = { diameter: 182, thickness: 10 };
    const h = buildDatasheet(design({ wall: 20, flange }), ALL, DATE);
    expect((h.match(/fill="#ececf2"/g) || []).length).toBe(8);
    expect((buildDatasheet(design({ wall: 0, flange }), ALL, DATE).match(/fill="#ececf2"/g) || []).length).toBe(0);
  });
});
