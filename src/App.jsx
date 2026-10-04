// Radialhorn-Konfigurator: Parameter in der Seitenleiste, Draufsicht und Seitenriss rechts.
import { memo, useEffect, useMemo, useState } from "react";
import {
  createHornMath, hasTraktrix, CURVES, computeFillet, makeProfile,
  mouthArea, verticalMouthAngle, frequencyEstimates,
} from "./horn-math.js";
import { FONT, SIDEBAR_WIDTH, UI } from "./theme.js";
import {
  Card, Note, Slider, Toggle, SegmentedButtons, Stat, Warn, FullscreenPanel,
} from "./components/ui.jsx";
import { Draufsicht } from "./components/Draufsicht.jsx";
import { Seitenriss } from "./components/Seitenriss.jsx";
import { Querschnitt } from "./components/Querschnitt.jsx";
import { Ansicht3D } from "./components/Ansicht3D.jsx";
import { Frequenzgang } from "./components/Frequenzgang.jsx";
import { usePersistentState, useThrottledValue } from "./hooks.js";
import { clearSettings } from "./settings.js";
import { exportDXF } from "./export/dxf.js";
import { exportPDF } from "./export/pdf.js";
import { exportSTL } from "./export/stl.js";
import { exportCSV } from "./export/csv.js";
import { flangeLayout } from "./horn-mesh.js";
import {
  airAt, logFrequencies, sampleStep, transverseLimit, areaCurve, simulate, driverSI, PLACEHOLDER_DRIVER,
} from "./simulation.js";

const THROAT_SIZES = [
  { label: '1"',  diameter: 25.4 },
  { label: '1½"', diameter: 38.1 },
  { label: '2"',  diameter: 50.8 },
  { label: '3"',  diameter: 76.2 },
];
const CURVE_LABELS = { linear: "Linear", exponential: "Exponential", hypex: "Hypex" };
const L_MAX = 1200;   // Obergrenze des L-Reglers ohne Raumecke [mm]
const SIM_FREQS = logFrequencies(20, 20000, 24);
const MOUTH_OPTIONS = ["4pi", "2pi", "pi", "pi/2"];
const MOUTH_LABELS = { "4pi": "4π", "2pi": "2π", "pi": "π", "pi/2": "π/2" };
const isPlaceholder = d => Object.keys(PLACEHOLDER_DRIVER).every(k => d[k] === PLACEHOLDER_DRIVER[k]);

const formatHz = f => f >= 1000 ? (f / 1000).toFixed(2) + " k" : f.toFixed(0);

