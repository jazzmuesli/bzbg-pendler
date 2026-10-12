# Boizenburg Bahnhof — Pendler-Pünktlichkeit

Interaktive Auswertung der Zugankünfte am Bahnhof **Boizenburg (Elbe)** mit den
Anschlüssen an den Busverkehr der VLP.

Live: <https://bzbg-pendler.openfun.org>

## Was drin ist

`index.html` ist eine **einzige, in sich geschlossene Datei** (ca. 600 KB). Die
Daten sind als JSON eingebettet, es wird zur Laufzeit **nichts** nachgeladen —
die Seite funktioniert offline und stellt keine Anfragen an Dritte.

- **12.722 Zugankünfte** an Boizenburg (Elbe) über **450 Tage**
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

## Drei Dinge, die beim Lesen wichtig sind

**1. Eine Zugnummer ist kein Fahrplan.** Zugfinder vergibt rollende Nummern:
dieselbe Fahrt erscheint unter verschiedenen Nummern und Ankunftszeiten. Die
Seite gruppiert deshalb nach der *physischen* Fahrt — Abfahrtsbahnhof plus
Abfahrtszeit. Beispiel: die Feierabendfahrt **Hamburg Hbf ab 16:21 →
Boizenburg** heißt mal `RE 4315` (17:07), mal `RE 4337` (17:08). Ohne diese
Gruppierung sähe ein Fahrplanwechsel wie ein Pünktlichkeitssprung aus.

**2. `Ankunft` ist der Fahrplan, `Ist` ist die Wirklichkeit.** Auf dem
Bahnhofstafel steht die Verspätung *nicht* in der Zeitspalte, sondern als Klammer
davor: `17:08 (+44)` in der Spalte **Ankunft** heißt *geplant 17:08, 44 Minuten
spät* — die tatsächliche Ankunft `17:52` steht in der nächsten Spalte **Ist**.
Wer nur die erste Zeitspalte liest, sieht eine pünktliche Fahrt. Die CSV-Dateien
in `data/` haben beide Zeiten getrennt (`planned`, `actual`) und die Verspätung
zusätzlich als Zahl (`delay_min`); `download_bahnhofstafel.py` liest `Ist` und
errechnet daraus die Verspätung. Beide stimmen für sich allein, sie dürfen nur
nicht verwechselt werden.

**3. Es gibt eine Datenlücke.** Für **2025-08-02 bis 2026-05-14** (9,5 Monate)
liegt nichts vor: das deckt sich mit der Generalsanierung Hamburg–Berlin, aber
es ist eine **Lücke im Archiv von Zugfinder**, keine schlechte Betriebslage.
Auswertungen über beide Blöcke hinweg sind entsprechend verzerrt.

## Rechenmodell

Ein Bus zählt als *geplanter Anschluss*, wenn er zwischen
`Ankunft + Umsteigezeit` und `Ankunft + Umsteigezeit + 80` Minuten abfährt.
*Erwischt* ist er, wenn die **tatsächliche** Ankunft noch
`Umsteigezeit + 2` Minuten lässt. Übernommen aus `calculate_transfer.py`, das
über alle 450 Tage 21.539 Anschlüsse mit 1.374 (6,4 %) gebrochen zählt.

**Wichtig: Linie 500 ist ein Ring.** Der Bahnhof liegt zweimal darauf — der
zweite Durchgang (17:44 bzw. 17:46) ist derselbe Bus auf dem Rückweg und fährt
*nicht* mehr über den Markt. Er zählt deshalb nicht als Anschluss. Der
**2. Bus** ist damit der nächste Ringbus: nach dem 17:15 also der 18:15, rund
eine Stunde später. Deshalb ist das Anschlussfenster 80 statt 50 Minuten weit —
mit 50 Minuten abgeschnittenem Fenster hätte die Seite „kein Bus" gemeldet,
obwohl der 18:15 fährt.

Nur 2,9 % aller Zugankünfte (254 von 8.758) haben danach gar keinen Anschluss
mehr; das sind vor allem Samstag- und Sonntagabende, an denen der Ring nach dem
17:15 keine weitere Runde fährt.

