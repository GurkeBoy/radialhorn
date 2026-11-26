/**
 * Lamellen: Auflösung (Winkelanteile, Beginn und Ende nach z, Hornbreite oder Kanalbreite, ab dem Throat), Körper
 * (geschlossen, ebene Flächen, im Luftkanal gemessen) und ihr Einfluss auf Volumen und Netz.
 */
import { describe, it, expect } from "vitest";
import { solveHorn, makeProfile, computeFillet, throatMorph, mouthRounding, focusRadius, createHornMath, wavefrontAtAxis } from "./horn-math.js";
import { buildShellGeometry, triangulate, gridLines } from "./horn-mesh.js";
import { buildAir } from "./bodies.js";
import { meshBuffers } from "./mesh-buffers.js";
import { computeVolumes } from "./volume.js";
import { crossSection } from "./horn-math.js";
import { vaneBlockage } from "./vane-blockage.js";
import { areaCurve, createSimulationEngine, PLACEHOLDER_DRIVER } from "./simulation.js";
import { resolveVanes, vaneBodies, vaneValue, vaneRanges, vaneOutline, airTriangles, VANE_SAMPLES, TIP_WIDTH } from "./vanes.js";
import { edgeCheck, signedVolume } from "./test-helpers.js";

const RT = 25.4, H_MOUTH = 200, WALL = 6;
const s = solveHorn(500, 60, RT, 182, 90);
const profile = makeProfile(s, RT, H_MOUTH, "exponential", 0.5);
const spec = (over = {}) => ({ count: 2, thickness: 2, start: { mode: "z", value: 200 }, end: { mode: "mouth", value: 0 }, ...over });
const airTris = (sol = s, prof = profile, fillet = null, morph = null) => airTriangles(buildAir(sol, RT, prof, fillet, morph).surfaces);
const zThroat = wavefrontAtAxis(s, -Infinity).zAxis;

