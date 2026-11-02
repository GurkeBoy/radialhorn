/**
 * Stützrippen und Horn im STEP zu einem Körper vereinen (boolesche Vereinigung mit OpenCascade).
 *
 * hornStep schreibt das Horn und jede Rippe als eigenen geschlossenen Körper; die Rippen stecken ein Stück in Platte
 * und Wand. Hier werden die Körper eingelesen, zum größten (dem Horn) vereinigt, gleiche Flächen zusammengefasst und
 * wieder als STEP geschrieben. Der CAD-Kern ist OpenCascade als WebAssembly (replicad-opencascadejs, LGPL-2.1); das
 * Laden übernimmt der Aufrufer (Worker im Browser, direkt in Node), damit dieses Modul keinen Wasm-Import braucht.
 */

/** Rauminhalt [mm³] einer Form. */
function volumeOf(oc, shape) {
  const props = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
  const v = props.Mass();
  props.delete();
  return v;
}

/** Alle Teilformen eines Typs (z. B. Körper) einer Form. */
function partsOf(oc, shape, type) {
  const parts = [];
  const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum[type], oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; explorer.More(); explorer.Next()) parts.push(explorer.Current());
  explorer.delete();
  return parts;
}

/**
 * Vereint alle Körper eines STEP-Texts zum größten.
 *
 * @param oc        initialisiertes OpenCascade (Aufruf der Fabrik aus replicad-opencascadejs)
 * @param stepText  STEP-Datei als Text (hornStep)
 * @param fileName  Dateiname für den STEP-Kopf (OpenCascade schreibt sonst den Namen der internen Datei)
 * @returns {{ step: string, bodies: number, volume: number }}
 *   bodies: Zahl der Körper vorher (< 2: nichts zu vereinen, step ist dann stepText); volume: Rauminhalt nachher [mm³]
 * @throws wenn die Vereinigung fehlschlägt oder nicht genau einen Körper ergibt
 */
export function fuseStepBodies(oc, stepText, fileName = "horn.step") {
  oc.FS.writeFile("/in.step", stepText);
  const reader = new oc.STEPControl_Reader();
  try {
    if (reader.ReadFile("/in.step") !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error("STEP-Datei nicht lesbar");
    reader.TransferRoots(new oc.Message_ProgressRange());
    const solids = partsOf(oc, reader.OneShape(), "TopAbs_SOLID").map(s => oc.TopoDS.Solid(s));
    if (solids.length < 2) return { step: stepText, bodies: solids.length, volume: solids.length ? volumeOf(oc, solids[0]) : 0 };

    const volumes = solids.map(s => volumeOf(oc, s));
    const base = volumes.indexOf(Math.max(...volumes));
    let fused = solids[base];
    solids.forEach((tool, i) => {
      if (i === base) return;
      const op = new oc.BRepAlgoAPI_Fuse(fused, tool, new oc.Message_ProgressRange());
      if (!op.IsDone() || op.HasErrors()) throw new Error(`Vereinigung von Körper ${i + 1} fehlgeschlagen`);
      fused = op.Shape();
    });
    const unify = new oc.ShapeUpgrade_UnifySameDomain(fused, true, true, true);
    unify.Build();
    const result = unify.Shape();

    const out = partsOf(oc, result, "TopAbs_SOLID");
    if (out.length !== 1) throw new Error(`Vereinigung ergibt ${out.length} Körper statt einem`);
    const volume = volumeOf(oc, result);
    // die Rippen stecken zum Teil im Horn: das Ergebnis ist größer als das Horn, aber kleiner als die Summe
    if (!(volume > volumes[base] * (1 - 1e-6) && volume < volumes.reduce((a, b) => a + b, 0))) {
      throw new Error(`Vereinigung ergibt ein unplausibles Volumen (${Math.round(volume)} mm³)`);
    }

    const writer = new oc.STEPControl_Writer();
    const status = writer.Transfer(result, oc.STEPControl_StepModelType.STEPControl_AsIs, true, new oc.Message_ProgressRange());
    if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone || writer.Write("/out.step") !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) {
      throw new Error("STEP nicht schreibbar");
    }
    const text = new TextDecoder().decode(oc.FS.readFile("/out.step"));
    // Kopf: Dateiname wie beim ungeteilten Export (erste Zeichenkette in FILE_NAME)
    const step = text.replace(/FILE_NAME\('[^']*'/, `FILE_NAME('${fileName.replace(/'/g, "''")}'`);
    return { step, bodies: solids.length, volume };
  } finally {
    reader.delete();
    for (const f of ["/in.step", "/out.step"]) { try { oc.FS.unlink(f); } catch { /* nicht angelegt */ } }
  }
}
