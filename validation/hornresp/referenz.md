# Hornresp-Referenz

Erzeugt mit `npm run hornresp` – nicht von Hand bearbeiten. Zweck: Prüfen, ob der 1D-Solver
(`src/simulation.js`) dasselbe rechnet wie Hornresp 60.50. Alle Fälle mit dem
**Platzhalter-Treiber** (keine echten Daten). Hintergrund und Vorgehen: [../README.md](../README.md).

| Fall | Stand |
|---|---|
| A: Konushorn, ohne Kammern | geprüft, 533 Frequenzen: max. ΔSPL 0,0000 dB, ΔZe 0,0000 %, ΔZa 5.0e-7 |
| B: Konushorn mit Kompressionskammer | geprüft, 533 Frequenzen: max. ΔSPL 0,0000 dB, ΔZe 0,0000 %, ΔZa 5.0e-7 |
| C: Konus + Exponential (Knick in S(x)), ohne Kammern | geprüft, 533 Frequenzen: max. ΔSPL 0,0000 dB, ΔZe 0,0000 %, ΔZa 9.3e-7 |

## Hornresps Konventionen (Vrc = 0)

- **Rückseite offen:** Ohne Rückkammer strahlt die Membranrückseite frei ab (Kolben, 2π). Das belastet
  die Membran und wird zum Horn addiert (Ausgabe „Combined“). Die App lässt die Rückseite unbelastet
  und stumm (Kompressionstreiber: die Rückkammer steckt in den gemessenen Thiele-Small-Werten).
  Die Tabellen unten folgen Hornresp, die Spalte **App** zeigt das Horn allein wie in der App.
- **SPL aus der Leistung** („constant directivity SPL“): je Quelle |p| = √(W·ρc/Ω)/r. Die App rechnet
  ebenso.
- **Kompressionskammer** als kurzes Rohr (Fläche Atc, Länge Vtc/Atc) – wie die App.
- **Luft:** c = 344 m/s, ρ = 1,205 kg/m³, in Hornresp fest eingebaut. Die Referenz rechnet mit
  diesen Werten, in Hornresp nichts umstellen.

## Gemeinsame Eingaben

| Hornresp | Wert | Hinweis |
|---|---|---|
| Ang | 2,0 × Pi | |
| Eg | 2,83 V | |
| Rg | 0 Ω | |
| Sd | 45,00 cm² | „CAUTION: S1 < Sd“ ist nur ein Hinweis |
| Bl | 15,00 T·m | |
| Cms | 3,00e-5 m/N | |
| Rms | 1,50 N·s/m | |
| Mmd | 2,50 g | ohne Luftlast |
| Le | 0,060 mH | |
| Re | 5,80 Ω | |
| Nd | 1 | |
| Vrc, Lrc | 0 | keine Rückkammer (Rückseite offen, siehe oben) |
| Fr, Tal | Standard lassen | ohne Rückkammer ohne Wirkung |

Einen Konus als **zwei Con-Segmente** gleicher Steigung von √S eingeben: Hornresp lehnt ein einzelnes
Segment mit S3 = 0 ab („ERROR: S3 = 0,00“). Den Flare-Typ eines Segments ändert ein Doppelklick auf seine
Beschriftung. Rechnen mit **Calculate**; bei Kammer-Resonanzen „nicht maskieren“ (Nein). Werte über das
**Sample**-Fenster bei genau den Frequenzen der Tabelle ablesen.

## Fall A: Konushorn, ohne Kammern

| Fläche | Fläche | Länge | Flare |
|---|---|---|---|
| S1 = 20,00 cm² | S2 = 268,25 cm² | L12 = 25,00 cm | Con |
| S2 = 268,25 cm² | S3 = 800,00 cm² | L23 = 25,00 cm | Con |

Kompressionskammer: Vtc = 0, Atc = 0

