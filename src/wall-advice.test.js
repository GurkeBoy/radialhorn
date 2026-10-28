/**
 * Wandstärke-Empfehlung: die Plattenmechanik gegen unabhängige Referenzen (numerische Integration der
 * Balkenbiegelinie, bekannte Grenzfälle), Skalierungsgesetze, Rückrechnung und Verhalten am echten Horn.
 */
import { describe, it, expect } from "vitest";
import { createHornMath, makeProfile, throatMorph } from "./horn-math.js";
import {
  MATERIALS, MATERIAL_KEYS, CUSTOM, ROUND_TO, ZONE_AREA_RATIO, materialOf, plateStiffness, frameCompliance,
  stationCompliance, stationMinThickness, lowestMode, wallStations, pressureZone, wallAdvice,
} from "./wall-advice.js";

const K = 1.4e5;                       // Steifigkeit der Luft [Pa]
const PLA = MATERIALS.pla;
const RT = 25.4;
const hornOf = (rt = RT, L = 500, Lt = 60) => {
  const s = createHornMath(140).solveHorn(L, Lt, rt, 182, 90);
  return { s, profile: makeProfile(s, rt, 200, "exponential", 0.5, null) };
};

/** Simpson-Integral von f über [0, L] mit n (gerade) Intervallen. */
const simpson = (f, L, n = 2000) => {
  const h = L / n;
  let sum = f(0) + f(L);
  for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * f(i * h);
  return sum * h / 3;
};

describe("Streifen unter Druck (Balkenlösung als Referenz)", () => {
  const D = 285, p = 1000;

  it("Biegelinie mit Randmoment: Fläche = p·L⁵/(120·D) − M·L³/(12·D), eingespannt L⁵/(720·D)", () => {
    for (const L of [0.05, 0.2, 0.8]) {
      const deflection = M => x => p * x * (L ** 3 - 2 * L * x ** 2 + x ** 3) / (24 * D) - M * x * (L - x) / (2 * D);
      const free = simpson(deflection(0), L), withM = simpson(deflection(0.3 * p * L ** 2 / 12), L);
      expect(free).toBeCloseTo(p * L ** 5 / (120 * D), 12);
      expect(withM).toBeCloseTo(p * L ** 5 / (120 * D) - 0.3 * p * L ** 2 / 12 * L ** 3 / (12 * D), 12);
      expect(simpson(deflection(p * L ** 2 / 12), L)).toBeCloseTo(p * L ** 5 / (720 * D), 12);   // voll eingespannt
    }
  });

  it("Biegelinie eingespannt: am Rand Steigung 0 (Randmoment p·L²/12)", () => {
    const L = 0.3, w = x => p * x * (L ** 3 - 2 * L * x ** 2 + x ** 3) / (24 * D) - (p * L ** 2 / 12) * x * (L - x) / (2 * D);
    const slope = x => (w(x + 1e-7) - w(x - 1e-7)) / 2e-7;
    expect(Math.abs(slope(1e-6))).toBeLessThan(1e-6 * p * L ** 3 / D);
    expect(Math.abs(slope(L - 1e-6))).toBeLessThan(1e-6 * p * L ** 3 / D);
  });
});

describe("Kasten mit starren Ecken (frameCompliance)", () => {
  it("quadratisch B = H = L: alle Wände voll eingespannt, g = L⁵/360", () => {
    for (const L of [0.05, 0.3]) expect(frameCompliance(L, L)).toBeCloseTo(L ** 5 / 360, 14);
  });

  it("sehr schmal H ≪ B: die lange Wand sitzt eingespannt, g → B⁵/720", () => {
    const B = 0.4;
    expect(frameCompliance(B, B / 1000) / (B ** 5 / 720)).toBeCloseTo(1, 2);
  });

  it("Ecke dreht sich in beiden Wänden gleich: Momentenverteilung und Ausbiegung stimmen mit g überein", () => {
    const D = 285, p = 1000;
    for (const [B, H] of [[0.16, 0.051], [0.05, 0.2], [0.1, 0.1], [0.4, 0.09]]) {
      const M = p * (B ** 3 + H ** 3) / (12 * (B + H));
      // Drehwinkel am Eck: Wand B im Uhrzeigersinn, Wand H entgegen – starre Ecke: Summe der freien Winkel minus Momentenanteile = 0
      const angle = L => p * L ** 3 / (24 * D) - M * L / (2 * D);
      expect(angle(B) + angle(H)).toBeCloseTo(0, 12);
      // Fläche je Wand aus der numerischen Biegelinie, vier Wände zusammen
      const area = L => simpson(x => p * x * (L ** 3 - 2 * L * x ** 2 + x ** 3) / (24 * D) - M * x * (L - x) / (2 * D), L);
      expect(2 * (area(B) + area(H))).toBeCloseTo(2 * frameCompliance(B, H) * p / D, 12);
    }
  });
});