Busse gelten als pünktlich abfahrend — **gemessen wird ausschließlich die
Zugverspätung**, weil Busdaten nicht vorliegen.


## Erzeugen

```bash
python3 build_pendler_app.py      # schreibt index.html + pendler_data.json
node test_pendler_core.js         # 403 Tests
```

Die Logik liegt in `pendler_core.js` und wird unverändert in die HTML-Datei
eingebettet, sodass Browser und Tests denselben Code ausführen.

## Daten nachziehen

Ein Befehl für den kompletten Durchlauf — fehlende Tage holen, prüfen,
`index.html` neu bauen, Tests:

```bash
export ZF_EMAIL=... ZF_PASS=...
python3 refresh.py                 # die letzten 14 Tage, dann index.html neu
python3 refresh.py --days 30       # nach längerer Pause ein weiteres Fenster
python3 refresh.py --dry-run       # nur auflisten, was geladen würde
python3 refresh.py --refresh       # auch bereits gespeicherte Tage neu holen
```

Die Einzelschritte bleiben getrennt verfügbar:

```bash
python3 download_bahnhofstafel.py 7          # die letzten 7 Tage
python3 verify_stock.py                      # data/ gegen die Website prüfen
```

**Zwei Zusicherungen, die `refresh.py` gibt.** *Heute* wird nie gespeichert,
weil die Tafel des laufenden Tages noch unvollständig ist und gespeicherte
Dateien nie überschrieben werden — ein halb gefüllter Tag bliebe für immer
halb gefüllt. *Weiterleitungen* (302) gelten als Fehler, nicht als fehlender
Tag: eine abgelaufene Sitzung darf keine Lücke in den Daten hinterlassen.

**Nach jedem neuen Tag sind die Sollwerte der Tests neu zu rechnen.**
`test_pendler_core.js` pinnt Zahlen an den Datenbestand (`12.722 Ankünfte`,
`450 Tage`, `RE 4337 @17:08 -> n=102` …). Sie kommen aus dem Orakel, nicht aus
der Implementierung:

```bash
python3 tools/truth.py             # Sollwerte neu ausgeben
node test_pendler_core.js          # und in die Konstanten einsetzen
```

**Vorher lesen — die Datenlücke ist nicht die, die man sieht.** Ohne
angemeldete Sitzung leitet Zugfinder *jede* historische Abfrage per **302** auf
die *aktuelle* Tafel um. Die Antwort enthält dann eine Tafel für den heutigen
Tag, nicht für den angefragten — der Parser findet dort entweder gar keine
Tabelle (`insufficient_data`) oder, schlimmer, eine glaubwürdig aussehende mit
falschem Datum. Zwei Fehlermodi, die man unterscheiden muss:

- **Ohne Login** sind nur der Vortag und heute abrufbar. Jeder ältere Tag wird
  still übersprungen und sieht in `data/` anschließend wie eine echte Lücke
  aus. Ein Abbruch der Sitzung mitten im Lauf erzeugt auf dieselbe Weise eine
  wochenlange Lücke.
- **Ein Tag, der echt fehlt**, ist im Archiv von Zugfinder nicht vorhanden.
  Beide Fälle sind an der Antwort unterscheidbar: die Umleitung landet auf
  `…/bahnhofstafel-<station>` **ohne** Datum, ein echter Fehlschlag trägt das
  Datum in der URL.

`verify_stock.py` meldet beide Fälle getrennt und schreibt nichts, ohne dass man
den Unterschied selbst erraten muss.

## Datenquellen

- Zugankünfte: Zugfinder Bahnhofstafel, via `download_bahnhofstafel.py`
  (angesteuert von `refresh.py`)
- Busanfahrten: VLP-Fahrpläne (PDF), via `parse_timetables.py`
- Sollwerte der Tests: `tools/truth.py` (Python-Orakel, unabhängig von `pendler_core.js`)

Es sind ausschließlich öffentlich einsehbare Fahrplandaten enthalten; keine
Zugangsdaten.
