// Farben, Schrift und wiederkehrende SVG-Stile der Oberfläche (Dark Mode, neutrales Grau).

export const FONT = "'DM Mono', monospace";

/** Außenbreite der Seitenleiste mit den Eingaben [px] inkl. Rahmen; das Vollbild einer Ansicht lässt sie frei. */
export const SIDEBAR_WIDTH = 397;

/** Oberfläche: Hintergründe, Rahmen, Text, Akzent. */
export const UI = {
  bg:            "#121212",
  panel:         "#161616",
  card:          "#1a1a1a",
  input:         "#1c1c1c",
  button:        "#1e1e1e",
  border:        "#262626",
  borderCard:    "#292929",
  borderStat:    "#2e2e2e",
  borderControl: "#303030",
  // Textstufen; Kontrast auf UI.card (#1a1a1a): text 14:1, label 6,6:1, faint 4,7:1, muted 4,3:1
  text:          "#e4e4e4",
  label:         "#9e9e9e",
  value:         "#9a9a9a",
  muted:         "#808080",
  subtle:        "#404040",
  faint:         "#858585",
  accent:        "#d6cbb8",
  accentSoft:    "rgba(214,203,184,0.15)",
  overlay:       "rgba(20,20,20,0.85)",
  error:         "#fca5a5",
  errorSoft:     "rgba(252,165,165,0.07)",
  scrollThumb:   "#2e2e2e",
  scrollThumbHover: "#3c3c3c",
};

/** Globale Regeln (main.jsx): dunkle, schmale Scrollbars; Zahlenfelder ohne Browser-Pfeile (eigene ▲▼, ui.jsx). */
export const GLOBAL_CSS = `
  * { scrollbar-width: thin; scrollbar-color: ${UI.scrollThumb} transparent; }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${UI.scrollThumb}; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: ${UI.scrollThumbHover}; }
  input[type=number] { -moz-appearance: textfield; appearance: textfield; }
  input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  button:focus-visible, input:focus-visible { outline: 1px solid ${UI.accent}; outline-offset: 1px; }
`;

/** Zeichnungen: jede Geometrie hat ihre Farbe, Bemaßungen übernehmen sie. */
export const COLOR = {
  trak:         "#f9a8d4",               // Traktrix
  klo:          "#93c5fd",               // Klothoide (krümmungsstetiger Übergang)
  horn:         "#86efac",               // gerade Wand / Aufweitung
  arc:          "#d6cbb8",               // Mundbogen, Fokus
  raum:         "#fdba74",               // Raumecke
  trans:        "#fca5a5",               // Übergangspunkte, Verrundung
  wand:         "#fcd34d",               // Wandstärke
  flansch:      "#c4b5fd",               // Throat-Flansch
  konflikt:     "#ef4444",               // Flanschbohrung im Konflikt mit der Schale
  dim:          "#5a5a78",               // allgemeine Bemaßung
  dimL:         "#6868a0",               // Gesamtlänge L
  text:         "#5a5a5a",               // Beschriftungen, Titel
  tick:         "#404040",               // Achsenwerte im Diagramm
  axis:         "#3a3a3a",               // Mittelachsen, Diagrammachsen
  driv:         "#888898",               // Treiber (Seitenriss)
  drivFill:     "rgba(26,26,26,0.55)",
  drivPlan:     "#363650",               // Treiber (Draufsicht)
  drivPlanFill: "rgba(26,26,26,0.6)",
  fillTrak:     "rgba(249,168,212,0.09)",
  fillHorn:     "rgba(134,239,172,0.08)",
  fillFlansch:  "rgba(196,181,253,0.14)",
  fillWand:     "rgba(252,211,77,0.10)",
  spl:          "#7dd3fc",               // Frequenzgang: Schalldruckpegel
  imp:          "#a5b4fc",               // Frequenzgang: elektrische Impedanz
  phase:        "#5f8fa8",               // Frequenzgang: Phase des Schalldrucks
  fill1D:       "rgba(252,165,165,0.06)", // Frequenzgang: Bereich, in dem das 1D-Modell unsicher ist
};

/** Radius der Punkt-Markierungen [px]. */
export const DOT = 2.5;

/** Wiederkehrende SVG-Attribute. */
export const S = {
  trakWall: { fill: "none", stroke: COLOR.trak, strokeWidth: "1.4", strokeLinejoin: "round" },
  kloWall:  { fill: "none", stroke: COLOR.klo,  strokeWidth: "1.4", strokeLinejoin: "round" },
  hornWall: { fill: "none", stroke: COLOR.horn, strokeWidth: "1.4", strokeLinejoin: "round" },
  dimRef:   { strokeWidth: "0.35", strokeDasharray: "3 3" },
  label:    { fontSize: "9", fontFamily: FONT },
};

/** Strichpunkt der Raumecke: Strich 75 + Lücke 10 + Punkt 5 + Lücke 10 = 100 mm pro Zyklus,
 *  gibt beim Ablesen ein Maßgefühl (1 Strich + Punkt = 10 cm). */
export const RAUM_DASH_MM = [75, 10, 5, 10];
export const raumDash = scale => RAUM_DASH_MM.map(mm => mm * scale).join(" ");
/** Versatz, der die Mitte eines Strichs auf den Linienanfang legt (Muster symmetrisch zur Achse). */
export const raumDashCenter = scale => RAUM_DASH_MM[0] / 2 * scale;
