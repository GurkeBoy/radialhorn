# Radialhorn-Konfigurator

React + Vite + Tauri App zur Berechnung und Visualisierung von Radialhörnern mit Traktrix-Eingang. Lautsprecher-Horn-Design-Tool für den Eigenbau.

## Befehle

| | |
|---|---|
| `npm run dev` | Web-Version, http://localhost:1420 |
| `npm run tauri dev` | Desktop-App (startet Vite selbst, Port 1420 muss frei sein) |
| `npm test` | Vitest |
| `npm run lint` | ESLint (inkl. React-Hook-Regeln) |

Vor jedem Commit: `npm run lint` und `npm test` grün.

## Projektstruktur

```
src/
  main.jsx, App.jsx        — Einstieg; App: Zustand, abgeleitete Geometrie (useMemo), Layout
  horn-math.js             — gesamte Geometrie-Mathematik, rein funktional
  horn-mesh.js             — 3D-Körper (Luftvolumen und Schale) als strukturierte Flächengitter
  mesh-buffers.js          — 3D-Netz als Float32-Puffer je Sektion (für den Worker)
  mesh.worker.js           — Web Worker: baut das 3D-Netz abseits des Haupt-Threads
  theme.js                 — Farben (UI, COLOR), Schrift, SVG-Stile, Raumecken-Strichmuster
  utils.js                 — linspace, clamp, svgPath, niceTicks
  hooks.js                 — useSize, useZoomPan, usePersistentState, useThrottledValue
  settings.js              — gespeicherte Einstellungen (localStorage, je Wert geprüft gegen den Standard)
  components/
    ui.jsx                 — Card, Slider, Toggle, SegmentedButtons, Stat, Warn, ZoomControls, FullscreenPanel, ArrowMarker
    Dim.jsx                — Bemaßungen Dim (waagerecht/senkrecht) und DimAligned (schräg)
    Draufsicht.jsx, Seitenriss.jsx, Querschnitt.jsx — 2D-Ansichten und Diagramm
    Ansicht3D.jsx          — 3D-Ansicht (three.js, OrbitControls, Netz aus dem Worker, Zeichnen nur bei Bedarf)
    FlanschSchnitt.jsx     — Schnittfläche des Throat-Flanschs (Draufsicht, Seitenriss; Kontur: flangeSectionOutline)
    WandSchnitt.jsx        — Schnittfläche der Schale (Wandstärke) in Draufsicht und Seitenriss
  export/
    bspline.js             — kubische B-Spline-Interpolation für DXF-SPLINEs
    dxf.js                 — DXF-Writer (buildDXF) und Export
    pdf.js                 — PDF-Datenblatt (buildDatasheet) und Export
    stl.js                 — STL-Export (binär) von Luftvolumen bzw. Schale
    download.js            — Datei-Download
  *.test.js                — Vitest, neben dem getesteten Modul
```

## Architektur