describe("Mindestwandstärke und Nachgiebigkeit je Stützstelle", () => {
  const st = { z: 50, A: 12000, H: 100, B: 120 };   // mm, mm²

  it("bei t_min ist die Nachgiebigkeit genau das Limit (Rückrechnung)", () => {
    for (const [mat, nuMax] of [[PLA, 0.05], [MATERIALS.alu, 0.02], [MATERIALS.plywood, 0.1]]) {
      const t = stationMinThickness(st, mat, nuMax, K);
      expect(stationCompliance(st, mat, t, K)).toBeCloseTo(nuMax, 12);
    }
  });

  it("Skalierung: t_min ∝ E^(−1/3) und ∝ nuMax^(−1/3), Nachgiebigkeit ∝ 1/t³", () => {
    const t = stationMinThickness(st, PLA, 0.05, K);
    expect(stationMinThickness(st, { ...PLA, E: 8 * PLA.E }, 0.05, K)).toBeCloseTo(t / 2, 12);
    expect(stationMinThickness(st, PLA, 8 * 0.05, K)).toBeCloseTo(t / 2, 12);
    expect(stationCompliance(st, PLA, 2 * t, K) * 8).toBeCloseTo(stationCompliance(st, PLA, t, K), 12);
  });

  it("breitere Wand braucht mehr Dicke, steifere Luft auch", () => {
    const wider = { ...st, B: 2 * st.B, A: 2 * st.A };
    expect(stationMinThickness(wider, PLA, 0.05, K)).toBeGreaterThan(stationMinThickness(st, PLA, 0.05, K));
    expect(stationMinThickness(st, PLA, 0.05, 2 * K)).toBeGreaterThan(stationMinThickness(st, PLA, 0.05, K));
  });
});

describe("tiefste Wandmode", () => {
  it("eingespannter Streifen: f = 22,373/(2π·L²)·√(D/(ρ·t)) – steigt mit t, fällt mit L²", () => {
    const f = lowestMode(100, PLA, 10);
    const D = plateStiffness(PLA.E, PLA.nu, 0.01);
    expect(f).toBeCloseTo(22.373 / (2 * Math.PI * 0.1 ** 2) * Math.sqrt(D / (PLA.rho * 0.01)), 9);
    expect(lowestMode(100, PLA, 20) / f).toBeCloseTo(2, 9);            // f ∝ t
    expect(lowestMode(200, PLA, 10) * 4).toBeCloseTo(f, 9);            // f ∝ 1/L²
  });

  it("Größenordnung: 200 mm breite, 10 mm dicke PLA-Wand schwingt bei einigen hundert Hz", () => {
    const f = lowestMode(200, PLA, 10);
    expect(f).toBeGreaterThan(100);
    expect(f).toBeLessThan(1000);
  });
});

describe("Werkstoffe", () => {
  it("alle Vorgaben sind plausibel", () => {
    for (const [name, m] of Object.entries(MATERIALS)) {
      expect(m.E, name).toBeGreaterThan(1e9);
      expect(m.E, name).toBeLessThan(2e11);
      expect(m.rho, name).toBeGreaterThan(500);
      expect(m.nu, name).toBeGreaterThan(0.2);
      expect(m.nu, name).toBeLessThan(0.5);
    }
    expect(MATERIALS.alu.E).toBeGreaterThan(10 * MATERIALS.pla.E);
  });

  it("materialOf: Vorgabe, eigene Werte (E in GPa → Pa), unbekannt → PLA", () => {
    expect(materialOf("petg")).toBe(MATERIALS.petg);
    expect(materialOf(CUSTOM, 4, 900)).toMatchObject({ E: 4e9, rho: 900 });
    expect(materialOf("gibt-es-nicht")).toBe(MATERIALS.pla);
    expect(MATERIAL_KEYS).toContain(CUSTOM);
    expect(MATERIAL_KEYS).toHaveLength(Object.keys(MATERIALS).length + 1);
  });
});