describe("resolveVanes: Anzahl, Anteile, Grenzen", () => {
  it("keine Lamellen ohne Anzahl, ohne Dicke und beim runden Horn", () => {
    expect(resolveVanes(s, spec({ count: 0 }))).toBeNull();
    expect(resolveVanes(s, spec({ thickness: 0 }))).toBeNull();
    expect(resolveVanes({ ...s, round: true }, spec())).toBeNull();
    expect(resolveVanes(null, spec())).toBeNull();
  });

  it("n Lamellen teilen jede Wellenfront in n + 1 gleiche Winkelsektoren, symmetrisch zur Achse", () => {
    for (const n of [1, 2, 3, 5]) {
      const v = resolveVanes(s, spec({ count: n }));
      expect(v.fractions).toHaveLength(n);
      const edges = [-1, ...v.fractions, 1];
      for (let i = 1; i < edges.length; i++) expect(edges[i] - edges[i - 1]).toBeCloseTo(2 / (n + 1), 12);
      v.fractions.forEach((f, i) => expect(f).toBeCloseTo(-v.fractions[n - 1 - i], 12));
      expect(v.delta).toBeCloseTo(2 * s.alpha2 / (n + 1), 12);
    }
    expect(resolveVanes(s, spec({ count: 1 })).fractions[0]).toBeCloseTo(0, 12);
  });

  it("Beginn nach z: die Wellenfront schneidet die Achse dort; die Mittellinie der mittleren Lamelle liegt auf der Achse", () => {
    const v = resolveVanes(s, spec({ count: 3, start: { mode: "z", value: 200 } }));
    expect(v.zStart).toBeCloseTo(200, 9);
    expect(v.startLimited).toBe(false);
    const mid = v.paths[1];
    expect(mid).toHaveLength(VANE_SAMPLES + 1);
    expect(mid[0][0]).toBeCloseTo(0, 12);
    expect(mid[0][1]).toBeCloseTo(200, 6);
    for (const [x] of mid) expect(Math.abs(x)).toBeLessThan(1e-9);
    expect(mid[VANE_SAMPLES][1]).toBeCloseTo(s.zApex, 6);   // Ende am Mund
  });

  it("Lamellen dürfen am Throat beginnen: Beginn bei z = 0 liegt auf der Throat-Wellenfront, ohne Begrenzung", () => {
    const v = resolveVanes(s, spec({ count: 3, start: { mode: "z", value: 0 } }));
    expect(v.zStart).toBeCloseTo(zThroat, 9);
    expect(v.atThroat).toBe(true);
    expect(v.startLimited).toBe(false);
    expect(v.ok).toBe(true);
    // erster Punkt jeder Lamelle liegt in der Throat-Ebene und innerhalb der Wand (x < rt); die mittlere Lamelle ist bis dorthin verlängert
    for (const p of v.paths) {
      expect(p).toHaveLength(VANE_SAMPLES + 2);
      expect(p[0][1]).toBe(0);
      expect(Math.abs(p[0][0])).toBeLessThan(RT);
    }
    expect(v.paths[0][0][0] * v.paths[2][0][0]).toBeLessThan(0);   // gegenüberliegende Seiten
    // Anteil an der Throat-Breite: die äußeren Lamellen bei ±½ der halben Breite
    expect(v.paths[2][0][0]).toBeCloseTo(RT * 0.5, 0);
    expect(resolveVanes(s, spec({ count: 3, start: { mode: "z", value: 200 } })).atThroat).toBe(false);
  });

  it("im geraden Bereich sind die Lamellen Strahlen vom Fokus unter φ = f·α, am Mund auf dem Mundbogen", () => {
    const v = resolveVanes(s, spec({ count: 3, start: { mode: "z", value: 200 } }));
    v.paths.forEach((p, i) => {
      for (const [x, z] of p) expect(Math.atan2(x, z - s.zFocus)).toBeCloseTo(v.fractions[i] * s.alpha2, 9);
      const [xe, ze] = p[VANE_SAMPLES];
      expect(Math.hypot(xe, ze - s.zFocus)).toBeCloseTo(s.arcR, 6);
    });
  });

  it("im Eingang folgen die Lamellen den Wellenfronten: jeder Punkt liegt bei f·θ auf dem Bogen, der Weg ist stetig", () => {
    const v = resolveVanes(s, spec({ count: 2, start: { mode: "z", value: 0 }, end: { mode: "z", value: 150 } }));
    v.paths.forEach((p, i) => {
      const off = p.length - (VANE_SAMPLES + 1);   // verlängerter erster Punkt in der Throat-Ebene
      for (let k = 0; k <= VANE_SAMPLES; k++) {
        const w = wavefrontAtAxis(s, v.zStart + (v.zEnd - v.zStart) * k / VANE_SAMPLES);
        const [x, z] = p[k + off];
        expect(Math.hypot(x, z - w.zCenter)).toBeCloseTo(w.radius, 9);
        expect(Math.atan2(x, z - w.zCenter)).toBeCloseTo(v.fractions[i] * w.halfAngle, 9);
        if (k) expect(Math.hypot(x - p[k + off - 1][0], z - p[k + off - 1][1])).toBeLessThan(10);
      }
    });
  });

  it("Ende am Mund, nach z oder bei einer Kanalbreite", () => {
    expect(resolveVanes(s, spec()).zEnd).toBeCloseTo(s.zApex, 9);
    const z = resolveVanes(s, spec({ end: { mode: "z", value: 250 } }));
    expect(z.zEnd).toBeCloseTo(250, 9);
    const ch = resolveVanes(s, spec({ start: { mode: "z", value: 0 }, end: { mode: "channel", value: 100 } }));
    expect(ch.channelEnd).toBeCloseTo(100, 6);
    expect(ch.zEnd).toBeGreaterThan(ch.zStart);
    expect(ch.endLimited).toBe(false);
    // so breit wird der Kanal nie: Ende am Mund, als begrenzt gemeldet
    const wide = resolveVanes(s, spec({ start: { mode: "z", value: 0 }, end: { mode: "channel", value: 1e6 } }));
    expect(wide.zEnd).toBeCloseTo(s.zApex, 9);
    expect(wide.endLimited).toBe(true);
  });

  it("Beginn bei einer Hornbreite bzw. Kanalbreite: die Maße stimmen mit den Angaben überein; Hornbreite am Mund = 2·xMouth", () => {
    expect(resolveVanes(s, spec({ start: { mode: "width", value: 300 } })).widthStart).toBeCloseTo(300, 6);
    expect(resolveVanes(s, spec({ start: { mode: "channel", value: 60 } })).channelStart).toBeCloseTo(60, 6);
    expect(resolveVanes(s, spec()).widthEnd).toBeCloseTo(2 * s.xMouth, 6);
    // Hornbreite am Throat = Throat-Durchmesser
    expect(resolveVanes(s, spec({ start: { mode: "z", value: 0 } })).widthStart).toBeCloseTo(2 * RT, 6);
  });

  it("Begrenzung: vor dem Throat und hinter dem Mund; zu kurze Lamelle ist nicht ok und hat keine Wege", () => {
    const early = resolveVanes(s, spec({ start: { mode: "z", value: -50 } }));
    expect(early.zStart).toBeCloseTo(zThroat, 9);
    expect(early.startLimited).toBe(true);
    const late = resolveVanes(s, spec({ start: { mode: "z", value: 5000 } }));
    expect(late.zStart).toBeCloseTo(s.zApex, 9);
    expect(late.ok).toBe(false);
    expect(late.paths).toEqual([]);
  });

  it("lichte Kanalbreite: nie weniger als 1 mm am Beginn, auch bei vielen dicken Lamellen am Throat", () => {
    const v = resolveVanes(s, spec({ count: 9, thickness: 8, start: { mode: "z", value: 0 } }));
    expect(v.channelStart).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(v.zStart).toBeGreaterThan(zThroat);
    expect(v.startLimited).toBe(true);
  });

  it("vaneValue rechnet Betriebsarten um; die Bereiche reichen vom Throat bis zum Mund", () => {
    for (const mode of ["width", "channel"]) {
      const value = vaneValue(s, 3, 2, mode, 260);
      expect(resolveVanes(s, spec({ count: 3, start: { mode, value } })).zStart).toBeCloseTo(260, 5);
    }
    const ranges = vaneRanges(s, 2, 2);
    expect(ranges.z[0]).toBe(0);   // Beginn in der Throat-Ebene
    expect(ranges.z[1]).toBeCloseTo(s.zApex, 6);
    expect(ranges.width[0]).toBeCloseTo(2 * RT, 6);
    expect(ranges.width[1]).toBeCloseTo(2 * s.xMouth, 6);
  });

  it("auch ohne Traktrix und mit Klothoide: Beginn am Throat gelöst, Wege innerhalb der Wand", () => {
    for (const sol of [solveHorn(500, 0, RT, 182, 90), createHornMath(140, { clothoid: 30 }).solveHorn(500, 60, RT, 182, 90)]) {
      const v = resolveVanes(sol, spec({ count: 4, start: { mode: "z", value: 0 } }));
      expect(v.ok).toBe(true);
      for (const p of v.paths) for (const [x, z] of p) {
        expect(z).toBeGreaterThanOrEqual(-1e-9);
        expect(Math.abs(x)).toBeLessThan(sol.xMouth + 1e-6);
      }
    }
  });
});

describe("vaneOutline", () => {
  it("zwei Seitenlinien im Abstand der Dicke, senkrecht zur Mittellinie", () => {
    const { left, right } = vaneOutline([[0, 0], [0, 10], [0, 20]], 4);
    expect(left.map(p => p[0])).toEqual([-2, -2, -2]);
    expect(left.map(p => p[1])).toEqual([0, 10, 20]);
    expect(right.map(p => p[0])).toEqual([2, 2, 2]);
  });
});

