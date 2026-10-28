import { describe, it, expect } from "vitest";
import {
  airAt, logFrequencies, sampleStep, transverseLimit, cx, abs,
  coneMatrix, propagate, inputImpedance, besselJ1, struveH1, radiationImpedance,
  mmdFromMms, driverSI, driverResponse, PLACEHOLDER_DRIVER, simulate, areaCurve, sampleArea,
  curveLevels, GEOMETRY_STEP_MM, MAX_SEGMENT, hornDelay, phaseWithoutDelay, createSimulationEngine,
} from "./simulation.js";
import { createHornMath, makeProfile, computeFillet, mouthArea, crossSection } from "./horn-math.js";

const AIR = airAt(20);
const RHOC = AIR.rho * AIR.c;
const kOf = f => 2 * Math.PI * f / AIR.c;

// komplexe Hilfen nur für die Erwartungswerte
const div = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const relErr = (a, b) => abs(cx(a.re - b.re, a.im - b.im)) / abs(b);

describe("Luft und Frequenzen", () => {
  it("airAt: c und ρ bei 0 °C und 20 °C", () => {
    expect(airAt(0).c).toBeCloseTo(331.3, 6);
    expect(AIR.c).toBeCloseTo(343.2, 1);
    expect(AIR.rho).toBeCloseTo(1.204, 3);
  });

  it("logFrequencies: 20 Hz – 20 kHz, 1/24 Oktave", () => {
    const f = logFrequencies();
    expect(f[0]).toBeCloseTo(20, 9);
    expect(f.at(-1)).toBeCloseTo(20000, 6);
    expect(f.length).toBe(240);
    expect(f[24] / f[0]).toBeCloseTo(2, 1);
  });

  it("sampleStep = λmin/20, transverseLimit = c/(2·Breite)", () => {
    expect(sampleStep(20000, 343)).toBeCloseTo(343 / 20000 / 20, 12);
    expect(transverseLimit(0.0508, 343)).toBeCloseTo(3376, 0);
  });
});

describe("Konus-Transfermatrix", () => {
  it("det = 1 für aufweitende, verengende und zylindrische Abschnitte", () => {
    for (const [S1, S2] of [[2e-3, 9e-3], [9e-3, 2e-3], [5e-3, 5e-3], [1e-4, 1e-1]]) {
      for (const k of [0.3, 30, 300]) {
        const m = coneMatrix(S1, S2, 0.05, k, RHOC);
        expect(m.A11 * m.A22 + m.B * m.C).toBeCloseTo(1, 10);   // A11·A22 − (jB)(jC)
      }
    }
  });

  it("Zylinder: ebene Welle", () => {
    const S = 3e-3, L = 0.2, k = 17;
    const m = coneMatrix(S, S, L, k, RHOC);
    expect(m.A11).toBeCloseTo(Math.cos(k * L), 14);
    expect(m.A22).toBeCloseTo(Math.cos(k * L), 14);
    expect(m.B).toBeCloseTo(RHOC / S * Math.sin(k * L), 8);
    expect(m.C).toBeCloseTo(S / RHOC * Math.sin(k * L), 14);
  });

  it("Unterteilen eines Konus ändert nichts (jeder Abschnitt ist exakt)", () => {
    const one = { x: [0, 0.5], S: [1e-3, 0.04] };
    const a1 = Math.sqrt(1e-3), a2 = Math.sqrt(0.04);
    const many = sampleArea(x => (a1 + (a2 - a1) * x / 0.5) ** 2, 0.5, 0.001);
    const load = cx(150, 80);
    for (const f of [50, 500, 5000]) {
      expect(relErr(inputImpedance(many, kOf(f), RHOC, load), inputImpedance(one, kOf(f), RHOC, load))).toBeLessThan(1e-10);
    }
  });
});

