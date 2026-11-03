# Hargassner Touch Pro für Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/hacs/integration)

Integration für Hargassner-Heizkessel mit Touch-Pro- oder Touch-Tronic-Regelung (Pellets, Hackgut, Stückholz) über die Hargassner-Cloud, also dieselbe Schnittstelle wie die Hargassner-App.

Beruht auf [EslbauerF/hargassner-ha](https://github.com/EslbauerF/hargassner-ha). Eigener Name (`hargassner_touch_pro`), damit sie neben dem Original installiert werden kann.

> ⚠️ **Inoffiziell.** Die Schnittstelle wurde aus der Android-App nachgebaut. Es braucht ein Konto in der Hargassner-App, und der Kessel muss mit der Cloud verbunden sein.

## Was die Integration anlegt

Die Integration hat keine feste Liste mehr. Sie legt alles an, was die Cloud für die Anlage meldet:

| Quelle | Wird zu |
|---|---|
| Istwerte jedes Bausteins (Kessel, Heizkreise, Puffer, Warmwasser, Frischwasserstation …) | Sensoren und Binärsensoren |
| Schreibbare Parameter mit Optionen (Betriebsart, Programm …) | Auswahl |
| Schreibbare Zahlen (Solltemperaturen, Heizkurve, Abschaltgrenzen, Brennstoffvorrat …) | Zahl, mit min/max/Schritt aus der Cloud |
| Schreibbare Ein/Aus-Werte (witterungsgeführt, einmalige Zirkulation …) | Schalter |
| Schreibbare Texte (z. B. Datum, Uhrzeit) | Text |
| Nur lesbare Parameter | Diagnose-Sensoren |
| Aktionen (z. B. Zündung starten) | Tasten |
| Messkanäle der Verlaufsaufzeichnung (wie in den Diagrammen der App) | Sensoren im Gerät «Messkanäle» |
| Heizkreise mit Raumtemperatur | Thermostat (Automatik, Heizen, Aus) |

Jeder Baustein ist ein eigenes Gerät unter der Anlage, benannt nach Typ und Nummer wie in der Anleitung, dahinter der Name aus der App: «Kessel», «Puffer», «Heizkreis 1 (Altbau)», «Frischwasserstation 1 (Neubau)», «Wetter (Ort)».

Einstellungen tragen die **Parameternummer der Touch-Regelung** und die Bezeichnung aus der Hargassner-Anleitung, z. B. «4 Tages-Raumtemperatur», «5 Absenk-Raumtemperatur», «A2 Steilheit», «A5b Witterungsführung», «A8 Sommer-Badheizen», «11 Alle Heizkreise aus über Aussentemperatur», «PR001 Kesselprogramm». Die Nummer liefert die Cloud selbst, sie stimmt also mit dem Display am Kessel überein. Parameter, die für alle Heizkreise gelten (11–13), erscheinen nur einmal.

Die Wochenuhr (z. B. «3a Wochenuhr») und das Urlaubsprogramm werden angezeigt, aber nicht geändert. Ihr Format ist zu komplex für ein einzelnes Feld. Kommt nach einem Firmware-Update ein neuer Wert dazu, erscheint er ohne Neustart.

Alle Namen und Zustände sind auf Deutsch, unabhängig von der Sprache von Home Assistant. Unbekannte Schlüssel werden Wort für Wort übersetzt. Den Originalwert der API zeigt das Attribut `api_wert`.

## Installation

**HACS:** HACS → Integrationen → ⋮ → Benutzerdefinierte Repositories → `https://github.com/sdoerig70-netizen/hargassner-touch-pro-homeassistant` als «Integration» hinzufügen → «Hargassner Touch Pro» installieren → Home Assistant neu starten.

**Manuell:** Den Ordner `custom_components/hargassner_touch_pro/` nach `config/custom_components/` kopieren und neu starten.

## Einrichten

Einstellungen → Geräte & Dienste → Integration hinzufügen → **Hargassner Touch Pro** → E-Mail und Passwort der Hargassner-App eingeben.

Unter **Konfigurieren** gibt es drei Optionen:

- **Abfrageintervall** (30–600 Sekunden, Standard 60)
- **Alle Messkanäle laden** (Standard ein)
- **Einstellungen und Aktionen anlegen** (Standard ein; aus = die Integration liest nur)

## Dienste

**`hargassner_touch_pro.set_parameter`** setzt jeden schreibbaren Parameter, auch ohne Entität:

```yaml
action: hargassner_touch_pro.set_parameter
data:
  baustein: Heizkreis 1        # oder «Kessel», «Warmwasser 1», Name aus der App
  parameter: room_temperature_reduction
  wert: 17.5
```

**`hargassner_touch_pro.start_ignition`** startet die Zündung.

## Dashboard

In `dashboard/heizung.yaml` liegt ein Beispiel-Dashboard für eine Eco-HK mit Puffer, zwei Heizkreisen und Frischwasserstation. Es nutzt nur Karten, die Home Assistant mitbringt (Kacheln, Rundanzeigen, Thermostate, Verläufe), und hat die Reiter Übersicht, Heizkurve, Einstellungen, Alle Werte und Messkanäle. Die Entitäts-IDs beginnen mit `musteranlage_`. Für eine andere Anlage ersetzt man diesen Teil durch den eigenen Anlagennamen.

Einfügen: Einstellungen → Dashboards → Dashboard hinzufügen → «Neues Dashboard von Grund auf» → öffnen → ✏️ → ⋮ → Rohdaten-Konfigurationseditor → Inhalt ersetzen → Speichern.

## Heizkurven-Karte

Die Integration bringt die Karte `custom:hargassner-heizkurve-card` mit, sie wird automatisch geladen. Sie zeigt pro Heizkreis die Tages- und Absenkkurve, den aktuellen Arbeitspunkt, den Einfluss der Witterungsführung A5b (Aus, ECO mit 3 h Vorhersage, ECO+ mit 6 h) und die echten Sollwerte der letzten Tage als Punkte. Steilheit und Tages-Raumtemperatur lassen sich als Entwurf verschieben und mit «Übernehmen» an den Kessel senden.

```yaml
type: custom:hargassner-heizkurve-card
aussen: sensor.<anlage>_kessel_aussentemperatur_gemittelt
aussen_aktuell: sensor.<anlage>_kessel_aussentemperatur
prognose: sensor.<anlage>_prognose
abschaltgrenze: number.<anlage>_heizkreis_1_..._11_alle_heizkreise_aus_uber_aussentemperatur
heizkreise:
  - name: Heizkreis 1
    steilheit: number.<anlage>_heizkreis_1_..._a2_steilheit
    tagestemperatur: number.<anlage>_heizkreis_1_..._4_tages_raumtemperatur
    absenktemperatur: number.<anlage>_heizkreis_1_..._5_absenk_raumtemperatur
    witterung: select.<anlage>_heizkreis_1_..._a5b_witterungsfuhrung
    vorlauf_soll: sensor.<anlage>_heizkreis_1_..._vorlauf_solltemperatur
    vorlauf_ist: sensor.<anlage>_heizkreis_1_..._vorlauftemperatur
```

Modell: Vorlauf = Raumsoll + Steilheit × (Raumsoll − Aussentemperatur). Weicht der echte Sollwert (Raute) vom Modell ab, wirken weitere Einflüsse, etwa ein gemeinsamer Vorlauf ohne Mischer.

## Anlagen-Karte im Hargassner-Stil

`custom:hargassner-anlage-card` bildet die Ansicht der Hargassner-App nach: Kacheln für Wetter, Kessel, Puffer, Heizkreise und Frischwasserstation mit den gewohnten Grafiken, dazu Kessel-Details und Signale. Oben gibt es die Reiter Dashboard, Parameter, Messwerte und Heizkurve.

- **Dashboard:** Ein Klick auf einen Wert öffnet die Entität. Der Schraubenschlüssel springt zu den Parametern des Bausteins, die Uhr öffnet die Wochenuhr. Bei den Heizkreisen stellen − und + die Raumtemperatur-Korrektur.
- **Parameter:** Alle schreibbaren Werte der Integration, nach Baustein gruppiert, direkt änderbar.
- **Kacheln:** Jede Kachel hat Knöpfe für Trends (grün), Heizkurve (orange, bei Heizkreisen), Parameter (grau) und Zeitprogramm (blau). Sie öffnen die passende Seite direkt beim richtigen Baustein.
- **Zeitprogramme:** Der blaue Knopf öffnet einen Editor für die Wochenuhr: Tage wählen, bis zu zwei Zeitfenster pro Eintrag im 15-Minuten-Raster, bis zu 7 Einträge, mit Wochenübersicht. Gespeichert wird über den Dienst `hargassner_touch_pro.set_time_program`.
- **Messwerte:** Verläufe aller Messkanäle (Heute, Gestern, 24 Stunden, 7 Tage, 30 Tage oder frei wählbarer Datumsbereich), mit ‹ › blättern, «jetzt» springt zurück. Zoomen mit dem Mausrad (zur Mausposition hin) oder durch Aufziehen eines Bereichs; ＋/－ zoomen um die Mitte, Doppelklick zoomt heraus, Umschalttaste + Mausrad verschiebt den Ausschnitt. Die Diagramme füllen die Fensterhöhe (fest einstellbar mit `diagramm_hoehe`). Prozentwerte erscheinen mit eigener Achse rechts im Temperaturdiagramm. Linien lassen sich in der Legende ausblenden. Druck und Ein/Aus-Signale sind ausgeblendet (`messwerte_ohne: [Signal, bar]`, mit `messwerte_ohne: []` wieder alle). Bei den Heizkreisen zeigt die Karte nur den Trend von Vorlauf- und Vorlauf-Solltemperatur (gestrichelt). Mit `trend:` im Heizkreis lässt sich eine eigene Liste von Entitäten angeben.
- **Heizkurve:** Die Heizkurven-Karte, falls `heizkurve:` gesetzt ist.

Parameter und Messkanäle findet die Karte selbst. Die Kacheln brauchen die Zuordnung der Entitäten, ein vollständiges Beispiel liegt in `dashboard/hargassner.yaml`. Am besten als Ansicht vom Typ «Panel» einsetzen.

## Einfache Ansicht für alle

Die Karte `custom:hargassner-schema-card` zeigt die Heizung als einfaches Schema: Holzschnitzel-Lager, Holzkessel, Wärmespeicher, Warmwasser-Station und die Häuser. Leitungen sind nach Temperatur eingefärbt, wandernde Striche zeigen, wo gerade Wasser fliesst. Oben steht in einem Satz, was die Heizung gerade tut. Ein Tippen auf einen Teil erklärt ihn in Alltagssprache.

Darunter wird pro Haus mit grossen Knöpfen bedient: Wohlfühl- und Spartemperatur mit + und −, Betrieb «Nach Zeitplan», «Immer warm», «Sparbetrieb», «Aus», «Jetzt warm», «Jetzt sparen» und der Zeitplan. Das Ausschalten eines Hauses und jede Änderung am Kessel fragen vorher nach. «Für Fachleute» öffnet die vollständige Anlagen-Karte. Konfiguration wie bei der Anlagen-Karte unter `anlage:`, dazu optional `ruecklauf`, `ladepumpe`, `lagerstand` und `cloud`. Der Speicher zeigt die Anschlüsse vereinfacht nach einem typischen Prinzipschema: links Kesselvorlauf oben und der Kesselrücklauf mit Ausdehnungsgefäss, umschaltbar über Kugelhähne auf den Anschluss unten (Normalbetrieb) oder Mitte (bei Solar, `ruecklauf_anschluss: mitte`); der abgesperrte Weg ist grau; rechts Frischwasserstation oben, Heizgruppen Mitte oben, Frischwasser-Rücklauf Mitte unten, Heizungsrücklauf unten. Dazu die vier Fühler BF1, PF1, PF2, PF3 (Zuordnung mit `fuehler: {BF1: …, PF1: …}`, sonst PF1 = oben, PF2 = Mitte, PF3 = unten), ein Elektroeinsatz (optional `elektro:` für den Ein/Aus-Zustand) und die Heizgruppen mit Pumpe, Mischer und Vorlauffühler auf dem Verteilbalken samt Reserveabgang. Eine Solarwendel unten im Speicher ist gestrichelt als «Solar (möglich)» eingezeichnet; mit `solar: {kollektor: sensor…, pumpe: binary_sensor…}` wird sie mit Temperatur und Strömung angezeigt. Das Schema ist fast quadratisch und passt auf dem Smartphone in die Bildschirmbreite; auf breiten Bildschirmen stehen die Bedienkacheln rechts daneben. «Grösser anzeigen» öffnet es bildschirmfüllend zum Zoomen. Vorlage: `dashboard/heizung-einfach.yaml`.

## Hackgut und Wartung

Die Integration rechnet aus der Kesselleistung (Leistung in % × Nennleistung) laufend die abgegebene Wärme hoch und schätzt daraus:

- **Hackgut im Lager:** Restmenge in Schüttraummetern, Reichweite in Tagen und das voraussichtliche Datum, an dem das Lager leer ist. Nach einer Lieferung den Dienst `hargassner_touch_pro.lager_gefuellt` (Menge, optional Datum) aufrufen oder den Knopf «Lager aufgefüllt» drücken.
- **Aschebox und Reinigung:** geschätzter Füllstand, Tage bis zur nächsten Wartung und Datum. Fällig ist die Wartung, wenn die Box rechnerisch voll ist, spätestens aber nach der eingestellten Anzahl Tage. Nach dem Leeren `hargassner_touch_pro.asche_geleert` aufrufen; mit dem tatsächlichen Füllstand (`fuellstand` in %) lernt der Rechner einen Korrekturfaktor.

Die Annahmen sind als Einstellungs-Entitäten änderbar: Nennleistung (aus dem Kesseltyp erkannt), Wirkungsgrad (90 %), Heizwert (745 kWh/Srm, Fichte W30), Schüttdichte (216 kg/Srm), Aschegehalt (1 %), Dichte der Asche in der Box (0,6 kg/l), Grösse der Aschebox (30 l) und Wartung spätestens nach (14 Tagen). Als Tagesverbrauch dient das Mittel der letzten Tage; beim ersten Start werden die Stundenwerte der Kesselleistung aus der Home-Assistant-Statistik übernommen. Die Schema-Karte zeigt die Werte unter `verbrauch:` an (siehe `dashboard/heizung-einfach.yaml`).

## 3D-Ansicht

Die Karte `custom:hargassner-anlage-3d-card` zeigt Heizraum und Lager als 3D-Modell. Rohre und Puffer sind nach Temperatur eingefärbt, die Strömung läuft, wenn die zuständige Pumpe aktiv ist, Flamme, Rührwerk und Rauch folgen der Kesselleistung. Ein Klick auf ein Bauteil zeigt Werte und Bedienung; Trends, Parameter, Zeitprogramm und Heizkurve öffnen die bestehenden Karten.

Die Karte selbst enthält keine Anlagendaten. Gebäude, Positionen und Masse der Bauteile und die Bauteil-Texte kommen aus einem Anlagenmodell unter `modell:`, entweder direkt als Objekt in der Dashboard-Konfiguration oder als URL einer JSON-Datei (z. B. `/local/hargassner/anlage-3d.json` für `config/www/hargassner/anlage-3d.json`). Aufbau siehe `dashboard/anlage-3d-beispiel.json`: Koordinaten in Metern, `x`/`y` im Grundriss, `z` als Höhe. Das Gebäude kann unter `gebaeude.teile` als Dreiecksnetz (z. B. aus einem IFC exportiert) oder vereinfacht unter `raeume` als Quader angegeben werden.

Unter `anlage:` stehen dieselben Einträge wie bei der Anlagen-Karte, dazu optional `ruecklauf`, `ruecklauf_soll`, `sauerstoff`, `sauerstoff_soll`, `systemdruck`, `lagerstand`, `lager_max_kg`, `ladepumpe`, `abgasueberwachung`, `zwangsladung`, `zwangsladung_aktiv`. Vorlage: `dashboard/heizung-3d.yaml`. three.js (MIT-Lizenz) liegt in `frontend/lib`.

## Welche Werte hat meine Anlage?

Geräte & Dienste → Hargassner Touch Pro → ⋮ → **Diagnose herunterladen**. Die Datei listet pro Baustein alle Istwerte, Parameter (mit Art: Zahl, Auswahl, Schalter, Text, nur lesbar), Aktionen und die Zahl der Messkanäle. Zugangsdaten und Seriennummern sind geschwärzt.

## Unterschiede zum Original

- Alle Istwerte, Parameter, Aktionen und Messkanäle werden automatisch angelegt statt einer festen Liste.
- Komplett auf Deutsch, unabhängig von der Sprache von Home Assistant.
- Ein Gerät pro Baustein, Dienst «Parameter setzen», Diagnose-Datei, Neuanmeldung bei abgelaufenem Passwort.
- Thermostat mit Automatik, Heizen und Aus. «Heizen» setzt die Betriebsart dauerhaft auf Heizen.

## Tests

```bash
pip install pytest-homeassistant-custom-component
pytest
```

## Hinweis

Nicht von der Hargassner GmbH unterstützt oder geprüft.