describe("vaneBodies: Körper", () => {
  for (const [name, vanes] of [
    ["ab z = 160 (gerader Bereich)", resolveVanes(s, spec({ count: 3, start: { mode: "z", value: 160 } }))],
    ["ab dem Throat (gekrümmt im Eingang)", resolveVanes(s, spec({ count: 3, start: { mode: "z", value: 0 } }))],
  ]) {
    describe(name, () => {
      const bodies = vaneBodies(s, airTris(), vanes, WALL);

      it("je Lamelle ein geschlossener, einheitlich orientierter Körper mit positivem Volumen", () => {
        expect(bodies.count).toBe(3);
        for (const f of bodies.surfaces) {
          expect(edgeCheck(f.triangles)).toEqual({ open: 0, flipped: 0 });
          expect(signedVolume(f.triangles)).toBeGreaterThan(0);
          expect(f.faces.flat()).toHaveLength(f.triangles.length);
        }
      });

      it("jede Fläche ist eben (STEP): alle Ecken auf der Ebene des ersten Dreiecks", () => {
        for (const f of bodies.surfaces) for (const face of f.faces) {
          const [a, b, c] = face[0];
          const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
          const len = Math.hypot(...n);
          for (const p of face.flat()) expect(Math.abs((n[0] * (p[0] - a[0]) + n[1] * (p[1] - a[1]) + n[2] * (p[2] - a[2])) / len)).toBeLessThan(1e-6);
        }
      });

      it("Luftanteil = Dicke × Fläche in (Weg, Höhe); Überlapp = Dicke × 2e × Weglänge", () => {
        const e = Math.min(3, 0.4 * WALL);
        let area = 0, length = 0;
        for (const path of vanes.paths) {
          // Fläche der Mittelebene: ∫ 2·h ds mit der Höhenregel des Netzes h(x, z) = Profil(zFocus + Abstand zum Fokus)
          const K = 2000, segments = path.length - 1;
          for (let k = 0; k < K; k++) {
            const seg = (k + 0.5) / K * segments, i = Math.min(segments - 1, Math.floor(seg)), f = seg - i;
            const x = path[i][0] + f * (path[i + 1][0] - path[i][0]), z = path[i][1] + f * (path[i + 1][1] - path[i][1]);
            const ds = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]) * segments / K;
            area += 2 * profile(s.zFocus + focusRadius(s, x, z)) * ds;
            length += ds;
          }
        }
        expect(bodies.cavity / (vanes.thickness * area)).toBeCloseTo(1, 2);
        expect(bodies.overlap / (vanes.thickness * 2 * e * length)).toBeCloseTo(1, 3);
        const total = bodies.surfaces.reduce((v, f) => v + signedVolume(f.triangles), 0);
        expect(total - bodies.overlap).toBeCloseTo(bodies.cavity, 3);
      });

      it("Höhe folgt dem Luftkanal: oben und unten höchstens e über dem Profil, nie bis an die Außenfläche", () => {
        const e = Math.min(3, 0.4 * WALL);
        expect(e).toBeLessThan(WALL);
        for (const f of bodies.surfaces) for (const [x, h, z] of f.triangles.flat()) {
          expect(z).toBeGreaterThanOrEqual(-vanes.thickness);
          expect(Math.abs(h)).toBeLessThanOrEqual(profile(s.zFocus + focusRadius(s, x, z)) + e + 0.25);
        }
      });
    });
  }

  it("mit unlösbarer Länge oder ohne Lamellen keine Körper; ohne Wandstärke (nur Ansicht) Platten mit kleiner Eintauchtiefe", () => {
    const vanes = resolveVanes(s, spec({ count: 3, start: { mode: "z", value: 160 } }));
    expect(vaneBodies(s, airTris(), { ...vanes, ok: false }, WALL).count).toBe(0);
    expect(vaneBodies(s, airTris(), null, WALL).count).toBe(0);
    expect(vaneBodies(s, airTris(), vanes, -1).count).toBe(0);
    const bare = vaneBodies(s, airTris(), vanes, 0), walled = vaneBodies(s, airTris(), vanes, WALL);
    expect(bare.count).toBe(3);
    for (const f of bare.surfaces) { expect(edgeCheck(f.triangles)).toEqual({ open: 0, flipped: 0 }); expect(signedVolume(f.triangles)).toBeGreaterThan(0); }
    expect(bare.overlap).toBeLessThan(0.1 * walled.overlap);   // 0,2 mm statt bis 2,4 mm
    expect(bare.cavity).toBeGreaterThan(0.9 * walled.cavity);
  });

  it("ohne Wandstärke: Lamellen im Luftkörper (Ansicht), Volumen der Luft um ihr Volumen kleiner, Export ohne Lamellen", () => {
    const vanes = resolveVanes(s, spec({ count: 3, start: { mode: "z", value: 160 } }));
    const plain = buildAir(s, RT, profile, null), withVanes = buildAir(s, RT, profile, null, null, undefined, vanes);
    expect(withVanes.surfaces.filter(f => f.section === "lamellen")).toHaveLength(3);
    expect(withVanes.surfaces.filter(f => f.section !== "lamellen")).toHaveLength(plain.surfaces.length);
    expect(withVanes.vanes.count).toBe(3);
    const base = { s, rt: RT, hMouth: H_MOUTH, curve: "exponential", hypexT: 0.5, fillet: null, wall: 0 };
    const a = computeVolumes(base), b = computeVolumes({ ...base, vanes });
    expect(a.air - b.air).toBeCloseTo(withVanes.vanes.cavity, 3);
    expect(b.air).toBeLessThan(a.air);
    expect(b.shell).toBeNull();
    const buffers = meshBuffers({ ...base, vanes, sections: ["lamellen"] });
    expect(buffers.sections[0].lines.length).toBeGreaterThan(0);
  });

  it("auch mit Verrundung, rundem Throat und gerundeten Mundecken geschlossen, ab dem Throat", () => {
    const fillet = computeFillet(s, RT, H_MOUTH, "exponential", 0.5, 100);
    const prof = makeProfile(s, RT, H_MOUTH, "exponential", 0.5, fillet);
    const throat = throatMorph(s, RT, null);
    const morph = mouthRounding(s, prof, throat, 40);
    const v = resolveVanes(s, spec({ count: 4, start: { mode: "z", value: 0 } }));
    const b = vaneBodies(s, airTris(s, prof, fillet, morph), v, WALL);
    expect(b.count).toBe(4);
    for (const f of b.surfaces) expect(edgeCheck(f.triangles)).toEqual({ open: 0, flipped: 0 });
  });
});