describe("Sonderfälle mit bekannter Lösung", () => {
  const L = 0.5, S = 2e-3, Z0 = RHOC / S, pipe = { x: [0, L], S: [S, S] };

  it("Zylinder offen (Z = 0): Z_in = j·Z0·tan(kL), Nullstellen bei n·c/2L, Pole bei (2n−1)·c/4L", () => {
    for (const f of [37, 211, 1234]) {
      const z = inputImpedance(pipe, kOf(f), RHOC, cx(0));
      expect(z.re).toBeCloseTo(0, 6);
      expect(z.im / Z0).toBeCloseTo(Math.tan(kOf(f) * L), 8);
    }
    for (const n of [1, 2, 3]) {
      expect(abs(inputImpedance(pipe, kOf(n * AIR.c / (2 * L)), RHOC, cx(0))) / Z0).toBeLessThan(1e-9);
      expect(abs(inputImpedance(pipe, kOf((2 * n - 1) * AIR.c / (4 * L)), RHOC, cx(0))) / Z0).toBeGreaterThan(1e9);
    }
  });

  it("Zylinder schallhart (U = 0): Z_in = −j·Z0·cot(kL), Pole bei n·c/2L, Nullstellen bei (2n−1)·c/4L", () => {
    for (const f of [37, 211, 1234]) {
      const z = inputImpedance(pipe, kOf(f), RHOC, Infinity);
      expect(z.im / Z0).toBeCloseTo(-1 / Math.tan(kOf(f) * L), 8);
    }
    for (const n of [1, 2, 3]) {
      expect(abs(inputImpedance(pipe, kOf((2 * n - 1) * AIR.c / (4 * L)), RHOC, Infinity)) / Z0).toBeLessThan(1e-9);
      expect(abs(inputImpedance(pipe, kOf(n * AIR.c / (2 * L)), RHOC, Infinity)) / Z0).toBeGreaterThan(1e9);
    }
  });

  it("Zylinder mit 2π-Abschluss: erste Nullstelle von Im Z bei c/2(L + 8a/3π)", () => {
    const a = 0.01, Sp = Math.PI * a * a, Lp = 1, p = { x: [0, Lp], S: [Sp, Sp] };
    const im = f => { const k = kOf(f); return inputImpedance(p, k, RHOC, radiationImpedance(Sp, k, RHOC)).im; };
    let lo = 140, hi = 180;   // c/2L ≈ 172 Hz, mit Mündungskorrektur etwas darunter
    expect(im(lo) * im(hi)).toBeLessThan(0);
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; im(lo) * im(m) <= 0 ? (hi = m) : (lo = m); }
    expect(lo).toBeCloseTo(AIR.c / (2 * (Lp + 8 * a / (3 * Math.PI))), 1);
  });

  it("unendlicher Konus: Z = ρc/S · jkr/(1 + jkr), exakt", () => {
    const omega = 0.4, r1 = 0.05, r2 = 0.8;
    const zSph = (r, k) => { const S = omega * r * r; return div(cx(0, k * r * RHOC / S), cx(1, k * r)); };
    for (const curve of [
      { x: [0, r2 - r1], S: [omega * r1 * r1, omega * r2 * r2] },
      sampleArea(x => omega * (r1 + x) ** 2, r2 - r1, 0.01),
    ]) {
      for (const f of [20, 100, 1000, 10000]) {
        const k = kOf(f);
        expect(relErr(inputImpedance(curve, k, RHOC, zSph(r2, k)), zSph(r1, k))).toBeLessThan(1e-9);
      }
    }
  });

  it("unendliches Exponentialhorn: Z = ρc/S·(√(1 − (fc/f)²) + j·fc/f), unterhalb fc rein reaktiv", () => {
    const S0 = 5e-4, m = 4, len = 1.5, fc = m * AIR.c / (4 * Math.PI);
    // Impedanz der vorlaufenden Welle: Z = ρc/S · jk / (m/2 + jβ), β = √(k² − m²/4), unter fc abklingend
    const zFwd = (S, k) => {
      const q = k * k - m * m / 4;
      const d = q >= 0 ? cx(m / 2, Math.sqrt(q)) : cx(m / 2 + Math.sqrt(-q), 0);
      return div(cx(0, k * RHOC / S), d);
    };
    const curve = sampleArea(x => S0 * Math.exp(m * x), len, 0.0005);
    for (const f of [40, 80, 150, 400, 2000, 10000]) {
      const k = kOf(f);
      const z = inputImpedance(curve, k, RHOC, zFwd(S0 * Math.exp(m * len), k));
      expect(relErr(z, zFwd(S0, k))).toBeLessThan(1e-4);
      if (f > fc) {
        expect(z.re * S0 / RHOC).toBeCloseTo(Math.sqrt(1 - (fc / f) ** 2), 3);
        expect(z.im * S0 / RHOC).toBeCloseTo(fc / f, 3);
      } else {
        expect(Math.abs(z.re) / abs(z)).toBeLessThan(1e-4);
      }
    }
  });

  it("Energie: eingespeiste Wirkleistung = abgestrahlte Leistung", () => {
    // Konus mit Knick in ein Exponentialstück, Strahlungslast am Mund
    const curve = sampleArea(x => x < 0.1 ? (0.02 + 0.6 * x) ** 2 : 0.08 ** 2 * Math.exp(6 * (x - 0.1)), 0.4, 0.002);
    const Sm = curve.S.at(-1);
    for (const f of [60, 300, 3000]) {
      const k = kOf(f), zr = radiationImpedance(Sm, k, RHOC);
      const { p, U } = propagate(curve, k, RHOC, zr);
      const pIn = p.re * U.re + p.im * U.im;   // Re(p·U*)
      expect(pIn / zr.re).toBeCloseTo(1, 9);   // U_Mund = 1
    }
  });

  it("Konvergenz: halbe Abtastweite ändert die Halsimpedanz kaum", () => {
    const area = x => 1e-3 * Math.exp(8 * x);
    const step = sampleStep(20000, AIR.c);
    for (const f of [100, 2000, 20000]) {
      const k = kOf(f), zr = radiationImpedance(area(0.4), k, RHOC);
      const z1 = inputImpedance(sampleArea(area, 0.4, step), k, RHOC, zr);
      const z2 = inputImpedance(sampleArea(area, 0.4, step / 2), k, RHOC, zr);
      expect(relErr(z1, z2)).toBeLessThan(1e-4);
    }
  });
});