- **Mathematik nur in `horn-math.js`**, keine Geometrie in Komponenten. Funktionen sind rein, es gibt keinen globalen Zustand.
- **Öffnungswinkel:** `createHornMath(openingAngle)` liefert die winkelabhängigen Funktionen (`solveHorn`, `minL`, `maxLt`, `maxLforRaumecke`, `minLtForRaumecke`) samt `ALPHA2`/`T_TRANS`/`PHI_TOTAL`. Die Modul-Exporte gleichen Namens gelten für 140° (Tests).
- **Lösung `s`** (aus `solveHorn`) trägt ihren Winkel mit (`openingAngle`, `alpha2`, `tTrans`). Alles Nachgelagerte – Abtastung, Querschnitt, Kennwerte, Export, Ansichten – braucht nur `s`.
- **Profil:** `makeProfile(s, rt, hMouth, curve, hypexT, fillet)` liefert `z ↦ halbe Höhe`; App erzeugt es einmal (useMemo) und reicht es an Seitenriss, Querschnitt, Kennwerte und PDF weiter.
- **App.jsx** rechnet Grenzen und Lösung in einem `useMemo` (die Grenzsuchen sind verschachtelte Bisektionen). Exporte bekommen ein `design`-Objekt plus Layer-Auswahl.
- **Flüssige Regler** (Messung: vorher ~300 ms je Regler-Schritt mit Schale + Flansch):
  - Regler zeigen den Live-Zustand; alles Abgeleitete (Rechnung, Ansichten, Export) hängt an `p = useThrottledValue(live)`. Beim Ziehen zieht `p` laufend nach, die nächste Runde erst nach dem Neuzeichnen plus kurzer Pause – die Eingabe bleibt bedienbar, die Ansichten aktualisieren so schnell sie rechnen. Nicht `useDeferredValue`: dessen Hintergrund-Render wird bei jeder Reglerbewegung neu begonnen, beim Dauerziehen standen die Ansichten still. Regler mit gerechnetem Wert (L, Lt, Flansch-Ø, Lochkreis) zeigen während des Ziehens den Live-Wert (`shown`).
  - Ansichten sind `memo`; teure Kurven in `useMemo` nur abhängig von der Geometrie (nicht von Zoom/Verschieben).
  - 3D-Netz im Web Worker (`mesh.worker.js` → `meshBuffers`): Eingaben sind reine Daten (`s`, `fillet`, `flange` sind klonbar), das Profil baut der Worker mit `makeProfile` nach. Höchstens eine Berechnung läuft, neuere Eingaben ersetzen wartende. Bezug und Konflikt-Bohrungen werden nur bei geänderten Werten neu gebaut, Zeichnen gebündelt per `requestAnimationFrame`.
  - `horn-mesh.js`: nächster Wandpunkt und Einhüllende per binärer Suche im z-Fenster statt über alle Wandpunkte, Außenkörper zwischengespeichert (flangeLayout und buildShellGeometry teilen ihn), `triangulate` ohne Hilfs-Arrays; Bisektionen brechen ab, sobald die Fließkomma-Auflösung erreicht ist. Alle Änderungen ergebnisgleich (Bit für Bit gegen einen Referenzstand geprüft).
  - Im Entwicklungsmodus (`tauri dev`) ist alles langsamer: `React.StrictMode` rendert absichtlich doppelt, React läuft ohne Optimierung.
- **Farben/Stile** nur aus `theme.js`, keine hartkodierten Farbwerte in Komponenten.
- `hasTraktrix(s)` statt `s.Lt > 0.5` (Schwelle `LT_MIN`).

## Mathematik

Horizontale Kontur in drei (mit Klothoide vier) Abschnitten:

1. **Traktrix-Eingang**: parametrisch über `t` von `tTh` bis `tEnd`, `zN(t) = t − tanh(t)`, `xN(t) = 1/cosh(t)`; ohne Klothoide ist `tEnd = T_TRANS` (Tangente erreicht α)
2. **Klothoide** (optional, `createHornMath(winkel, { clothoid: ℓ })`): krümmungsstetiger Übergang, Krümmung fällt linear von der Traktrix-Krümmung 1/(r0·sinh τ) auf 0. Beginnt bei τa mit ℓ = 2·(α − θ(τa)) / κ(τa), endet mit Winkel α. Lt = axiale Länge von Traktrix + Klothoide bis zum Beginn der Geraden; r0 wird dafür gelöst (eingegrenztes Illinois-Verfahren, Ergebnis wird nachgeprüft – an der Sprungstelle „Klothoide passt gerade nicht“ gibt es keine Lösung). Mindest-Lt: `minLtForClothoid`. `transition` wird je Instanz zwischengespeichert (Grenzsuchen rufen es tausendfach).
3. **Gerade Wand** (zTrans → zMouth): unter ALPHA2, radial zum Fokuspunkt (mit Klothoide liegt der Fokus etwas anders)
4. **Mundbogen**: Kreisbogen mit Radius arcR um den Fokus zFocus

