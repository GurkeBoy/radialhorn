// Radialhorn-Konfigurator: Parameter in der Seitenleiste, Draufsicht und Seitenriss rechts.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  createHornMath, hasTraktrix, CURVES, computeFillet, makeProfile, throatMorph,
  mouthArea, verticalMouthAngle, frequencyEstimates,
} from "./horn-math.js";
import { FONT, SIDEBAR_WIDTH, UI } from "./theme.js";
import {
  Button, Card, Group, Note, Slider, Toggle, SegmentedButtons, Stat, Warn, FullscreenPanel,
} from "./components/ui.jsx";
import { Draufsicht } from "./components/Draufsicht.jsx";
import { Seitenriss } from "./components/Seitenriss.jsx";
import { Querschnitt } from "./components/Querschnitt.jsx";
import { Ansicht3D } from "./components/Ansicht3D.jsx";
import { Frequenzgang } from "./components/Frequenzgang.jsx";
import { usePersistentState, useThrottledValue, useUndo } from "./hooks.js";
import { LANGUAGES, LanguageContext, detectLanguage, translate } from "./i18n.js";
import { clearSettings } from "./settings.js";
import { DESIGN_DEFAULTS as D, ProjectError, buildProject, parseProject, projectFileName } from "./project.js";
import { downloadFile } from "./export/download.js";
import { version as APP_VERSION } from "../package.json";
import { exportDXF } from "./export/dxf.js";
import { exportPDF } from "./export/pdf.js";
import { exportSTL } from "./export/stl.js";
import { exportCSV } from "./export/csv.js";
import { flangeLayout } from "./horn-mesh.js";
import {
  airAt, logFrequencies, transverseLimit, areaCurve, GEOMETRY_STEP_MM, simulate, driverSI, PLACEHOLDER_DRIVER, hornDelay, phaseWithoutDelay,
} from "./simulation.js";

// Gängige Austrittsdurchmesser von Kompressionstreibern; 1,4" wird mit 35,5 mm angegeben (Herstellerangabe)
const THROAT_SIZES = [
  { label: '1"',          diameter: 25.4 },
  { labelKey: "throat.size14", diameter: 35.5 },
  { label: '2"',          diameter: 50.8 },
];
const THROAT_CUSTOM = "custom";                   // Knopf „Eigene“: Durchmesser frei über den Regler
const THROAT_RANGE = { min: 10, max: 150 };       // [mm]
const L_MAX = 1200;   // Obergrenze des L-Reglers ohne Raumecke [mm]
const SIM_FREQS = logFrequencies(20, 20000, 24);
const MOUTH_OPTIONS = ["auto", "4pi", "2pi", "pi", "pi/2"];
const MOUTH_LABELS = { "4pi": "4π", "2pi": "2π", "pi": "π", "pi/2": "π/2" };
const isPlaceholder = d => Object.keys(PLACEHOLDER_DRIVER).every(k => d[k] === PLACEHOLDER_DRIVER[k]);

const formatHz = f => f >= 1000 ? (f / 1000).toFixed(2) + " k" : f.toFixed(0);

