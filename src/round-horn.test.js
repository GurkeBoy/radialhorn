/**
 * Rundes Horn im Zusammenspiel: Geometrie-Kern (hornShape), Wandstärke-Empfehlung, Simulation, Volumen, 3D-Puffer,
 * DXF, PDF-Datenblatt und Projektdatei. Die Körper selbst prüft round-mesh.test.js, die Mathematik horn-math.round.test.js.
 */
import { describe, it, expect } from "vitest";
import { makeProfile, mouthArea, capArea } from "./horn-math.js";
import { createGeometryEngine } from "./geometry.js";
import { DESIGN_DEFAULTS, buildProject, parseProject } from "./project.js";
import { wallAdvice, materialOf, wallStationsRound, stationComplianceRound, stationMinThicknessRound, ringMode } from "./wall-advice.js";
import { createSimulationEngine, logFrequencies, PLACEHOLDER_DRIVER, airAt } from "./simulation.js";
import { computeVolumes } from "./volume.js";
import { meshBuffers } from "./mesh-buffers.js";
import { buildDXF, ALL_LAYERS } from "./export/dxf.js";
import { buildDatasheet } from "./export/pdf.js";
import { hornStep } from "./export/step.js";
import { hornGeometry } from "./export/stl.js";

const RT = 25.4;
const BASE = {
  hornShape: "round", throatDiam: 50.8, openingAngle: 70, L: 500, Lt: 60, dw: 182, dh: 90, hMouth: 200, curve: "hypex", hypexT: 0.7,
  showRaumecke: true, showWandstaerke: true, wandstaerke: 10, filletOn: true, filletR: 477, clothoidOn: false, clothoidLength: 30,
  morphOn: true, morphLength: 473, mouthRoundOn: true, mouthRoundR: 20, flangeOn: true, flangeD: null, flangeT: 10, holeCount: 4, holeCircle: null, holeD: 6.6,
  holeAngle: 0, ribsOn: true, ribThickness: 4, ribLength: 30, roundOn: false, roundR: 2, edgeOn: true, edgeR: 10,
};

describe("Geometrie-Kern, Bauform rund", () => {
  const { values: v, params } = createGeometryEngine()(BASE);

  it("löst mit dem Throat als Beginn von L: Mundkante (offener Mund, kein Scheitel) bei z = L, kennzeichnet s.round", () => {
    expect(v.s.round).toBe(true);
    expect(v.s.zMouth).toBeCloseTo(500, 5);
    expect(v.LClamped).toBeCloseTo(500, 5);
    expect(v.s.zApex).toBeGreaterThan(500);
    expect(v.s.openingAngle).toBe(70);
  });

  it("L ist über den ganzen Regler die Lage der Mundkante; die Grenzen gelten angezeigt", () => {
    const compute = createGeometryEngine();
    for (const L of [60, 150, 400, 900]) expect(compute({ ...BASE, L }).values.s.zMouth).toBeCloseTo(L, 5);
    const w = compute({ ...BASE, L: 1 }).values;                  // zu kurz: kürzestes Horn, Mundkante bei Lmin
    expect(w.LClamped).toBeCloseTo(w.Lmin, 5);
    expect(w.s.zMouth).toBeCloseTo(w.Lmin, 5);
    const x = compute({ ...BASE, L: 5000 }).values;               // zu lang: Obergrenze des Reglers
    expect(x.LClamped).toBeCloseTo(x.Lmax, 3);
  });

  it("ignoriert Raumecke, Treibermaße, vertikales Profil, Übergang, Mundecken und Kantenrundung; params bleiben die Eingabe", () => {
    expect(v.fillet).toBeNull();
    expect(v.morph).toBeNull();
    expect(v.edge).toBe(0);
    expect(v.LMaxRaumecke).toBeNull();
    expect(v.shellCut).toBeNull();
    expect(params.hornShape).toBe("round");
    expect(params.dw).toBe(182);                      // Eingabe unverändert
    const other = createGeometryEngine()({ ...BASE, dw: 50, dh: 10, showRaumecke: false, filletR: 10, morphOn: false }).values;
    expect(other.s).toEqual(v.s);                     // gleiche Lösung
  });

  it("Flansch gegen den runden Außenkörper aufgelöst, mit Rippen", () => {
    expect(v.flange.centers).toHaveLength(4);
    expect(v.flange.ribs).toEqual({ thickness: 4, length: 30 });
    const r0 = Math.hypot(v.flange.loop[0][0], v.flange.loop[0][1]);
    expect(v.flange.loop.every(([x, h]) => Math.abs(Math.hypot(x, h) - r0) < 1e-6)).toBe(true);   // Kreis
  });

  it("Umschalten der Bauform rechnet die Lösung neu; die Außenkontur der Draufsicht (Schnitt) bleibt vorhanden", () => {
    const engine = createGeometryEngine();
    const radial = engine({ ...BASE, hornShape: "radial", L: 700, openingAngle: 140 });
    const round = engine({ ...BASE });
    expect(radial.values.s.round).toBeUndefined();
    expect(round.versions.s).not.toBe(radial.versions.s);
    expect(round.values.shellOuter.length).toBeGreaterThan(10);
  });
});