describe("Beginn ab Kanalbreite gilt auch für die Stufen (ein Wert für alle)", () => {
  const shared = (W, stagger = {}, over = {}) => spec({ count: 1, start: { mode: "channel", value: W }, stagger: { stages: 2, mode: "z", channel: 999, z: [50, 60, 70], ...stagger }, ...over });

  it("jede Gruppe beginnt, sobald die Kanäle, die sie bildet, die Breite des Beginns haben; eigene Stufenwerte (z, Breite) sind ohne Wirkung", () => {
    const v = resolveVanes(s, shared(30));
    expect(v.stageStarts).toHaveLength(2);
    // Beginn: 2 Sektoren (1 Lamelle), Stufe 1: 4 Sektoren (3 Lamellen), Stufe 2: 8 Sektoren (7 Lamellen) – jeweils 30 mm lichte Breite
    expect(vaneValue(s, 1, 2, "channel", v.zStart)).toBeCloseTo(30, 6);
    expect(vaneValue(s, 3, 2, "channel", v.stageStarts[0])).toBeCloseTo(30, 6);
    expect(vaneValue(s, 7, 2, "channel", v.stageStarts[1])).toBeCloseTo(30, 6);
    expect(v.stageStarts[0]).toBeGreaterThan(v.zStart);
    expect(v.stageStarts[1]).toBeGreaterThan(v.stageStarts[0]);
    expect(v.count).toBe(7);
    expect(v.staggerLimited).toBe(false);
    const other = resolveVanes(s, shared(30, { mode: "channel", channel: 5, z: [1, 2, 3] }));
    expect(other.stageStarts).toEqual(v.stageStarts);
  });

  it("mit Beginn nach z gelten die eigenen Stufenwerte weiter", () => {
    const v = resolveVanes(s, shared(30, { mode: "z", z: [200, 260, 300] }, { start: { mode: "z", value: 100 } }));
    expect(v.stageStarts).toEqual([200, 260]);
  });

  it("automatisch: so viele Stufen, wie vor dem Ende Platz haben, alle ab derselben Kanalbreite", () => {
    const v = resolveVanes(s, shared(30, { auto: true }));
    expect(v.stageStarts.length).toBeGreaterThan(0);
    v.stageStarts.forEach((z, i) => expect(vaneValue(s, 2 ** (i + 2) - 1, 2, "channel", z)).toBeCloseTo(30, 4));
  });
});

describe("Ende ab Kanalbreite: der Kanal zwischen den Lamellen, die dort laufen", () => {
  const withEnd = (value, stagger) => spec({ count: 1, start: { mode: "z", value: 0 }, end: { mode: "channel", value }, stagger });
  const stg = { stages: 1, mode: "channel", channel: 30, z: [] };

  it("ohne Staffelung: Kanal zwischen n Lamellen (n + 1 Sektoren)", () => {
    const v = resolveVanes(s, withEnd(60));
    expect(vaneValue(s, 1, 2, "channel", v.zEnd)).toBeCloseTo(60, 6);
    expect(v.channelEnd).toBeCloseTo(60, 6);
  });

  it("mit Staffelung zählen die Lamellen, die am Ende laufen: nach der Stufe sind die Kanäle schmaler, das Ende liegt weiter hinten", () => {
    const plain = resolveVanes(s, withEnd(40)), v = resolveVanes(s, withEnd(40, stg));
    expect(v.stageStarts).toHaveLength(1);
    expect(v.stageStarts[0]).toBeLessThan(plain.zEnd);
    expect(v.zEnd).toBeGreaterThan(v.stageStarts[0]);
    expect(v.count).toBe(3);
    // Kanal zwischen den dann 3 laufenden Lamellen (4 Sektoren) ist 40 mm breit – nicht der der ersten Lamelle allein
    expect(vaneValue(s, 3, 2, "channel", v.zEnd)).toBeCloseTo(40, 6);
    expect(v.channelEnd).toBeCloseTo(40, 6);
    expect(vaneValue(s, 1, 2, "channel", v.zEnd)).toBeGreaterThan(40);
    expect(v.zEnd).toBeGreaterThan(plain.zEnd);
  });

  it("wird die Breite schon vor der Stufe erreicht, enden die Lamellen vor ihr: keine Stufenlamellen", () => {
    const v = resolveVanes(s, withEnd(25, stg));
    expect(vaneValue(s, 1, 2, "channel", v.zEnd)).toBeCloseTo(25, 6);
    expect(v.count).toBe(1);
  });

  it("der wählbare Bereich reicht von der Kanalbreite am Beginn bis zur größten vor dem Mund; nie erreicht: Ende am Mund, begrenzt", () => {
    const v = resolveVanes(s, withEnd(25, stg));
    const [lo, hi] = v.endChannelRange;
    expect(lo).toBeLessThan(hi);
    expect(hi).toBeGreaterThanOrEqual(30 - 1e-6);   // knapp vor der Stufe war der Kanal 30 mm breit
    const never = resolveVanes(s, withEnd(hi + 50, stg));
    expect(never.zEnd).toBeCloseTo(s.zApex, 9);
    expect(never.endLimited).toBe(true);
  });
});