export default function App() {
  const [langSetting, setLang] = usePersistentState("sprache", detectLanguage());
  const lang = langSetting in LANGUAGES ? langSetting : "de";
  const t = useMemo(() => (key, params) => translate(lang, key, params), [lang]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const [throatDiam,      setThroatDiam]      = usePersistentState("throatDiam", D.throatDiam);
  // Eigene Halsgröße: gewählt oder ein gespeicherter Durchmesser, den es als Knopf nicht (mehr) gibt (z. B. früher 3")
  const [throatCustomOn,  setThroatCustomOn]  = usePersistentState("throatCustom", D.throatCustom);
  const throatCustom = throatCustomOn || !THROAT_SIZES.some(th => th.diameter === throatDiam);
  const selectThroat = v => {
    setThroatCustomOn(v === THROAT_CUSTOM);
    if (v !== THROAT_CUSTOM) setThroatDiam(v);
  };
  const [morphOn,         setMorphOn]         = usePersistentState("morphOn", D.morphOn);
  const [morphLength,     setMorphLength]     = usePersistentState("morphLength", D.morphLength);
  const [openingAngle,    setOpeningAngle]    = usePersistentState("openingAngle", D.openingAngle);
  const [L,               setL]               = usePersistentState("L", D.L);
  const [Lt,              setLt]              = usePersistentState("Lt", D.Lt);
  const [dw,              setDw]              = usePersistentState("dw", D.dw);
  const [dh,              setDh]              = usePersistentState("dh", D.dh);
  const [hMouth,          setHMouth]          = usePersistentState("hMouth", D.hMouth);
  const [curve,           setCurve]           = usePersistentState("curve", D.curve);
  const [hypexT,          setHypexT]          = usePersistentState("hypexT", D.hypexT);
  const [showRaumecke,    setShowRaumecke]    = usePersistentState("showRaumecke", D.showRaumecke);
  const [showWandstaerke, setShowWandstaerke] = usePersistentState("showWandstaerke", D.showWandstaerke);
  const [wandstaerke,     setWandstaerke]     = usePersistentState("wandstaerke", D.wandstaerke);
  const [filletOn,        setFilletOn]        = usePersistentState("filletOn", D.filletOn);
  const [filletR,         setFilletR]         = usePersistentState("filletR", D.filletR);
  const [clothoidOn,      setClothoidOn]      = usePersistentState("clothoidOn", D.clothoidOn);
  const [clothoidLength,  setClothoidLength]  = usePersistentState("clothoidLength", D.clothoidLength);
  const [edgeOn,          setEdgeOn]          = usePersistentState("edgeOn", D.edgeOn);
  const [edgeR,           setEdgeR]           = usePersistentState("edgeR", D.edgeR);
  const [flangeOn,        setFlangeOn]        = usePersistentState("flangeOn", D.flangeOn);
  const [flangeD,         setFlangeD]         = usePersistentState("flangeD", D.flangeD);
  const [flangeT,         setFlangeT]         = usePersistentState("flangeT", D.flangeT);
  const [holeCount,       setHoleCount]       = usePersistentState("holeCount", D.holeCount);
  const [holeCircle,      setHoleCircle]      = usePersistentState("holeCircle", D.holeCircle);
  const [holeD,           setHoleD]           = usePersistentState("holeD", D.holeD);
  const [holeAngle,       setHoleAngle]       = usePersistentState("holeAngle", D.holeAngle);
  const [exportLayers,    setExportLayers]    = usePersistentState("exportLayers", {
    draufsicht: true, mundbogen: true, fokus: true, seitenprofil: true, uebergang: true, flansch: true, bemassung: true,
  });
  const setLayer = key => on => setExportLayers(layers => ({ ...layers, [key]: on }));
  const [simOn,           setSimOn]           = usePersistentState("simOn", false);
  // Abstrahlung: "auto" = π in der Raumecke (zwei Wände; Boden/Decke bei Ohrhöhe im Arbeitsbereich
  // zu weit weg), sonst 2π
  const [simMouth,        setSimMouth]        = usePersistentState("abstrahlung", D.abstrahlung);
  const mouth = simMouth === "auto" ? (showRaumecke ? "pi" : "2pi") : simMouth;
  const [simTemp,         setSimTemp]         = usePersistentState("simTemp", D.simTemp);
  const [simPhase,        setSimPhase]        = usePersistentState("simPhase", false);
  const [simNoDelay,      setSimNoDelay]      = usePersistentState("simNoDelay", false);
  const [driver,          setDriver]          = usePersistentState("driver", D.driver);
  const setDriverValue = key => v => setDriver(d => ({ ...d, [key]: v }));

  // Projektdatei (project.js): der Entwurf als Ganzes, Schlüssel wie die gespeicherten Einstellungen
  const designValues = {
    throatDiam, throatCustom: throatCustomOn, morphOn, morphLength, openingAngle, L, Lt, dw, dh, hMouth, curve, hypexT, showRaumecke,
    showWandstaerke, wandstaerke, filletOn, filletR, clothoidOn, clothoidLength, edgeOn, edgeR, flangeOn, flangeD,
    flangeT, holeCount, holeCircle, holeD, holeAngle, abstrahlung: simMouth, simTemp, driver,
  };
  const designSetters = {
    throatDiam: setThroatDiam, throatCustom: setThroatCustomOn, morphOn: setMorphOn, morphLength: setMorphLength,
    openingAngle: setOpeningAngle, L: setL, Lt: setLt,
    dw: setDw, dh: setDh, hMouth: setHMouth, curve: setCurve, hypexT: setHypexT, showRaumecke: setShowRaumecke,
    showWandstaerke: setShowWandstaerke, wandstaerke: setWandstaerke, filletOn: setFilletOn, filletR: setFilletR,
    clothoidOn: setClothoidOn, clothoidLength: setClothoidLength, edgeOn: setEdgeOn, edgeR: setEdgeR,
    flangeOn: setFlangeOn, flangeD: setFlangeD, flangeT: setFlangeT, holeCount: setHoleCount,
    holeCircle: setHoleCircle, holeD: setHoleD, holeAngle: setHoleAngle, abstrahlung: setSimMouth,
    simTemp: setSimTemp, driver: setDriver,
  };
  const applyDesign = design => { for (const [key, value] of Object.entries(design)) designSetters[key](value); };
  // Rückgängig/Wiederherstellen über alle Entwurfswerte (wie die Projektdatei; Ansichten und
  // Anzeige-Schalter nicht). Öffnen einer Projektdatei ist ein Schritt.
  const history = useUndo(designValues, applyDesign);
  const [projectStatus, setProjectStatus] = useState(null);   // { kind: "ok" | "warn" | "error", text }
  useEffect(() => {   // Erfolgsmeldung verschwindet nach ein paar Sekunden, Hinweise und Fehler bleiben
    if (projectStatus?.kind !== "ok") return;
    const timer = setTimeout(() => setProjectStatus(null), 5000);
    return () => clearTimeout(timer);
  }, [projectStatus]);
  const saveProject = () => {
    downloadFile(buildProject(designValues, { appVersion: APP_VERSION }), projectFileName(designValues), "application/json");
    setProjectStatus(null);
  };
  const openProject = async file => {
    try {
      const { design, invalid, missing, newer } = parseProject(await file.text());
      applyDesign(design);
      const replaced = [...invalid, ...missing];
      const notes = [
        newer && t("project.newer"),
        replaced.length > 0 && t(replaced.length === 1 ? "project.defaultsOne" : "project.defaults", { n: replaced.length, keys: replaced.join(", ") }),
      ].filter(Boolean);
      setProjectStatus(notes.length
        ? { kind: "warn", text: [t("project.opened", { name: file.name }), ...notes].join(" ") }
        : { kind: "ok", text: t("project.opened", { name: file.name }) });
    } catch (e) {
      setProjectStatus({ kind: "error", text: t(e instanceof ProjectError ? "project.error." + e.code : "project.error.read") });
    }
  };

  // Regler reagieren sofort; Rechnung und Ansichten folgen gedrosselt (useThrottledValue): beim
  // Ziehen laufend mit dem jeweils neuesten Wert, mit Pausen für die Eingabe dazwischen. Alles
  // Abgeleitete hängt deshalb an p, nicht am Live-Zustand; die Ansichten sind memo und rendern
  // nur, wenn sich p auswirkt.
  const live = useMemo(() => ({
    throatDiam, morphOn, morphLength, openingAngle, L, Lt, dw, dh, hMouth, curve, hypexT, showRaumecke, showWandstaerke, wandstaerke,
    filletOn, filletR, clothoidOn, clothoidLength, flangeOn, flangeD, flangeT, holeCount, holeCircle, holeD, holeAngle,
    edgeOn, edgeR, simOn, mouth, simTemp, driver,
  }), [throatDiam, morphOn, morphLength, openingAngle, L, Lt, dw, dh, hMouth, curve, hypexT, showRaumecke, showWandstaerke, wandstaerke,
    filletOn, filletR, clothoidOn, clothoidLength, flangeOn, flangeD, flangeT, holeCount, holeCircle, holeD, holeAngle,
    edgeOn, edgeR, simOn, mouth, simTemp, driver]);
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
  // Übergang rund → eckig am Throat (Eckradius entlang der Wand), auf das Machbare begrenzt
  const morph = useMemo(
    () => p.morphOn && s ? throatMorph(s, rt, p.morphLength) : null,
    [p.morphOn, p.morphLength, s, rt],
  );

  const wall = p.showWandstaerke ? p.wandstaerke : 0;
  // gerundete Längskanten außen: Radius höchstens die Wandstärke (sonst würde die Wand an der Ecke dünner)
  const edge = wall > 0 && p.edgeOn ? Math.min(p.edgeR ?? wall, wall) : 0;
  // Flansch nur an der Schale; Ø und Lochkreis werden gegen den Außenkörper aufgelöst
  const flange = useMemo(
    () => s && wall > 0 && p.flangeOn ? flangeLayout(s, rt, profile, fillet, wall, {
      diameter: p.flangeD, fallback: p.dw, thickness: p.flangeT,
      holes: { count: p.holeCount, circle: p.holeCircle, diameter: p.holeD, angle: p.holeAngle },
    }, edge, morph) : null,
    [s, rt, profile, fillet, wall, p.flangeOn, p.flangeD, p.dw, p.flangeT, p.holeCount, p.holeCircle, p.holeD, p.holeAngle, edge, morph],
  );
  // 1D-Simulation (Webster, Transfermatrizen) – nur bei eingeschaltetem Frequenzgang. S(x) hängt
  // nur an der Geometrie: Treiber, Abstrahlung und Temperatur rechnen nur die Kette neu.
  const areaCurveSI = useMemo(() => s && p.simOn ? areaCurve(s, rt, profile, GEOMETRY_STEP_MM, morph) : null, [s, rt, profile, morph, p.simOn]);
  const sim = useMemo(() => {
    if (!areaCurveSI) return null;
    const air = airAt(p.simTemp), driverSi = driverSI(p.driver, air.rho);
    const delay = hornDelay(areaCurveSI, air, driverSi);
    return {
      result: simulate({ curve: areaCurveSI, air, driver: driverSi, mouth: p.mouth, freqs: SIM_FREQS }),
      fLimit: transverseLimit(2 * rt / 1000, air.c),
      delay, delayPath: delay * air.c,
    };
  }, [areaCurveSI, rt, p.simTemp, p.mouth, p.driver]);
  // Angezeigtes (und als CSV exportiertes) Ergebnis: Phase wahlweise ohne die Laufzeit durch Kammer und Horn
  const simResult = useMemo(() => sim && (simNoDelay
    ? { ...sim.result, phase: phaseWithoutDelay(sim.result.f, sim.result.phase, sim.delay) }
    : sim.result), [sim, simNoDelay]);

  const flangeOverRaumecke = flange && p.showRaumecke && flange.diameter / 2 > p.dw / 2 + p.dh;
  const design = {
    s, rt, L: LClamped, hMouth: p.hMouth, curve: p.curve, hypexT: p.hypexT, fillet, profile, wall, flange,
    showRaumecke: p.showRaumecke, showWandstaerke: p.showWandstaerke, wandstaerke: p.wandstaerke, edgeR: edge, morph,
  };
  // Während eines Zugs zeigt der Regler den Live-Wert, sonst den (ggf. begrenzten) gerechneten
  const shown = (key, computed) => live[key] !== p[key] ? live[key] : computed;

  return (
    <LanguageContext.Provider value={lang}>
    <div style={{ background: UI.bg, height: "100vh", overflow: "hidden", color: UI.text, fontFamily: FONT, display: "flex" }}>

      {/* Seitenleiste */}
      <div style={{ width: SIDEBAR_WIDTH, boxSizing: "border-box", flexShrink: 0, borderRight: `1px solid ${UI.border}`, overflowY: "auto", padding: "14px 12px 12px 14px" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 14, padding: "0 2px" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 500, color: UI.accent, letterSpacing: "0.1em" }}>RADIALHORN</div>
            <div style={{ fontSize: 10, color: UI.faint, letterSpacing: "0.12em", marginTop: 2 }}>{t("app.subtitle")}</div>
          </div>
          <LanguageSwitch value={lang} onChange={setLang} label={t("app.language")} />
        </div>
        <ProjectButtons onOpen={openProject} onSave={saveProject} status={projectStatus} history={history} t={t} />

        <Card title={t("card.throat")} id="throat">
          <SegmentedButtons
            options={[...THROAT_SIZES.map(th => th.diameter), THROAT_CUSTOM]}
            labels={{ ...Object.fromEntries(THROAT_SIZES.map(th => [th.diameter, th.labelKey ? t(th.labelKey) : th.label])), [THROAT_CUSTOM]: t("throat.custom") }}
            value={throatCustom ? THROAT_CUSTOM : throatDiam} onChange={selectThroat} />
          {throatCustom && <Slider label={t("throat.diameter")} value={throatDiam} min={THROAT_RANGE.min} max={THROAT_RANGE.max} step={0.1} unit="mm" onChange={setThroatDiam} />}
          <Toggle label={t("throat.morph")} checked={morphOn} onChange={setMorphOn} hint={morphOn ? t("throat.morphHint") : null} />
          {morphOn && morph && <Slider label={t("throat.morphLength")} value={shown("morphLength", morph.length)} min={1} max={Math.max(1, Math.floor(morph.max))} step={1} unit="mm" onChange={setMorphLength} />}
          {morphOn && morph?.limited && <Warn>{t("warn.morphLimited", { mm: morph.length.toFixed(0) })}</Warn>}
        </Card>

        <Card title={t("card.geometry")} id="geometrie">
          <Slider label={t("geometry.openingAngle")} value={openingAngle} min={60} max={160} step={1} unit="°" onChange={setOpeningAngle} />
          <Slider label={t("geometry.length")} value={shown("L", LClamped)} min={Lmin} max={Lmax} step={5} unit="mm" onChange={setL} />
          {warnings.raumecke && <Warn>{t("warn.cornerLimit", { mm: LMaxRaumecke.toFixed(0) })}</Warn>}
          <Slider label={t("geometry.tractrixLength")} value={shown("Lt", LtClamped)} min={LtMin} max={LtMax} step={1} unit="mm" onChange={setLt} />
          {warnings.ltMax && <Warn>{t("warn.ltMax", { mm: LtMax.toFixed(0) })}</Warn>}
          {warnings.ltMin && <Warn>{t("warn.ltMin", { mm: LtMin.toFixed(0) })}</Warn>}
          <Toggle label={t("geometry.clothoid")} checked={clothoidOn} onChange={setClothoidOn} />
          {clothoidOn && <Slider label={t("geometry.clothoidLength")} value={clothoidLength} min={1} max={150} step={1} unit="mm" onChange={setClothoidLength} />}
          {clothoidOn && warnings.clothoid === "Lt" && <Warn>{t("warn.clothoidLt", { mm: LtMinClothoid.toFixed(0) })}</Warn>}
          {clothoidOn && warnings.clothoid === "zu lang" && <Warn>{t("warn.clothoidTooLong")}</Warn>}
        </Card>

        <Card title={t("card.profile")} id="profil">
          <Slider label={t("profile.mouthHeight")} value={hMouth} min={Math.ceil(rt * 2)} max={600} step={1} unit="mm" onChange={setHMouth} />
          <Group title={t("profile.flareCurve")}>
            <SegmentedButtons options={CURVES} labels={Object.fromEntries(CURVES.map(c => [c, t("profile." + c)]))} value={curve} onChange={setCurve} />
            {curve === "hypex" && <Slider label={t("profile.hypexT")} value={hypexT} min={0} max={2} step={0.05} unit="" onChange={setHypexT} />}
          </Group>
          <Toggle label={t("profile.fillet")} checked={filletOn} onChange={setFilletOn} />
          {filletOn && <Slider label={t("profile.filletRadius")} value={filletR} min={1} max={1000} step={1} unit="mm" onChange={setFilletR} />}
          {filletOn && s && !hasTraktrix(s) && <Warn>{t("warn.filletNeedsTractrix")}</Warn>}
          {fillet?.limited && <Warn>{t("warn.filletLimited", { mm: fillet.R.toFixed(1) })}</Warn>}
        </Card>

        <Card title={t("card.driver")} id="treiber">
          <Slider label={t("driver.width")} value={dw} min={10} max={300} step={1} unit="mm" onChange={setDw} />
          <Slider label={t("driver.depth")} value={dh} min={10} max={250} step={1} unit="mm" onChange={setDh} />
        </Card>

        <Card title={t("card.placement")} id="aufstellung">
          <Toggle label={t("placement.corner")} checked={showRaumecke} onChange={setShowRaumecke}
            hint={showRaumecke ? t("placement.cornerHint") : null} />
        </Card>

        <Card title={t("card.construction")} id="ausfuehrung">
          <Toggle label={t("construction.wall")} checked={showWandstaerke} onChange={setShowWandstaerke}
            hint={showWandstaerke ? null : t("construction.wallHint")} />
          {showWandstaerke && <>
            <Slider label={t("construction.wallThickness")} value={wandstaerke} min={1} max={100} step={1} unit="mm" onChange={setWandstaerke} />
            <Toggle label={t("construction.roundEdges")} checked={edgeOn} onChange={setEdgeOn} />
            {edgeOn && <Slider label={t("construction.edgeRadius")} value={Math.min(edgeR ?? wandstaerke, wandstaerke)} min={1} max={wandstaerke} step={1} unit="mm" onChange={setEdgeR} />}
            <Toggle label={t("construction.flange")} checked={flangeOn} onChange={setFlangeOn} />
          </>}
          {flange && <Group title={t("flange.title")}>
            <Slider label={t("flange.diameter")} value={shown("flangeD", Math.round(flange.diameter))} min={Math.ceil(flange.minDiameter)} max={400} step={1} unit="mm" onChange={setFlangeD} />
            {flange.limited && <Note>{t("flange.minDiameter", { mm: Math.ceil(flange.minDiameter) })}</Note>}
            {flangeOverRaumecke && <Warn>{t("warn.flangeOverCorner")}</Warn>}
            <Slider label={t("flange.thickness")} value={flangeT} min={2} max={40} step={1} unit="mm" onChange={setFlangeT} />
            <Slider label={t("flange.holes")} value={holeCount} min={0} max={12} step={1} unit="" onChange={setHoleCount} />
            {holeCount > 0 && <>
              <Slider label={t("flange.boltCircle")} value={shown("holeCircle", flange.holes.circle)} min={Math.ceil(flange.minDiameter / 2)} max={Math.floor(flange.diameter)} step={0.1} unit="mm" onChange={setHoleCircle} />
              <Slider label={t("flange.holeDiameter")} value={holeD} min={2} max={20} step={0.1} unit="mm" onChange={setHoleD} />
              <Slider label={t("flange.angle")} value={holeAngle} min={0} max={Math.round(360 / holeCount)} step={1} unit="°" onChange={setHoleAngle} />
              {flange.invalidHoles > 0 && <Warn>{flange.invalidHoles === 1 ? t("warn.holeConflictOne") : t("warn.holeConflictMany", { n: flange.invalidHoles })}</Warn>}
            </>}
          </Group>}
        </Card>

        <Card title={t("card.simulation")} id="simulation">
          <Toggle label={t("sim.frequencyResponse")} checked={simOn} onChange={setSimOn}
            hint={simOn ? null : t("sim.hint")} />
          {simOn && <>
            <Group title={t("sim.radiation")}>
              <SegmentedButtons options={MOUTH_OPTIONS} labels={{ ...MOUTH_LABELS, auto: t("sim.auto") }} value={simMouth} onChange={setSimMouth} />
              {(simMouth === "auto" || mouth !== "2pi") && <Note>
                {simMouth === "auto" && (showRaumecke ? t("sim.autoCorner") : t("sim.autoBaffle")) + " "}
                {mouth !== "2pi" && t("sim.approximation")}
              </Note>}
            </Group>
            <Slider label={t("sim.temperature")} value={simTemp} min={-10} max={40} step={1} unit="°C" onChange={setSimTemp} />
            <Toggle label={t("sim.showPhase")} checked={simPhase} onChange={setSimPhase} />
            {simPhase && <Toggle label={t("sim.removeDelay")} checked={simNoDelay} onChange={setSimNoDelay}
              hint={sim && t("sim.delayHint", {
                ms: (sim.delay * 1e3).toLocaleString(LANGUAGES[lang].locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                mm: (sim.delayPath * 1e3).toLocaleString(LANGUAGES[lang].locale, { maximumFractionDigits: 1 }),
              })} />}
            <Group title={t("sim.driverData")} id="simulation.treiber">
              {isPlaceholder(driver) && <Warn>{t("sim.placeholder")}</Warn>}
              <Slider label="Re"  value={driver.Re}  min={1}    max={16}   step={0.1}  unit="Ω"    onChange={setDriverValue("Re")} />
              <Slider label="Le"  value={driver.Le}  min={0}    max={1}    step={0.01} unit="mH"   onChange={setDriverValue("Le")} />
              <Slider label="Bl"  value={driver.Bl}  min={1}    max={40}   step={0.1}  unit="T·m"  onChange={setDriverValue("Bl")} />
              <SegmentedButtons options={["Mmd", "Mms"]} labels={{ Mmd: t("sim.massIsMmd"), Mms: t("sim.massIsMms") }} value={driver.massIs} onChange={setDriverValue("massIs")} />
              <Slider label={driver.massIs} value={driver.mass} min={0.1} max={50} step={0.1} unit="g" onChange={setDriverValue("mass")} />
              {driver.massIs === "Mms" && <Note>{t("sim.mmsNote")}</Note>}
              <Slider label="Cms" value={driver.Cms} min={1}    max={1000} step={1}    unit="µm/N" onChange={setDriverValue("Cms")} />
              <Slider label="Rms" value={driver.Rms} min={0.01} max={20}   step={0.01} unit="Ns/m" onChange={setDriverValue("Rms")} />
              <Slider label="Sd"  value={driver.Sd}  min={1}    max={500}  step={0.5}  unit="cm²"  onChange={setDriverValue("Sd")} />
              <Slider label={t("sim.vtc")} value={driver.Vtc} min={0} max={50}   step={0.1} unit="cm³" onChange={setDriverValue("Vtc")} />
              {driver.Vtc > 0 && <Slider label={t("sim.atc")} value={driver.Atc} min={0} max={200} step={0.5} unit="cm²" onChange={setDriverValue("Atc")} />}
              <Slider label={t("sim.vrc")} value={driver.Vrc} min={0} max={2000} step={1}   unit="cm³" onChange={setDriverValue("Vrc")} />
              <Note>{t("sim.chamberNote")}{driver.Vtc > 0 && driver.Atc === 0 ? t("sim.atcNote") : ""}</Note>
              {!isPlaceholder(driver) && <Button onClick={() => setDriver(PLACEHOLDER_DRIVER)}>{t("sim.resetDriver")}</Button>}
            </Group>
            {sim && <Button onClick={() => exportCSV(simResult)}>{t("sim.csv")}</Button>}
          </>}
        </Card>

        {s && <>
          <KeyFigures s={s} rt={rt} hMouth={p.hMouth} profile={profile} roundThroat={!!morph} t={t} />
          <Card title={t("card.crossSection")} id="querschnitt">
            <Querschnitt s={s} profile={profile} morph={morph} />
          </Card>
          <Card title={t("card.export")} id="export">
            <Group title={t("export.dxfCurves")} first>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 8 }}>
                <Toggle label={t("export.layerTopView")}    checked={exportLayers.draufsicht}   onChange={setLayer("draufsicht")} />
                <Toggle label={t("export.layerMouthArc")}   checked={exportLayers.mundbogen}    onChange={setLayer("mundbogen")} />
                <Toggle label={t("export.layerFocus")}      checked={exportLayers.fokus}        onChange={setLayer("fokus")} />
                <Toggle label={t("export.layerProfile")}    checked={exportLayers.seitenprofil} onChange={setLayer("seitenprofil")} />
                <Toggle label={t("export.layerTransition")} checked={exportLayers.uebergang}    onChange={setLayer("uebergang")} />
                {flange && <Toggle label={t("export.layerFlange")} checked={exportLayers.flansch} onChange={setLayer("flansch")} />}
              </div>
            </Group>
            <Group title={t("export.pdfExtra")}>
              <Toggle label={t("export.dimensions")} checked={exportLayers.bemassung} onChange={setLayer("bemassung")} />
            </Group>
            <div style={{ marginTop: 4 }}>
              <Button primary onClick={() => exportDXF(design, exportLayers)}>{t("export.dxf")}</Button>
              <Button onClick={() => exportPDF(design, exportLayers, lang)}>{t("export.pdf")}</Button>
              <Button onClick={() => exportSTL(design)}>{wall > 0 ? t(flange ? "export.stlShellFlange" : "export.stlShell", { mm: wall }) : t("export.stlAir")}</Button>
            </div>
          </Card>
        </>}
      </div>

      {/* Ansichten: oben Draufsicht und 3D, unten Seitenriss über die volle Breite */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 10, gap: 8, overflow: "hidden", minWidth: 0 }}>
        <div style={{ flex: 6, display: "flex", gap: 8, minHeight: 0 }}>
          <ViewPanel flex={1}>
            <Draufsicht s={s} rt={rt} dw={p.dw} dh={p.dh} L={LClamped}
              showRaumecke={p.showRaumecke} showWandstaerke={p.showWandstaerke} wandstaerke={p.wandstaerke} flange={flange} />
          </ViewPanel>
          <ViewPanel flex={1}>
            <Ansicht3D s={s} rt={rt} dw={p.dw} dh={p.dh} hMouth={p.hMouth} curve={p.curve} hypexT={p.hypexT} fillet={fillet} wall={wall} edgeR={edge} flange={flange} morph={morph} showRaumecke={p.showRaumecke} />
          </ViewPanel>
        </div>
        <div style={{ flex: 5, display: "flex", gap: 8, minHeight: 0 }}>
          <ViewPanel flex={1}>
            <Seitenriss s={s} rt={rt} dw={p.dw} dh={p.dh} L={LClamped} hMouth={p.hMouth} profile={profile} fillet={fillet} flange={flange} wall={wall} />
          </ViewPanel>
          {sim && <ViewPanel flex={1}>
            <Frequenzgang result={simResult} fLimit={sim.fLimit} mouth={p.mouth} showPhase={simPhase} placeholder={isPlaceholder(p.driver)} />
          </ViewPanel>}
        </div>
      </div>
    </div>
    </LanguageContext.Provider>
  );
}

