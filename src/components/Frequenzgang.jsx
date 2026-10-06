// Frequenzgang aus der 1D-Simulation: SPL (oben) und elektrische Impedanz (unten) über log f.
import { memo, useRef, useState } from "react";
import { abs } from "../simulation.js";
import { COLOR, FONT, S, UI } from "../theme.js";
import { niceTicks, svgPath } from "../utils.js";
import { useSize } from "../hooks.js";

const F_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const SPL_SPAN = 50;                              // dB im SPL-Diagramm
const MOUTH_LABEL = { "4pi": "4π", "2pi": "2π", "pi": "π", "pi/2": "π/2" };

const fmtHz = f => f >= 1000 ? `${+(f / 1000).toFixed(f >= 10000 ? 1 : 2)}k` : f.toFixed(0);

/**
 * @param result     simulate(...) oder null
 * @param fLimit     Frequenz, ab der das 1D-Modell unsicher ist (Querwellen im Hals) [Hz]
 * @param mouth      Raumwinkel der Abstrahlung
 * @param showPhase  Phase des Schalldrucks einblenden
 * @param placeholder  Treiberdaten sind der Platzhalter
 */
export const Frequenzgang = memo(function Frequenzgang({ result, fLimit, mouth, showPhase, placeholder }) {
  const ref = useRef(null);
  const { w: VW, h: VH } = useSize(ref);
  const [hover, setHover] = useState(null);   // Index der Frequenz unter dem Mauszeiger

  if (!result || VW < 10 || VH < 10) return <div ref={ref} style={{ width: "100%", height: "100%" }} />;

  const { f, spl, phase, zel } = result;
  const zMag = zel.map(abs);
  const ml = 44, mr = showPhase ? 40 : 14, mt = 34, mb = 22, gap = 26;
  const pw = VW - ml - mr, plotH = VH - mt - mb - gap;
  const hSpl = plotH * 0.6, hImp = plotH - hSpl;
  const ySpl0 = mt, yImp0 = mt + hSpl + gap;

  const fMin = f[0], fMax = f.at(-1);
  const gx = v => ml + Math.log(v / fMin) / Math.log(fMax / fMin) * pw;

  const splTop = Math.ceil(Math.max(...spl) / 5) * 5, splBot = splTop - SPL_SPAN;
  const gySpl = v => ySpl0 + (splTop - Math.max(splBot, Math.min(splTop, v))) / SPL_SPAN * hSpl;
  const zTicks = niceTicks(0, Math.max(...zMag), 4);
  const zTop = Math.max(zTicks.at(-1) ?? 1, ...zMag);
  const gyImp = v => yImp0 + (1 - v / zTop) * hImp;
  const gyPh = v => ySpl0 + (180 - v) / 360 * hSpl;

  // Frequenz-Beschriftungen nur mit genug Abstand (schmales Panel): bei Bedarf jede zweite weglassen
  const ticksInRange = F_TICKS.filter(v => v >= fMin && v <= fMax);
  const minGap = Math.min(...ticksInRange.slice(1).map((v, i) => gx(v) - gx(ticksInRange[i])));
  const fLabels = minGap >= 26 ? ticksInRange : ticksInRange.filter((v, i) => i % 2 === 0);
  const xLim = fLimit < fMax ? gx(Math.max(fMin, fLimit)) : null;
  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = fMin * (fMax / fMin) ** ((e.clientX - r.left - ml) / pw);
    if (fx < fMin || fx > fMax) { setHover(null); return; }
    let best = 0;
    for (let i = 1; i < f.length; i++) if (Math.abs(Math.log(f[i] / fx)) < Math.abs(Math.log(f[best] / fx))) best = i;
    setHover(best);
  };

  const frame = (y0, h) => <rect x={ml} y={y0} width={pw} height={h} fill="none" stroke={COLOR.axis} strokeWidth="0.7" />;
  const grid = (y0, h) => F_TICKS.filter(v => v >= fMin && v <= fMax).map(v =>
    <line key={v} x1={gx(v)} y1={y0} x2={gx(v)} y2={y0 + h} stroke={COLOR.axis} strokeWidth="0.4" opacity="0.6" />);
  const limitBand = (y0, h) => xLim !== null && <rect x={xLim} y={y0} width={ml + pw - xLim} height={h} fill={COLOR.fill1D} />;
  const tickText = { fontSize: "9", fontFamily: FONT, fill: COLOR.tick };

  return (
    <div ref={ref} style={{ width: "100%", height: "100%" }}>
      <svg width={VW} height={VH} onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ display: "block", userSelect: "none" }}>
        <text x={ml} y={14} {...S.label} fill={COLOR.text} letterSpacing="0.1em">
          FREQUENZGANG · 2,83 V / 1 m · {MOUTH_LABEL[mouth]}
        </text>
        {placeholder && <text x={ml} y={26} {...S.label} fontSize="8" fill={UI.error}>Platzhalter-Treiber – Werte nicht belastbar</text>}

        {/* SPL */}
        {limitBand(ySpl0, hSpl)}
        {grid(ySpl0, hSpl)}
        {niceTicks(splBot, splTop, 5).map(v => <g key={v}>
          <line x1={ml} y1={gySpl(v)} x2={ml + pw} y2={gySpl(v)} stroke={COLOR.axis} strokeWidth="0.4" opacity="0.6" />
          <text x={ml - 5} y={gySpl(v)} textAnchor="end" dominantBaseline="central" {...tickText}>{v}</text>
        </g>)}
        <text x={ml - 5} y={ySpl0 - 6} textAnchor="end" {...tickText} fill={COLOR.spl}>dB</text>
        {showPhase && <>
          <path d={svgPath(f.map((v, i) => [gx(v), gyPh(phase[i])]), 1)} fill="none" stroke={COLOR.phase} strokeWidth="0.9" strokeDasharray="3 2" />
          {[-180, -90, 0, 90, 180].map(v => <text key={v} x={ml + pw + 5} y={gyPh(v)} dominantBaseline="central" {...tickText} fill={COLOR.phase}>{v}°</text>)}
        </>}
        <path d={svgPath(f.map((v, i) => [gx(v), gySpl(spl[i])]), 1)} fill="none" stroke={COLOR.spl} strokeWidth="1.4" strokeLinejoin="round" />
        {frame(ySpl0, hSpl)}

        {/* Impedanz */}
        {limitBand(yImp0, hImp)}
        {grid(yImp0, hImp)}
        {zTicks.map(v => <g key={v}>
          <line x1={ml} y1={gyImp(v)} x2={ml + pw} y2={gyImp(v)} stroke={COLOR.axis} strokeWidth="0.4" opacity="0.6" />
          <text x={ml - 5} y={gyImp(v)} textAnchor="end" dominantBaseline="central" {...tickText}>{v}</text>
        </g>)}
        <text x={ml - 5} y={yImp0 - 6} textAnchor="end" {...tickText} fill={COLOR.imp}>Ω</text>
        <path d={svgPath(f.map((v, i) => [gx(v), gyImp(zMag[i])]), 1)} fill="none" stroke={COLOR.imp} strokeWidth="1.4" strokeLinejoin="round" />
        {frame(yImp0, hImp)}

        {fLabels.map(v =>
          <text key={v} x={gx(v)} y={yImp0 + hImp + 13} textAnchor="middle" {...tickText}>{fmtHz(v)}</text>)}

        {xLim !== null && <text x={xLim + 4} y={ySpl0 + hSpl - 6} {...tickText} fill={UI.error} opacity="0.8">
          <title>{`Ab ${fmtHz(fLimit)} Hz sind im Hals Querwellen möglich (Breite = λ/2) – das 1D-Modell (Webster) wird unsicher. Faustregel, keine harte Grenze.`}</title>
          1D unsicher
        </text>}

        {hover !== null && <g pointerEvents="none">
          <line x1={gx(f[hover])} y1={ySpl0} x2={gx(f[hover])} y2={yImp0 + hImp} stroke={UI.muted} strokeWidth="0.6" />
          <circle cx={gx(f[hover])} cy={gySpl(spl[hover])} r="2.5" fill={COLOR.spl} />
          <circle cx={gx(f[hover])} cy={gyImp(zMag[hover])} r="2.5" fill={COLOR.imp} />
          <text x={ml + pw} y={26} textAnchor="end" {...S.label} fill={UI.label}>
            {fmtHz(f[hover])} Hz · <tspan fill={COLOR.spl}>{spl[hover].toFixed(1)} dB</tspan>
            {showPhase && <tspan fill={COLOR.phase}> · {phase[hover].toFixed(0)}°</tspan>}
            {" · "}<tspan fill={COLOR.imp}>{zMag[hover].toFixed(1)} Ω</tspan>
          </text>
        </g>}
      </svg>
    </div>
  );
});
