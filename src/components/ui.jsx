// Bedienelemente und Rahmen der Seitenleiste und Ansichten.
import { useState } from "react";
import { FONT, UI, COLOR } from "../theme.js";

const LABEL_WIDTH = 128;   // Breite der Slider-Beschriftung; Warnungen rücken darauf ein

/** Karte der Seitenleiste mit optionaler Abschnittsüberschrift. */
export function Card({ title, children }) {
  return (
    <div style={{ background: UI.card, borderRadius: 8, padding: "12px 14px", border: `1px solid ${UI.borderCard}`, marginBottom: 8 }}>
      {title && <SectionTitle>{title}</SectionTitle>}
      {children}
    </div>
  );
}

export function SectionTitle({ children }) {
  return <div style={{ fontSize: 9, color: UI.muted, letterSpacing: "0.15em", marginBottom: 8 }}>{children}</div>;
}

/** Kleine Zwischenüberschrift bzw. Hinweiszeile innerhalb einer Karte. */
export function Note({ children, style }) {
  return <div style={{ fontSize: 9, color: UI.faint, ...style }}>{children}</div>;
}

/**
 * Schieberegler mit Zahlenfeld. Das Zahlenfeld übernimmt erst bei Enter oder Verlassen
 * und begrenzt auf [min, max]; ungültige Eingaben werden verworfen. Solange nicht getippt
 * wird, zeigt es den aktuellen Wert.
 */
export function Slider({ label, value, min, max, step, unit, onChange }) {
  const [draft, setDraft] = useState(null);   // Eingabe während des Tippens, sonst null

  const commit = () => {
    const v = parseFloat(draft);
    if (draft !== null && !isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
    setDraft(null);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ minWidth: LABEL_WIDTH, fontSize: 11, color: UI.label, fontFamily: FONT }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={Math.min(Math.max(value, min), max)}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, minWidth: 0, accentColor: UI.accent }} />
      <input type="number" min={min} max={max} step={step} value={draft ?? String(value)}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); }}
        style={{ width: 62, padding: "2px 6px", background: UI.input, border: `1px solid ${UI.borderControl}`, borderRadius: 4, color: UI.text, fontSize: 11, fontFamily: FONT, boxSizing: "border-box" }} />
      <span style={{ minWidth: 24, fontSize: 10, color: UI.muted }}>{unit}</span>
    </div>
  );
}

/** Ein/Aus-Schalter; die ganze Zeile ist klickbar und per Tastatur bedienbar. */
export function Toggle({ label, checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 8, padding: 0, background: "none", border: "none" }}>
      <span style={{
        width: 36, height: 20, borderRadius: 10, position: "relative", transition: "background 0.2s",
        background: checked ? UI.accent : UI.borderControl, flexShrink: 0,
      }}>
        <span style={{
          position: "absolute", top: 3, left: checked ? 19 : 3, width: 14, height: 14,
          borderRadius: "50%", background: "#fff", transition: "left 0.2s",
        }} />
      </span>
      <span style={{ fontSize: 11, color: checked ? UI.accent : UI.muted, fontFamily: FONT, userSelect: "none" }}>
        {label}
      </span>
    </button>
  );
}

/** Auswahl aus mehreren Optionen als Knopfleiste. */
export function SegmentedButtons({ options, value, onChange, labels = {} }) {
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
      {options.map(o => (
        <button key={o} type="button" onClick={() => onChange(o)} aria-pressed={value === o} style={{
          flex: 1, padding: "4px 0", borderRadius: 4, fontSize: 10, cursor: "pointer",
          border: `1px solid ${value === o ? UI.accent : UI.borderControl}`,
          background: value === o ? UI.accentSoft : UI.input,
          color: value === o ? UI.accent : UI.muted,
          fontFamily: FONT, letterSpacing: "0.05em",
        }}>{labels[o] ?? o}</button>
      ))}
    </div>
  );
}

export function Stat({ label, value }) {
  return (
    <div style={{ background: UI.input, border: `1px solid ${UI.borderStat}`, borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontSize: 9, color: UI.subtle, marginBottom: 3, letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: UI.accent }}>{value}</div>
    </div>
  );
}

/** Warnhinweis unter einem Slider, eingerückt auf dessen Regler. */
export function Warn({ children }) {
  return <div style={{ fontSize: 9, color: UI.error, marginTop: -4, marginBottom: 4, paddingLeft: LABEL_WIDTH + 6 }}>{children}</div>;
}

const controlStyle = {
  background: UI.overlay, border: `1px solid ${UI.borderControl}`, borderRadius: 4,
  color: UI.muted, fontFamily: FONT,
};

/** Zoomstufe + Zurücksetzen oben rechts (Standard: links neben dem Vollbild-Button). */
export function ZoomControls({ k, onReset, top = 6, right = 36, compact = false }) {
  const h = compact ? 18 : 24, fs = compact ? 9 : 10;
  return (
    <div onPointerDown={e => e.stopPropagation()} style={{
      position: "absolute", top, right, zIndex: 10, display: "flex", gap: 4, alignItems: "center",
    }}>
      <span style={{ ...controlStyle, fontSize: fs, height: h, boxSizing: "border-box", padding: "0 6px", display: "flex", alignItems: "center" }}>
        {Math.round(k * 100)} %
      </span>
      <button type="button" onClick={onReset} title="Zoom zurücksetzen"
        style={{ ...controlStyle, fontSize: fs, height: h, padding: compact ? "0 5px" : "0 7px", cursor: "pointer" }}>
        ⟲ Reset
      </button>
    </div>
  );
}

/**
 * Rahmen einer Ansicht mit Umschalter auf Vollbild. Der Inhalt bleibt dabei an derselben
 * Stelle im Komponentenbaum – nur der Rahmen wechselt –, damit Zoom, Kamera und
 * Darstellung der Ansicht erhalten bleiben.
 */
export function FullscreenPanel({ children }) {
  const [full, setFull] = useState(false);
  return (
    <div style={full
      ? { position: "fixed", inset: 0, zIndex: 1000, background: UI.bg }
      : { position: "relative", width: "100%", height: "100%" }}>
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
        <button type="button" onClick={() => setFull(f => !f)} title={full ? "Vollbild beenden" : "Vollbild"} style={{
          ...controlStyle, position: "absolute", top: 6, right: 6, zIndex: 10, cursor: "pointer",
          width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, lineHeight: 1,
        }}>
          {full ? "✕" : "⤢"}
        </button>
        {children}
      </div>
    </div>
  );
}

/** Pfeilspitze für Maßlinien (orient="auto-start-reverse": gleiche Form an beiden Enden). */
export function ArrowMarker({ id }) {
  return (
    <marker id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" fill="none" stroke={COLOR.dim} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </marker>
  );
}
