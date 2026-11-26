/**
 * Rippen und Horn im STEP zu einem Körper vereinen (step-fuse.js) mit OpenCascade als WebAssembly: ein gültiger Körper,
 * Volumen zwischen Horn und Summe, ohne Rippen keine Änderung, defekte Eingabe wirft.
 */
import { describe, it, expect, beforeAll } from "vitest";
import initOC from "replicad-opencascadejs";
import { solveHorn, makeProfile, createHornMath, entrancePoints, linearWallPoints } from "../horn-math.js";
import { flangeLayout } from "../horn-mesh.js";
import { layoutFlange } from "../bodies.js";
import { hornStep } from "./step.js";
import { resolveVanes } from "../vanes.js";
import { computeVolumes } from "../volume.js";
import { fuseStepBodies } from "./step-fuse.js";

const RT = 25.4, H = 200, WALL = 12;
const FLANGE = { diameter: null, fallback: 120, thickness: 10, holes: { count: 4, circle: 101.6, diameter: 6.6, angle: 0 } };

const stepOf = (flange) => {
  const s = solveHorn(500, 60, RT, 120, 100), profile = makeProfile(s, RT, H, "exponential", 0.5);
  const layout = flangeLayout(s, RT, profile, null, WALL, { ...FLANGE, ...flange }, 0, null);
  return hornStep({ s, rt: RT, profile, fillet: null, wall: WALL, edgeR: 0, morph: null, flange: layout }, { fileName: "test.step" });
};

let oc;
beforeAll(async () => { oc = await initOC(); });

/** Körper und Rauminhalte einer STEP-Datei, gelesen mit OpenCascade. */
function bodiesOf(step) {
  oc.FS.writeFile("/check.step", step);
  const reader = new oc.STEPControl_Reader();
  reader.ReadFile("/check.step");
  reader.TransferRoots(new oc.Message_ProgressRange());
  const shape = reader.OneShape(), volumes = [];
  const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; explorer.More(); explorer.Next()) {
    const solid = explorer.Current(), props = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(solid, props, false, false, false);
    volumes.push(props.Mass());
  }
  const valid = new oc.BRepCheck_Analyzer(shape, true, false).IsValid();
  oc.FS.unlink("/check.step");
  return { volumes, valid };
}

describe("STEP des runden Horns in OpenCascade", () => {
  const s = { ...createHornMath(70).solveHorn(500, 60, RT, 0, 0), round: true };
  const design = (wall, flange = null) => ({ s, rt: RT, profile: null, fillet: null, wall, edgeR: 0, morph: null, flange });

  it("Luftvolumen: ein gültiger Körper, Rauminhalt = Rotation des Profils (Flächen exakt, nicht facettiert)", () => {
    const { volumes, valid } = bodiesOf(hornStep(design(0), { fileName: "rund.step" }));
    expect(valid).toBe(true);
    expect(volumes).toHaveLength(1);
    const pts = [...entrancePoints(s, 4000, 4000), ...linearWallPoints(s, 4000)].filter((p, i, a) => i === 0 || p[1] > a[i - 1][1]);
    let wall = 0;
    for (let i = 1; i < pts.length; i++) wall += Math.PI * (pts[i][0] ** 2 + pts[i][0] * pts[i - 1][0] + pts[i - 1][0] ** 2) / 3 * (pts[i][1] - pts[i - 1][1]);
    const h = s.zApex - s.zMouth, a = s.xMouth;
    expect(volumes[0] / (wall + Math.PI * h * (3 * a * a + h * h) / 6)).toBeCloseTo(1, 4);
  });

  it("Schale: ein gültiger Körper; mit Flansch und Rippen Horn + 4 Rippen, vereint zu einem", () => {
    expect(bodiesOf(hornStep(design(12), { fileName: "s.step" }))).toMatchObject({ valid: true, volumes: [expect.any(Number)] });
    const flange = layoutFlange(s, RT, null, null, 12, { ...FLANGE, ribs: { thickness: 4, length: 30 } }, 0, null);
    const step = hornStep(design(12, flange), { fileName: "f.step" });
    expect(bodiesOf(step).volumes).toHaveLength(1 + flange.holes.count);
    const { step: fused } = fuseStepBodies(oc, step, "f.step");
    expect(bodiesOf(fused)).toMatchObject({ valid: true, volumes: [expect.any(Number)] });
  });
}, 180000);   // STEP bauen, einlesen und vereinen: ≈ 10 s, auf einem ausgelasteten Rechner ein Vielfaches