describe("Wandstärke-Empfehlung, rundes Horn", () => {
  const s = createGeometryEngine()(BASE).values.s, K = airAt(20).rho * airAt(20).c ** 2, pla = materialOf("pla");

  it("Membranformel: t_min = 2·K·x/(E·ν_max·cos θ) an der maßgebenden Stelle; Rückrechnung der Nachgiebigkeit", () => {
    const advice = wallAdvice({ s, profile: null, material: pla, K, tMM: null, nuMax: 5 });
    expect(advice.round).toBe(true);
    const all = wallStationsRound(s);
    const zone = all.filter(st => st.A <= 4 * all[0].A);
    const expected = Math.max(...zone.map(st => stationMinThicknessRound(st, pla, 0.05, K)));
    expect(advice.tMin).toBeCloseTo(expected, 9);
    const st = zone.find(p => p.z === advice.worst.z);
    expect(stationComplianceRound(st, pla, advice.tMin, K)).toBeCloseTo(0.05, 9);
  });

  it("eine runde Schale ist viel steifer als ein Kasten: Empfehlung unter 1 mm für PLA; Ampel nach Dicke", () => {
    const advice = wallAdvice({ s, profile: null, material: pla, K, tMM: 3, nuMax: 5 });
    expect(advice.tMin).toBeLessThan(1);
    expect(advice.status).toBe("ok");
    expect(wallAdvice({ s, profile: null, material: pla, K, tMM: 0.05, nuMax: 5 }).status).toBe("thin");
  });

  it("Skalierung: ∝ 1/E, ∝ 1/ν_max; Atmungsmode des Rings f = √(E/ρ(1−ν²))/(2πx)", () => {
    const base = wallAdvice({ s, profile: null, material: pla, K, nuMax: 5 }).tMin;
    expect(wallAdvice({ s, profile: null, material: { ...pla, E: 2 * pla.E }, K, nuMax: 5 }).tMin).toBeCloseTo(base / 2, 9);
    expect(wallAdvice({ s, profile: null, material: pla, K, nuMax: 10 }).tMin).toBeCloseTo(base / 2, 9);
    expect(ringMode(25, pla)).toBeCloseTo(Math.sqrt(pla.E / (pla.rho * (1 - pla.nu ** 2))) / (2 * Math.PI * 0.025), 6);
  });
});

