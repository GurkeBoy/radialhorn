# Radialhorn-Konfigurator

React + Vite + Tauri App zur Berechnung und Visualisierung von Radialhörnern mit Traktrix-Eingang. Lautsprecher-Horn-Design-Tool für den Eigenbau.

**Dev-Server:** `npm run dev` → http://localhost:1420 · **Desktop-App:** `npm run tauri dev` · **Tests:** `npm test`

## Projektstruktur

```
src/
  App.jsx        — UI, SVG-Komponenten, PDF/DXF-Export (alles in einer Datei)
  horn-math.js   — Geometrie-Mathematik (zN, xN, solveR0, solveHorn, ...)
  horn-math.test.js / horn-math.cross-validate.test.js — Vitest-Tests
```

## Mathematik

Die Traktrix-Kurve wird in drei Abschnitte unterteilt:

1. **Traktrix-Eingang** (0 → zTrans): parametrisch über `t` von `tTh` bis `T_TRANS`
   - `zN(t) = t - tanh(t)`, `xN(t) = 1/cosh(t)`
2. **Linearer Bereich** (zTrans → zMouth): gerade Flanken mit Winkel ALPHA2, radial zum Fokuspunkt
3. **Teilkreis** (Mundbogen): Kreisbogen mit Radius arcR um den Fokuspunkt zFocus

Globale Geometrie-Variablen (werden per `openingAngle` gesetzt): `ALPHA2`, `T_TRANS`, `PHI_TOTAL`

**Wichtige Invarianten nie brechen:** `solveR0`, `solveHorn`, `zN`, `xN`

## Koordinatensysteme

**HornSVG (Draufsicht / Horizontalschnitt)**
- z-Achse: vertikal im SVG (Treiber oben bei z=0, Mund unten bei z=zApex)
- x-Achse: horizontal, symmetrisch um Mittellinie
- `toX(x) = cx + x * scale`, `toY(z) = topOffset + (z - zMin) * scale`

**SeitenrissSVG (Seitenriss / Vertikalschnitt)**
- z-Achse: horizontal (links=Treiber bei z=0, rechts=Mund bei z=zApex)
- h-Achse: vertikal, symmetrisch um cy
- Portrait-Modus dreht die Achsen

**Zoom/Pan (`useZoomPan`)**
- Bildschirm-Transformation `p' = t + k·p` auf die Basis-Abbildung (Standard-Zoom, zentriert)
- In den Ansichten: `scale = scale0 * k`, Offsets/`toX`/`toY` entsprechend transformiert
- Nur die Geometrie skaliert; Bemaßungsabstände, Text, Punkte und Strichstärken sind Pixelwerte und bleiben konstant
- Titelzeilen bleiben fest (nutzen Basis-Koordinaten, z.B. `cx0`)
- Querschnittsgraph: Daten-Zoom mit `minZoom: 1` und `unitsPerPx` (SVG per viewBox skaliert). Achsen sitzen im Datenursprung und wandern beim Verschieben mit (am Plotrand festgehalten, wenn der Ursprung aus dem Bild läuft), Kurve per `clipPath` beschnitten; Übergang Traktrix → linear ist eigener Stützpunkt (Farbwechsel exakt bei zInnerApex); Achsenwerte = markante Werte (Start, Traktrix-Ende, Mund; 0/½/max) plus beim Zoomen runde Zwischenwerte (`niceTicks`). Zurück auf 100 % setzt auch die Verschiebung zurück.

**DXF-Export**
- Draufsicht: Wandpunkte `[x, z]` → `[z, x]` (DXF x=Tiefe, y=Breite)
- Seitenprofil: `[z, h]` → `[z, 0, h]` (3D, z=Tiefe, y=0, z=Höhe)

## Farbschema (Neutral Dark Mode)

```js
const COLOR = {
  trak:     "#f9a8d4",  // Traktrix-Wände (Rosa)
  horn:     "#86efac",  // Linearer Bereich (Mint)
  arc:      "#d6cbb8",  // Teilkreis/Bogen (Sandbeige)
  raum:     "#fdba74",  // Raumecke (Orange)
  dim:      "#5a5a78",  // Bemaßungslinien
  dimL:     "#6868a0",  // L-Bemaßung
  trans:    "#fca5a5",  // Übergangspunkte (Koralle)
  driv:     "#888898",  // Treiber-Box
  text:     "#5a5a5a",  // Beschriftungen
  axisH:    "#3a3a3a",  // Mittelachse Draufsicht
  axisS:    "#3a3a3a",  // Mittelachse Seitenriss
  drivFill: "rgba(26,26,26,0.55)",
  wand:     "#fcd34d",  // Wandstärke (Gelb)
}
```

**UI-Hintergründe (neutrales Grau, kein Blau-/Lila-Tint):**
- App-Hintergrund: `#121212`
- SVG-Panels: `#161616`
- Sidebar-Karten / Inputs: `#1a1a1a` / `#1c1c1c` / `#1e1e1e`
- Borders: `#262626` / `#292929` / `#303030`
- Hauptakzent: `#d6cbb8` (Sandbeige)

## Bemaßungsregeln

**Platzierung**
- Alle Maßlinien außerhalb der Konstruktionsgeometrie — und außerhalb der Raumecke
- Engeres/inneres Maß → 1. Lage (näher am Konstrukt); breiteres/äußeres → 2. Lage
- 1. Lage: 18px vom äußersten Geometriepunkt; 2. Lage: +22px Lagenabstand (= 40px)

