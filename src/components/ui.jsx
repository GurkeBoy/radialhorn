// Bedienelemente und Rahmen der Seitenleiste und Ansichten.
import { useEffect, useRef, useState } from "react";
import { FONT, UI, COLOR, SIDEBAR_WIDTH } from "../theme.js";
import { usePersistentState } from "../hooks.js";
import { useT } from "../i18n.js";

// Raster der Seitenleiste: Zeilen aus Beschriftung | Regler | Zahl | Einheit; Abstände auf 4/8 px
const ROW_COLUMNS = "116px minmax(0, 1fr) 70px 30px";   // Zahl mit ▲▼
const ROW_GAP = 8;
const TOGGLE_INDENT = 46;   // Schalterbreite + Abstand: Hinweise unter einem Schalter beginnen beim Text

const chevron = open => (
  <span aria-hidden style={{ display: "inline-block", fontSize: 9, color: UI.faint, transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "none" }}>▶</span>
);

/**
 * Karte der Seitenleiste. Mit id ist sie über die Überschrift einklappbar; der Zustand wird
 * gespeichert (Einstellung "open.<id>").
 */
export function Card({ title, id, children }) {
  return id
    ? <CollapsibleCard title={title} id={id}>{children}</CollapsibleCard>
    : <CardFrame>{title && <SectionTitle>{title}</SectionTitle>}{children}</CardFrame>;
}

function CollapsibleCard({ title, id, children }) {
  const [open, setOpen] = usePersistentState("open." + id, true);
  return (
    <CardFrame closed={!open}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
        padding: 0, margin: open ? "0 0 10px" : 0, background: "none", border: "none", cursor: "pointer",
      }}>
        <SectionTitle style={{ margin: 0 }}>{title}</SectionTitle>
        {chevron(open)}
      </button>
      {open && children}
    </CardFrame>
  );
}

function CardFrame({ closed, children }) {
  return (
    <div style={{
      background: UI.card, borderRadius: 8, border: `1px solid ${UI.borderCard}`, marginBottom: 8,
      padding: closed ? "10px 14px" : "10px 14px 2px",
    }}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, style }) {
  return <div style={{ fontSize: 10, color: UI.label, letterSpacing: "0.14em", fontFamily: FONT, marginBottom: 10, ...style }}>{children}</div>;
}

/**
 * Unterabschnitt einer Karte mit kleiner Überschrift. Mit id einklappbar (Zustand gespeichert,
 * Standard zu, falls defaultOpen = false). first: direkt unter der Kartenüberschrift, ohne Trennlinie.
 */
export function Group({ title, id, defaultOpen = true, first, children }) {
  if (id) return <CollapsibleGroup title={title} id={id} defaultOpen={defaultOpen}>{children}</CollapsibleGroup>;
  return <div style={first ? undefined : GROUP_FRAME}><div style={{ ...GROUP_HEADING, marginBottom: 8 }}>{title}</div>{children}</div>;
}

// Unterabschnitt: dünne Trennlinie darüber, damit er sich von den Reglern davor absetzt
const GROUP_FRAME = { marginTop: 4, paddingTop: 10, borderTop: `1px solid ${UI.borderControl}` };

const GROUP_HEADING = { fontSize: 10, color: UI.faint, letterSpacing: "0.1em", fontFamily: FONT };

function CollapsibleGroup({ title, id, defaultOpen, children }) {
  const [open, setOpen] = usePersistentState("open." + id, defaultOpen);
  return (
    <div style={GROUP_FRAME}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} style={{
        display: "flex", alignItems: "center", gap: 6, padding: 0, margin: "0 0 8px", background: "none", border: "none", cursor: "pointer",
      }}>
        {chevron(open)}<span style={GROUP_HEADING}>{title}</span>
      </button>
      {open && children}
    </div>
  );
}

/** Hinweiszeile (grau). Unter einem Schalter mit underToggle auf dessen Text eingerückt. */
export function Note({ children, underToggle, style }) {
  return (
    <div style={{ fontSize: 10, lineHeight: 1.45, color: UI.faint, fontFamily: FONT, margin: "-2px 0 8px", paddingLeft: underToggle ? TOGGLE_INDENT : 0, ...style }}>
      {children}
    </div>
  );
}

/** Warnung über die volle Breite, mit Warnzeichen. */
export function Warn({ children }) {
  return (
    <div role="alert" style={{
      display: "flex", gap: 6, alignItems: "baseline", fontSize: 10, lineHeight: 1.45, color: UI.error, fontFamily: FONT,
      background: UI.errorSoft, borderLeft: `2px solid ${UI.error}`, borderRadius: 3, padding: "4px 8px", margin: "-2px 0 8px",
    }}>
      <span aria-hidden>⚠</span><span>{children}</span>
    </div>
  );
}

