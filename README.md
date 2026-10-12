# Boizenburg Bahnhof — Pendler-Pünktlichkeit

Interaktive Auswertung der Zugankünfte am Bahnhof **Boizenburg (Elbe)** mit den
Anschlüssen an den Busverkehr der VLP.

Live: <https://bzbg-pendler.openfun.org>

## Die beiden Seiten

| Adresse | Datei | Wofür |
|---|---|---|
| `/` | `simplified.html` | die kurze interaktive Rechnung: ein Diagramm, sechs Regler |
| `/complex.html` | `index.html` | die vollständige Auswertung mit allen Filtern und Nachleseteilen |

Beide sind einzelne, in sich geschlossene Dateien ohne Netzzugriff.

**Achtung beim Veröffentlichen:** die Dateinamen sind im Repository gegen
die ausgelieferten Adressen vertauscht.

```bash
cp simplified.html <repo>/index.html      # wird zu /
cp index.html      <repo>/complex.html   # wird zu /complex.html
```

Wer das umdreht, überschreibt die Kurzfassung mit der Langfassung.

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
| **Planänderung** | im Abschnitt „Was wäre, wenn der Bus anders fährt?": verschiebt alle Busse des Tages um x Minuten (Vorgabe +5) |

Der Abschnitt **Was wäre, wenn der Bus anders fährt?** bündelt drei
Stellschrauben, mit denen sich dieselbe Frage durchspielen lässt:

| Stellschraube | Wirkung |
|---|---|
| **Bus fährt … später** | verschiebt alle Abfahrten der gewählten Buslinien um x Minuten |
| **Alle Züge sind … zu spät** | unterstellt eine zusätzliche Verspätung auf jede Ankunft, statt der gemessenen |
| **heutigen Fahrplan auf alle Fahrten rechnen** | wendet den Busfahrplan des jeweils letzten Tages auf die ganze Historie an — beantwortet „was wäre mit dem heutigen Bus damals passiert?" |

Die Tabelle darunter zerlegt jede Fahrtgruppe in vier Stufen, die zusammen
100 % ergeben: 0 Minuten Puffer, der Bus des Tages, der Bus mit dem
gewünschten Versatz, und die Fahrten, die auch dann noch verpasst werden.
Der grüne Balken ist die Differenz aus dem Versatz; die Maus darüber zeigt
bis zu 20 konkrete Fahrten (neueste zuerst, älteste am Ende) zum Nachschlagen
auf der Bahnhofstafel.

Der frühere Abschnitt „Was ändert ein früherer/späterer Bus?" ist als
aufklappbare Einzelheit darunter erhalten.

Der Abschnitt **Was ändert ein früherer/späterer Bus?** rechnet dieselben
Ankünfte mit verschobenen Buszeiten durch und zeigt je Zugslot den **Puffer**
— wie viele Minuten Zugverspätung der Anschluss noch verträgt:

    Puffer = Busabfahrt − geplante Ankunft − Fußweg − Umsteigezeit

RE 4337 an 17:08 mit Bus 17:15, Fußweg 1 min und Umsteigezeit 2 min ergibt
darum **4 min**, nicht 5: der Fußweg wird zusätzlich zur Umsteigezeit
gezählt. Bei 17:25 (+10 min) sind es 14 min. Verschiebungen, die den Bus aus
dem Anschlussfenster herausbugsieren, sind als „ohne Anschluss" markiert —
deren Prozentwerte sind nicht mit „heute" vergleichbar.

## Aufbau der Seite

Die Seite ist auf das Nötigste eingedampft, damit sie auch ohne Vorwissen
lesbar ist. Ganz oben stehen **drei große Knöpfe** — *Feierabend*, *Früher
Morgen*, *Der ganze Tag* —, die die wichtigsten Fälle abdecken. Die 28
einzelnen Regler (Richtung, Zeitfenster, Zeitraum, Buslinien, Umsteigezeit)
liegen aufklappbar unter **Eigene Einstellungen** und sind für die allermeisten
Besucher unnötig.

Danach vier Blöcke: **Übersicht** mit drei Kennzahlen, der Rechner **„Was
wäre, wenn der Bus anders fährt?"**, der **Busanschluss** mit drei Kennzahlen
und alles Weitere als aufklappbare Nachlese (Einzelzugtabelle, Monatswerte,
Zugverlauf, Fahrplan-Versionen, Detail-Simulation).

Die Tabelle im „Was wäre"-Rechner kommt mit drei Spalten aus: Bus heute, Bus
mit dem gewünschten Versatz, Bus trotzdem verpasst. Die frühere vierte Spalte
„0 Min. Puffer" war in jedem Datensatz 0&thinsp;% und wurde in den Erklärungstext
verschoben.

Stationen ohne Omnibusanschluss verlieren die Busabschnitte samt Reglern
automatisch.

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

## Rohdaten als CSV

`history.csv` — eine Zeile je Zugankunft, mit dem Bussen, der an dem Tag
tatsächlich zur Verfügung stand:

```bash
node make_history_csv.js                            # ganzer Zeitraum, Linie 500
node make_history_csv.js --transfer-time 2          # 2 min Einstieg (Seiten-Vorgabe)
node make_history_csv.js --weekdays-only --lines 500,520
```

| Spalte | Bedeutung |
|---|---|
| `date`, `time`, `train_id` | Tag, geplante Ankunft, Zugnummer |
| `direction_from`, `direction_to` | Startbahnhof, Zielbahnhof |
| `expected_arrival`, `actual_arrival`, `delay` | Fahrplan, Wirklichkeit, Verspätung in Minuten |
| `first_next_bus_time`, `second_next_bus_time` | der nächste Bus im Anschlussfenster, und der nächstdrüber |
| `transfer_ok` | **der geplante Bus wurde erwischt** (das ist die „1. Bus"-Zahl der Seite) |
| `any_connection_ok` | irgendein Bus im Fenster wurde erwischt |
| `taken_bus_time` | der Bus, der tatsächlich erreichbar war |

**Die beiden letzten Spalten darf man nicht verwechseln.** `transfer_ok` misst
den *ersten* Bus; `any_connection_ok` liegt bei rund 99,7 %, weil die Linie 500
stündlich fährt — nach dem verpassten 17:15 kommt der 18:15 noch im Fenster.
„85,7 % transfer_ok" und „99,7 % Anschluss" sind dieselben Daten, zweimal
gelesen.

`time` und `expected_arrival` sind bewusst doppelt: die erste ist die
gebuchte Ankunft, die zweite der Wert aus der Spalte **Ankunft** der
Bahnhofstafel.

Gerechnet wird mit `pendler_core.js`, also mit demselben Code, den die Seite
ausführt — `transfer_time=0` bedeutet: Bus noch am Bahnsteig, ich steige ein.

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