| f [Hz] | SPL Hornresp [dB] | Ze [Ω] | Ra (norm) | SPL App, Horn allein [dB] |
|---:|---:|---:|---:|---:|
| 100 | 60,02 | 7,43 | 0,002 | 72,15 |
| 200 | 89,95 | 12,59 | 0,089 | 91,88 |
| 300 | 96,12 | 20,87 | 0,129 | 94,18 |
| 500 | 102,78 | 51,66 | 0,783 | 101,84 |
| 700 | 96,73 | 31,93 | 0,460 | 99,77 |
| 1000 | 103,34 | 18,13 | 0,693 | 101,17 |
| 2000 | 97,93 | 9,47 | 0,861 | 100,99 |
| 5000 | 99,04 | 6,15 | 0,983 | 97,35 |
| 10000 | 95,40 | 6,32 | 0,997 | 91,05 |
| 20000 | 75,54 | 8,97 | 1,004 | 81,99 |

Voller Frequenzgang des Modells: [modell-A.csv](modell-A.csv), Hornresp-Referenz: [hornresp-A.csv](hornresp-A.csv)

## Fall B: Konushorn mit Kompressionskammer

| Fläche | Fläche | Länge | Flare |
|---|---|---|---|
| S1 = 20,00 cm² | S2 = 268,25 cm² | L12 = 25,00 cm | Con |
| S2 = 268,25 cm² | S3 = 800,00 cm² | L23 = 25,00 cm | Con |

Kompressionskammer: Vtc = 10,00 cm³, Atc = 45,00 cm²

| f [Hz] | SPL Hornresp [dB] | Ze [Ω] | Ra (norm) | SPL App, Horn allein [dB] |
|---:|---:|---:|---:|---:|
| 100 | 60,08 | 7,43 | 0,002 | 72,16 |
| 200 | 90,05 | 12,61 | 0,089 | 91,96 |
| 300 | 96,17 | 20,91 | 0,129 | 94,23 |
| 500 | 102,92 | 50,00 | 0,783 | 102,04 |
| 700 | 97,13 | 31,36 | 0,460 | 100,10 |
| 1000 | 103,68 | 18,14 | 0,693 | 101,53 |
| 2000 | 97,21 | 9,59 | 0,861 | 101,37 |
| 5000 | 100,35 | 6,16 | 0,983 | 97,14 |
| 10000 | 93,46 | 6,30 | 0,997 | 89,36 |
| 20000 | 81,04 | 8,96 | 1,004 | 77,14 |

Voller Frequenzgang des Modells: [modell-B.csv](modell-B.csv), Hornresp-Referenz: [hornresp-B.csv](hornresp-B.csv)

## Fall C: Konus + Exponential (Knick in S(x)), ohne Kammern

| Fläche | Fläche | Länge | Flare |
|---|---|---|---|
| S1 = 20,00 cm² | S2 = 100,00 cm² | L12 = 10,00 cm | Con |
| S2 = 100,00 cm² | S3 = 1200,00 cm² | L23 = 50,00 cm | Exp |

Kompressionskammer: Vtc = 0, Atc = 0

| f [Hz] | SPL Hornresp [dB] | Ze [Ω] | Ra (norm) | SPL App, Horn allein [dB] |
|---:|---:|---:|---:|---:|
| 100 | 63,03 | 7,43 | 0,002 | 72,99 |
| 200 | 97,57 | 13,07 | 0,388 | 98,13 |
| 300 | 96,33 | 21,25 | 0,132 | 94,28 |
| 500 | 96,23 | 83,65 | 0,258 | 97,46 |
| 700 | 98,43 | 36,56 | 0,448 | 99,69 |
| 1000 | 102,53 | 17,96 | 0,594 | 100,57 |
| 2000 | 104,68 | 9,53 | 0,849 | 100,96 |
| 5000 | 99,86 | 6,16 | 1,012 | 97,46 |
| 10000 | 95,27 | 6,32 | 1,007 | 91,09 |
| 20000 | 78,76 | 8,97 | 1,002 | 81,98 |

Voller Frequenzgang des Modells: [modell-C.csv](modell-C.csv), Hornresp-Referenz: [hornresp-C.csv](hornresp-C.csv)