describe("Querschnitt mit Lamellen", () => {
  const vanes = resolveVanes(s, spec({ count: 3, thickness: 2, start: { mode: "z", value: 160 } }));
  const block = vaneBlockage(s, vanes, profile);

  it("ohne Lamellen keine Abzugsfunktion", () => {
    expect(vaneBlockage(s, null, profile)).toBeNull();
    expect(vaneBlockage(s, resolveVanes(s, spec({ start: { mode: "z", value: 1e6 } })), profile)).toBeNull();
  });

  it("im geraden Bereich nehmen n Lamellen n·Dicke·2h weg (h konstant auf dem Bogen um den Fokus)", () => {
    const wf = wavefrontAtAxis(s, 0.9 * s.zApex);
    expect(wf.zCenter).toBeCloseTo(s.zFocus, 9);
    expect(block(wf)).toBeCloseTo(3 * 2 * 2 * profile(s.zFocus + wf.radius), 6);
  });

  it("nur dort, wo die Lamellen laufen: davor und dahinter nichts; A + B ist die Fläche ohne Lamellen", () => {
    const bare = crossSection(s, profile, 80), cut = crossSection(s, profile, 80, null, null, block);
    expect(cut).toHaveLength(bare.length);
    let inside = 0;
    cut.forEach((p, i) => {
      expect(p.A + p.B).toBeCloseTo(bare[i].A, 6);
      if (p.z < vanes.zStart - 1e-6) expect(p.B).toBe(0);
      if (p.z > vanes.zStart + 1 && p.z <= vanes.zEnd) { expect(p.B).toBeGreaterThan(0); inside++; }
    });
    expect(inside).toBeGreaterThan(10);
    expect(Math.max(...cut.map(p => p.B / bare[cut.indexOf(p)].A))).toBeLessThan(0.1);   // wenige Prozent der Fläche
  });

  it("Spitzen: am Beginn nehmen die Lamellen weniger weg als weiter hinten", () => {
    const tip = resolveVanes(s, spec({ count: 3, thickness: 4, start: { mode: "z", value: 160 }, tip: { start: true, end: true, length: 30 } }));
    const b = vaneBlockage(s, tip, profile);
    const early = b(wavefrontAtAxis(s, tip.zStart + 3)), late = b(wavefrontAtAxis(s, (tip.zStart + tip.zEnd) / 2));
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.6 * late);
  });

  it("Flächenkurve der Simulation: kleiner mit Lamellen, am Hals schon abgezogen, wenn sie am Throat beginnen", () => {
    const throat = resolveVanes(s, spec({ count: 3, thickness: 2, start: { mode: "z", value: 0 } }));
    const plain = areaCurve(s, RT, profile), cut = areaCurve(s, RT, profile, undefined, null, vaneBlockage(s, throat, profile));
    expect(cut.S[0]).toBeLessThan(plain.S[0]);
    expect(cut.S.at(-1)).toBeLessThan(plain.S.at(-1));
    expect(cut.S.every((v, i) => v <= plain.S[Math.min(i, plain.S.length - 1)] + 1e-9 || cut.x.length !== plain.x.length)).toBe(true);
    expect(cut.S.every(v => v > 0 && Number.isFinite(v))).toBe(true);
  });

  it("Frequenzgang rechnet mit den Lamellen und ändert sich (leicht)", () => {
    const geometry = { s, rt: RT, hMouth: H_MOUTH, curve: "exponential", hypexT: 0.5, fillet: null, morph: null };
    const freqs = [200, 500, 1000, 2000, 5000];
    const run = createSimulationEngine();
    const a = run({ geoKey: "a", geometry, temp: 20, mouth: "2pi", driver: PLACEHOLDER_DRIVER, freqs }).result;
    const b = run({ geoKey: "b", geometry: { ...geometry, vanes: resolveVanes(s, spec({ count: 3, thickness: 2, start: { mode: "z", value: 0 } })) }, temp: 20, mouth: "2pi", driver: PLACEHOLDER_DRIVER, freqs }).result;
    expect(b.spl.every(Number.isFinite)).toBe(true);
    expect(b.spl).not.toEqual(a.spl);
    expect(Math.max(...b.spl.map((v, i) => Math.abs(v - a.spl[i])))).toBeLessThan(3);   // dB: eine kleine Wirkung, kein Umsturz
  });
});

describe("Grenzfälle: Bereich des Reglers bleibt endlich", () => {
  it("beginnt die Lamelle erst am Mund (kein Abschnitt bis zum Mund), sind alle Werte endlich – nie ±Infinity", () => {
    for (const start of [s.zApex, s.zApex + 100, 1e6]) for (const stagger of [undefined, { stages: 2, mode: "channel", channel: 30, z: [] }]) {
      const v = resolveVanes(s, spec({ count: 3, start: { mode: "z", value: start }, end: { mode: "channel", value: 60 }, stagger }));
      expect(v.endChannelRange.every(Number.isFinite)).toBe(true);
      expect(v.endChannelRange[0]).toBeLessThanOrEqual(v.endChannelRange[1]);
      expect(v.ok).toBe(false);   // zu kurz für eine Lamelle: Warnung, keine Körper
    }
  });

  it("zufällige Einstellungen: nichts wird NaN oder unendlich, nichts wirft", () => {
    let seed = 99;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const pick = a => a[Math.floor(rnd() * a.length)], between = (a, b) => a + rnd() * (b - a);
    const finite = o => typeof o === "number" ? Number.isFinite(o) : o && typeof o === "object" ? Object.values(o).every(finite) : true;
    for (let i = 0; i < 300; i++) {
      const v = resolveVanes(s, {
        count: pick([1, 2, 3, 5, 8, 12]), thickness: pick([0.3, 0.5, 2, 5, 10]),
        start: { mode: pick(["z", "channel", "width"]), value: between(-50, 600) },
        end: { mode: pick(["mouth", "z", "channel"]), value: between(-50, 600) },
        tip: { start: pick([true, false]), end: pick([true, false]), length: pick([2, 10, 40]) },
        stagger: pick([null, { stages: pick([1, 2, 3]), auto: pick([true, false]), mode: pick(["channel", "z"]), channel: between(3, 150), z: [between(0, 500), between(0, 500), between(0, 500)] }]),
      });
      expect(finite(v)).toBe(true);
    }
  });
});