function ViewPanel({ flex, children }) {
  return (
    <div style={{ flex, background: UI.panel, borderRadius: 8, border: `1px solid ${UI.border}`, overflow: "hidden", minHeight: 0, minWidth: 0 }}>
      <FullscreenPanel>{children}</FullscreenPanel>
    </div>
  );
}

/** Kennwerte des Horns und grobe Grenzfrequenzen in einer Karte. */
const KeyFigures = memo(function KeyFigures({ s, rt, hMouth, profile, roundThroat, t }) {
  const { fcLow, fcCut, fcHigh } = frequencyEstimates(s, rt, hMouth, roundThroat);
  return (
    <Card title={t("card.keyFigures")} id="kennwerte">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
        <Stat label={t("key.mouthWidth")} value={(2 * s.xMouth).toFixed(1) + " mm"} />
        <Stat label={t("key.mouthHeight")} value={hMouth + " mm"} />
        <Stat label={t("key.mouthArea")} value={(mouthArea(s, hMouth) / 1e6).toFixed(4) + " m²"} />
        <Stat label={t("key.arcLength")} value={s.arcLen.toFixed(1) + " mm"} />
        <Stat label={t("key.vertAngle")} value={verticalMouthAngle(s, profile).toFixed(1) + "°"} />
        <Stat label={t("key.horizAngle")} value={s.openingAngle + "°"} />
      </div>
      <Group title={t("key.frequencies")}>
        <FrequencyRow label={t("key.fcLow")}  value={fcLow} />
        <FrequencyRow label={t("key.fcCut")}  value={fcCut} />
        <FrequencyRow label={t("key.fcHigh")} value={fcHigh} />
      </Group>
    </Card>
  );
});

function FrequencyRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: UI.label, fontFamily: FONT }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: UI.text, fontFamily: FONT, fontVariantNumeric: "tabular-nums" }}>{formatHz(value)} Hz</span>
    </div>
  );
}

/** Gespeicherte Einstellungen löschen und mit den Standardwerten neu starten (zweiter Klick bestätigt). */
function ResetSettingsButton({ t }) {
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
  return <Button onClick={reset}>{armed ? t("reset.confirm") : t("reset.button")}</Button>;
}

/** Sprachwahl im Kopf der Seitenleiste: Kürzel der Sprachen als kleine Knopfleiste. */
function LanguageSwitch({ value, onChange, label }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 2, marginTop: 2 }}>
      {Object.entries(LANGUAGES).map(([code, { name }]) => (
        <button key={code} type="button" onClick={() => onChange(code)} aria-pressed={value === code} title={name} style={{
          height: 20, padding: "0 6px", borderRadius: 3, fontSize: 9, letterSpacing: "0.08em", cursor: "pointer", fontFamily: FONT,
          border: `1px solid ${value === code ? UI.accent : UI.borderControl}`,
          background: value === code ? UI.accentSoft : "transparent",
          color: value === code ? UI.accent : UI.faint,
        }}>{code.toUpperCase()}</button>
      ))}
    </div>
  );
}

/**
 * Projekt öffnen und speichern, Rückgängig und Wiederherstellen, alle Einstellungen zurücksetzen
 * (Kopf der Seitenleiste), darunter die Meldung zum letzten Öffnen.
 */
function ProjectButtons({ onOpen, onSave, status, history, t }) {
  const input = useRef(null);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 6 }}>
        <Button onClick={() => input.current.click()}>{t("project.open")}</Button>
        <Button onClick={onSave}>{t("project.save")}</Button>
        <Button onClick={history.undo} disabled={!history.canUndo} title={t("history.undoKey")}>{t("history.undo")}</Button>
        <Button onClick={history.redo} disabled={!history.canRedo} title={t("history.redoKey")}>{t("history.redo")}</Button>
      </div>
      <ResetSettingsButton t={t} />
      <input ref={input} type="file" accept=".json,application/json" hidden aria-label={t("project.open")}
        onChange={e => { const file = e.target.files[0]; e.target.value = ""; if (file) onOpen(file); }} />
      {status?.kind === "ok" && <Note>{status.text}</Note>}
      {status && status.kind !== "ok" && <Warn>{status.text}</Warn>}
    </div>
  );
}
