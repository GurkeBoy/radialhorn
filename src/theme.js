// Farben, Schrift und wiederkehrende SVG-Stile der Oberfläche (Dark Mode, neutrales Grau).

export const FONT = "'DM Mono', monospace";

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
  text:          "#e4e4e4",
  label:         "#8a8a8a",
  value:         "#9a9a9a",
  muted:         "#6e6e6e",
  subtle:        "#404040",
  faint:         "#3a3a3a",
  accent:        "#d6cbb8",
  accentSoft:    "rgba(214,203,184,0.15)",
  overlay:       "rgba(20,20,20,0.85)",
  error:         "#fca5a5",
};

/** Zeichnungen: jede Geometrie hat ihre Farbe, Bemaßungen übernehmen sie. */
export const COLOR = {
  trak:         "#f9a8d4",               // Traktrix
  horn:         "#86efac",               // gerade Wand / Aufweitung
  arc:          "#d6cbb8",               // Mundbogen, Fokus
  raum:         "#fdba74",               // Raumecke
  trans:        "#fca5a5",               // Übergangspunkte, Verrundung
  wand:         "#fcd34d",               // Wandstärke
  dim:          "#5a5a78",               // allgemeine Bemaßung
  dimL:         "#6868a0",               // Gesamtlänge L
  text:         "#5a5a5a",               // Beschriftungen, Titel
  tick:         "#404040",               // Achsenwerte im Diagramm
  axis:         "#3a3a3a",               // Mittelachsen, Diagrammachsen
  driv:         "#888898",               // Treiber (Seitenriss)
  drivFill:     "rgba(26,26,26,0.55)",
  drivPlan:     "#363650",               // Treiber (Draufsicht)
  drivPlanDiag: "#303048",
  drivPlanFill: "rgba(26,26,26,0.6)",
  fillTrak:     "rgba(249,168,212,0.09)",
  fillHorn:     "rgba(134,239,172,0.08)",
  fillArc:      "rgba(147,197,253,0.06)",
};

/** Radius der Punkt-Markierungen [px]. */
export const DOT = 2.5;

/** Wiederkehrende SVG-Attribute. */
export const S = {
  trakWall: { fill: "none", stroke: COLOR.trak, strokeWidth: "1.4", strokeLinejoin: "round" },
  hornWall: { fill: "none", stroke: COLOR.horn, strokeWidth: "1.4", strokeLinejoin: "round" },
  dimRef:   { strokeWidth: "0.35", strokeDasharray: "3 3" },
  label:    { fontSize: "9", fontFamily: FONT },
};

/** Strichpunkt der Raumecke: ein Zyklus ≈ 92 mm, gibt beim Ablesen ein Maßgefühl. */
export const raumDash = scale => `${70 * scale} ${9 * scale} ${4 * scale} ${9 * scale}`;