describe("Stufen automatisch", () => {
  const auto = (end, over = {}) => spec({ count: 1, start: { mode: "z", value: 0 }, end, stagger: { stages: 1, auto: true, mode: "channel", channel: 35, z: [], ...over } });
  const upTo = z => ({ mode: "z", value: z });

  it("so viele Stufen wie bis zum Ende Platz haben: je weiter das Ende Richtung Mund, desto mehr Lamellenfronten", () => {
    const counts = [60, 120, 200, 300].map(z => resolveVanes(s, auto(upTo(z))).stageStarts.length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(counts[0]).toBeLessThan(counts.at(-1));
    expect(counts.at(-1)).toBeGreaterThan(0);
  });

  it("jede Stufe beginnt vor dem Ende (mindestens 5 mm Lamelle), bei der eingestellten Kanalbreite der vorigen Anordnung; keine Lamelle entfällt", () => {
    const v = resolveVanes(s, auto({ mode: "mouth", value: 0 }));
    const S = v.stageStarts.length;
    expect(S).toBeGreaterThan(0);
    expect(v.count).toBe(2 * 2 ** S - 1);
    v.stageStarts.forEach((z, i) => {
      expect(z).toBeLessThanOrEqual(v.zEnd - 5 + 1e-9);
      expect(vaneValue(s, 2 ** (i + 1) - 1, 2, "channel", z)).toBeCloseTo(35, 4);
    });
    expect(v.staggerLimited).toBe(false);
  });

  it("verschiebt man das Ende, entstehen genau dann neue Fronten, wenn die nächste Stufe noch vor dem Ende beginnt", () => {
    const full = resolveVanes(s, auto({ mode: "mouth", value: 0 }));
    const cutAfter = full.stageStarts.at(-1) + 6, cutBefore = full.stageStarts.at(-1) + 2;
    expect(resolveVanes(s, auto(upTo(cutAfter))).stageStarts).toHaveLength(full.stageStarts.length);
    expect(resolveVanes(s, auto(upTo(cutBefore))).stageStarts).toHaveLength(full.stageStarts.length - 1);
  });

  it("höchstens vier Stufen; in der z-Betriebsart zählt die eingestellte Stufenzahl", () => {
    const tiny = resolveVanes(s, auto({ mode: "mouth", value: 0 }, { channel: 8 }));
    expect(tiny.stageStarts.length).toBeLessThanOrEqual(4);
    const z = resolveVanes(s, auto({ mode: "mouth", value: 0 }, { mode: "z", stages: 2, z: [150, 250, 300] }));
    expect(z.stageStarts).toEqual([150, 250]);
  });
});

describe("Kanalwinkel am Ende der Lamellen", () => {
  it("bis zum Mund (oder im geraden Bereich): der Sektorwinkel 2α/(n + 1)", () => {
    const v = resolveVanes(s, spec({ count: 3, start: { mode: "z", value: 0 } }));
    expect(v.endAngle).toBeCloseTo(2 * s.alpha2 / 4, 12);
    expect(v.endAngle).toBeCloseTo(v.delta, 12);
    expect(v.endWave.zCenter).toBeCloseTo(s.zFocus, 6);
    expect(v.endWave.radius).toBeCloseTo(s.arcR, 6);
    const straight = resolveVanes(s, spec({ count: 3, start: { mode: "z", value: 100 }, end: { mode: "z", value: 250 } }));
    expect(straight.endAngle).toBeCloseTo(2 * s.alpha2 / 4, 9);
  });

  it("enden die Lamellen im Traktrix-Eingang, wird der Winkel kleiner: 2θ/(n + 1) mit dem Halbwinkel der Wellenfront dort", () => {
    const v = resolveVanes(s, spec({ count: 3, start: { mode: "z", value: 0 }, end: { mode: "z", value: 30 } }));
    expect(v.ok).toBe(true);
    const w = wavefrontAtAxis(s, v.zEnd);
    expect(w.halfAngle).toBeLessThan(s.alpha2);
    expect(v.endAngle).toBeCloseTo(2 * w.halfAngle / 4, 12);
    expect(v.endAngle).toBeLessThan(v.delta);
    // die Enden der Lamellen liegen im Winkelabstand endAngle auf dem Bogen der Wellenfront
    const ends = v.paths.map(p => p.at(-1));
    const ang = ([px, pz]) => Math.atan2(px, pz - v.endWave.zCenter);
    for (let i = 1; i < ends.length; i++) expect(ang(ends[i]) - ang(ends[i - 1])).toBeCloseTo(v.endAngle, 6);
    // je weiter hinten sie enden, desto größer der Winkel
    const later = resolveVanes(s, spec({ count: 3, start: { mode: "z", value: 0 }, end: { mode: "z", value: 60 } }));
    expect(later.endAngle).toBeGreaterThan(v.endAngle);
  });
});

describe("Spitzen (druckbarer Keil an Beginn und Ende)", () => {
  const length = p => p.slice(1).reduce((l, q, k) => l + Math.hypot(q[0] - p[k][0], q[1] - p[k][1]), 0);
  const tip = (start, end, len = 12, over = {}) => spec({ count: 3, start: { mode: "z", value: 160 }, tip: { start, end, length: len }, ...over });

  it("ohne Spitzen: überall volle Dicke, Wege unverändert", () => {
    const plain = resolveVanes(s, spec({ count: 3, start: { mode: "z", value: 160 } })), off = resolveVanes(s, tip(false, false));
    expect(plain.widths.every(w => w.every(v => v === 2))).toBe(true);
    expect(plain.tip).toEqual({ start: false, end: false, length: 0 });
    expect(off.paths).toEqual(plain.paths);
  });

  it("spitzer Beginn und spitzes Ende: Dicke 0,4 mm an den Enden, nach der Spitzenlänge wieder voll, dazwischen linear", () => {
    const v = resolveVanes(s, tip(true, true, 12));
    expect(v.tip).toEqual({ start: true, end: true, length: 12 });
    v.paths.forEach((p, i) => {
      const w = v.widths[i];
      expect(p).toHaveLength(w.length);
      expect(w[0]).toBeCloseTo(TIP_WIDTH, 9);
      expect(w.at(-1)).toBeCloseTo(TIP_WIDTH, 9);
      expect(Math.max(...w)).toBeCloseTo(2, 9);
      let a = 0;
      p.forEach((q, k) => {
        if (k) a += Math.hypot(q[0] - p[k - 1][0], q[1] - p[k - 1][1]);
        const total = length(p), d = Math.min(a, total - a);
        expect(w[k]).toBeCloseTo(d < 12 ? TIP_WIDTH + (2 - TIP_WIDTH) * d / 12 : 2, 6);
      });
    });
  });

  it("nur Beginn oder nur Ende; Weg und Form bleiben dieselbe Linie", () => {
    const plain = resolveVanes(s, spec({ count: 3, start: { mode: "z", value: 160 } }));
    const a = resolveVanes(s, tip(true, false)), b = resolveVanes(s, tip(false, true));
    a.widths.forEach(w => { expect(w[0]).toBeCloseTo(TIP_WIDTH, 9); expect(w.at(-1)).toBe(2); });
    b.widths.forEach(w => { expect(w[0]).toBe(2); expect(w.at(-1)).toBeCloseTo(TIP_WIDTH, 9); });
    for (const v of [a, b]) v.paths.forEach((p, i) => { expect(length(p)).toBeCloseTo(length(plain.paths[i]), 9); expect(p[0]).toEqual(plain.paths[i][0]); expect(p.at(-1)).toEqual(plain.paths[i].at(-1)); });
  });

  it("zu lange Spitzen: höchstens 40 % der Lamellenlänge; Dicke ≤ 0,4 mm bleibt unverändert", () => {
    const v = resolveVanes(s, tip(true, true, 5000));
    const shortest = Math.min(...v.paths.map(length));
    expect(v.tip.length).toBeCloseTo(0.4 * shortest, 6);
    expect(Math.max(...v.widths.flat())).toBeCloseTo(2, 9);
    const thin = resolveVanes(s, tip(true, true, 12, { thickness: 0.4 }));
    expect(thin.tip.start).toBe(false);
    expect(thin.widths.flat().every(w => w === 0.4)).toBe(true);
  });

  it("Umriss: Abstand der Seitenlinien = Dicke an jedem Punkt", () => {
    const v = resolveVanes(s, tip(true, true, 12));
    v.paths.forEach((p, i) => {
      const { left, right } = vaneOutline(p, v.widths[i]);
      p.forEach((_, k) => expect(Math.hypot(left[k][0] - right[k][0], left[k][1] - right[k][1])).toBeCloseTo(v.widths[i][k], 9));
    });
  });

  for (const [name, start] of [["gerader Bereich", 160], ["ab dem Throat", 0]]) {
    it(`Körper (${name}): geschlossen, einheitlich orientiert, nur ebene Flächen; weniger Luftverdrängung als ohne Spitzen`, () => {
      const sp = tip(true, true, 12, { start: { mode: "z", value: start } });
      const v = resolveVanes(s, sp), plain = resolveVanes(s, { ...sp, tip: undefined });
      const bodies = vaneBodies(s, airTris(), v, WALL), reference = vaneBodies(s, airTris(), plain, WALL);
      expect(bodies.count).toBe(3);
      for (const f of bodies.surfaces) {
        expect(edgeCheck(f.triangles)).toEqual({ open: 0, flipped: 0 });
        expect(signedVolume(f.triangles)).toBeGreaterThan(0);
        for (const face of f.faces) {
          const [a, b, c] = face[0];
          const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
          const len = Math.hypot(...n);
          for (const p of face.flat()) expect(Math.abs((n[0] * (p[0] - a[0]) + n[1] * (p[1] - a[1]) + n[2] * (p[2] - a[2])) / len)).toBeLessThan(1e-6);
        }
      }
      expect(bodies.cavity).toBeLessThan(reference.cavity);
      expect(bodies.cavity).toBeGreaterThan(0.8 * reference.cavity);
      const total = bodies.surfaces.reduce((acc, f) => acc + signedVolume(f.triangles), 0);
      expect(total - bodies.overlap).toBeCloseTo(bodies.cavity, 3);
    });
  }
});

describe("gestaffelter Beginn", () => {
  const stag = (over = {}, stagger = {}) => spec({ count: 1, start: { mode: "z", value: 0 }, stagger: { stages: 1, mode: "channel", channel: 30, z: [200, 300, 400], ...stagger }, ...over });

  it("ohne Staffelung: alle Lamellen Stufe 0, keine Stufenstellen", () => {
    const v = resolveVanes(s, spec({ count: 2, start: { mode: "z", value: 100 } }));
    expect(v.stages).toEqual([0, 0]);
    expect(v.stageStarts).toEqual([]);
    expect(v.baseCount).toBe(2);
    expect(resolveVanes(s, stag({}, { stages: 0 })).count).toBe(1);
  });

  it("eine Stufe, Kanalbreite: aus 1 Lamelle (2 Sektoren) werden 3 (4 Sektoren); die neuen beginnen bei 30 mm lichter Kanalbreite der laufenden", () => {
    const v = resolveVanes(s, stag());
    expect(v.count).toBe(3);
    expect(v.baseCount).toBe(1);
    expect(v.stages).toEqual([1, 0, 1]);
    expect(v.fractions[0]).toBeCloseTo(-0.5, 12);
    expect(v.fractions[1]).toBeCloseTo(0, 12);
    expect(v.fractions[2]).toBeCloseTo(0.5, 12);
    expect(v.stageStarts).toHaveLength(1);
    expect(v.stageStarts[0]).toBeGreaterThan(v.zStart);
    // lichte Kanalbreite zwischen den zwei laufenden Sektoren (n = 1 Lamelle) = 30 mm an der Stufenstelle
    expect(vaneValue(s, 1, 2, "channel", v.stageStarts[0])).toBeCloseTo(30, 6);
    expect(v.staggerLimited).toBe(false);
    expect(v.delta).toBeCloseTo(2 * s.alpha2 / 4, 12);
  });

  it("jede Lamelle beginnt auf ihrer Wellenfront bei f·θ, die der Stufen an der Stufenstelle", () => {
    const v = resolveVanes(s, stag());
    v.paths.forEach((p, i) => {
      const z = v.stages[i] ? v.stageStarts[0] : v.zStart, w = wavefrontAtAxis(s, z);
      if (v.stages[i] || !v.atThroat) expect(p[0][0]).toBeCloseTo(w.radius * Math.sin(v.fractions[i] * w.halfAngle), 6);
      if (v.stages[i] || !v.atThroat) expect(p[0][1]).toBeCloseTo(w.zCenter + w.radius * Math.cos(v.fractions[i] * w.halfAngle), 6);
      const end = wavefrontAtAxis(s, v.zEnd);
      expect(p.at(-1)[0]).toBeCloseTo(end.radius * Math.sin(v.fractions[i] * end.halfAngle), 6);
    });
  });

  it("zwei Stufen: 1 → 3 → 7 Lamellen, Stufe 2 bei 35 mm Kanalbreite der vier Sektoren, nach Stufe 1", () => {
    const v = resolveVanes(s, stag({}, { stages: 2, channel: 35 }));
    expect(v.count).toBe(7);
    expect(v.stages).toEqual([2, 1, 2, 0, 2, 1, 2]);
    expect(v.stageStarts).toHaveLength(2);
    expect(v.stageStarts[1]).toBeGreaterThanOrEqual(v.stageStarts[0]);
    expect(vaneValue(s, 1, 2, "channel", v.stageStarts[0])).toBeCloseTo(35, 6);
    expect(vaneValue(s, 3, 2, "channel", v.stageStarts[1])).toBeCloseTo(35, 6);
    for (let i = 1; i < 7; i++) expect(v.fractions[i] - v.fractions[i - 1]).toBeCloseTo(0.25, 12);
  });

  it("mit zwei Lamellen ab dem Beginn: 2 → 5 Lamellen", () => {
    const v = resolveVanes(s, stag({ count: 2 }));
    expect(v.count).toBe(5);
    expect(v.stages).toEqual([1, 0, 1, 0, 1]);
  });

  it("feste Achsenstellen; Stufen nie vor der vorigen, Begrenzung wird gemeldet", () => {
    const v = resolveVanes(s, stag({}, { stages: 2, mode: "z", z: [220, 300] }));
    expect(v.stageStarts).toEqual([220, 300]);
    expect(v.staggerLimited).toBe(false);
    const back = resolveVanes(s, stag({}, { stages: 2, mode: "z", z: [300, 220] }));
    expect(back.stageStarts).toEqual([300, 300]);
    expect(back.staggerLimited).toBe(true);
  });

  it("Stufe zu spät: zu kurze Lamellen entfallen, nur die ab dem Beginn bleiben", () => {
    const late = resolveVanes(s, stag({}, { mode: "z", z: [s.zApex - 2, 0, 0] }));
    expect(late.count).toBe(1);
    expect(late.paths).toHaveLength(1);
    const wide = resolveVanes(s, stag({}, { channel: 5000 }));
    expect(wide.count).toBe(1);
    expect(wide.staggerLimited).toBe(true);
  });

  it("Körper: geschlossen und eben, auch mit Spitzen; Stufenlamellen sind kürzer", () => {
    const v = resolveVanes(s, stag({ tip: { start: true, end: true, length: 8 } }, { stages: 2, channel: 25 }));
    const bodies = vaneBodies(s, airTris(), v, WALL);
    expect(bodies.count).toBe(7);
    for (const f of bodies.surfaces) {
      expect(edgeCheck(f.triangles)).toEqual({ open: 0, flipped: 0 });
      expect(signedVolume(f.triangles)).toBeGreaterThan(0);
    }
    const len = p => p.slice(1).reduce((l, q, k) => l + Math.hypot(q[0] - p[k][0], q[1] - p[k][1]), 0);
    expect(len(v.paths[1])).toBeLessThan(len(v.paths[3]));
    expect(len(v.paths[0])).toBeLessThan(len(v.paths[1]));
  });
});

describe("Gitteransicht: Umriss statt Gitter für Flächen aus fertigen Dreiecken", () => {
  it("Lamellen: je ebener Fläche der Rand, ohne Diagonalen; jede Strecke liegt auf Dreieckskanten des Körpers", () => {
    const v = resolveVanes(s, spec({ count: 2, start: { mode: "z", value: 160 } }));
    const bodies = vaneBodies(s, airTris(), v, WALL);
    for (const f of bodies.surfaces) {
      const lines = gridLines(f);
      expect(lines.length).toBeGreaterThan(0);
      // Rand je ebener Fläche: Vierecke ergeben 4 Strecken, Diagonalen (je 2 Dreiecke) entfallen
      const quads = f.faces.filter(face => face.length === 2).length;
      expect(lines.length).toBeGreaterThanOrEqual(quads * 4);
      expect(lines.length).toBeLessThan(f.triangles.length * 3);
      for (const [p, q] of lines) expect(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])).toBeGreaterThan(0);
    }
  });

  it("ein Dreieck allein: drei Strecken; zwei Dreiecke zu einem Viereck: vier (ohne Diagonale)", () => {
    const A = [0, 0, 0], B = [1, 0, 0], C = [1, 1, 0], D = [0, 1, 0];
    expect(gridLines({ triangles: [[A, B, C]] })).toHaveLength(3);
    expect(gridLines({ triangles: [[A, B, C], [A, C, D]] })).toHaveLength(4);
    expect(gridLines({ faces: [[[A, B, C], [A, C, D]]], triangles: [[A, B, C], [A, C, D]] })).toHaveLength(4);
    expect(gridLines({})).toEqual([]);
  });

  it("meshBuffers liefert für die Lamellen Linien (Sektion lamellen)", async () => {
    const { meshBuffers } = await import("./mesh-buffers.js");
    const out = meshBuffers({ s, rt: RT, hMouth: H_MOUTH, curve: "exponential", hypexT: 0.5, fillet: null, wall: WALL, vanes: resolveVanes(s, spec({ count: 2, start: { mode: "z", value: 160 } })), sections: ["lamellen"] });
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].lines.length).toBeGreaterThan(0);
  });
});