**Treiber:** Zylinder mit Durchmesser dw und Länge dh, Achse = Hornachse z, Front bei z = 0 (in beiden Schnitten ein Rechteck dw × dh).

**L** wird von der Hut-Spitze der Raumecke (`hatTipZ = −dh − dw/2`) bis zum Mundscheitel `zApex` gemessen.

**Seitenriss-Profil** (`verticalHalfHeight`): waagerechter Throat (h = rt) bis zInnerApex, danach Aufweitung Linear/Exponential/Hypex bis hMouth/2. Der Hypex-Exponent wird gecacht (der Verrundungs-Solver wertet das Profil zehntausendfach aus).

**Verrundung des Übergangs** (`computeFillet`): Kreis tangential an Throat und Aufweitung, Mittelpunkt (zc, rt + R) außerhalb der Wand, Tangentenpunkt T2 per Bisektion. Zu große Radien werden auf den größten machbaren begrenzt (`limited`). Wirkt auf Seitenriss, Querschnitt, PDF und DXF; Sektionsfarben und Maße bleiben an zInnerApex getrennt. Nur mit Traktrix-Eingang.

**Querschnitt** (`crossSection`): Wellenfront = Kreisbogen um den Schnittpunkt der Wandtangente mit der Achse (gerader Bereich: Fokus, wachsender Radius; Traktrix: mitwandernder Tangentenfuß, Radius r0 – Voigt; Klothoide: allgemeine Regel). Sektionen `part`: traktrix / klothoide / linear. A = ∫ 2h ds über den Bogen mit der Höhe nach der 3D-Regel h = Profil(zFocus + Abstand zum Fokus); im geraden Bereich ist h auf dem Bogen konstant, auf der Traktrix wird im Verrundungsband numerisch integriert. Der Übergang Traktrix → gerade Wand ist eigener Stützpunkt. A ist dort stetig, hat aber einen Knick: die Wandkrümmung springt (Traktrix → Gerade), und die Wellenfrontbreite hängt vom Tangentenwinkel ab (Steigung von B: 2·sin α → 2·α). Mit Klothoide ist die Krümmung stetig und A glatt (Tests prüfen beide Fälle).