describe("Strahlungsimpedanz", () => {
  it("J1 gegen Tabellenwerte (Abramowitz/Stegun)", () => {
    expect(besselJ1(1)).toBeCloseTo(0.4400505857, 10);
    expect(besselJ1(2)).toBeCloseTo(0.5767248078, 10);
    expect(besselJ1(5)).toBeCloseTo(-0.3275791376, 10);
    expect(besselJ1(10)).toBeCloseTo(0.0434727462, 10);
  });

  it("J1 asymptotisch (x ≥ 30) gegen die Integraldarstellung, auch an der Bereichsgrenze", () => {
    // J1(x) = (1/π)∫₀^π cos(θ − x sin θ) dθ, Trapezregel (periodischer Integrand)
    const ref = x => {
      const n = Math.ceil(x) + 80, h = Math.PI / n;
      let s = (1 + Math.cos(Math.PI)) / 2;
      for (let i = 1; i < n; i++) s += Math.cos(i * h - x * Math.sin(i * h));
      return s * h / Math.PI;
    };
    for (const x of [29.99, 30, 31.7, 77.3, 300, 1000]) expect(besselJ1(x)).toBeCloseTo(ref(x), 9);
  });

  it("H1 gegen Tabellenwerte und gegen eine unabhängige, feine Integration", () => {
    expect(struveH1(1)).toBeCloseTo(0.1984573362, 9);
    expect(struveH1(2)).toBeCloseTo(0.6467637283, 9);
    // H1(x) = (2x/π)∫₀^{π/2} sin(x cos θ) sin²θ dθ, Simpson mit 200 000 Intervallen
    const ref = x => {
      const n = 200000, h = Math.PI / 2 / n;
      let s = 0;
      for (let i = 0; i <= n; i++) s += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * Math.sin(x * Math.cos(i * h)) * Math.sin(i * h) ** 2;
      return 2 * x / Math.PI * h / 3 * s;
    };
    // Bereichsgrenzen: Reihe | Simpson bei 16, Simpson | Asymptotik bei 30
    for (const x of [0.5, 5, 12, 15.99, 16, 29.99, 30, 40, 150, 400]) expect(struveH1(x)).toBeCloseTo(ref(x), 7);
  });

  it("2π-Kolben: Grenzwerte für kleine und große ka", () => {
    const a = 0.1, S = Math.PI * a * a;
    const lo = radiationImpedance(S, 0.01 / a, RHOC);
    expect(lo.re * S / RHOC / (0.01 ** 2 / 2)).toBeCloseTo(1, 3);
    expect(lo.im * S / RHOC / (8 * 0.01 / (3 * Math.PI))).toBeCloseTo(1, 3);
    const hi = radiationImpedance(S, 300 / a, RHOC);
    expect(hi.re * S / RHOC).toBeCloseTo(1, 2);
    expect(Math.abs(hi.im * S / RHOC)).toBeLessThan(0.01);
  });

  it("andere Raumwinkel: Tiefton-Resistanz ρck²/Ω, 4π-Mündungskorrektur ≈ 0,60·a", () => {
    const a = 0.1, S = Math.PI * a * a, k = 0.01 / a;
    const r2pi = radiationImpedance(S, k, RHOC, "2pi").re;
    expect(r2pi / (RHOC * k * k / (2 * Math.PI))).toBeCloseTo(1, 3);
    expect(radiationImpedance(S, k, RHOC, "4pi").re / r2pi).toBeCloseTo(0.5, 3);
    expect(radiationImpedance(S, k, RHOC, "pi").re / r2pi).toBeCloseTo(2, 3);
    expect(radiationImpedance(S, k, RHOC, "pi/2").re / r2pi).toBeCloseTo(4, 3);
    const delta = radiationImpedance(S, k, RHOC, "4pi").im * S / RHOC / k;   // Mündungskorrektur
    expect(delta / a).toBeCloseTo(0.60, 2);
  });
});

