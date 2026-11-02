/**
 * Rippen und Horn im STEP zu einem Körper vereinen (step-fuse.js) mit OpenCascade als WebAssembly: ein gültiger Körper,
 * Volumen zwischen Horn und Summe, ohne Rippen keine Änderung, defekte Eingabe wirft.
 */
import { describe, it, expect, beforeAll } from "vitest";
import initOC from "replicad-opencascadejs";
import { solveHorn, makeProfile } from "../horn-math.js";
import { flangeLayout } from "../horn-mesh.js";
import { hornStep } from "./step.js";
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
