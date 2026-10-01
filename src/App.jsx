// Radialhorn-Konfigurator: Parameter in der Seitenleiste, Draufsicht und Seitenriss rechts.
import { useMemo, useState } from "react";
import {
  createHornMath, hasTraktrix, CURVES, computeFillet, makeProfile,
  mouthArea, verticalMouthAngle, frequencyEstimates,
} from "./horn-math.js";
import { FONT, UI } from "./theme.js";
import {
  Card, Note, Slider, Toggle, SegmentedButtons, Stat, Warn, FullscreenPanel,
} from "./components/ui.jsx";
import { Draufsicht } from "./components/Draufsicht.jsx";
import { Seitenriss } from "./components/Seitenriss.jsx";
import { Querschnitt } from "./components/Querschnitt.jsx";
import { Ansicht3D } from "./components/Ansicht3D.jsx";
import { exportDXF } from "./export/dxf.js";
import { exportPDF } from "./export/pdf.js";
import { exportSTL } from "./export/stl.js";

const THROAT_SIZES = [
  { label: '1"',  diameter: 25.4 },
  { label: '1½"', diameter: 38.1 },
  { label: '2"',  diameter: 50.8 },
  { label: '3"',  diameter: 76.2 },
];
const CURVE_LABELS = { linear: "Linear", exponential: "Exponential", hypex: "Hypex" };
const L_MAX = 1200;   // Obergrenze des L-Reglers ohne Raumecke [mm]

const formatHz = f => f >= 1000 ? (f / 1000).toFixed(2) + " k" : f.toFixed(0);