**Hilfslinien:** gestrichelt `strokeDasharray="3 3"`, `strokeWidth="0.35"` (`S.dimRef`), Start 2px vom Geometriepunkt, Ende 2px über die Maßlinie hinaus.

**Betrag (Text):** `textAnchor="middle"`, 8px neben der Maßlinie auf der **äußeren Seite** (von der Geometrie weg). Horizontal: `y = ay ± 8`; vertikal: `rotate(-90, ax ± 8, center_y)` mit `dominantBaseline="central"`.

**Farbe:** Maßlinie, Hilfslinien und Text immer in der Farbe des bemaßten Elements.

**`Dim`** (waagerecht/senkrecht) erkennt die Orientierung automatisch aus p1/p2:
- `|dy| >= |dx|` → senkrechte Ausdehnung → vertikale Maßlinie (links/rechts)
- `|dx| > |dy|` → waagerechte Ausdehnung → horizontale Maßlinie (oben/unten)
- `arrowPos`: absolute Koordinate der Maßlinie (x für vertikal, y für horizontal)
- `orient="v"|"h"` erzwingt die Orientierung — nötig bei 45°-Strecken (z.B. Hut-Spitze → Treiberecke), wo Rundung sonst zufällig entscheidet
- Zusammenhängende Maße als Kette auf derselben Lage (z.B. Hut-Spitze → Treiberrückseite → Treiberfront)

**`DimAligned`** (schräge Linien): Bemaßung parallel zur Linie, `offset` senkrecht dazu (positiv = links von p1→p2). Offset wird dynamisch berechnet, sodass die Maßlinie 18px außerhalb aller Hindernisse (Raumecke, Treiber, Traktrix) im Bereich der Bemaßung liegt, mindestens 18px (siehe `wallDimOff` in HornSVG). Text wird so gedreht, dass er nie auf dem Kopf steht.

**Bemaßungswerte: axiale Projektion vs. physische Länge.** Eine parallel zur Wand platzierte Bemaßung zeigt die physische Wandlänge (`sqrt(dx²+dy²)`), nicht die axiale Projektion. Beide Ansichten (Draufsicht + Seitenprofil) zeigen den gleichen Wert für dasselbe physische Element. Bei Widersprüchen zwischen Nutzerbeschreibung und Geometrie aktiv nachfragen: „Meinst du die axiale Projektion oder die physische Länge?" – niemals stillschweigend eine korrekte Implementierung auf Zuruf ändern.

**Lagen-Belegung**
- Draufsicht rechts, 1. Lage (`bx`): Kette Hut-Spitze → Treiberrückseite (dw/2, Raumecke-Farbe) → Treiberfront (dh); 2. Lage: Traktrix axial
- Draufsicht links, schräg: linearer Bereich (1. Lage) und Fokus → Mund (2. Lage), außerhalb der Raumecke
- Seitenriss oben, 1. Lage (`dimDrivTopAy`): Kette dw/2 → dh; 2. Lage (`dimTrakAy`): Kette Traktrix → Mund (axial); Rand oben `mT` reserviert Platz für Titel + zwei Lagen

**Endpunkte von Linien:** gefüllter Kreis `r = DOT`, Farbe der zugehörigen Linie.

## Strichstärken (SVG)

- Hauptkurven (Traktrix, Horn, Bogen, Wandstärke): `1.4`
- Throat-Linien, Raumecke-Strich, Querschnittsgraph: `1.2`
- Innerer gestrichelter Übergangsbogen: `0.9`
- Bemaßungspfeil: `0.7`
- Bemaßungshilfslinien: `0.35`
- Mittelachse: `0.6`
- Treiber-Rahmen: `1.3`

## Export

**DXF** (`exportDXF`): Traktrix und Exponential/Hypex-Flare als echte SPLINE-Entities (kubische B-Spline-Interpolation, `fitBSpline`), Mundbogen als ARC, gerade Abschnitte als LINE, Konstruktionspunkte als POINT. Layer `Draufsicht_Wand`, `Mundbogen`, `Fokus`, `Seitenprofil_Throat`, `Seitenprofil_Flare`, `Uebergang`. Steuerbar über Toggles im UI.

**PDF** (`exportPDF`): Öffnet HTML mit zwei SVG-Zeichnungen (Draufsicht + Seitenprofil) in neuem Fenster → Strg+P → Als PDF speichern. Maßstab wird automatisch gewählt (1:1, 1:2, 1:5, 1:10, ...). Bemaßungen als Template-Literal-Funktionen `dimH`/`dimV`/`dimParallel` (kein React). Die Kurven-Toggles des Exports steuern auch das PDF; zusätzlich Toggle „Bemaßungen“. Maßbeschriftungen zeigen immer die tatsächlich überspannte Strecke (wie am Bildschirm).

**Kurvenauflösung:** Bildschirm/PDF fein (Traktrix 600 bzw. 500 Punkte, Flare 500). Der DXF-Spline-Fit bekommt bewusst weniger Stützpunkte (`genDraufsichtWandSplit` 80, `genSeitenprofilFlare` Standard 100) — der Fit ist O(n³) und die Splines bleiben schlank.

## Raumecke

Strichpunktlinie mit 100mm-Zyklus: `strokeDasharray="${70*scale} ${9*scale} ${4*scale} ${9*scale}"`
→ 1 Strich + Punkt ≈ 10 cm, gibt intuitives Maßgefühl.