describe("Treiber", () => {
  const base = { Re: 6, Le: 0, Bl: 8, Mmd: 0.002, Cms: 3e-5, Rms: 1.2, Sd: 4.5e-3, Vtc: 0, Atc: 0, Vrc: 0 };

  it("ohne Last: Z_el bei fs = Re + Bl²/Rms", () => {
    const fs = 1 / (2 * Math.PI * Math.sqrt(base.Mmd * base.Cms));
    const { zel } = driverResponse(base, AIR, fs, cx(0), cx(1), 2.83);
    expect(zel.re).toBeCloseTo(base.Re + base.Bl ** 2 / base.Rms, 6);
    expect(zel.im).toBeCloseTo(0, 6);
  });

  it("Direktstrahler im massegesteuerten Bereich: p = ρ·Bl·e·Sd / (2π·r·Re·M)", () => {
    const a = 0.04, Sd = Math.PI * a * a;
    const dr = { Re: 8, Le: 0, Bl: 1, Mmd: 0.01, Cms: 1e-2, Rms: 0.05, Sd, Vtc: 0, Atc: 0, Vrc: 0 };   // fs ≈ 16 Hz
    const f = 500, k = kOf(f);
    const { uMouth } = driverResponse(dr, AIR, f, radiationImpedance(Sd, k, RHOC), cx(1), 2.83);
    const p = AIR.rho * 2 * Math.PI * f * abs(uMouth) / (2 * Math.PI);
    const M = dr.Mmd + 8 * AIR.rho * a ** 3 / 3;   // Mitschwingmasse vorn (Kolben in Schallwand)
    const expected = AIR.rho * dr.Bl * 2.83 * Sd / (2 * Math.PI * dr.Re * M);
    expect(20 * Math.log10(p / expected)).toBeCloseTo(0, 1);   // ±0,05 dB
  });

  it("Kompressionskammer: dünnes Rohr (großes Atc) = reine Nachgiebigkeit", () => {
    const zt = cx(RHOC / 2e-3 * 0.8, RHOC / 2e-3 * 0.3);
    for (const f of [200, 2000, 8000]) {
      const lumped = driverResponse({ ...base, Vtc: 2.5e-6 }, AIR, f, zt, cx(1), 2.83);
      const duct = driverResponse({ ...base, Vtc: 2.5e-6, Atc: 10 }, AIR, f, zt, cx(1), 2.83);
      expect(relErr(duct.zel, lumped.zel)).toBeLessThan(1e-6);
      expect(relErr(duct.uMouth, lumped.uMouth)).toBeLessThan(1e-6);
    }
  });

  it("Kompressionskammer senkt den Hochton, Rückkammer hebt die Resonanz", () => {
    const zt = cx(RHOC / 2e-3, 0);
    const u = (d, f) => abs(driverResponse(d, AIR, f, zt, cx(1), 2.83).uMouth);
    expect(u({ ...base, Vtc: 5e-6 }, 15000)).toBeLessThan(u(base, 15000));
    expect(u({ ...base, Vtc: 5e-6 }, 300) / u(base, 300)).toBeCloseTo(1, 2);
    // Rückkammer versteift: Z_el-Maximum ohne Last wandert nach oben
    const peak = d => {
      let best = 0, fBest = 0;
      for (let f = 100; f < 3000; f += 1) { const z = abs(driverResponse(d, AIR, f, cx(0), cx(1), 2.83).zel); if (z > best) { best = z; fBest = f; } }
      return fBest;
    };
    expect(peak({ ...base, Vrc: 20e-6 })).toBeGreaterThan(peak(base) + 50);
  });

  it("Mms → Mmd: Luftlast beidseitig 8ρa³/3", () => {
    const Sd = 4.5e-3, a = Math.sqrt(Sd / Math.PI);
    expect(mmdFromMms(0.003, Sd, AIR.rho)).toBeCloseTo(0.003 - 16 / 3 * AIR.rho * a ** 3, 12);
  });

  it("driverSI: Einheiten", () => {
    const d = driverSI(PLACEHOLDER_DRIVER, AIR.rho);
    expect(d.Le).toBeCloseTo(6e-5, 12);
    expect(d.Mmd).toBeCloseTo(2.5e-3, 12);
    expect(d.Cms).toBeCloseTo(3e-5, 12);
    expect(d.Sd).toBeCloseTo(4.5e-3, 12);
    expect(d.Vtc).toBeCloseTo(2.5e-6, 12);
    expect(d.Atc).toBeCloseTo(4.5e-3, 12);
    expect(driverSI({ ...PLACEHOLDER_DRIVER, massIs: "Mms" }, AIR.rho).Mmd).toBeLessThan(d.Mmd);
  });
});