**3D-Körper** (`horn-mesh.js`, vereinbarte Konstruktion):
- Traktrix-Sektion: senkrechte Wände entlang der Traktrix, Grundfläche wie in der Draufsicht bis zum inneren Teilkreis (Radius rInner um den Fokus).
- Gerader Bereich: senkrechte Wände im Öffnungswinkel; Deckel und Boden = Rotation des Seitenprofils um die senkrechte Achse durch den Fokus.
- Eine Höhenregel für den ganzen Körper: halbe Höhe = Profil(zFocus + Abstand zum Fokus). Im Prisma ergibt das rt; mit Verrundung steigt der Deckel im Ringband vor dem inneren Teilkreis an (Variante a – wie im Seitenriss).
- Flächen als Gitter: Traktrix-Grundfläche als Coons-Fläche (Ränder Throat, Traktrix links/rechts, innerer Teilkreis), gerader Bereich als Polargitter; Nachbarflächen teilen die Randpunkte exakt → wasserdicht. Kappen an Throat und Mund schließen das Volumen (nur für die STL).
- **Schale** (Wandstärke an): Dicke t senkrecht zur Fläche, scharfe Außenkanten, eine Stärke für alles. Throat: bündig in der Ebene z = 0. Mund: Deckel/Boden außen höchstens hMouth/2 + t (am Mund senkrecht nach oben/unten gemessen, waagerecht abgeschnitten), Stirnfläche bündig auf dem Mundbogen; Seitenwände laufen über die volle Höhe durch und enden senkrecht zur Wand durch die Mundkante (wie der Wandstärke-Strich in der Draufsicht und die Raumecken-Rechnung). Über den Seitenwänden hat der Außenkörper dafür je einen Eckstreifen (Coons-Fläche zwischen Wand, Außenkante, Naht und Endlinie). Außenkörper = derselbe Aufbau mit versetzter Kontur und eigener Höhe. Kontur: Einhüllende der Kreise mit Radius t um die Wandpunkte (`contourRight`) – schneidet die Schlaufe ab, die die einfache Parallelkurve der Traktrix bei t > Krümmungsradius bildet; die Naht zum Rotationsteil liegt dort, wo die Einhüllende in die Parallele der geraden Wand übergeht. Höhe (`outerHeightField`): über der Grundfläche die senkrechte Aufdickung des Deckels (eben rt + t, ansteigender Teil als Einhüllende, im Öffnungssektor radial über `offsetHeight`), außerhalb der Wert am nächsten Wandpunkt – der Deckel wird senkrecht zur Wand bis zur Außenkante verlängert (scharfe Kante). Die Traktrix-Sektion bleibt so auch bei großen Wandstärken außen eben. An konkaven Knicken treffen sich außen zwei Versatzflächen in einer Kante – die Wand ist dort minimal dicker als t, nie dünner. Verrundungen mit R < t werden außen zur Kante. Schale = Außenkörper + Luftvolumen mit umgedrehten Flächen + Ringflächen an Throat und Mund.
- **Schale in 2D:** Draufsicht und Seitenriss zeigen den Schnitt durch die Schale aus derselben Rechnung wie der 3D-Körper – `shellPlanOutline` (Kontur des Außenkörpers bei h = 0 bis zum Seitenwandende E = Mundkante + t·Normale) und `shellProfileOutline` (Höhe des Außenkörpers auf der Achse x = 0, am Mund auf hMouth/2 + t begrenzt). Mit Flansch beginnen beide erst bei z = Flanschdicke.
- **Flansch am Throat** (eigener Schalter, nur mit Wandstärke): runde Platte auf der Hornseite, z ∈ [0, Dicke], Öffnung = Throat-Querschnitt (Quadrat 2·rt). Der Außenkörper beginnt dann erst bei z = Dicke (`zStart` in `body`/`contourRight`); statt des Throat-Rings: Rückseite (Kreis − Luftkanal − Bohrungen), Vorderseite (Kreis − Außenkörper − Bohrungen), Zylindermantel, Bohrungswände. Die ebenen Flächen trianguliert earcut (`ShapeUtils.triangulateShape`); earcut lässt kollineare Randpunkte weg – `planarFace` setzt sie wieder in die Kanten ein, sonst gäbe es T-Stöße zur Schale. `flangeLayout` löst die Vorgaben auf: Ø mindestens der Umkreis des Außenkörpers bei z = Dicke (kleinerer Ø wird angehoben, `limited`); ohne Ø-Vorgabe dw, mindestens Minimum + 4·Bohrungs-Ø + 4 mm; ohne Lochkreis mittig zwischen Minimum und Rand; Bohrungen, die nicht ganz im Ring liegen, entfallen (`invalidHoles`, Warnung). Standard (Bohrbild BMS 4591): 10 mm, 4 × Ø 6,6 mm (M6 durch) auf Lochkreis 101,6 mm, 12, 3, 6, 9 Uhr (Winkellage 0°, gemessen von der Breitenachse). Durchgangsbohrungen, die in der Schale landen (`conflicts`), werden nicht gebohrt (Körper und STL bleiben dicht), aber angezeigt: in 3D rot markiert (Scheibe auf der Rückseite, Ringe an Rück- und Vorderseite), im DXF auf Layer `Flansch_Konflikt`. Konflikt-Lösung offen.
- Die Wellenfront-Betrachtung für den Querschnitt im Traktrix-Bereich ist noch offen.

**Kennwerte:** `mouthArea`, `verticalMouthAngle`, `frequencyEstimates` (Näherungen nach Olson/Beranek, aus der Mundfläche = Bogenlänge × Mundhöhe: fc_low über den flächengleichen Kreismund, fc_cut über m = ln(A_Mund / (2·rt)²) / L).