describe("Simulation, rundes Horn", () => {
  const s = createGeometryEngine()(BASE).values.s;
  const freqs = logFrequencies(100, 5000, 40);
  const run = (sol, key) => createSimulationEngine()({
    geoKey: key, geometry: { s: sol, rt: RT, hMouth: 0, curve: "hypex", hypexT: 0.7, fillet: null, morph: null },
    temp: 20, mouth: "2pi", driver: PLACEHOLDER_DRIVER, freqs,
  });

  it("läuft mit der Kugelkappen-Fläche: endliche Werte, Schalldruck steigt zum Plateau, Mundfläche = Kappe", () => {
    const r = run(s, "a");
    expect(r.result.spl.every(Number.isFinite)).toBe(true);
    const at = hz => r.result.spl[r.result.f.reduce((b, f, i) => Math.abs(f - hz) < Math.abs(r.result.f[b] - hz) ? i : b, 0)];
    expect(at(1500)).toBeGreaterThan(at(150) + 3);
    expect(mouthArea(s, 0)).toBeCloseTo(capArea(s.arcR, s.alpha2), 6);
  });

  it("kleinerer Öffnungswinkel = kleinerer Mund: tiefe Frequenzen verlieren Pegel", () => {
    const narrow = createGeometryEngine()({ ...BASE, openingAngle: 30 }).values.s;
    const wide = run(s, "w"), small = run(narrow, "n");
    expect(small.result.spl[2]).toBeLessThan(wide.result.spl[2]);   // ≈ 130 Hz
  });
});

describe("Volumen und 3D-Puffer, rundes Horn", () => {
  const { s, flange } = createGeometryEngine()(BASE).values;
  const input = extra => ({ s, rt: RT, hMouth: 0, curve: "hypex", hypexT: 0.7, fillet: null, ...extra });

  it("computeVolumes: Schale ohne und mit Flansch samt Rippen; Außenkörper = Luft + Wand", () => {
    const air = computeVolumes(input({ wall: 0 })).air;
    const plain = computeVolumes(input({ wall: 10 }));
    const full = computeVolumes(input({ wall: 10, flange }));
    expect(plain.air).toBeCloseTo(air, 6);
    expect(plain.outer).toBeCloseTo(plain.air + plain.shell, 6);
    expect(full.shell).toBeGreaterThan(plain.shell);
  });

  it("meshBuffers liefert die Sektionen des Rotationskörpers (klonbare Eingaben, wie im Worker)", () => {
    const out = meshBuffers(structuredClone(input({ wall: 10, flange, sections: ["traktrix", "linear", "rim", "flansch", "cap"] })));
    const names = out.sections.map(x => x.section);
    expect(names).toEqual(expect.arrayContaining(["traktrix", "linear", "rim", "flansch"]));
    for (const sec of out.sections) expect(sec.positions.length).toBe(sec.normals.length);
  });
});

describe("DXF und PDF, rundes Horn", () => {
  const { s, flange } = createGeometryEngine()(BASE).values;
  const design = { s, rt: RT, hMouth: 0, curve: "hypex", hypexT: 0.7, fillet: null, flange, morph: null, profile: makeProfile(s, RT, 200, "hypex", 0.7), wall: 10, edgeR: 0 };

  it("DXF: Profil (Traktrix, Gerade, Mundbogen), kein Seitenprofil; Flansch mit rundem Throat", () => {
    const dxf = buildDXF(design, ALL_LAYERS);
    expect(dxf).toContain("Draufsicht_Traktrix");
    expect(dxf).toContain("Draufsicht_Gerade");
    expect(dxf).toContain("Mundbogen");
    expect(dxf).not.toContain("Seitenprofil");
    expect(dxf).toContain("Flansch");
  });

  it("PDF: Längsschnitt statt Seitenriss, Kennwerte des runden Horns", () => {
    const html = buildDatasheet({ ...design, L: 500, showRaumecke: false, showWandstaerke: true, wandstaerke: 10 }, { ...ALL_LAYERS, bemassung: true }, new Date(2026, 9, 1));
    expect(html).toContain("LÄNGSSCHNITT");
    expect(html).not.toContain("SEITENRISS");
    expect(html).toContain("Munddurchmesser");
    expect(html).not.toContain("Mundhöhe");
    expect(html).toContain((mouthArea(s, 0) / 1e6).toFixed(4) + " m²");
  });
});