describe("Geometrie → S(x)", () => {
  const RT = 25.4;
  const cases = [
    ["mit Traktrix", createHornMath(140), 500, 60, false],
    ["ohne Traktrix", createHornMath(140), 500, 0, false],
    ["lange Traktrix", createHornMath(140), 700, 345, false],
    ["Klothoide", createHornMath(140, { clothoid: 30 }), 500, 60, false],
    ["Verrundung", createHornMath(140), 500, 60, true],
  ];
  for (const [name, math, L, Lt, withFillet] of cases) {
    it(`areaCurve ${name}: ebener Hals, monoton, fein genug, Mund = mouthArea`, () => {
      const s = math.solveHorn(L, Lt, RT, 182, 90);
      const fillet = withFillet ? computeFillet(s, RT, 200, "exponential", 0.5, 100) : null;
      const profile = makeProfile(s, RT, 200, "exponential", 0.5, fillet);
      const step = GEOMETRY_STEP_MM;
      const { x, S } = areaCurve(s, RT, profile);
      expect(x[0]).toBe(0);
      expect(S[0]).toBeCloseTo((2 * RT) ** 2 * 1e-6, 12);
      // x[1] = erste Wellenfront (Übergang vom ebenen Hals als ein Konusabschnitt)
      const first = crossSection(s, profile, 10)[1];
      expect(x[1] * 1000).toBeCloseTo(first.z, 9);
      expect(S[1] * 1e6).toBeCloseTo(first.A, 6);
      for (let i = 1; i < x.length; i++) expect(x[i]).toBeGreaterThan(x[i - 1]);
      for (let i = 2; i < x.length; i++) expect((x[i] - x[i - 1]) * 1000).toBeLessThanOrEqual(step + 1e-9);
      expect(x.at(-1)).toBeCloseTo(s.zApex / 1000, 9);
      expect(S.at(-1)).toBeCloseTo(mouthArea(s, 200) * 1e-6, 9);
    });
  }

  it("Abtastweite der Geometrie: gegenüber 0,25 mm < 0,002 dB und < 0,02 % in Z_el", () => {
    const freqs = logFrequencies(20, 20000, 6), driver = driverSI(PLACEHOLDER_DRIVER, AIR.rho);
    for (const [L, Lt, curve] of [[500, 60, "exponential"], [700, 345, "hypex"], [500, 0, "exponential"]]) {
      const s = createHornMath(140).solveHorn(L, Lt, RT, 182, 90);
      const profile = makeProfile(s, RT, 200, curve, 0.5);
      const run = step => simulate({ curve: areaCurve(s, RT, profile, step), air: AIR, driver, freqs, adaptive: false });
      const ref = run(0.25), r = run(GEOMETRY_STEP_MM);
      for (let i = 0; i < freqs.length; i++) {
        expect(Math.abs(r.spl[i] - ref.spl[i])).toBeLessThan(0.002);
        expect(relErr(r.zel[i], ref.zel[i])).toBeLessThan(2e-4);
      }
    }
  });
});