**Invarianten nie brechen:** `solveR0`, `solveHorn`, `zN`, `xN` – die Tests prüfen sie gegen unabhängige Referenzen (analytisch, numerische Integration, Skalierung).

## Koordinatensysteme

- **Draufsicht:** z-Achse vertikal (Treiber oben bei z = 0, Mund unten), x horizontal symmetrisch. `toX(x) = cx + x·scale`, `toY(z) = topOffset + (z − zMin)·scale`.
- **Seitenriss:** z horizontal (links Treiber, rechts Mund), h vertikal symmetrisch um `cy`.
- **Zoom/Pan** (`useZoomPan`): Bildschirm-Transformation `p' = t + k·p` auf die Basis-Abbildung. Nur die Geometrie skaliert; Bemaßungsabstände, Text, Punkte und Strichstärken sind Pixelwerte. Titel bleiben fest.
- **Querschnitt:** Daten-Zoom (`minZoom: 1`, `unitsPerPx` wegen viewBox). Achsen im Datenursprung, wandern mit und bleiben am Plotrand, wenn der Ursprung aus dem Bild läuft. Achsenwerte: markante Werte plus beim Zoomen `niceTicks`.
- **DXF:** Draufsicht `[x, z] → (X = z, Y = x)`, Seitenprofil `[z, h] → (X = z, Y = 0, Z = h)`.

## Farbschema

Alle Werte in `theme.js`: `UI` (Oberfläche, neutrales Grau ohne Blau-/Lila-Tint, Akzent Sandbeige `#d6cbb8`) und `COLOR` (Zeichnungen: Traktrix Rosa, gerade Wand Mint, Mundbogen Sandbeige, Raumecke Orange, Übergänge Koralle, Wandstärke Gelb, Flansch Violett, Bemaßung Grau-Violett). Das PDF hat ein eigenes helles Schema in `export/pdf.js`.

## Bemaßungsregeln

**Platzierung**
- Alle Maßlinien außerhalb der Konstruktionsgeometrie – und außerhalb der Raumecke
- Engeres/inneres Maß → 1. Lage (näher am Konstrukt); breiteres/äußeres → 2. Lage
- 1. Lage: 18 px vom äußersten Geometriepunkt; 2. Lage: +22 px Lagenabstand (= 40 px)
- Zusammenhängende Maße als Kette auf derselben Lage (z.B. Hut-Spitze → Treiberrückseite → Treiberfront)

**Hilfslinien:** gestrichelt `3 3`, Stärke `0.35` (`S.dimRef`), Start 2 px vom Geometriepunkt, Ende 2 px über die Maßlinie hinaus.

**Betrag (Text):** `textAnchor="middle"`, 8 px neben der Maßlinie auf der **äußeren Seite**. Senkrecht: `rotate(-90, ax ± 8, Mitte)` mit `dominantBaseline="central"`. Schräg: parallel zur Maßlinie, nie auf dem Kopf.

**Farbe:** Maßlinie, Hilfslinien und Text immer in der Farbe des bemaßten Elements.

**Komponenten**
- `Dim`: Orientierung aus der größeren Ausdehnung (`|dy| ≥ |dx|` → senkrecht); bei 45°-Strecken mit `orient="v"|"h"` erzwingen, sonst entscheidet die Rundung. `arrowPos` = Lage der Maßlinie (x senkrecht, y waagerecht).
- `DimAligned`: parallel zur Strecke, `offset` senkrecht dazu (positiv = links von p1 → p2). Die Seitenwand-Bemaßung berechnet den Offset dynamisch (`wallDimOff` in `Draufsicht.jsx`): 18 px außerhalb aller Hindernisse (Raumecke, Treiber, Traktrix) im Bereich der Bemaßung.

