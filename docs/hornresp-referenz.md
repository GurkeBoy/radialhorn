# Hornresp-Referenz

Erzeugt mit `node scripts/hornresp-referenz.js`. Zweck: Prüfen, ob der 1D-Solver (`src/simulation.js`)
dasselbe rechnet wie Hornresp. Alle Fälle mit dem **Platzhalter-Treiber** (keine echten Daten).

## Gemeinsame Eingaben

| Hornresp | Wert | Hinweis |
|---|---|---|
| Ang | 2,0 × Pi | Kolben in unendlicher Schallwand |
| Eg | 2,83 V | |
| Rg | 0 Ω | |
| Sd | 45,00 cm² | |
| Bl | 15,00 T·m | |
| Cms | 3,00e-5 m/N | |
| Rms | 1,50 N·s/m | |
| Mmd | 2,50 g | ohne Luftlast |
| Le | 0,060 mH | einfache Induktivität (kein Semi-Inductance-Modell) |
| Re | 5,80 Ω | |
| Nd | 1 | |
| Vrc, Lrc | 0 | keine Rückkammer – in Hornresp prüfen, dass die Rückseite unbelastet bleibt |
| Luft | c = 343,21 m/s, ρ = 1,2041 kg/m³ | 20 °C, in Hornresp unter den Optionen gleich einstellen |

SPL bei 1 m, Phase ohne Laufzeit über 1 m. Impedanz = elektrische Eingangsimpedanz.

## Fall A: Konushorn, ohne Kammern

| Fläche | Fläche | Länge | Flare |
|---|---|---|---|
| S1 = 20,00 cm² | S2 = 800,00 cm² | L12 = 50,00 cm | Con |

Kompressionskammer: Vtc = 0, Atc = 0

| f [Hz] | SPL [dB] | Phase [°] | \|Z\| [Ω] | Phase Z [°] |
|---:|---:|---:|---:|---:|
| 100,9 | 72,40 | 140,0 | 7,45 | 37,2 |
| 201,9 | 92,72 | 95,2 | 12,66 | 57,7 |
| 302,7 | 94,57 | -48,6 | 20,73 | 64,3 |
| 494,7 | 103,20 | -139,4 | 53,91 | 2,9 |
| 699,8 | 102,78 | 104,5 | 34,99 | -52,2 |
| 989,9 | 106,83 | -60,1 | 19,59 | -54,1 |
| 1980,8 | 113,01 | 106,2 | 9,69 | -43,2 |
| 4994,8 | 117,58 | -82,4 | 6,09 | -9,4 |
| 9994,8 | 117,35 | 141,3 | 6,30 | 21,7 |
| 20000,0 | 114,30 | -96,4 | 8,96 | 49,6 |

Voller Frequenzgang: [hornresp/fall-A.csv](hornresp/fall-A.csv)

## Fall B: Konushorn mit Kompressionskammer

| Fläche | Fläche | Länge | Flare |
|---|---|---|---|
| S1 = 20,00 cm² | S2 = 800,00 cm² | L12 = 50,00 cm | Con |

Kompressionskammer: Vtc = 10,00 cm³, Atc = 45,00 cm²

| f [Hz] | SPL [dB] | Phase [°] | \|Z\| [Ω] | Phase Z [°] |
|---:|---:|---:|---:|---:|
| 100,9 | 72,41 | 140,0 | 7,45 | 37,2 |
| 201,9 | 92,81 | 95,0 | 12,68 | 57,7 |
| 302,7 | 94,63 | -48,8 | 20,77 | 64,3 |
| 494,7 | 103,42 | -141,4 | 52,02 | 2,8 |
| 699,8 | 103,11 | 102,6 | 34,27 | -51,3 |
| 989,9 | 107,18 | -63,7 | 19,59 | -53,0 |
| 1980,8 | 113,38 | 97,6 | 9,81 | -43,1 |
| 4994,8 | 117,37 | -107,3 | 6,09 | -9,9 |
| 9994,8 | 115,65 | 94,8 | 6,28 | 21,6 |
| 20000,0 | 109,40 | -165,7 | 8,96 | 49,6 |

Voller Frequenzgang: [hornresp/fall-B.csv](hornresp/fall-B.csv)

## Fall C: Konus + Exponential (Knick in S(x)), ohne Kammern

| Fläche | Fläche | Länge | Flare |
|---|---|---|---|
| S1 = 20,00 cm² | S2 = 100,00 cm² | L12 = 10,00 cm | Con |
| S2 = 100,00 cm² | S3 = 1200,00 cm² | L23 = 50,00 cm | Exp |

Kompressionskammer: Vtc = 0, Atc = 0

| f [Hz] | SPL [dB] | Phase [°] | \|Z\| [Ω] | Phase Z [°] |
|---:|---:|---:|---:|---:|
| 100,9 | 73,30 | 139,4 | 7,45 | 37,2 |
| 201,9 | 99,15 | 59,3 | 13,11 | 54,8 |
| 302,7 | 95,17 | -64,3 | 21,10 | 64,2 |
| 494,7 | 99,76 | 151,2 | 76,19 | 32,2 |
| 699,8 | 104,07 | 24,1 | 40,75 | -49,0 |
| 989,9 | 108,50 | -158,6 | 19,41 | -55,6 |
| 1980,8 | 115,10 | -101,2 | 9,75 | -43,3 |
| 4994,8 | 119,45 | 114,8 | 6,09 | -9,4 |
| 9994,8 | 119,14 | 173,1 | 6,30 | 21,7 |
| 20000,0 | 116,04 | -33,7 | 8,96 | 49,6 |

Voller Frequenzgang: [hornresp/fall-C.csv](hornresp/fall-C.csv)