describe("Abtastung je Frequenz", () => {
  const s = createHornMath(140).solveHorn(700, 345, 25.4, 182, 90);
  const curve = areaCurve(s, 25.4, makeProfile(s, 25.4, 200, "hypex", 0.5));
  const h0 = sampleStep(20000, AIR.c);
  const levels = curveLevels(curve, h0);

  it("curveLevels: h verdoppelt bis MAX_SEGMENT, Hals/erste Wellenfront/Mund bleiben, Abschnitte ≤ h", () => {
    expect(levels[0].h).toBe(h0);
    expect(levels.at(-1).h).toBe(MAX_SEGMENT);
    for (let j = 0; j < levels.length; j++) {
      const { h, curve: c } = levels[j];
      if (j > 0) {
        expect(h).toBe(Math.min(2 * levels[j - 1].h, MAX_SEGMENT));
        expect(c.x.length).toBeLessThanOrEqual(levels[j - 1].curve.x.length);
      }
      expect([c.x[0], c.x[1], c.x.at(-1)]).toEqual([curve.x[0], curve.x[1], curve.x.at(-1)]);
      expect(c.S.at(-1)).toBe(curve.S.at(-1));
      for (let i = 2; i < c.x.length; i++) {
        const gap = c.x[i] - c.x[i - 1];
        // länger als h nur, wo schon die volle Kurve einen so langen Abschnitt hat
        if (gap > h) expect(curve.x.indexOf(c.x[i]) - curve.x.indexOf(c.x[i - 1])).toBe(1);
      }
    }
  });

  it("adaptiv = volle Auflösung (< 0,02 dB, < 0,2 % in Z_el), bei viel weniger Abschnitten", () => {
    const freqs = logFrequencies(20, 20000, 12), driver = driverSI(PLACEHOLDER_DRIVER, AIR.rho);
    for (const mouth of ["2pi", "pi/2"]) {
      const full = simulate({ curve, air: AIR, driver, freqs, mouth, adaptive: false });
      const fast = simulate({ curve, air: AIR, driver, freqs, mouth });
      for (let i = 0; i < freqs.length; i++) {
        expect(Math.abs(fast.spl[i] - full.spl[i])).toBeLessThan(0.02);
        expect(relErr(fast.zel[i], full.zel[i])).toBeLessThan(2e-3);
      }
    }
    // tiefe Frequenzen laufen über die gröbste Stufe (Abschnitte bis 3 mm statt ≤ 1,5 mm)
    expect(levels.at(-1).curve.x.length).toBeLessThan(0.6 * curve.x.length);
    expect(levels.at(-1).curve.x.length).toBeGreaterThan((curve.x.at(-1) - curve.x[1]) / MAX_SEGMENT);
  });
});