/**
 * Schieberegler mit Zahlenfeld. Getipptes übernimmt das Zahlenfeld erst bei Enter oder Verlassen
 * (halbe Eingaben rechnen nicht); Enter verlässt danach das Feld, Esc verwirft die Eingabe und
 * verlässt es ebenfalls. Ungültige Eingaben werden verworfen. Solange nicht getippt wird,
 * zeigt es den aktuellen Wert mit einer Nachkommastelle (gerechnet wird mit dem genauen).
 *
 * Schritte über eigene ▲▼-Knöpfe (immer sichtbar, gedrückt halten wiederholt) und ↑/↓ – nicht über
 * die Pfeile des Browsers: die zählen ab min (bei gerechnetem min wie einem begrenzten Lₜ landet
 * „nach oben“ wieder auf demselben Wert) und verhalten sich in WebView2 (Tauri) anders als in Chrome.
 * Ein Schritt geht vom auf die Schrittweite gerundeten Wert aus (126,341 → 127 → 128) und wird auf
 * [min, max] begrenzt.
 */
export function Slider({ label, value, min, max, step, unit, onChange }) {
  const [draft, setDraft] = useState(null);   // Eingabe während des Tippens, sonst null
  const decimals = (String(step).split(".")[1] ?? "").length;
  const round = v => Number(v.toFixed(decimals));
  // Anzeige mit einer Nachkommastelle (feinere Schrittweite wie Le 0,01: deren Stellen), ohne unnötige Null
  const display = String(Number(value.toFixed(Math.max(1, decimals))));
  const clampTo = v => Math.max(min, Math.min(max, v));

  const discard = useRef(false);   // Esc: beim folgenden Verlassen nichts übernehmen
  const commit = () => {
    const v = parseFloat(draft);
    if (!discard.current && draft !== null && !isNaN(v)) onChange(clampTo(v));
    discard.current = false;
    setDraft(null);
  };

  // Schritt ±1 vom aktuellen Wert; während des Haltens neuester Wert über ref (Props ändern sich)
  const latest = useRef(value);
  useEffect(() => { latest.current = value; });
  const stepBy = dir => {
    setDraft(null);
    onChange(clampTo(round(Math.round(latest.current / step) * step + dir * step)));
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: ROW_COLUMNS, columnGap: ROW_GAP, alignItems: "center", marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: UI.label, fontFamily: FONT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={Math.min(Math.max(value, min), max)} aria-label={label}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", margin: 0, accentColor: UI.accent }} />
      <div style={{ position: "relative" }}>
        <input type="number" step={step} value={draft ?? display} aria-label={label}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === "Enter") e.currentTarget.blur();   // Verlassen übernimmt (onBlur → commit)
            else if (e.key === "Escape") { discard.current = true; e.currentTarget.blur(); }
            else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); stepBy(e.key === "ArrowUp" ? 1 : -1); }
          }}
          onWheel={e => e.currentTarget.blur()}   // Mausrad soll die Seite scrollen, nicht den Wert ändern
          style={{
            width: "100%", height: 22, padding: "0 17px 0 6px", background: UI.input, border: `1px solid ${UI.borderControl}`, borderRadius: 4,
            color: UI.text, fontSize: 11, fontFamily: FONT, textAlign: "right", fontVariantNumeric: "tabular-nums", boxSizing: "border-box",
          }} />
        <Stepper onStep={stepBy} label={label} />
      </div>
      <span style={{ fontSize: 10, color: UI.faint, fontFamily: FONT }}>{unit}</span>
    </div>
  );
}

