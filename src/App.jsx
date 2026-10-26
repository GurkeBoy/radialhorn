// Radialhorn-Konfigurator: Parameter in der Seitenleiste, Draufsicht und Seitenriss rechts.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  hasTraktrix, CURVES, makeProfile, lengthOffset,
  mouthArea, verticalMouthAngle, frequencyEstimates,
} from "./horn-math.js";
import { FONT, SIDEBAR_WIDTH, UI } from "./theme.js";
import {
  Button, Card, Group, Note, Slider, Toggle, SegmentedButtons, Stat, Warn, FullscreenPanel, Toast,
} from "./components/ui.jsx";
import { Draufsicht } from "./components/Draufsicht.jsx";
import { Seitenriss } from "./components/Seitenriss.jsx";
import { Querschnitt } from "./components/Querschnitt.jsx";
import { Ansicht3D } from "./components/Ansicht3D.jsx";
import { Frequenzgang } from "./components/Frequenzgang.jsx";
import { useGeometry, usePersistentState, useSimulation, useThrottledValue, useUndo, useVolumes } from "./hooks.js";
import { GEOMETRY_KEYS } from "./geometry.js";
import { LANGUAGES, LanguageContext, detectLanguage, translate } from "./i18n.js";
import { clearSettings } from "./settings.js";
import { DESIGN_DEFAULTS as D, ProjectError, buildProject, parseProject, projectFileName } from "./project.js";
import { downloadFile } from "./export/download.js";
import { version as APP_VERSION } from "../package.json";
import { exportDXF, ALL_LAYERS } from "./export/dxf.js";
import { exportPDF } from "./export/pdf.js";
import { exportSTL } from "./export/stl.js";
import { exportSTEP } from "./export/step.js";
import { exportCSV } from "./export/csv.js";
import { logFrequencies, PLACEHOLDER_DRIVER, phaseWithoutDelay } from "./simulation.js";

