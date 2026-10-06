# Boizenburg Bahnhof — Pendler-Pünktlichkeit

Interaktive Auswertung der Zugankünfte am Bahnhof **Boizenburg (Elbe)** mit den
Anschlüssen an den Busverkehr der VLP.

Live: <https://bzbg-pendler.openfun.org>

## Was drin ist

`index.html` ist eine **einzige, in sich geschlossene Datei** (ca. 600 KB). Die
Daten sind als JSON eingebettet, es wird zur Laufzeit **nichts** nachgeladen —
die Seite funktioniert offline und stellt keine Anfragen an Dritte.

- **12.566 Zugankünfte** an Boizenburg (Elbe) über **445 Tage**
- Fahrpläne der VLP-Linien **500, 520, 525, 530** (Stand der eingelesenen PDFs)

## Bedienung

Oben einstellen, alles darunter rechnet sich sofort neu:

| Regler | Wirkung |
|---|---|
| **Richtung / Herkunft** | von Hamburg Hbf, Rostock Hbf, Schwerin Hbf |
| **Zeitfenster** | Presets (Früh, Vormittag, Feierabend …) oder frei wählbar |
| **Zeitraum** | Presets (*letzte 7/30/90 Tage*, *seit 2026-08-24*, *2026*) oder Datumsfelder; Standard ist der gesamte Zeitraum |
| **nur Mo–Fr** | Wochenenden ausblenden |
| **Buslinien** | welche Linien als Anschluss zählen |
| **Umsteigezeit** | Minuten von Zug zu Haltestelle plus Einstieg (Vorgabe 2) |

Ausgewertet werden: Pünktlichkeit (< 5 min), Median, Mittelwert, p90, p95,
maximale Verspätung — nach Monat, je Zug und für den kompletten Zeitraum.
Dazu der **Busanschluss**, getrennt nach **1. Bus / 2. Bus / keiner**, und je
eigner **Busfahrplan-Version**, damit ein Fahrplanwechsel nicht mit dem
alten Fahrplan verrechnet wird.

## Zwei Dinge, die beim Lesen wichtig sind

**1. Eine Zugnummer ist kein Fahrplan.** Zugfinder vergibt rollende Nummern:
dieselbe Fahrt erscheint unter verschiedenen Nummern und Ankunftszeiten. Die
Seite gruppiert deshalb nach der *physischen* Fahrt — Abfahrtsbahnhof plus
Abfahrtszeit. Beispiel: die Feierabendfahrt **Hamburg Hbf ab 16:21 →
Boizenburg** heißt mal `RE 4315` (17:07), mal `RE 4337` (17:08). Ohne diese
Gruppierung sähe ein Fahrplanwechsel wie ein Pünktlichkeitssprung aus.

**2. Es gibt eine Datenlücke.** Für **2025-08-02 bis 2026-05-14** (9,5 Monate)
liegt nichts vor: das deckt sich mit der Generalsanierung Hamburg–Berlin, aber
es ist eine **Lücke im Archiv von Zugfinder**, keine schlechte Betriebslage.
Auswertungen über beide Blöcke hinweg sind entsprechend verzerrt.

## Rechenmodell

Ein Bus zählt als *geplanter Anschluss*, wenn er zwischen
`Ankunft + Umsteigezeit` und `Ankunft + Umsteigezeit + 50` Minuten abfährt.
*Erwischt* ist er, wenn die **tatsächliche** Ankunft noch
`Umsteigezeit + 2` Minuten lässt. Übernommen aus `calculate_transfer.py`, das
über alle 445 Tage 21.981 Anschlüsse mit 1.803 (8,2 %) gebrochenen zählt.

Busse gelten als pünktlich abfahrend — **gemessen wird ausschließlich die
Zugverspätung**, weil Busdaten nicht vorliegen.

## Erzeugen

```bash
python3 build_pendler_app.py      # schreibt index.html + pendler_data.json
node test_pendler_core.js         # 348 Tests
```

Die Logik liegt in `pendler_core.js` und wird unverändert in die HTML-Datei
eingebettet, sodass Browser und Tests denselben Code ausführen.

## Datenquellen

- Zugankünfte: Zugfinder Bahnhofstafel, via `download_bahnhofstafel.py`
- Busanfahrten: VLP-Fahrpläne (PDF), via `parse_timetables.py`

Es sind ausschließlich öffentlich einsehbare Fahrplandaten enthalten; keine
Zugangsdaten.