describe("fuseStepBodies", () => {
  it("vereint Horn und vier Rippen zu einem gültigen Körper; Volumen zwischen Horn und Summe", () => {
    const step = stepOf({ ribs: { thickness: 4, length: 30 } });
    const before = bodiesOf(step);
    expect(before.volumes).toHaveLength(5);                                   // Horn + 4 Rippen
    const horn = Math.max(...before.volumes), sum = before.volumes.reduce((a, b) => a + b, 0);

    const { step: fused, bodies, volume } = fuseStepBodies(oc, step, "vereint.step");
    expect(bodies).toBe(5);
    const after = bodiesOf(fused);
    expect(after.volumes).toHaveLength(1);
    expect(after.valid).toBe(true);
    expect(after.volumes[0] / volume).toBeCloseTo(1, 9);                      // beim Einlesen bis auf Rundung gleich
    expect(volume).toBeGreaterThan(horn);                                     // Rippen ragen aus der Wand
    expect(volume).toBeLessThan(sum);                                         // …und stecken zum Teil darin
    expect(fused).toMatch(/FILE_NAME\('vereint\.step'/);
  });

  it("Lamellen: Horn und drei Lamellen werden zu einem gültigen Körper vereint, Volumen = Schale plus Lamellen im Luftkanal", () => {
    const s = solveHorn(500, 60, RT, 120, 100), profile = makeProfile(s, RT, H, "exponential", 0.5);
    const vanes = resolveVanes(s, { count: 3, thickness: 2, start: { mode: "z", value: 160 }, end: { mode: "mouth", value: 0 } });
    const step = hornStep({ s, rt: RT, profile, fillet: null, wall: WALL, edgeR: 0, morph: null, flange: null, vanes }, { fileName: "l.step" });
    const before = bodiesOf(step);
    expect(before.volumes).toHaveLength(4);
    const { step: fused, volume } = fuseStepBodies(oc, step, "l.step");
    const after = bodiesOf(fused);
    expect(after.volumes).toHaveLength(1);
    expect(after.valid).toBe(true);
    // das Netz rechnet die Schale mit Lamellen; STEP hat glatte Flächen statt Facetten: wenige Promille Abstand
    const mesh = computeVolumes({ s, rt: RT, hMouth: H, curve: "exponential", hypexT: 0.5, fillet: null, wall: WALL, vanes });
    expect(volume / mesh.shell).toBeCloseTo(1, 2);
  });

  it("Lamellen ab dem Throat (gekrümmt im Eingang): ein gültiger Körper nach dem Vereinen, Volumen wie das Netz", () => {
    const s = solveHorn(500, 60, RT, 120, 100), profile = makeProfile(s, RT, H, "exponential", 0.5);
    const vanes = resolveVanes(s, { count: 3, thickness: 2, start: { mode: "z", value: 0 }, end: { mode: "mouth", value: 0 } });
    const step = hornStep({ s, rt: RT, profile, fillet: null, wall: WALL, edgeR: 0, morph: null, flange: null, vanes }, { fileName: "t.step" });
    expect(bodiesOf(step).volumes).toHaveLength(4);
    const { step: fused, volume } = fuseStepBodies(oc, step, "t.step");
    const after = bodiesOf(fused);
    expect(after.volumes).toHaveLength(1);
    expect(after.valid).toBe(true);
    const mesh = computeVolumes({ s, rt: RT, hMouth: H, curve: "exponential", hypexT: 0.5, fillet: null, wall: WALL, vanes });
    expect(volume / mesh.shell).toBeCloseTo(1, 2);
  });

  it("Lamellen mit Spitzen an beiden Enden: ein gültiger Körper nach dem Vereinen, Volumen wie das Netz", () => {
    const s = solveHorn(500, 60, RT, 120, 100), profile = makeProfile(s, RT, H, "exponential", 0.5);
    const vanes = resolveVanes(s, { count: 3, thickness: 2, start: { mode: "z", value: 0 }, end: { mode: "mouth", value: 0 }, tip: { start: true, end: true, length: 12 } });
    const step = hornStep({ s, rt: RT, profile, fillet: null, wall: WALL, edgeR: 0, morph: null, flange: null, vanes }, { fileName: "t.step" });
    const { step: fused, volume } = fuseStepBodies(oc, step, "t.step");
    const after = bodiesOf(fused);
    expect(after.volumes).toHaveLength(1);
    expect(after.valid).toBe(true);
    const mesh = computeVolumes({ s, rt: RT, hMouth: H, curve: "exponential", hypexT: 0.5, fillet: null, wall: WALL, vanes });
    expect(volume / mesh.shell).toBeCloseTo(1, 2);
  });

  it("gestaffelte Lamellen (1 → 3 → 7) mit Spitzen: ein gültiger Körper nach dem Vereinen, Volumen wie das Netz", () => {
    const s = solveHorn(500, 60, RT, 120, 100), profile = makeProfile(s, RT, H, "exponential", 0.5);
    const vanes = resolveVanes(s, { count: 1, thickness: 2, start: { mode: "z", value: 0 }, end: { mode: "mouth", value: 0 }, tip: { start: true, end: true, length: 10 }, stagger: { stages: 2, mode: "channel", channel: 35, z: [] } });
    expect(vanes.count).toBe(7);
    const step = hornStep({ s, rt: RT, profile, fillet: null, wall: WALL, edgeR: 0, morph: null, flange: null, vanes }, { fileName: "t.step" });
    const { step: fused, volume } = fuseStepBodies(oc, step, "t.step");
    const after = bodiesOf(fused);
    expect(after.volumes).toHaveLength(1);
    expect(after.valid).toBe(true);
    const mesh = computeVolumes({ s, rt: RT, hMouth: H, curve: "exponential", hypexT: 0.5, fillet: null, wall: WALL, vanes });
    expect(volume / mesh.shell).toBeCloseTo(1, 2);
  });

  it("ohne Rippen: ein Körper bleibt unverändert", () => {
    const step = stepOf({});
    const result = fuseStepBodies(oc, step);
    expect(result.bodies).toBe(1);
    expect(result.step).toBe(step);
  });

  it("wirft bei einer Datei, die kein STEP ist", () => {
    expect(() => fuseStepBodies(oc, "kein STEP")).toThrow();
  });
}, 120000);