describe("wallAdvice am Horn", () => {
  const { s, profile } = hornOf();
  const advice = (over = {}) => wallAdvice({ s, profile, material: PLA, K, ...over });

  it("Stützstellen: Beginn am Hals, Breite × Höhe = Fläche; druckreicher Bereich A ≤ 4·A_Hals", () => {
    const stations = wallStations(s, profile);
    expect(stations[0].z).toBe(0);
    for (const st of stations) expect(st.B * st.H).toBeCloseTo(st.A, 6);
    const zone = pressureZone(stations);
    expect(zone.length).toBeGreaterThan(2);
    expect(zone.length).toBeLessThan(stations.length);
    for (const st of zone) expect(st.A).toBeLessThanOrEqual(ZONE_AREA_RATIO * stations[0].A + 1e-9);
    expect(stations[zone.length].A).toBeGreaterThan(ZONE_AREA_RATIO * stations[0].A);
  });

  it("Empfehlung: aufgerundet auf 0,5 mm, nicht unter dem exakten Wert, maßgebend am Ende des Bereichs, plausible Größe", () => {
    const r = advice();
    expect(r.tRecommended).toBeGreaterThanOrEqual(r.tMin);
    expect(r.tRecommended - r.tMin).toBeLessThan(ROUND_TO);
    expect(r.tRecommended / ROUND_TO).toBeCloseTo(Math.round(r.tRecommended / ROUND_TO), 9);
    expect(r.tMin).toBeGreaterThan(5);                         // Richtwert für gedrucktes PLA: einige mm bis gut 10 mm
    expect(r.tMin).toBeLessThan(20);
    expect(r.worst.z).toBeLessThanOrEqual(r.zoneEnd);
    expect(r.worst.z).toBeGreaterThan(0.5 * r.zoneEnd);        // breiteste Wand im Bereich = am Ende
    expect(r.compliance).toBeNull();
    expect(r.status).toBeNull();
  });

  it("Ampel: ab t_min ok, bis 79 % davon knapp, darunter zu dünn", () => {
    const { tMin } = advice();
    expect(advice({ tMM: tMin * 1.01 }).status).toBe("ok");
    expect(advice({ tMM: tMin * 0.85 }).status).toBe("tight");
    expect(advice({ tMM: tMin * 0.7 }).status).toBe("thin");
    expect(advice({ tMM: tMin }).ratio).toBeCloseTo(1, 9);
    expect(advice({ tMM: tMin / 2 }).ratio).toBeCloseTo(8, 9);          // Nachgiebigkeit ∝ 1/t³
  });

  it("Material und Limit wirken: steiferer Werkstoff und größeres Limit → dünner; Alu deutlich dünner als PLA", () => {
    const pla = advice().tMin;
    expect(advice({ material: MATERIALS.alu }).tMin).toBeLessThan(0.5 * pla);
    expect(advice({ nuMax: 10 }).tMin).toBeLessThan(pla);
    expect(advice({ nuMax: 2 }).tMin).toBeGreaterThan(pla);
    expect(advice({ material: materialOf(CUSTOM, 3 * 8, 1250) }).tMin).toBeCloseTo(advice({ material: materialOf(CUSTOM, 3, 1250) }).tMin / 2, 9);
  });

  it("größerer Throat → breitere Wände am Hals → mehr Dicke", () => {
    const small = hornOf(12.7), big = hornOf(38.1);
    const t = h => wallAdvice({ ...h, material: PLA, K }).tMin;
    expect(t(big)).toBeGreaterThan(t(small));
  });

  it("tiefste Wandmode: aus der aktuellen Dicke, ohne Wand aus der Empfehlung", () => {
    const withWall = advice({ tMM: 10 }), withoutWall = advice();
    expect(withWall.fMode).toBeGreaterThan(100);
    expect(advice({ tMM: 20 }).fMode / withWall.fMode).toBeCloseTo(2, 9);
    expect(withoutWall.fMode).toBeCloseTo(advice({ tMM: withoutWall.tRecommended }).fMode, 9);
  });

  it("mit rundem Throat und ohne Traktrix: berechenbar, endliche Werte", () => {
    for (const [h, morph] of [[hornOf(RT, 500, 0), null], [hornOf(), throatMorph(hornOf().s, RT, null)]]) {
      const r = wallAdvice({ ...h, morph, material: PLA, K, tMM: 10 });
      for (const v of [r.tMin, r.tRecommended, r.fMode, r.compliance, r.zoneEnd]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("ohne Lösung: null", () => {
    expect(wallAdvice({ s: null, profile, material: PLA, K })).toBeNull();
    expect(wallAdvice({ s, profile: null, material: PLA, K })).toBeNull();
  });
});