export default function App() {
  const [throatDiam,      setThroatDiam]      = useState(50.8);
  const [openingAngle,    setOpeningAngle]    = useState(140);
  const [L,               setL]               = useState(500);
  const [Lt,              setLt]              = useState(60);
  const [dw,              setDw]              = useState(120);
  const [dh,              setDh]              = useState(100);
  const [hMouth,          setHMouth]          = useState(200);
  const [curve,           setCurve]           = useState("exponential");
  const [hypexT,          setHypexT]          = useState(0.5);
  const [showRaumecke,    setShowRaumecke]    = useState(true);
  const [showWandstaerke, setShowWandstaerke] = useState(false);
  const [wandstaerke,     setWandstaerke]     = useState(20);
  const [filletOn,        setFilletOn]        = useState(false);
  const [filletR,         setFilletR]         = useState(100);
  const [exportLayers,    setExportLayers]    = useState({
    draufsicht: true, mundbogen: true, fokus: true, seitenprofil: true, uebergang: true, bemassung: true,
  });
  const setLayer = key => on => setExportLayers(layers => ({ ...layers, [key]: on }));

  const rt = throatDiam / 2;

  // Grenzen und Lösung der Draufsicht. Die Grenzsuchen sind teuer (verschachtelte
  // Bisektionen) und hängen nur von diesen Parametern ab.
  const geometry = useMemo(() => {
    const math = createHornMath(openingAngle);
    // Wandstärke vergrößert die Außenkante senkrecht zur Wand; ihre Projektion auf die
    // 45°-Raumecke verkleinert den verfügbaren Platz
    const extraBreite = showRaumecke && showWandstaerke
      ? (Math.cos(math.ALPHA2) + Math.sin(math.ALPHA2)) * wandstaerke
      : 0;

    const LtMax         = math.maxLt(L, rt, dw, dh);
    const LtMinRaumecke = showRaumecke ? math.minLtForRaumecke(L, rt, dw, dh, extraBreite) : null;
    const LtMin         = LtMinRaumecke ?? 0;
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
      },
    };
  }, [openingAngle, L, Lt, rt, dw, dh, showRaumecke, showWandstaerke, wandstaerke]);

  const { s, LtMin, LtMax, LtClamped, LClamped, LMaxRaumecke, Lmin, Lmax, warnings } = geometry;

  const fillet = useMemo(
    () => filletOn ? computeFillet(s, rt, hMouth, curve, hypexT, filletR) : null,
    [filletOn, s, rt, hMouth, curve, hypexT, filletR],
  );
  const profile = useMemo(
    () => s && makeProfile(s, rt, hMouth, curve, hypexT, fillet),
    [s, rt, hMouth, curve, hypexT, fillet],
  );

  const wall = showWandstaerke ? wandstaerke : 0;
  const design = {
    s, rt, L: LClamped, hMouth, curve, hypexT, fillet, profile, wall,
    showRaumecke, showWandstaerke, wandstaerke,
  };

  return (
    <div style={{ background: UI.bg, height: "100vh", overflow: "hidden", color: UI.text, fontFamily: FONT, display: "flex" }}>

      {/* Seitenleiste */}
      <div style={{ width: 368, flexShrink: 0, borderRight: `1px solid ${UI.border}`, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column" }}>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: UI.accent, letterSpacing: "0.1em" }}>RADIALHORN</div>
          <div style={{ fontSize: 9, color: UI.faint, letterSpacing: "0.2em", marginTop: 1 }}>KONFIGURATOR · {openingAngle}° · v4</div>
        </div>

        <Card>
          <Toggle label="Raumecke" checked={showRaumecke} onChange={setShowRaumecke} />
          {showRaumecke && <Note style={{ paddingLeft: 46, marginTop: -6, marginBottom: 4 }}>Hornbreite auf Raumecken-Diagonale begrenzt</Note>}
          <Toggle label="Wandstärke" checked={showWandstaerke} onChange={setShowWandstaerke} />
          {showWandstaerke && <Slider label="Wandstärke" value={wandstaerke} min={1} max={100} step={1} unit="mm" onChange={setWandstaerke} />}
        </Card>

        <Card title="THROAT">
          <SegmentedButtons
            options={THROAT_SIZES.map(t => t.diameter)}
            labels={Object.fromEntries(THROAT_SIZES.map(t => [t.diameter, t.label]))}
            value={throatDiam} onChange={setThroatDiam} />
        </Card>

        <Card title="HORNGEOMETRIE">
          <Slider label="Öffnungswinkel" value={openingAngle} min={60} max={160} step={1} unit="°" onChange={setOpeningAngle} />
          <Slider label="Gesamtlänge L" value={LClamped} min={Lmin} max={Lmax} step={5} unit="mm" onChange={setL} />
          {warnings.raumecke && <Warn>⚠ Raumecken-Limit ({LMaxRaumecke.toFixed(0)} mm)</Warn>}
          <Slider label="Traktrix-Länge Lₜ" value={LtClamped} min={LtMin} max={LtMax} step={1} unit="mm" onChange={setLt} />
          {warnings.ltMax && <Warn>⚠ Lₜ-Maximum erreicht ({LtMax.toFixed(0)} mm)</Warn>}
          {warnings.ltMin && <Warn>⚠ Lₜ-Minimum (Raumecke: {LtMin.toFixed(0)} mm)</Warn>}
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

        {s && <>
          <KeyFigures s={s} hMouth={hMouth} profile={profile} />
          <Frequencies s={s} rt={rt} />
          <Querschnitt s={s} profile={profile} />
          <Card title="EXPORT">
            <Note style={{ marginBottom: 6 }}>DXF — Kurven (mm)</Note>
            <Toggle label="Draufsicht-Wände" checked={exportLayers.draufsicht}   onChange={setLayer("draufsicht")} />
            <Toggle label="Mundbogen"        checked={exportLayers.mundbogen}    onChange={setLayer("mundbogen")} />
            <Toggle label="Fokuspunkt"       checked={exportLayers.fokus}        onChange={setLayer("fokus")} />
            <Toggle label="Seitenprofil"     checked={exportLayers.seitenprofil} onChange={setLayer("seitenprofil")} />
            <Toggle label="Übergangspunkt"   checked={exportLayers.uebergang}    onChange={setLayer("uebergang")} />
            <Note style={{ margin: "8px 0 6px" }}>PDF — zusätzlich zu Kurven oben</Note>
            <Toggle label="Bemaßungen"       checked={exportLayers.bemassung}    onChange={setLayer("bemassung")} />
            <ExportButton primary onClick={() => exportDXF(design, exportLayers)}>↓ DXF exportieren</ExportButton>
            <ExportButton onClick={() => exportPDF(design, exportLayers)}>↓ PDF (Zeichnungen)</ExportButton>
            <ExportButton onClick={() => exportSTL(design)}>↓ STL (3D, {wall > 0 ? `Schale ${wall} mm` : "Luftvolumen"})</ExportButton>
          </Card>
        </>}
      </div>

      {/* Ansichten: oben Draufsicht und 3D, unten Seitenriss über die volle Breite */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 10, gap: 8, overflow: "hidden", minWidth: 0 }}>
        <div style={{ flex: 6, display: "flex", gap: 8, minHeight: 0 }}>
          <ViewPanel flex={1}>
            <Draufsicht s={s} rt={rt} dw={dw} dh={dh} L={LClamped}
              showRaumecke={showRaumecke} showWandstaerke={showWandstaerke} wandstaerke={wandstaerke} />
          </ViewPanel>
          <ViewPanel flex={1}>
            <Ansicht3D s={s} rt={rt} dw={dw} dh={dh} hMouth={hMouth} profile={profile} fillet={fillet} wall={wall} showRaumecke={showRaumecke} />
          </ViewPanel>
        </div>
        <ViewPanel flex={5}>
          <Seitenriss s={s} rt={rt} dw={dw} dh={dh} L={LClamped} hMouth={hMouth} profile={profile} fillet={fillet} />
        </ViewPanel>
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

function KeyFigures({ s, hMouth, profile }) {
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
}

function Frequencies({ s, rt }) {
  const { fcLow, fcCut, fcHigh } = frequencyEstimates(s, rt);
  return (
    <Card title="FREQUENZEN (NÄHERUNG)">
      <FrequencyRow label="fc_low  — Mund (λ=2πR)"   value={fcLow} />
      <FrequencyRow label="fc_cut  — Horn-Cutoff"     value={fcCut} />
      <FrequencyRow label="fc_high — Throat (λ=2r)"   value={fcHigh} />
      <Note style={{ fontSize: 8, marginTop: 6, lineHeight: 1.4 }}>
        Bandbreite: {fcLow.toFixed(0)} – {fcHigh >= 1000 ? (fcHigh / 1000).toFixed(1) + "k" : fcHigh.toFixed(0)} Hz
      </Note>
    </Card>
  );
}

function FrequencyRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
      <span style={{ fontSize: 10, color: UI.muted, fontFamily: FONT }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: UI.value, fontFamily: FONT }}>{formatHz(value)} Hz</span>
    </div>
  );
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