export default function App() {
  const [throatDiam,      setThroatDiam]      = usePersistentState("throatDiam", 50.8);
  const [openingAngle,    setOpeningAngle]    = usePersistentState("openingAngle", 140);
  const [L,               setL]               = usePersistentState("L", 500);
  const [Lt,              setLt]              = usePersistentState("Lt", 60);
  const [dw,              setDw]              = usePersistentState("dw", 182);   // BMS 4591: Ø 182 mm
  const [dh,              setDh]              = usePersistentState("dh", 90);    // BMS 4591: Tiefe 90 mm
  const [hMouth,          setHMouth]          = usePersistentState("hMouth", 200);
  const [curve,           setCurve]           = usePersistentState("curve", "exponential");
  const [hypexT,          setHypexT]          = usePersistentState("hypexT", 0.5);
  const [showRaumecke,    setShowRaumecke]    = usePersistentState("showRaumecke", true);
  const [showWandstaerke, setShowWandstaerke] = usePersistentState("showWandstaerke", false);
  const [wandstaerke,     setWandstaerke]     = usePersistentState("wandstaerke", 20);
  const [filletOn,        setFilletOn]        = usePersistentState("filletOn", false);
  const [filletR,         setFilletR]         = usePersistentState("filletR", 100);
  const [clothoidOn,      setClothoidOn]      = usePersistentState("clothoidOn", false);
  const [clothoidLength,  setClothoidLength]  = usePersistentState("clothoidLength", 30);
  const [edgeOn,          setEdgeOn]          = usePersistentState("edgeOn", false);
  const [edgeR,           setEdgeR]           = usePersistentState("edgeR", null);   // null: Wandstärke
  const [flangeOn,        setFlangeOn]        = usePersistentState("flangeOn", false);
  const [flangeD,         setFlangeD]         = usePersistentState("flangeD", null);   // null: Treiberbreite dw, mind. Schale + Bohrungen
  const [flangeT,         setFlangeT]         = usePersistentState("flangeT", 10);
  const [holeCount,       setHoleCount]       = usePersistentState("holeCount", 4);
  // Bohrbild BMS 4591: 4 × M6 im 90°-Raster auf Ø 101,6 mm (4"), Durchgangsbohrung M6 mittel 6,6 mm
  const [holeCircle,      setHoleCircle]      = usePersistentState("holeCircle", 101.6);   // null: mittig im Flanschring
  const [holeD,           setHoleD]           = usePersistentState("holeD", 6.6);
  const [holeAngle,       setHoleAngle]       = usePersistentState("holeAngle", 0);    // 0°: Bohrungen auf 3, 12, 9, 6 Uhr
  const [exportLayers,    setExportLayers]    = usePersistentState("exportLayers", {
    draufsicht: true, mundbogen: true, fokus: true, seitenprofil: true, uebergang: true, flansch: true, bemassung: true,
  });
  const setLayer = key => on => setExportLayers(layers => ({ ...layers, [key]: on }));
  const [simOn,           setSimOn]           = usePersistentState("simOn", false);
  const [simMouth,        setSimMouth]        = usePersistentState("simMouth", "2pi");
  const [simTemp,         setSimTemp]         = usePersistentState("simTemp", 20);
  const [simPhase,        setSimPhase]        = usePersistentState("simPhase", false);
  const [driver,          setDriver]          = usePersistentState("driver", PLACEHOLDER_DRIVER);
  const setDriverValue = key => v => setDriver(d => ({ ...d, [key]: v }));

  // Regler reagieren sofort; Rechnung und Ansichten folgen gedrosselt (useThrottledValue): beim
  // Ziehen laufend mit dem jeweils neuesten Wert, mit Pausen für die Eingabe dazwischen. Alles
  // Abgeleitete hängt deshalb an p, nicht am Live-Zustand; die Ansichten sind memo und rendern
  // nur, wenn sich p auswirkt.
  const live = useMemo(() => ({
    throatDiam, openingAngle, L, Lt, dw, dh, hMouth, curve, hypexT, showRaumecke, showWandstaerke, wandstaerke,
    filletOn, filletR, clothoidOn, clothoidLength, flangeOn, flangeD, flangeT, holeCount, holeCircle, holeD, holeAngle,
    edgeOn, edgeR, simOn, simMouth, simTemp, driver,
  }), [throatDiam, openingAngle, L, Lt, dw, dh, hMouth, curve, hypexT, showRaumecke, showWandstaerke, wandstaerke,
    filletOn, filletR, clothoidOn, clothoidLength, flangeOn, flangeD, flangeT, holeCount, holeCircle, holeD, holeAngle,
    edgeOn, edgeR, simOn, simMouth, simTemp, driver]);
  const p = useThrottledValue(live);
  const rt = p.throatDiam / 2;

  // Grenzen und Lösung der Draufsicht. Die Grenzsuchen sind teuer (verschachtelte
  // Bisektionen) und hängen nur von diesen Parametern ab.
  const geometry = useMemo(() => {
    const { openingAngle, L, Lt, dw, dh, showRaumecke, showWandstaerke, wandstaerke, clothoidOn, clothoidLength } = p;
    const math = createHornMath(openingAngle, { clothoid: clothoidOn ? clothoidLength : 0 });
    // Wandstärke vergrößert die Außenkante senkrecht zur Wand; ihre Projektion auf die
    // 45°-Raumecke verkleinert den verfügbaren Platz
    const extraBreite = showRaumecke && showWandstaerke
      ? (Math.cos(math.ALPHA2) + Math.sin(math.ALPHA2)) * wandstaerke
      : 0;

    const LtMax         = math.maxLt(L, rt, dw, dh);
    const LtMinRaumecke = showRaumecke ? math.minLtForRaumecke(L, rt, dw, dh, extraBreite) : null;
    const LtMinClothoid = math.minLtForClothoid(rt);
    const LtMin         = Math.max(LtMinRaumecke ?? 0, LtMinClothoid);
    const LtClamped     = Math.min(Math.max(Lt, LtMin), LtMax);
    const LMaxRaumecke  = showRaumecke ? math.maxLforRaumecke(LtClamped, rt, dw, dh, extraBreite) : null;
    const LClamped      = LMaxRaumecke !== null && L > LMaxRaumecke ? LMaxRaumecke : L;

    return {
      s: math.solveHorn(LClamped, LtClamped, rt, dw, dh),
      LtMin, LtMax, LtClamped, LClamped, LMaxRaumecke,
      Lmin: math.minL(LtClamped, rt, dw, dh),
      Lmax: LMaxRaumecke ?? L_MAX,
      warnings: {
        raumecke: showRaumecke && LMaxRaumecke !== null && L >= LMaxRaumecke - 1,
        ltMax:    Lt > LtMax,
        ltMin:    showRaumecke && LtMinRaumecke !== null && Lt <= LtMin + 0.5,
        clothoid: LtMinClothoid > LtMax ? "zu lang" : Lt < LtMinClothoid ? "Lt" : null,
      },
      LtMinClothoid,
    };
  }, [p, rt]);

  const { s, LtMin, LtMax, LtClamped, LClamped, LMaxRaumecke, Lmin, Lmax, warnings, LtMinClothoid } = geometry;

  const fillet = useMemo(
    () => p.filletOn ? computeFillet(s, rt, p.hMouth, p.curve, p.hypexT, p.filletR) : null,
    [p.filletOn, s, rt, p.hMouth, p.curve, p.hypexT, p.filletR],
  );
  const profile = useMemo(
    () => s && makeProfile(s, rt, p.hMouth, p.curve, p.hypexT, fillet),
    [s, rt, p.hMouth, p.curve, p.hypexT, fillet],
  );

  const wall = p.showWandstaerke ? p.wandstaerke : 0;
  // gerundete Längskanten außen: Radius höchstens die Wandstärke (sonst würde die Wand an der Ecke dünner)
  const edge = wall > 0 && p.edgeOn ? Math.min(p.edgeR ?? wall, wall) : 0;
  // Flansch nur an der Schale; Ø und Lochkreis werden gegen den Außenkörper aufgelöst
  const flange = useMemo(
    () => s && wall > 0 && p.flangeOn ? flangeLayout(s, rt, profile, fillet, wall, {
      diameter: p.flangeD, fallback: p.dw, thickness: p.flangeT,
      holes: { count: p.holeCount, circle: p.holeCircle, diameter: p.holeD, angle: p.holeAngle },
    }, edge) : null,
    [s, rt, profile, fillet, wall, p.flangeOn, p.flangeD, p.dw, p.flangeT, p.holeCount, p.holeCircle, p.holeD, p.holeAngle, edge],
  );
  // 1D-Simulation (Webster, Transfermatrizen) – nur bei eingeschaltetem Frequenzgang
  const sim = useMemo(() => {
    if (!s || !p.simOn) return null;
    const air = airAt(p.simTemp);
    const curve = areaCurve(s, rt, profile, sampleStep(SIM_FREQS.at(-1), air.c) * 1000);
    return {
      result: simulate({ curve, air, driver: driverSI(p.driver, air.rho), mouth: p.simMouth, freqs: SIM_FREQS }),
      fLimit: transverseLimit(2 * rt / 1000, air.c),
    };
  }, [s, rt, profile, p.simOn, p.simTemp, p.simMouth, p.driver]);

  const flangeOverRaumecke =flange && p.showRaumecke && flange.diameter / 2 > p.dw / 2 + p.dh;
  const design = {
    s, rt, L: LClamped, hMouth: p.hMouth, curve: p.curve, hypexT: p.hypexT, fillet, profile, wall, flange,
    showRaumecke: p.showRaumecke, showWandstaerke: p.showWandstaerke, wandstaerke: p.wandstaerke, edgeR: edge,
  };
  // Während eines Zugs zeigt der Regler den Live-Wert, sonst den (ggf. begrenzten) gerechneten
  const shown = (key, computed) => live[key] !== p[key] ? live[key] : computed;

  return (
    <div style={{ background: UI.bg, height: "100vh", overflow: "hidden", color: UI.text, fontFamily: FONT, display: "flex" }}>

      {/* Seitenleiste */}
      <div style={{ width: SIDEBAR_WIDTH, boxSizing: "border-box", flexShrink: 0, borderRight: `1px solid ${UI.border}`, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column" }}>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: UI.accent, letterSpacing: "0.1em" }}>RADIALHORN</div>
          <div style={{ fontSize: 9, color: UI.faint, letterSpacing: "0.2em", marginTop: 1 }}>KONFIGURATOR · {openingAngle}° · v4</div>
        </div>

        <Card>
          <Toggle label="Raumecke" checked={showRaumecke} onChange={setShowRaumecke} />
          {showRaumecke && <Note style={{ paddingLeft: 46, marginTop: -6, marginBottom: 4 }}>Hornbreite auf Raumecken-Diagonale begrenzt</Note>}
          <Toggle label="Wandstärke" checked={showWandstaerke} onChange={setShowWandstaerke} />
          {showWandstaerke && <Slider label="Wandstärke" value={wandstaerke} min={1} max={100} step={1} unit="mm" onChange={setWandstaerke} />}
          {showWandstaerke && <Toggle label="Kanten verrunden" checked={edgeOn} onChange={setEdgeOn} />}
          {showWandstaerke && edgeOn && <Slider label="Kantenradius" value={Math.min(edgeR ?? wandstaerke, wandstaerke)} min={1} max={wandstaerke} step={1} unit="mm" onChange={setEdgeR} />}
          {showWandstaerke && <Toggle label="Flansch am Throat" checked={flangeOn} onChange={setFlangeOn} />}
        </Card>

        <Card title="THROAT">
          <SegmentedButtons
            options={THROAT_SIZES.map(t => t.diameter)}
            labels={Object.fromEntries(THROAT_SIZES.map(t => [t.diameter, t.label]))}
            value={throatDiam} onChange={setThroatDiam} />
        </Card>

        <Card title="HORNGEOMETRIE">
          <Slider label="Öffnungswinkel" value={openingAngle} min={60} max={160} step={1} unit="°" onChange={setOpeningAngle} />
          <Slider label="Gesamtlänge L" value={shown("L", LClamped)} min={Lmin} max={Lmax} step={5} unit="mm" onChange={setL} />
          {warnings.raumecke && <Warn>⚠ Raumecken-Limit ({LMaxRaumecke.toFixed(0)} mm)</Warn>}
          <Slider label="Traktrix-Länge Lₜ" value={shown("Lt", LtClamped)} min={LtMin} max={LtMax} step={1} unit="mm" onChange={setLt} />
          {warnings.ltMax && <Warn>⚠ Lₜ-Maximum erreicht ({LtMax.toFixed(0)} mm)</Warn>}
          {warnings.ltMin && <Warn>⚠ Lₜ-Minimum (Raumecke: {LtMin.toFixed(0)} mm)</Warn>}
          <Toggle label="Krümmungsstetiger Übergang" checked={clothoidOn} onChange={setClothoidOn} />
          {clothoidOn && <Slider label="Klothoide ℓ" value={clothoidLength} min={1} max={150} step={1} unit="mm" onChange={setClothoidLength} />}
          {clothoidOn && warnings.clothoid === "Lt" && <Warn>⚠ Lₜ für diese Klothoide mind. {LtMinClothoid.toFixed(0)} mm</Warn>}
          {clothoidOn && warnings.clothoid === "zu lang" && <Warn>⚠ Klothoide zu lang für diese Geometrie</Warn>}
        </Card>

        <Card title="TREIBER">
          <Slider label="Breite dw" value={dw} min={10} max={300} step={1} unit="mm" onChange={setDw} />
          <Slider label="Tiefe dh" value={dh} min={10} max={250} step={1} unit="mm" onChange={setDh} />
        </Card>

        <Card title="VERTIKALES PROFIL">
          <Slider label="Mund-Höhe hₘ" value={hMouth} min={Math.ceil(rt * 2)} max={600} step={1} unit="mm" onChange={setHMouth} />
          <Note style={{ letterSpacing: "0.12em", marginBottom: 6, marginTop: 4 }}>Aufweitungskurve</Note>
          <SegmentedButtons options={CURVES} labels={CURVE_LABELS} value={curve} onChange={setCurve} />
          {curve === "hypex" && <Slider label="Hypex T" value={hypexT} min={0} max={2} step={0.05} unit="" onChange={setHypexT} />}
          <Toggle label="Verrundung Übergang" checked={filletOn} onChange={setFilletOn} />
          {filletOn && <Slider label="Radius r" value={filletR} min={1} max={1000} step={1} unit="mm" onChange={setFilletR} />}
          {filletOn && s && !hasTraktrix(s) && <Warn>Verrundung nur mit Traktrix-Eingang (Lₜ &gt; 0)</Warn>}
          {fillet?.limited && <Warn>Radius zu groß – begrenzt auf {fillet.R.toFixed(1)} mm</Warn>}
        </Card>

        {flange && <Card title="FLANSCH">
          <Slider label="Durchmesser" value={shown("flangeD", Math.round(flange.diameter))} min={Math.ceil(flange.minDiameter)} max={400} step={1} unit="mm" onChange={setFlangeD} />
          {flange.limited && <Note style={{ marginTop: -4, marginBottom: 4 }}>mind. {Math.ceil(flange.minDiameter)} mm (umschließt die Schale)</Note>}
          {flangeOverRaumecke && <Warn>⚠ Flansch ragt über die Raumecke</Warn>}
          <Slider label="Dicke" value={flangeT} min={2} max={40} step={1} unit="mm" onChange={setFlangeT} />
          <Slider label="Bohrungen" value={holeCount} min={0} max={12} step={1} unit="" onChange={setHoleCount} />
          {holeCount > 0 && <>
            <Slider label="Lochkreis-Ø" value={shown("holeCircle", flange.holes.circle)} min={Math.ceil(flange.minDiameter / 2)} max={Math.floor(flange.diameter)} step={0.1} unit="mm" onChange={setHoleCircle} />
            <Slider label="Bohrungs-Ø" value={holeD} min={2} max={20} step={0.1} unit="mm" onChange={setHoleD} />
            <Slider label="Winkellage" value={holeAngle} min={0} max={Math.round(360 / holeCount)} step={1} unit="°" onChange={setHoleAngle} />
            {flange.invalidHoles > 0 && <Warn>⚠ {flange.invalidHoles} Bohrung{flange.invalidHoles > 1 ? "en" : ""} im Konflikt mit der Schale (rot markiert, nicht gebohrt)</Warn>}
          </>}
        </Card>}

        <Card title="SIMULATION (1D)">
          <Toggle label="Frequenzgang" checked={simOn} onChange={setSimOn} />
          {simOn && <>
            <Note style={{ letterSpacing: "0.12em", marginBottom: 6 }}>Abstrahlung (Mund)</Note>
            <SegmentedButtons options={MOUTH_OPTIONS} labels={MOUTH_LABELS} value={simMouth} onChange={setSimMouth} />
            {simMouth !== "2pi" && <Note style={{ marginTop: -4, marginBottom: 6 }}>Näherung – exakt ist nur 2π (Kolben in Schallwand)</Note>}
            <Slider label="Lufttemperatur" value={simTemp} min={-10} max={40} step={1} unit="°C" onChange={setSimTemp} />
            <Note style={{ letterSpacing: "0.12em", margin: "8px 0 6px" }}>Treiber (Thiele-Small)</Note>
            {isPlaceholder(driver) && <Note style={{ color: UI.error, marginBottom: 6 }}>Platzhalter, keine echten Treiberdaten</Note>}
            <Slider label="Re"  value={driver.Re}  min={1}    max={16}   step={0.1}  unit="Ω"    onChange={setDriverValue("Re")} />
            <Slider label="Le"  value={driver.Le}  min={0}    max={1}    step={0.01} unit="mH"   onChange={setDriverValue("Le")} />
            <Slider label="Bl"  value={driver.Bl}  min={1}    max={40}   step={0.1}  unit="T·m"  onChange={setDriverValue("Bl")} />
            <SegmentedButtons options={["Mmd", "Mms"]} labels={{ Mmd: "Masse = Mmd", Mms: "Masse = Mms" }} value={driver.massIs} onChange={setDriverValue("massIs")} />
            <Slider label={driver.massIs} value={driver.mass} min={0.1} max={50} step={0.1} unit="g" onChange={setDriverValue("mass")} />
            {driver.massIs === "Mms" && <Note style={{ marginTop: -4, marginBottom: 6 }}>Mmd = Mms − Luftlast (beidseitig 8ρa³/3, Annahme)</Note>}
            <Slider label="Cms" value={driver.Cms} min={1}    max={1000} step={1}    unit="µm/N" onChange={setDriverValue("Cms")} />
            <Slider label="Rms" value={driver.Rms} min={0.01} max={20}   step={0.01} unit="Ns/m" onChange={setDriverValue("Rms")} />
            <Slider label="Sd"  value={driver.Sd}  min={1}    max={500}  step={0.5}  unit="cm²"  onChange={setDriverValue("Sd")} />
            <Slider label="Vtc (Kammer)" value={driver.Vtc} min={0} max={50}   step={0.1} unit="cm³" onChange={setDriverValue("Vtc")} />
            {driver.Vtc > 0 && <Slider label="Atc (Kammer)" value={driver.Atc} min={0} max={200} step={0.5} unit="cm²" onChange={setDriverValue("Atc")} />}
            <Slider label="Vrc (Rückk.)" value={driver.Vrc} min={0} max={2000} step={1}   unit="cm³" onChange={setDriverValue("Vrc")} />
            <Note style={{ marginTop: -2, marginBottom: 6 }}>0 = ohne{driver.Vtc > 0 && driver.Atc === 0 ? "; Atc 0 = Kammer als reine Nachgiebigkeit" : ""}</Note>
            {!isPlaceholder(driver) && <ExportButton onClick={() => setDriver(PLACEHOLDER_DRIVER)}>⟲ Platzhalter-Treiber</ExportButton>}
            <Toggle label="Phase anzeigen" checked={simPhase} onChange={setSimPhase} />
            {sim && <ExportButton onClick={() => exportCSV(sim.result)}>↓ CSV (Frequenzgang)</ExportButton>}
          </>}
        </Card>

        {s && <>
          <KeyFigures s={s} hMouth={p.hMouth} profile={profile} />
          <Frequencies s={s} rt={rt} hMouth={p.hMouth} />
          <Querschnitt s={s} profile={profile} />
          <Card title="EXPORT">
            <Note style={{ marginBottom: 6 }}>DXF — Kurven (mm)</Note>
            <Toggle label="Draufsicht-Wände" checked={exportLayers.draufsicht}   onChange={setLayer("draufsicht")} />
            <Toggle label="Mundbogen"        checked={exportLayers.mundbogen}    onChange={setLayer("mundbogen")} />
            <Toggle label="Fokuspunkt"       checked={exportLayers.fokus}        onChange={setLayer("fokus")} />
            <Toggle label="Seitenprofil"     checked={exportLayers.seitenprofil} onChange={setLayer("seitenprofil")} />
            <Toggle label="Übergangspunkt"   checked={exportLayers.uebergang}    onChange={setLayer("uebergang")} />
            {flange && <Toggle label="Flansch"  checked={exportLayers.flansch}      onChange={setLayer("flansch")} />}
            <Note style={{ margin: "8px 0 6px" }}>PDF — zusätzlich zu Kurven oben</Note>
            <Toggle label="Bemaßungen"       checked={exportLayers.bemassung}    onChange={setLayer("bemassung")} />
            <ExportButton primary onClick={() => exportDXF(design, exportLayers)}>↓ DXF exportieren</ExportButton>
            <ExportButton onClick={() => exportPDF(design, exportLayers)}>↓ PDF (Zeichnungen)</ExportButton>
            <ExportButton onClick={() => exportSTL(design)}>↓ STL (3D, {wall > 0 ? `Schale ${wall} mm${flange ? " + Flansch" : ""}` : "Luftvolumen"})</ExportButton>
          </Card>
        </>}
        <ResetSettingsButton />
      </div>

      {/* Ansichten: oben Draufsicht und 3D, unten Seitenriss über die volle Breite */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 10, gap: 8, overflow: "hidden", minWidth: 0 }}>
        <div style={{ flex: 6, display: "flex", gap: 8, minHeight: 0 }}>
          <ViewPanel flex={1}>
            <Draufsicht s={s} rt={rt} dw={p.dw} dh={p.dh} L={LClamped}
              showRaumecke={p.showRaumecke} showWandstaerke={p.showWandstaerke} wandstaerke={p.wandstaerke} flange={flange} />
          </ViewPanel>
          <ViewPanel flex={1}>
            <Ansicht3D s={s} rt={rt} dw={p.dw} dh={p.dh} hMouth={p.hMouth} curve={p.curve} hypexT={p.hypexT} fillet={fillet} wall={wall} edgeR={edge} flange={flange} showRaumecke={p.showRaumecke} />
          </ViewPanel>
        </div>
        <div style={{ flex: 5, display: "flex", gap: 8, minHeight: 0 }}>
          <ViewPanel flex={1}>
            <Seitenriss s={s} rt={rt} dw={p.dw} dh={p.dh} L={LClamped} hMouth={p.hMouth} profile={profile} fillet={fillet} flange={flange} wall={wall} />
          </ViewPanel>
          {sim && <ViewPanel flex={1}>
            <Frequenzgang result={sim.result} fLimit={sim.fLimit} mouth={p.simMouth} showPhase={simPhase} placeholder={isPlaceholder(p.driver)} />
          </ViewPanel>}
        </div>
      </div>
    </div>
  );
}

function ViewPanel({ flex, children }) {
  return (
    <div style={{ flex, background: UI.panel, borderRadius: 8, border: `1px solid ${UI.border}`, overflow: "hidden", minHeight: 0, minWidth: 0 }}>
      <FullscreenPanel>{children}</FullscreenPanel>
    </div>
  );
}

const KeyFigures = memo(function KeyFigures({ s, hMouth, profile }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
      <Stat label="Mundbreite"    value={(2 * s.xMouth).toFixed(1) + " mm"} />
      <Stat label="Mund-Höhe"     value={hMouth + " mm"} />
      <Stat label="A(Mund)"       value={(mouthArea(s, hMouth) / 1e6).toFixed(4) + " m²"} />
      <Stat label="Bogenlänge"    value={s.arcLen.toFixed(1) + " mm"} />
      <Stat label="Vert. Winkel"  value={verticalMouthAngle(s, profile).toFixed(1) + "°"} />
      <Stat label="Horiz. Winkel" value={s.openingAngle + "°"} />
    </div>
  );
});