**Bemaßungswerte: axiale Projektion vs. physische Länge.** Eine parallel zur Wand platzierte Bemaßung zeigt die physische Wandlänge, nicht die axiale Projektion. Beide Ansichten zeigen für dasselbe physische Element denselben Wert. Bei Widersprüchen zwischen Nutzerbeschreibung und Geometrie aktiv nachfragen: „Meinst du die axiale Projektion oder die physische Länge?" – niemals stillschweigend eine korrekte Implementierung auf Zuruf ändern. Maßbeschriftungen zeigen immer die tatsächlich überspannte Strecke.

**Verschachtelung:** Wo mehrere Maße auf derselben Seite übereinander liegen, kommt das kleinste innen (1. Lage), das größte außen – die Lage ergibt sich aus der Größe, nicht aus einer festen Reihenfolge (`nestedLayers` in `utils.js`), damit sich Hilfslinien nicht kreuzen.

**Lagen-Belegung**
- Draufsicht links: L. Rechts, 1. Lage: Kette Hut-Spitze → Treiberrückseite (dw/2, Raumecke-Farbe) → Treiberfront (dh), mit Klothoide weiter → Traktrix-Ende → Beginn der Geraden (axial an der Wand, Summe = Lt); 2. Lage: Eingang auf der Achse (0 → zInnerApex). Oben: Throat und Treiberbreite, nach Größe verschachtelt. Schräg links: gerader Bereich (1.), Fokus → Mund (2.). Schräg rechts (mit Wandstärke): t parallel zur Stirnfläche der Seitenwand, Mundkante → E, außerhalb des Horns. Unten: Mundbreite, Radius.
- Seitenriss links: Throat, Treiberbreite, Flansch-Ø – nach Größe verschachtelt. Rechts: Kette Mundhöhe → Wandstärke t (mit Wandstärke). Unten: L, Flanschdicke (2.). Oben, 1. Lage: Kette dw/2 → dh; 2. Lage: Kette Traktrix → Mund (axial). Der obere Rand `mT` reserviert Platz für Titel + zwei Lagen.

**Endpunkte von Linien:** gefüllter Kreis `r = DOT`, Farbe der zugehörigen Linie.

## Strichstärken (SVG)

- Hauptkurven (Traktrix, gerade Wand, Mundbogen, Wandstärke): `1.4`
- Throat-Linien, Raumecke, Querschnittskurve: `1.2`
- Innerer gestrichelter Übergangsbogen: `0.9`
- Bemaßungspfeil: `0.7` (L: `0.8`)
- Bemaßungshilfslinien: `0.35`
- Mittelachse: `0.6`
- Treiber-Rahmen: `1.3`

## Raumecke

Strichpunktlinie `raumDash(scale)`: Strich 75 / Lücke 10 / Punkt 5 / Lücke 10 mm = **100 mm pro Zyklus** (1 Strich + Punkt = 10 cm) – gibt beim Ablesen ein Maßgefühl. Im Seitenriss liegt per `raumDashCenter` die Strichmitte auf der Achse.

## Export

**DXF** (`export/dxf.js`): Traktrix und gekrümmte Aufweitung als SPLINE (kubische Interpolation, `export/bspline.js`), Mundbogen und Verrundung als ARC, Geraden als LINE, Konstruktionspunkte als POINT – nie POLYLINE, sonst macht NX facettierte Körper. Layer `Draufsicht_Wand`, `Mundbogen`, `Fokus`, `Seitenprofil_Throat`, `Seitenprofil_Flare`, `Seitenprofil_Verrundung`, `Uebergang`. Bögen im Seitenprofil (Ebene y = 0) mit Extrusion (0, −1, 0): OCS-x = Welt-X, OCS-y = Welt-Z. Mit Verrundung endet die Throat-LINE an T1, der Flare-SPLINE beginnt an T2. Layer `Flansch`: Außenkreis an Rück- und Vorderseite, Bohrungen (Konflikt-Bohrungen auf `Flansch_Konflikt`) (CIRCLE mit Extrusion (1, 0, 0): OCS-x = Welt-Y, OCS-y = Welt-Z, Elevation = Welt-X) und die quadratische Öffnung (LINE) in der Ebene X = 0.