// Gängige Austrittsdurchmesser von Kompressionstreibern; 1,4" wird mit 35,5 mm angegeben (Herstellerangabe)
const THROAT_SIZES = [
  { label: '1"',          diameter: 25.4 },
  { labelKey: "throat.size14", diameter: 35.5 },
  { label: '2"',          diameter: 50.8 },
];
const THROAT_CUSTOM = "custom";                   // Knopf „Eigene“: Durchmesser frei über den Regler
const THROAT_RANGE = { min: 10, max: 150 };       // [mm]
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
  const [ribsOn,          setRibsOn]          = usePersistentState("ribsOn", D.ribsOn);
  const [ribThickness,    setRibThickness]    = usePersistentState("ribThickness", D.ribThickness);
  const [ribLength,       setRibLength]       = usePersistentState("ribLength", D.ribLength);
  const [pdfDimensions,   setPdfDimensions]   = usePersistentState("pdfBemassung", true);
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
  // L beginnt mit Raumecke an der Hut-Spitze, ohne an der Treiberrückseite (dw/2 davor): beim
  // Umschalten wird L mit umgerechnet, das Horn bleibt dasselbe
  const toggleRaumecke = on => {
    setL(l => l + lengthOffset(dw, !on) - lengthOffset(dw, on));
    setShowRaumecke(on);
  };

  // Projektdatei (project.js): der Entwurf als Ganzes, Schlüssel wie die gespeicherten Einstellungen
  const designValues = {
    throatDiam, throatCustom: throatCustomOn, morphOn, morphLength, openingAngle, L, Lt, dw, dh, hMouth, curve, hypexT, showRaumecke,
    showWandstaerke, wandstaerke, filletOn, filletR, clothoidOn, clothoidLength, edgeOn, edgeR, flangeOn, flangeD,
    flangeT, holeCount, holeCircle, holeD, holeAngle, ribsOn, ribThickness, ribLength, abstrahlung: simMouth, simTemp, driver,
  };
  const designSetters = {
    throatDiam: setThroatDiam, throatCustom: setThroatCustomOn, morphOn: setMorphOn, morphLength: setMorphLength,
    openingAngle: setOpeningAngle, L: setL, Lt: setLt,
    dw: setDw, dh: setDh, hMouth: setHMouth, curve: setCurve, hypexT: setHypexT, showRaumecke: setShowRaumecke,
    showWandstaerke: setShowWandstaerke, wandstaerke: setWandstaerke, filletOn: setFilletOn, filletR: setFilletR,
    clothoidOn: setClothoidOn, clothoidLength: setClothoidLength, edgeOn: setEdgeOn, edgeR: setEdgeR,
    flangeOn: setFlangeOn, flangeD: setFlangeD, flangeT: setFlangeT, holeCount: setHoleCount,
    holeCircle: setHoleCircle, holeD: setHoleD, holeAngle: setHoleAngle, ribsOn: setRibsOn, ribThickness: setRibThickness,
    ribLength: setRibLength, abstrahlung: setSimMouth,
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
  // Rückmeldung nach jedem Speichern/Export (sonst merkt man nicht, ob es geklappt hat)
  const [notice, setNotice] = useState(null);   // { kind: "ok" | "info" | "warn" | "error", text }
  useEffect(() => {
    if (!notice || notice.kind === "error" || notice.kind === "warn") return;   // Warnung und Fehler bleiben stehen
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  // conflictNote: Export mit Flansch – Hinweis auf Bohrungen im Konflikt mit der Schale ("3d" | "dxf" | "pdf")
  const reportSave = async (run, conflictNote = null) => {
    try {
      const r = await run();
      const saved = r.status === "cancelled" ? { kind: "info", text: t("save.cancelled") }
        : r.status === "opened" ? { kind: "ok", text: t("save.printOpened") }
        : { kind: "ok", text: t(r.status === "downloaded" ? "save.downloaded" : r.html ? "save.savedHtml" : "save.saved", { name: r.name }) };
      const n = conflictNote && r.status !== "cancelled" ? flange?.invalidHoles ?? 0 : 0;
      setNotice(n > 0 ? {
        kind: "warn",
        text: `${saved.text} · ${conflictText(n)}${conflictNote === "3d" ? ", " + t("export.conflict3d") : conflictNote === "dxf" ? ", " + t("export.conflictDxf") : ""}`,
      } : saved);
    } catch (err) {
      setNotice({ kind: "error", text: t("save.error", { msg: err?.message ?? String(err) }) });
    }
  };
  const conflictText = n => n === 1 ? t("export.conflictOne") : t("export.conflictMany", { n });
  const saveProject = () => {
    setProjectStatus(null);
    reportSave(() => downloadFile(buildProject(designValues, { appVersion: APP_VERSION }), projectFileName(designValues), "application/json"));
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
    filletOn, filletR, clothoidOn, clothoidLength, flangeOn, flangeD, flangeT, holeCount, holeCircle, holeD, holeAngle, ribsOn, ribThickness, ribLength,
    edgeOn, edgeR, simOn, mouth, simTemp, driver,
  }), [throatDiam, morphOn, morphLength, openingAngle, L, Lt, dw, dh, hMouth, curve, hypexT, showRaumecke, showWandstaerke, wandstaerke,
    filletOn, filletR, clothoidOn, clothoidLength, flangeOn, flangeD, flangeT, holeCount, holeCircle, holeD, holeAngle, ribsOn, ribThickness, ribLength,
    edgeOn, edgeR, simOn, mouth, simTemp, driver]);
  const p = useThrottledValue(live);
  // Abgeleitete Geometrie im Web Worker (geometry.js, useGeometry): beim Ziehen rechnet der
  // Haupt-Thread nicht, er zeichnet nur. Jede Stufe rechnet dort nur neu, was der Regler betrifft;
  // unveränderte Teile behalten ihr Objekt (memo/useMemo dahinter bleiben wirksam). g = die
  // Reglerwerte, zu denen das Ergebnis gehört – Ansichten und Exporte nehmen sie statt p, damit
  // Werte und Geometrie immer zusammenpassen, auch während der Worker noch rechnet.
  const geoKey = JSON.stringify(GEOMETRY_KEYS.map(k => p[k]));
  const geoParams = useMemo(() => Object.fromEntries(GEOMETRY_KEYS.map(k => [k, p[k]])), [geoKey]);   // eslint-disable-line react-hooks/exhaustive-deps -- p über geoKey
  const geo = useGeometry(geoParams);
  const g = geo.params;
  const rt = g.throatDiam / 2;
  const {
    s, fillet, morph, flange, shellOuter, shellCut, wall, edge,
    LtMin, LtMax, LtClamped, LtMinClothoid, LMaxRaumecke, Lmin, Lmax, LClamped, warnings,
  } = geo.values;
  // Profil als Funktion (nicht übertragbar): hier aus s und Verrundung, billig
  const profile = useMemo(() => s && makeProfile(s, rt, g.hMouth, g.curve, g.hypexT, fillet), [s, rt, g.hMouth, g.curve, g.hypexT, fillet]);
  // 1D-Simulation (Webster, Transfermatrizen) – nur bei eingeschaltetem Frequenzgang, im Web Worker
  // (useSimulation): beim Ziehen folgt die Kurve laufend, der Haupt-Thread zeichnet nur. S(x) hängt
  // nur an der Geometrie (geoKey aus den Versionen der Stufen): Treiber, Abstrahlung und Temperatur
  // rechnen dort nur die Kette neu.
  const simGeoKey = JSON.stringify([geo.versions.s, geo.versions.fillet, geo.versions.morph, rt, g.hMouth, g.curve, g.hypexT]);
  const simInput = useMemo(() => s && p.simOn ? {
    geoKey: simGeoKey, geometry: { s, rt, hMouth: g.hMouth, curve: g.curve, hypexT: g.hypexT, fillet, morph },
    temp: p.simTemp, mouth: p.mouth, driver: p.driver, freqs: SIM_FREQS,
  } : null, [simGeoKey, p.simOn, p.simTemp, p.mouth, p.driver]);   // eslint-disable-line react-hooks/exhaustive-deps -- Geometrie über simGeoKey
  const sim = useSimulation(simInput);
  // Angezeigtes (und als CSV exportiertes) Ergebnis: Phase wahlweise ohne die Laufzeit durch Kammer und Horn
  const simResult = useMemo(() => sim && (simNoDelay
    ? { ...sim.result, phase: phaseWithoutDelay(sim.result.f, sim.result.phase, sim.delay) }
    : sim.result), [sim, simNoDelay]);

  // Volumen aus den geschlossenen 3D-Netzen, im Web Worker (useVolumes); hängt nur an der Geometrie
  const volKey = JSON.stringify([geo.versions.s, geo.versions.fillet, geo.versions.morph, geo.versions.flange, rt, g.hMouth, g.curve, g.hypexT, wall, edge]);
  const volInput = useMemo(() => s ? {
    s, rt, hMouth: g.hMouth, curve: g.curve, hypexT: g.hypexT, fillet, morph, wall, flange, edgeR: edge,
  } : null, [volKey]);   // eslint-disable-line react-hooks/exhaustive-deps -- Geometrie über volKey
  const volumes = useVolumes(volInput);

  const flangeOverRaumecke = flange && g.showRaumecke && flange.diameter / 2 > g.dw / 2 + g.dh;
  const design = {
    s, rt, L: LClamped, hMouth: g.hMouth, curve: g.curve, hypexT: g.hypexT, fillet, profile, wall, flange,
    showRaumecke: g.showRaumecke, showWandstaerke: g.showWandstaerke, wandstaerke: g.wandstaerke, edgeR: edge, morph,
  };
  // Während eines Zugs zeigt der Regler den Live-Wert, sonst den (ggf. begrenzten) gerechneten
  const shown = (key, computed) => live[key] !== g[key] ? live[key] : computed;

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
          <Note>{t(g.showRaumecke ? "geometry.lengthFromCorner" : "geometry.lengthFromDriver")}</Note>
          {warnings.raumecke && <Warn>{t("warn.cornerLimit", { mm: LMaxRaumecke.toFixed(0) })}</Warn>}
          <Slider label={t("geometry.tractrixLength")} value={shown("Lt", LtClamped)} min={LtMin} max={LtMax} step={1} unit="mm" onChange={setLt} />
          {warnings.ltMax && <Warn>{t("warn.ltMax", { mm: LtMax.toFixed(0) })}</Warn>}
          {warnings.ltFollows && <Note>{t("note.ltFollows", { mm: LtClamped.toFixed(0) })}</Note>}
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
          <Toggle label={t("placement.corner")} checked={showRaumecke} onChange={toggleRaumecke}
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
              <Toggle label={t("flange.ribs")} checked={ribsOn} onChange={setRibsOn} hint={ribsOn ? t("flange.ribsHint", { n: holeCount }) : null} />
              {ribsOn && <>
                <Slider label={t("flange.ribThickness")} value={ribThickness} min={1} max={20} step={0.5} unit="mm" onChange={setRibThickness} />
                <Slider label={t("flange.ribLength")} value={ribLength} min={5} max={150} step={1} unit="mm" onChange={setRibLength} />
              </>}
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
            {sim && <Button onClick={() => reportSave(() => exportCSV(simResult))}>{t("sim.csv")}</Button>}
          </>}
        </Card>

        {s && <>
          <KeyFigures s={s} rt={rt} hMouth={g.hMouth} profile={profile} roundThroat={!!morph} t={t} />
          <Volumes volumes={volumes} t={t} />
          <Card title={t("card.crossSection")} id="querschnitt">
            <Querschnitt s={s} profile={profile} morph={morph} />
          </Card>
          <Card title={t("card.export")} id="export">
            <Note>{t("export.dxfHint")}</Note>
            <Toggle label={t("export.dimensions")} checked={pdfDimensions} onChange={setPdfDimensions} hint={t("export.dimensionsHint")} />
            {flange?.invalidHoles > 0 && <Warn>{conflictText(flange.invalidHoles)}: {t("export.conflictCard")}</Warn>}
            <div style={{ marginTop: 4 }}>
              <Button primary onClick={() => reportSave(() => exportDXF(design), "dxf")}>{t("export.dxf")}</Button>
              <Button onClick={() => reportSave(() => exportPDF(design, { ...ALL_LAYERS, bemassung: pdfDimensions }, lang), "pdf")}>{t("export.pdf")}</Button>
              <Button onClick={() => reportSave(() => exportSTL(design), "3d")}>{wall > 0 ? t(flange ? "export.stlShellFlange" : "export.stlShell", { mm: wall }) : t("export.stlAir")}</Button>
              <Button onClick={() => reportSave(() => exportSTEP(design), "3d")}>{wall > 0 ? t(flange ? "export.stepShellFlange" : "export.stepShell", { mm: wall }) : t("export.stepAir")}</Button>
            </div>
          </Card>
        </>}
      </div>

      {/* Ansichten: oben Draufsicht und 3D, unten Seitenriss über die volle Breite */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 10, gap: 8, overflow: "hidden", minWidth: 0 }}>
        <div style={{ flex: 6, display: "flex", gap: 8, minHeight: 0 }}>
          <ViewPanel flex={1}>
            <Draufsicht s={s} rt={rt} dw={g.dw} dh={g.dh} L={LClamped}
              showRaumecke={g.showRaumecke} showWandstaerke={g.showWandstaerke} wandstaerke={g.wandstaerke} flange={flange} shellOuter={shellOuter} />
          </ViewPanel>
          <ViewPanel flex={1}>
            <Ansicht3D s={s} rt={rt} dw={g.dw} dh={g.dh} hMouth={g.hMouth} curve={g.curve} hypexT={g.hypexT} fillet={fillet} wall={wall} edgeR={edge} flange={flange} morph={morph} showRaumecke={g.showRaumecke} />
          </ViewPanel>
        </div>
        <div style={{ flex: 5, display: "flex", gap: 8, minHeight: 0 }}>
          <ViewPanel flex={1}>
            <Seitenriss s={s} rt={rt} dw={g.dw} dh={g.dh} L={LClamped} hMouth={g.hMouth} profile={profile} fillet={fillet} flange={flange} wall={wall} shellCut={shellCut} showRaumecke={g.showRaumecke} />
          </ViewPanel>
          {sim && <ViewPanel flex={1}>
            <Frequenzgang result={simResult} fLimit={sim.fLimit} mouth={p.mouth} showPhase={simPhase} placeholder={isPlaceholder(p.driver)} />
          </ViewPanel>}
        </div>
      </div>
      <Toast notice={notice} onClose={() => setNotice(null)} />
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

/** Volumen des Horns: Luftvolumen (Innenform), Wandmaterial der Schale und Außenkörper insgesamt. */
const Volumes = memo(function Volumes({ volumes, t }) {
  const litres = v => v === null || v === undefined ? "–" : (v / 1e6).toFixed(2) + " L";
  return (
    <Card title={t("card.volume")} id="volumen">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <Stat label={t("volume.air")} value={litres(volumes?.air)} />
        <Stat label={t("volume.shell")} value={litres(volumes?.shell)} />
        <Stat label={t("volume.outer")} value={litres(volumes?.outer)} />
      </div>
      <Note>{volumes?.shell == null ? t("volume.noWall") : t("volume.hint")}</Note>
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
    clearSettings().finally(() => window.location.reload());   // erst die Einstellungsdatei leeren
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
