/**
 * Lamellen: Auflösung (Winkel, Beginn und Ende nach z, Hornbreite oder Kanalbreite), Körper (geschlossen, im Luftkanal
 * gemessen) und ihr Einfluss auf Volumen und Netz.
 */
import { describe, it, expect } from "vitest";
import { solveHorn, makeProfile, computeFillet, throatMorph, mouthRounding } from "./horn-math.js";
import { buildShellGeometry, triangulate } from "./horn-mesh.js";
import { buildAir } from "./bodies.js";
import { computeVolumes } from "./volume.js";
import { resolveVanes, vaneBodies, vaneRadius, vaneValue, vaneRanges, airTriangles, VANE_SAMPLES } from "./vanes.js";
import { edgeCheck, signedVolume } from "./test-helpers.js";

const RT = 25.4, H_MOUTH = 200, WALL = 6;
const s = solveHorn(500, 60, RT, 182, 90);
const profile = makeProfile(s, RT, H_MOUTH, "exponential", 0.5);
const spec = (over = {}) => ({ count: 2, thickness: 2, start: { mode: "z", value: 200 }, end: { mode: "mouth", value: 0 }, ...over });
const airTris = (sol = s, prof = profile, fillet = null, morph = null) => airTriangles(buildAir(sol, RT, prof, fillet, morph).surfaces);

describe("resolveVanes: Anzahl, Winkel, Grenzen", () => {
  it("keine Lamellen ohne Anzahl, ohne Dicke und beim runden Horn", () => {
    expect(resolveVanes(s, spec({ count: 0 }))).toBeNull();
    expect(resolveVanes(s, spec({ thickness: 0 }))).toBeNull();
    expect(resolveVanes({ ...s, round: true }, spec())).toBeNull();
    expect(resolveVanes(null, spec())).toBeNull();
  });

  it("n Lamellen teilen den Öffnungswinkel in n + 1 gleich breite Sektoren, symmetrisch zur Achse", () => {
    for (const n of [1, 2, 3, 5]) {
      const v = resolveVanes(s, spec({ count: n }));
      expect(v.phis).toHaveLength(n);
      const edges = [-s.alpha2, ...v.phis, s.alpha2];
      for (let i = 1; i < edges.length; i++) expect(edges[i] - edges[i - 1]).toBeCloseTo(2 * s.alpha2 / (n + 1), 12);
      v.phis.forEach((phi, i) => expect(phi).toBeCloseTo(-v.phis[n - 1 - i], 12));
    }
    expect(resolveVanes(s, spec({ count: 1 })).phis[0]).toBeCloseTo(0, 12);
  });

  it("Beginn nach z: die Wellenfront schneidet die Achse dort; nie vor dem Ende des Eingangs, nie hinter dem Mund", () => {
    const v = resolveVanes(s, spec({ start: { mode: "z", value: 200 } }));
    expect(v.zStart).toBeCloseTo(200, 9);
    expect(v.rStart).toBeCloseTo(200 - s.zFocus, 9);
    expect(v.startLimited).toBe(false);
    const early = resolveVanes(s, spec({ start: { mode: "z", value: 1 } }));
    expect(early.rStart).toBeCloseTo(s.rInner, 9);
    expect(early.startLimited).toBe(true);
    const late = resolveVanes(s, spec({ start: { mode: "z", value: 5000 } }));
    expect(late.rStart).toBeCloseTo(s.arcR, 9);
    expect(late.ok).toBe(false);
  });

  it("Ende am Mund, nach z oder bei einer Kanalbreite", () => {
    expect(resolveVanes(s, spec()).rEnd).toBeCloseTo(s.arcR, 9);
    const z = resolveVanes(s, spec({ end: { mode: "z", value: 250 } }));
    expect(z.zEnd).toBeCloseTo(250, 9);
    const ch = resolveVanes(s, spec({ end: { mode: "channel", value: 100 } }));
    expect(ch.channelEnd).toBeCloseTo(100, 9);
    expect(ch.endLimited).toBe(false);
    // so breit wird der Kanal nie: Ende am Mund
    expect(resolveVanes(s, spec({ end: { mode: "channel", value: 1e6 } })).rEnd).toBeCloseTo(s.arcR, 9);
  });

  it("Beginn bei einer Hornbreite bzw. Kanalbreite: die Maße stimmen mit den Angaben überein", () => {
    const w = resolveVanes(s, spec({ start: { mode: "width", value: 300 } }));
    expect(w.widthStart).toBeCloseTo(300, 9);
    const c = resolveVanes(s, spec({ start: { mode: "channel", value: 60 } }));
    expect(c.channelStart).toBeCloseTo(60, 9);
    // Sehne zwischen den Wänden am Mund = 2·xMouth
    expect(resolveVanes(s, spec()).widthEnd).toBeCloseTo(2 * s.xMouth, 6);
  });

  it("lichte Kanalbreite: nie weniger als 1 mm am Beginn, auch bei vielen dicken Lamellen", () => {
    const v = resolveVanes(s, spec({ count: 9, thickness: 8, start: { mode: "z", value: 1 } }));
    expect(v.channelStart).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(v.startLimited).toBe(true);
  });

  it("vaneRadius und vaneValue sind Umkehrungen; die Bereiche reichen vom Ende des Eingangs bis zum Mund", () => {
    for (const mode of ["z", "width", "channel"]) {
      const r = 260;
      expect(vaneRadius(s, 3, 2, mode, vaneValue(s, 3, 2, mode, r))).toBeCloseTo(r, 9);
    }
    const ranges = vaneRanges(s, 2, 2);
    expect(ranges.z[0]).toBeCloseTo(s.zFocus + s.rInner, 6);
    expect(ranges.z[1]).toBeCloseTo(s.zApex, 6);
    expect(ranges.width[1]).toBeCloseTo(2 * s.xMouth, 6);
  });
});