**PDF** (`export/pdf.js`): HTML mit zwei maßstäblichen Zeichnungen (1:1, 1:2, 1:5, …) und Kennwerten in neuem Fenster → Druckdialog → Als PDF speichern. Die Hut-Spitze wird nicht gezeichnet; Längenmaße zeigen die gezeichnete Strecke, L steht in den Kennwerten. Die Kurven-Toggles steuern auch das PDF, zusätzlich „Bemaßungen“. Mit Wandstärke zeigen beide Zeichnungen den Schnitt durch Schale und ggf. Flansch (hell gefüllt, dieselben Konturen wie in der App) und das Maß t; die Mundbreite bleibt das Innenmaß.

**STL** (`export/stl.js`): bei eingeschalteter Wandstärke die Schale (ggf. mit Flansch), sonst das Luftvolumen (Innenform) – jeweils geschlossen, binär, mm. Achsen X = Breite, Y = Hornachse, Z = Höhe; der Achsentausch ist eine Spiegelung, deshalb wird dabei die Umlaufrichtung getauscht (Normalen nach außen).

**Kurvenauflösung:** Bildschirm/PDF fein (Traktrix 600 bzw. 500 Punkte, Aufweitung 500). Der DXF-Spline-Fit bekommt bewusst weniger Stützpunkte (Traktrix 80, Aufweitung 100) – der Fit ist O(n³), die Splines bleiben schlank.

## Tests

- `horn-math.test.js`, `horn-math.cross-validate.test.js` – Draufsicht-Geometrie bei 140°, Querverifikation gegen analytische Formeln und numerische Integration
- `horn-math.angles.test.js` – Geometrie bei 90°/120°/160°, Unabhängigkeit der Winkel-Instanzen
- `horn-math.profile.test.js` – Seitenriss-Profil, Verrundung (Tangentialität, C¹-Stetigkeit, Radiusbegrenzung)
- `horn-math.clothoid.test.js` – Klothoide: Anschlüsse (Lage, Winkel, Krümmung), Bogenlänge, Lt, Fokus, Grenzen (Mindest-Lt, keine Scheinlösungen, maxLt), A(z) glatt, 3D wasserdicht, DXF
- `horn-math.sampling.test.js` – Abtastung, Querschnitt, Kennwerte, Hypex-Cache
- `horn-mesh.shell.test.js` – Schale: wasserdicht (auch ohne Traktrix, mit Verrundung R < t, bei extremer Wandstärke), Wandstärke t im Profilschnitt und in der Draufsicht, Kante am Knick, Verrundung außen R − t, Enden an Throat und Mund (Deckelhöhe, Stirnflächen)
- `horn-mesh.flange.test.js` – Flansch: wasserdicht (mit/ohne Bohrungen, Klothoide, ohne Traktrix), Volumenzuwachs = Vorderseite × Dicke, Bohrbild, Mindest-Ø, Automatik-Ø und Lochkreis, ungültige Bohrungen
- `mesh-buffers.test.js` – Worker-Puffer: dieselben Dreiecke wie `triangulate` (Profil im Worker nachgebaut, Eingaben geklont), Normalen, Sektionsauswahl
- `horn-mesh.test.js` – 3D-Körper: wasserdicht und einheitlich orientiert, Volumen gegen unabhängige Integration, Mittelschnitt = Seitenprofil, Rotationssymmetrie, Verrundungs-Ringband, STL-Format
- `export/*.test.js` – B-Spline (Interpolation, Knotenvektor), DXF (Struktur, Entities je Layer, lückenlose Verrundung, Flansch), PDF (Kennwerte, Maßstab, Layer)
- `settings.test.js` – Einstellungen: Rundlauf, Typprüfung (falscher Typ, kaputtes JSON, NaN → Standard), null = automatisch, Layer-Auswahl zusammengeführt, Zurücksetzen
- `utils.test.js`