/** ▲▼ rechts im Zahlenfeld: Klick = ein Schritt, gedrückt halten = wiederholen. */
function Stepper({ onStep, label }) {
  const timer = useRef(null);
  const stop = () => { clearTimeout(timer.current); timer.current = null; };
  useEffect(() => stop, []);
  const start = dir => e => {
    e.preventDefault();   // Fokus bleibt, wo er war; kein Textmarkieren beim Halten
    onStep(dir);
    const repeat = delay => { timer.current = setTimeout(() => { onStep(dir); repeat(60); }, delay); };
    repeat(400);
  };
  const half = (dir, top) => (
    <button type="button" tabIndex={-1} aria-label={`${label} ${dir > 0 ? "+" : "−"}`}
      onPointerDown={start(dir)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      style={{
        position: "absolute", right: 1, width: 14, height: 10, top: top ? 1 : 11, padding: 0, border: "none",
        background: "transparent", color: UI.faint, fontSize: 7, lineHeight: "10px", cursor: "pointer",
      }}
      onMouseEnter={e => { e.currentTarget.style.color = UI.text; }}
      onMouseLeave={e => { e.currentTarget.style.color = UI.faint; }}>
      {dir > 0 ? "▲" : "▼"}
    </button>
  );
  return <>{half(1, true)}{half(-1, false)}</>;
}

/** Ein/Aus-Schalter; die ganze Zeile ist klickbar und per Tastatur bedienbar. hint erscheint darunter. */
export function Toggle({ label, checked, onChange, hint }) {
  return (
    <>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", margin: "0 0 8px", padding: 0, background: "none", border: "none", minHeight: 20 }}>
        <span style={{
          width: 36, height: 20, borderRadius: 10, position: "relative", transition: "background 0.2s",
          background: checked ? UI.accent : UI.borderControl, flexShrink: 0,
        }}>
          <span style={{
            position: "absolute", top: 3, left: checked ? 19 : 3, width: 14, height: 14,
            borderRadius: "50%", background: checked ? UI.bg : UI.label, transition: "left 0.2s",
          }} />
        </span>
        <span style={{ fontSize: 11, color: checked ? UI.text : UI.label, fontFamily: FONT, userSelect: "none", textAlign: "left" }}>
          {label}
        </span>
      </button>
      {hint && <Note underToggle>{hint}</Note>}
    </>
  );
}

/** Auswahl aus mehreren Optionen als Knopfleiste. */
export function SegmentedButtons({ options, value, onChange, labels = {} }) {
  return (
    <div role="group" style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
      {options.map(o => (
        <button key={o} type="button" onClick={() => onChange(o)} aria-pressed={value === o} style={{
          flex: 1, height: 24, padding: "0 4px", borderRadius: 4, fontSize: 10, cursor: "pointer",
          border: `1px solid ${value === o ? UI.accent : UI.borderControl}`,
          background: value === o ? UI.accentSoft : UI.input,
          color: value === o ? UI.accent : UI.label,
          fontFamily: FONT, letterSpacing: "0.04em",
        }}>{labels[o] ?? o}</button>
      ))}
    </div>
  );
}

/** Schaltfläche über die volle Breite; primary hebt die Hauptaktion hervor, title ist der Tooltip. */
export function Button({ primary, onClick, disabled, title, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} style={{
      width: "100%", height: 30, marginBottom: 6, borderRadius: 5, cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.4 : 1,
      border: `1px solid ${primary ? UI.accent : UI.borderControl}`,
      background: primary ? UI.accentSoft : UI.button,
      color: primary ? UI.accent : UI.label,
      fontFamily: FONT, fontSize: 11, letterSpacing: "0.04em",
    }}>{children}</button>
  );
}

export function Stat({ label, value }) {
  return (
    <div style={{ background: UI.input, border: `1px solid ${UI.borderStat}`, borderRadius: 6, padding: "7px 10px" }}>
      <div style={{ fontSize: 9, color: UI.faint, marginBottom: 3, letterSpacing: "0.08em", fontFamily: FONT }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: UI.accent, fontFamily: FONT, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

const controlStyle = {
  background: UI.overlay, border: `1px solid ${UI.borderControl}`, borderRadius: 4,
  color: UI.muted, fontFamily: FONT,
};

/**
 * Titel einer Ansicht oben links, auf Höhe der Knöpfe; kürzt mit „…“, statt unter die Knöpfe zu laufen.
 * reserve = Platz rechts für Vollbild- und Zoom-Knöpfe [px].
 */
export function ViewTitle({ children, reserve = 160 }) {
  return (
    <div style={{
      position: "absolute", top: 6, left: 12, right: reserve, height: 24, display: "flex", alignItems: "center", pointerEvents: "none",
      fontSize: 9, color: COLOR.text, fontFamily: FONT, letterSpacing: "0.12em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
    </div>
  );
}

/** Zoomstufe + Zurücksetzen oben rechts (Standard: links neben dem Vollbild-Button). */
export function ZoomControls({ k, onReset, top = 6, right = 36, compact = false }) {
  const tr = useT();
  const h = compact ? 18 : 24, fs = compact ? 9 : 10;
  return (
    <div onPointerDown={e => e.stopPropagation()} style={{
      position: "absolute", top, right, zIndex: 10, display: "flex", gap: 4, alignItems: "center",
    }}>
      <span style={{ ...controlStyle, fontSize: fs, height: h, boxSizing: "border-box", padding: "0 6px", display: "flex", alignItems: "center" }}>
        {Math.round(k * 100)} %
      </span>
      <button type="button" onClick={onReset} title={tr("view.resetZoom")}
        style={{ ...controlStyle, fontSize: fs, height: h, padding: compact ? "0 5px" : "0 7px", cursor: "pointer" }}>
        {tr("view.reset")}
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
  const tr = useT();
  const [full, setFull] = useState(false);
  return (
    <div style={full
      ? { position: "fixed", top: 0, right: 0, bottom: 0, left: SIDEBAR_WIDTH, zIndex: 1000, background: UI.bg }
      : { position: "relative", width: "100%", height: "100%" }}>
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
        <button type="button" onClick={() => setFull(f => !f)} title={full ? tr("view.exitFullscreen") : tr("view.fullscreen")} style={{
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
