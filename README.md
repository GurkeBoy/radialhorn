# Radialhorn-Konfigurator

Desktop-App zur Auslegung von Radialhörnern mit Traktrix-Eingang für den Lautsprecher-Eigenbau. Die Geometrie wird aus wenigen Parametern berechnet, als maßstäbliche Draufsicht und Seitenriss gezeichnet und als DXF (für CAD, z.B. Siemens NX) oder PDF-Datenblatt exportiert.

## Funktionen

- **Horizontale Kontur:** Traktrix-Eingang → gerade Wand unter dem halben Öffnungswinkel → Mundbogen um den Fokuspunkt; optional krümmungsstetiger Übergang (Klothoide) zwischen Traktrix und Wand. Öffnungswinkel, Gesamtlänge, Traktrix-Länge, Throat und Treibermaße einstellbar.
- **Raumecke:** Begrenzt die Hornbreite auf die 45°-Diagonale einer Raumecke, optional mit Wandstärke.
- **Vertikales Profil:** Aufweitung linear, exponentiell oder Hypex; optionale Verrundung des Übergangs Throat → Aufweitung.
- **Ansichten:** Draufsicht und Seitenriss mit Bemaßung, Zoom (Mausrad) und Verschieben (Ziehen), Vollbild; Querschnittsfläche A(z) als Diagramm.
- **3D-Ansicht:** das Luftvolumen oder – mit Wandstärke – die Schale des Horns zum Drehen und Zoomen, als Fläche oder Gitter, mit Treiber und Raumecke als Bezug.
- **Gerundete Kanten:** die äußeren Längskanten der Schale optional verrundet (Radius bis zur Wandstärke).
- **Flansch am Throat:** runde Platte mit quadratischer Throat-Öffnung und Bohrbild (Anzahl, Lochkreis, Bohrungs-Ø, Winkellage) zum Anschrauben des Treibers – in 3D/STL, Draufsicht, Seitenriss und DXF.
- **Einstellungen bleiben erhalten:** Alle Parameter werden gespeichert, beim nächsten Start geht es dort weiter, wo man aufgehört hat; ein Knopf setzt alles auf die Standardwerte zurück.
- **Kennwerte:** Mundfläche, vertikaler Öffnungswinkel, akustische Grenzfrequenzen (Näherung).
- **Frequenzgang (1D-Simulation):** Webster-Horngleichung per Transfermatrizen aus der Wellenfrontfläche S(x), Treiber mit Thiele-Small-Parametern und Kompressionskammer, Abstrahlung in 2π (exakt) oder 4π/π/π/2 (Näherung). SPL bei 1 m / 2,83 V und elektrische Impedanz als Diagramm, Export als CSV. Validiert an Rohr, Konus und Exponentialhorn; Referenzwerte für den Vergleich mit Hornresp in [docs/hornresp-referenz.md](docs/hornresp-referenz.md).
- **Export:** DXF mit exakten Kurven (SPLINE/ARC/LINE statt Polylinien, damit CAD glatte Körper erzeugt), PDF-Datenblatt mit maßstäblichen Zeichnungen und STL der Schale bzw. des Luftvolumens (z.B. für den 3D-Druck).

## Entwicklung

Voraussetzungen: Node.js, Rust und die [Tauri-Voraussetzungen](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev    # Desktop-App
npm run dev          # nur Web-Oberfläche, http://localhost:1420
npm test             # Tests (Vitest)
npm run lint         # ESLint
npm run tauri build  # Installer bauen
```

Aufbau, Konventionen und Bemaßungsregeln: siehe [CLAUDE.md](CLAUDE.md).
