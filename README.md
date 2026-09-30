# Radialhorn-Konfigurator

Desktop-App zur Auslegung von Radialhörnern mit Traktrix-Eingang für den Lautsprecher-Eigenbau. Die Geometrie wird aus wenigen Parametern berechnet, als maßstäbliche Draufsicht und Seitenriss gezeichnet und als DXF (für CAD, z.B. Siemens NX) oder PDF-Datenblatt exportiert.

## Funktionen

- **Horizontale Kontur:** Traktrix-Eingang → gerade Wand unter dem halben Öffnungswinkel → Mundbogen um den Fokuspunkt. Öffnungswinkel, Gesamtlänge, Traktrix-Länge, Throat und Treibermaße einstellbar.
- **Raumecke:** Begrenzt die Hornbreite auf die 45°-Diagonale einer Raumecke, optional mit Wandstärke.
- **Vertikales Profil:** Aufweitung linear, exponentiell oder Hypex; optionale Verrundung des Übergangs Throat → Aufweitung.
- **Ansichten:** Draufsicht und Seitenriss mit Bemaßung, Zoom (Mausrad) und Verschieben (Ziehen), Vollbild; Querschnittsfläche A(z) als Diagramm.
- **3D-Ansicht:** das Luftvolumen des Horns zum Drehen und Zoomen, als Fläche oder Gitter, mit Treiber und Raumecke als Bezug.
- **Kennwerte:** Mundfläche, vertikaler Öffnungswinkel, akustische Grenzfrequenzen (Näherung).
- **Export:** DXF mit exakten Kurven (SPLINE/ARC/LINE statt Polylinien, damit CAD glatte Körper erzeugt), PDF-Datenblatt mit maßstäblichen Zeichnungen und STL des Luftvolumens (z.B. für ein 3D-gedrucktes Modell).

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