describe("Schale und Volumen mit Lamellen", () => {
  const vanes = resolveVanes(s, spec({ count: 2, start: { mode: "z", value: 0 } }));
  const base = { s, rt: RT, hMouth: H_MOUTH, curve: "exponential", hypexT: 0.5, fillet: null, wall: WALL };

  it("Lamellen stehen als eigene Flächen im Netz (Abschnitt lamellen), der Rest bleibt unverändert", () => {
    const without = buildShellGeometry(s, RT, profile, null, WALL);
    const geo = buildShellGeometry(s, RT, profile, null, WALL, null, 0, null, undefined, vanes);
    const extra = geo.surfaces.filter(f => f.section === "lamellen");
    expect(extra.map(f => f.name)).toEqual(["vane0", "vane1"]);
    expect(geo.surfaces).toHaveLength(without.surfaces.length + 2);
    expect(without.vanes).toBeNull();
    expect(geo.vanes.count).toBe(2);
    expect(geo.surfaces.filter(f => f.section !== "lamellen").flatMap(triangulate)).toEqual(without.surfaces.flatMap(triangulate));
  });

  it("Außenkörper bleibt gleich; die Lamellen verschieben genau ihr Volumen von der Luft in die Schale", () => {
    const a = computeVolumes(base), b = computeVolumes({ ...base, vanes });
    const geo = buildShellGeometry(s, RT, profile, null, WALL, null, 0, null, undefined, vanes);
    expect(b.outer).toBeCloseTo(a.outer, 3);
    expect(a.air - b.air).toBeCloseTo(geo.vanes.cavity, 3);
    expect(b.shell - a.shell).toBeCloseTo(geo.vanes.cavity, 3);
    expect(geo.vanes.cavity).toBeGreaterThan(0);
  });

  it("ohne Lamellen bleibt alles beim Alten", () => {
    const a = computeVolumes(base), b = computeVolumes({ ...base, vanes: null });
    expect(b).toEqual(a);
  });
});
