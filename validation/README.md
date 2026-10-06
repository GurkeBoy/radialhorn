# Validierung

Prüfcode und Referenzdaten, die nicht Teil der App sind. Die Tests hier laufen mit `npm test` mit.

## Hornresp-Abgleich (`hornresp/`)

[Hornresp](http://www.hornresp.net/) ist ein verbreitetes Simulationsprogramm für Horn- und
Direktstrahler-Lautsprecher von David J McBean. Es ist ein eigenständiges Programm; dieses Projekt steht
in keiner Verbindung dazu und enthält weder Hornresp noch Teile davon. Die Referenzdateien enthalten nur
Zahlenwerte, die Hornresp für die dokumentierten Eingaben berechnet hat. Sie dienen dem Vergleich.

Der Abgleich prüft den 1D-Rechenkern (`src/simulation.js`: Webster-Transfermatrizen, Strahlungsimpedanz,
Treiber, Kompressionskammer) an Hörnern, die beide Programme exakt kennen:

| Fall | Horn | prüft |
|---|---|---|
| A | Konus 20 → 800 cm², 50 cm | Solver, 2π-Abstrahlung, Treiber |
| B | wie A, mit Kompressionskammer | Kammer als kurzes Rohr |
| C | Konus 20 → 100 cm² (10 cm) + Exponential 100 → 1200 cm² (50 cm) | Verkettung über einen Knick in S(x) |

Ergebnis, Eingaben und Stützwerte: [hornresp/referenz.md](hornresp/referenz.md) (erzeugt).

Nicht geprüft wird das Flächenmodell des Radialhorns selbst (Wellenfrontfläche S(x) aus der Geometrie) –
Hornresp rechnet mit derselben 1D-Annahme. Das ließe sich nur mit Messung oder einer 3D-Simulation (BEM)
klären.

### Dateien

| Datei | Inhalt |
|---|---|
| `faelle.js` | Referenzfälle: Geometrie, Treiber, Hornresp-Version und -Einstellungen (einzige Quelle) |
| `modell.js` | das Modell aus `src/simulation.js` mit Hornresps Konventionen bei Vrc = 0 (Rückseite offen, „Combined“), Leser für Exporte und Referenzdateien |
| `hornresp-<Fall>.csv` | Hornresp-Ergebnisse: f, Ra, Xa (normiert), \|Ze\|, SPL; Kopf mit Version, Eingaben und Einstellungen |
| `hornresp.test.js` | Test: Modell gegen die Referenzdateien, 533 Frequenzen je Fall |
| `referenz.js` → `referenz.md`, `modell-<Fall>.csv` | Referenzdokument und voller Frequenzgang des Modells (`npm run hornresp`) |
| `import.js` | Hornresp-Export → Referenzdatei (`npm run hornresp:import`) |

### Selbst nachrechnen oder einen Fall hinzufügen

1. Fall in `faelle.js` anlegen (oder einen vorhandenen nehmen), `npm run hornresp` – `referenz.md` nennt
   die Hornresp-Eingaben.
2. In Hornresp eingeben, **Calculate**, im Fenster *Acoustical Power* (Ausgabe *Combined*) die Ergebnisse
   als Textdatei exportieren. Hornresp legt sie unter `<Hornresp-Ordner>\Export\` ab.
3. `npm run hornresp:import -- <Fall> <Pfad zum Export>` schreibt `hornresp-<Fall>.csv`.
4. `npm run hornresp` und `npm test`.

Stimmt die Hornresp-Version nicht mit `HORNRESP` in `faelle.js` überein, dort anpassen – neuere Versionen
können leicht andere Zahlen liefern.