describe("simulate", () => {
  const s = createHornMath(140).solveHorn(500, 60, 25.4, 182, 90);
  const profile = makeProfile(s, 25.4, 200, "exponential", 0.5);
  const freqs = logFrequencies(20, 20000, 6);
  const curve = areaCurve(s, 25.4, profile);
  const r = simulate({ curve, air: AIR, driver: driverSI(PLACEHOLDER_DRIVER, AIR.rho), freqs });

  it("liefert endliche Werte für alle Frequenzen", () => {
    for (const key of ["spl", "phase", "zel", "zThroat"]) expect(r[key]).toHaveLength(freqs.length);
    for (let i = 0; i < freqs.length; i++) {
      expect(Number.isFinite(r.spl[i])).toBe(true);
      expect(Number.isFinite(r.zel[i].re) && Number.isFinite(r.zel[i].im)).toBe(true);
      expect(r.zel[i].re).toBeGreaterThan(0);          // passiv
      expect(r.zThroat[i].re).toBeGreaterThanOrEqual(0);
    }
  });

  it("Halsimpedanz: im Durchlassbereich Resistanz nahe ρc/S, tief unten fast rein reaktiv", () => {
    const at = f => r.zThroat[freqs.findIndex(v => v >= f)];
    expect(at(5000).re).toBeGreaterThan(0.6);
    expect(at(5000).re).toBeLessThan(1.6);
    expect(at(20).re).toBeLessThan(0.05);
  });

  it("2,83 V → doppelte Spannung = +6,02 dB", () => {
    const r2 = simulate({ curve, air: AIR, driver: driverSI(PLACEHOLDER_DRIVER, AIR.rho), freqs, voltage: 5.66 });
    for (let i = 0; i < freqs.length; i++) expect(r2.spl[i] - r.spl[i]).toBeCloseTo(6.0206, 3);
  });

});