describe("Projektdatei, Bauform", () => {
  it("hornShape gehört zum Entwurf, Standard radial; Rundtrip; ungültiger Wert wird ersetzt und gemeldet", () => {
    expect(DESIGN_DEFAULTS.hornShape).toBe("radial");
    const text = buildProject({ ...DESIGN_DEFAULTS, hornShape: "round" });
    expect(parseProject(text).design.hornShape).toBe("round");
    const broken = JSON.parse(text);
    broken.design.hornShape = "kugel";
    const result = parseProject(JSON.stringify(broken));
    expect(result.design.hornShape).toBe("radial");
    expect(JSON.stringify(result.invalid)).toContain("hornShape");
  });

  it("ältere Dateien ohne hornShape: Radial, ohne Meldung", () => {
    const old = JSON.parse(buildProject(DESIGN_DEFAULTS));
    delete old.design.hornShape;
    const result = parseProject(JSON.stringify(old));
    expect(result.design.hornShape).toBe("radial");
    expect(JSON.stringify(result.missing)).not.toContain("hornShape");
  });
});

describe("Rundes Horn mit größter Traktrix (Lₜ am Maximum, keine gerade Wand)", () => {
  // Ohne gerade Wand lagen zwei Ringe aufeinander (Fläche 0): das STEP-B-Rep wurde nicht geschlossen, der Export brach nach dem
  // Speichern-Dialog ab und hinterließ eine Datei mit 0 KB. Jetzt entfällt der Streifen, die Kontur endet im Mundpunkt.
  const compute = createGeometryEngine();
  const build = o => {
    const v = compute({ ...DESIGN_DEFAULTS, hornShape: "round", ...o }).values;
    const design = { s: v.s, rt: 25.4, profile: v.profile, fillet: null, wall: v.wall, edgeR: 0, morph: null, vanes: null, flange: v.flange };
    return { v, design };
  };
  const CASES = [[10, 60], [30, 60], [60, 300], [60, 60], [60, 150], [100, 60], [140, 150], [160, 60], [160, 150]];

  it("Lₜ weit über dem Maximum: die Traktrix reicht bis zum Mund, ohne gerade Wand im Netz", () => {
    for (const [angle, L] of CASES) {
      const { v, design } = build({ openingAngle: angle, roundAngle: angle, L, roundL: L, Lt: 5000, roundLt: 5000 });
      expect(v.s.zMouth - v.s.zTrans, JSON.stringify([angle, L])).toBeLessThan(1e-3);
      const names = hornGeometry(design).surfaces.map(f => f.name);
      expect(names.some(n => n.includes("linWall")), JSON.stringify([angle, L])).toBe(false);
      expect(names.some(n => n.includes("trakWall"))).toBe(true);
    }
  });

  it("mit gerader Wand bleibt der Streifen", () => {
    const { design } = build({ openingAngle: 60, roundAngle: 60, L: 300, roundL: 300, Lt: 60, roundLt: 60 });
    expect(hornGeometry(design).surfaces.some(f => f.name.includes("linWall"))).toBe(true);
  });

  it("STEP-Export gelingt: Luftvolumen und Schale, mit und ohne Flansch", () => {
    for (const [angle, L] of CASES) for (const wall of [0, 3, 12]) {
      const o = { openingAngle: angle, roundAngle: angle, L, roundL: L, Lt: 5000, roundLt: 5000, showWandstaerke: wall > 0, wandstaerke: wall || 3, flangeOn: wall > 0, ribsOn: wall > 0 };
      const { design } = build(o);
      expect(() => hornStep(design, { fileName: "x.step" }), JSON.stringify(o)).not.toThrow();
    }
  });
});