describe("vaneBodies: Körper", () => {
  const vanes = resolveVanes(s, spec({ count: 3, start: { mode: "z", value: 160 } }));
  const bodies = vaneBodies(s, airTris(), vanes, WALL);

  it("je Lamelle ein geschlossener, einheitlich orientierter Körper mit positivem Volumen", () => {
    expect(bodies.count).toBe(3);
    for (const f of bodies.surfaces) {
      expect(edgeCheck(f.triangles)).toEqual({ open: 0, flipped: 0 });
      expect(signedVolume(f.triangles)).toBeGreaterThan(0);
      // ebene Flächen für STEP: jede für sich eben (keine Randpunkte außerhalb der Fläche)
      expect(f.faces.flat()).toHaveLength(f.triangles.length);
    }
  });

  it("Volumen = Dicke × Fläche in (r, h); Überlapp = Dicke × 2e × Länge; Luftanteil = Differenz", () => {
    const e = Math.min(3, 0.4 * WALL), length = vanes.rEnd - vanes.rStart;
    expect(bodies.overlap).toBeCloseTo(3 * vanes.thickness * 2 * e * length, 6);
    // Fläche des Luftkanals in (r, h): ∫ 2·h(r) dr mit dem Profil – das Netz weicht nur um die Facetten ab
    let area = 0;
    const K = 4000;
    for (let k = 0; k < K; k++) area += 2 * profile(s.zFocus + vanes.rStart + (k + 0.5) * length / K) * length / K;
    expect(bodies.cavity / (3 * vanes.thickness * area)).toBeCloseTo(1, 2);
    const total = bodies.surfaces.reduce((v, f) => v + signedVolume(f.triangles), 0);
    expect(total - bodies.overlap).toBeCloseTo(bodies.cavity, 4);
  });

  it("jede Lamelle liegt in ihrer Ebene durch den Fokus, ihre Dicke steht senkrecht dazu", () => {
    bodies.surfaces.forEach((f, i) => {
      const phi = vanes.phis[i], c = Math.cos(phi), sn = Math.sin(phi);
      for (const [x, , z] of f.triangles.flat()) {
        const side = x * c - (z - s.zFocus) * sn;   // Abstand zur Mittelebene
        expect(Math.abs(side)).toBeLessThanOrEqual(vanes.thickness / 2 + 1e-9);
        const r = x * sn + (z - s.zFocus) * c;
        expect(r).toBeGreaterThanOrEqual(vanes.rStart - 1e-6);
        expect(r).toBeLessThanOrEqual(s.arcR + 1e-6);
      }
    });
  });

  it("Höhe folgt dem Luftkanal: oben und unten genau e in die Wand, nie bis an die Außenfläche", () => {
    const e = Math.min(3, 0.4 * WALL);
    expect(e).toBeLessThan(WALL);
    const f = bodies.surfaces[1], phi = vanes.phis[1];
    const hs = f.triangles.flat().map(p => ({ r: p[0] * Math.sin(phi) + (p[2] - s.zFocus) * Math.cos(phi), h: p[1] }));
    for (const { r, h } of hs) expect(Math.abs(h)).toBeLessThanOrEqual(profile(s.zFocus + r) + e + 0.05);
    // Mitte der Lamelle: höchster Punkt bei r = Mitte ≈ Profil + e
    const mid = (vanes.rStart + vanes.rEnd) / 2;
    const near = hs.filter(p => Math.abs(p.r - mid) < 6).map(p => p.h);
    expect(Math.max(...near)).toBeGreaterThan(profile(s.zFocus + mid) + e - 0.5);
  });

  it("ohne Wandstärke oder mit unlösbarer Länge keine Körper", () => {
    expect(vaneBodies(s, airTris(), vanes, 0).count).toBe(0);
    expect(vaneBodies(s, airTris(), { ...vanes, ok: false }, WALL).count).toBe(0);
    expect(vaneBodies(s, airTris(), null, WALL).count).toBe(0);
  });

  it("auch mit Verrundung, rundem Throat und gerundeten Mundecken geschlossen", () => {
    const fillet = computeFillet(s, RT, H_MOUTH, "exponential", 0.5, 100);
    const prof = makeProfile(s, RT, H_MOUTH, "exponential", 0.5, fillet);
    const throat = throatMorph(s, RT, null);
    const morph = mouthRounding(s, prof, throat, 40);
    const v = resolveVanes(s, spec({ count: 4, start: { mode: "z", value: 150 } }));
    const b = vaneBodies(s, airTris(s, prof, fillet, morph), v, WALL);
    expect(b.count).toBe(4);
    for (const f of b.surfaces) expect(edgeCheck(f.triangles)).toEqual({ open: 0, flipped: 0 });
  });
});

describe("Schale und Volumen mit Lamellen", () => {
  const vanes = resolveVanes(s, spec({ count: 2, start: { mode: "z", value: 160 } }));
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