const Frequencies = memo(function Frequencies({ s, rt, hMouth }) {
  const { fcLow, fcCut, fcHigh } = frequencyEstimates(s, rt, hMouth);
  return (
    <Card title="FREQUENZEN (NÄHERUNG)">
      <FrequencyRow label="fc_low  — Mund (Umfang=λ)"   value={fcLow} />
      <FrequencyRow label="fc_cut  — Horn-Cutoff"     value={fcCut} />
      <FrequencyRow label="fc_high — Throat (λ=2r)"   value={fcHigh} />
      <Note style={{ fontSize: 8, marginTop: 6, lineHeight: 1.4 }}>
        Bandbreite: {fcLow.toFixed(0)} – {fcHigh >= 1000 ? (fcHigh / 1000).toFixed(1) + "k" : fcHigh.toFixed(0)} Hz
      </Note>
    </Card>
  );
});

function FrequencyRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
      <span style={{ fontSize: 10, color: UI.muted, fontFamily: FONT }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: UI.value, fontFamily: FONT }}>{formatHz(value)} Hz</span>
    </div>
  );
}

/** Gespeicherte Einstellungen löschen und mit den Standardwerten neu starten (zweiter Klick bestätigt). */
function ResetSettingsButton() {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  const reset = () => {
    if (!armed) { setArmed(true); return; }
    clearSettings();
    window.location.reload();
  };
  return <ExportButton onClick={reset}>{armed ? "Wirklich zurücksetzen? Nochmal klicken" : "⟲ Alle Einstellungen zurücksetzen"}</ExportButton>;
}

function ExportButton({ primary, onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      width: "100%", marginTop: primary ? 8 : 6, padding: "7px 0", borderRadius: 5, cursor: "pointer",
      border: `1px solid ${primary ? UI.accent : UI.borderControl}`,
      background: primary ? UI.accentSoft : UI.button,
      color: primary ? UI.accent : UI.muted,
      fontFamily: FONT, fontSize: 11, letterSpacing: "0.05em",
    }}>{children}</button>
  );
}
