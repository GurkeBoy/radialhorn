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
  const html = buildDatasheet(design(), ALL, DATE);

  it("Kennwerte", () => {
    expect(row(html, "Öffnungswinkel horiz.")).toBe("140 °");
    expect(row(html, "Gesamtlänge L")).toBe("500 mm");
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
});