describe("Laufzeit (hornDelay, phaseWithoutDelay)", () => {
  const s = createHornMath(140).solveHorn(500, 60, 25.4, 182, 90);
  const profile = makeProfile(s, 25.4, 200, "exponential", 0.5);
  const freqs = logFrequencies(20, 20000, 24);
  const curve = areaCurve(s, 25.4, profile);
  const driver = driverSI(PLACEHOLDER_DRIVER, AIR.rho);
  const r = simulate({ curve, air: AIR, driver, freqs });
  const tau = hornDelay(curve, AIR, driver);
  // Gruppenlaufzeit −dφ/dω aus der entfalteten Phase (Mittelwert über ein Band)
  const groupDelay = (phase, f1, f2) => {
    const i1 = freqs.findIndex(v => v >= f1), i2 = freqs.findIndex(v => v >= f2);
    let un = 0;
    for (let i = i1 + 1; i <= i2; i++) { const d = phase[i] - phase[i - 1]; un += d - 360 * Math.round(d / 360); }
    return -un / 360 / (freqs[i2] - freqs[i1]);
  };

  it("Weg = Kammer (Vtc/Atc) + Länge der Flächenkurve, ohne Atc nur das Horn", () => {
    const horn = curve.x.at(-1) - curve.x[0];
    expect(tau * AIR.c).toBeCloseTo(horn + driver.Vtc / driver.Atc, 12);
    expect(hornDelay(curve, AIR, { ...driver, Atc: 0 }) * AIR.c).toBeCloseTo(horn, 12);
    expect(hornDelay(curve, AIR, { ...driver, Vtc: 0 }) * AIR.c).toBeCloseTo(horn, 12);
  });

  it("im Hochton entspricht die Gruppenlaufzeit der Simulation der Laufzeit (±5 %)", () => {
    expect(groupDelay(r.phase, 5000, 15000) / tau).toBeGreaterThan(0.95);
    expect(groupDelay(r.phase, 5000, 15000) / tau).toBeLessThan(1.05);
  });

  it("ohne Laufzeit: Gruppenlaufzeit im Hochton klein, Phase in −180° … 180°", () => {
    const ph = phaseWithoutDelay(freqs, r.phase, tau);
    expect(Math.abs(groupDelay(ph, 5000, 15000))).toBeLessThan(0.05 * tau);
    expect(ph.every(v => v >= -180 && v < 180)).toBe(true);
  });

  it("phaseWithoutDelay dreht um 360°·f·τ und faltet", () => {
    expect(phaseWithoutDelay([1000], [-170], 0.5e-3)).toEqual([10]);     // −170 + 180
    expect(phaseWithoutDelay([1000], [90], 0.5e-3)).toEqual([-90]);      // 270 → −90
    expect(phaseWithoutDelay([1000], [30], 0)).toEqual([30]);
  });
});

describe("createSimulationEngine (Rechenkern im Worker)", () => {
  const RT = 25.4;
  const s = createHornMath(140).solveHorn(500, 80, RT, 182, 90);
  const geometry = { s, rt: RT, hMouth: 200, curve: "exponential", hypexT: 0.5, fillet: null, morph: null };
  const freqs = logFrequencies(20, 20000, 6);
  const input = { geoKey: "a", geometry, temp: 20, mouth: "2pi", driver: PLACEHOLDER_DRIVER, freqs };

  it("gleich der Rechnung von Hand; Eingaben klonbar (postMessage)", () => {
    const out = createSimulationEngine()(structuredClone(input));
    const curve = areaCurve(s, RT, makeProfile(s, RT, 200, "exponential", 0.5, null));
    const driver = driverSI(PLACEHOLDER_DRIVER, AIR.rho);
    expect(out.result).toEqual(simulate({ curve, air: AIR, driver, mouth: "2pi", freqs }));
    expect(out.delay).toBe(hornDelay(curve, AIR, driver));
    expect(out.delayPath).toBeCloseTo(out.delay * AIR.c, 12);
    expect(out.fLimit).toBe(transverseLimit(2 * RT / 1000, AIR.c));
  });

  it("S(x) bleibt bei gleichem geoKey, neu bei neuem", () => {
    const run = createSimulationEngine();
    const first = run(input);
    // andere Geometrie unter demselben Schlüssel: alte Kurve bleibt (nur die Kette wird neu gerechnet)
    const other = { ...geometry, hMouth: 300 };
    expect(run({ ...input, geometry: other }).result).toEqual(first.result);
    expect(run({ ...input, geometry: other, geoKey: "b" }).result).not.toEqual(first.result);
    // Treiber und Temperatur wirken auch ohne neuen Schlüssel
    expect(run({ ...input, geometry: other, geoKey: "b", temp: 30 }).result.spl).not.toEqual(run({ ...input, geometry: other, geoKey: "b" }).result.spl);
  });
});
