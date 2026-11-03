"""Brennstoff- und Wartungsrechner.

Rechnet aus der Kesselleistung laufend die abgegebene Wärme hoch und schätzt daraus:
- wie viel Hackgut (Schüttraummeter) noch im Lager ist und wie lange es reicht,
- wie voll die Aschebox ist und wann sie geleert und der Kessel gereinigt werden sollte.

Alle Annahmen (Heizwert, Wirkungsgrad, Aschegehalt, Boxgrösse …) sind als Zahlen-Entitäten
einstellbar. Mit jeder Leerung, bei der der tatsächliche Füllstand angegeben wird, lernt der
Rechner einen Korrekturfaktor für die Asche dazu.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Any

from homeassistant.components.button import ButtonEntity
from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.const import EntityCategory, UnitOfEnergy
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .entity_base import hauptgeraet

_LOGGER = logging.getLogger(__name__)

SPEICHER_VERSION = 1
MAX_LUECKE_H = 0.25  # längere Datenlücken nicht hochrechnen

# Einstellbare Annahmen: Schlüssel → (Name, Einheit, min, max, Schritt, Vorgabe, Symbol)
ANNAHMEN: dict[str, tuple] = {
    "nennleistung": ("Nennleistung Kessel", "kW", 5, 500, 0.5, None, "mdi:fire"),
    "wirkungsgrad": ("Kesselwirkungsgrad", "%", 50, 100, 1, 90, "mdi:percent"),
    "heizwert": ("Heizwert Hackgut", "kWh/Srm", 400, 1300, 5, 745, "mdi:lightning-bolt"),
    "schuettdichte": ("Schüttdichte Hackgut", "kg/Srm", 120, 400, 1, 216, "mdi:weight"),
    "aschegehalt": ("Aschegehalt Hackgut", "%", 0.2, 5, 0.1, 1.0, "mdi:grain"),
    "aschedichte": ("Dichte Asche in der Box", "kg/l", 0.2, 1.5, 0.05, 0.6, "mdi:weight-kilogram"),
    "aschebox": ("Grösse Aschebox", "l", 10, 1000, 1, 30, "mdi:delete-variant"),
    "wartung_max": ("Wartung spätestens nach", "Tage", 3, 90, 1, 14, "mdi:calendar-refresh"),
    "lager_menge": ("Lager zuletzt gefüllt mit", "Srm", 0, 500, 0.5, 0, "mdi:warehouse"),
}


def nennleistung_aus_typ(text: str | None) -> float | None:
    """«Eco-HK 35.4» → 35."""
    m = re.search(r"(\d{2,3})(?:[.,]\d)?\b", str(text or ""))
    return float(m.group(1)) if m else None


class Verbrauchsrechner:
    """Hält Zähler und Zeitpunkte persistent und liefert die abgeleiteten Werte."""

    def __init__(self, hass: HomeAssistant, coordinator, entry_id: str) -> None:
        self.hass = hass
        self.coordinator = coordinator
        self._store = Store(hass, SPEICHER_VERSION, f"{DOMAIN}.verbrauch.{entry_id}")
        self.daten: dict[str, Any] = {}
        self._hoerer: list = []

    async def async_laden(self) -> None:
        self.daten = await self._store.async_load() or {}
        self.daten.setdefault("energie_kwh", 0.0)
        self.daten.setdefault("tage", {})
        self.daten.setdefault("annahmen", {})
        self.daten.setdefault("asche_faktor", 1.0)
        self.daten.setdefault("lager", {})
        self.daten.setdefault("asche", {})
        self.daten.setdefault("tag_beginn", {})
        if not self.daten["tage"]:
            try:
                await self._aus_statistik_nachtragen()
            except Exception as err:  # noqa: BLE001 – Nachtragen ist nur eine Hilfe
                _LOGGER.debug("Statistik konnte nicht nachgetragen werden: %s", err)

    async def _aus_statistik_nachtragen(self) -> None:
        """Beim ersten Start die Stundenmittel der Kesselleistung aus der Statistik übernehmen."""
        from homeassistant.components.recorder import get_instance
        from homeassistant.components.recorder.statistics import statistics_during_period
        from homeassistant.helpers import entity_registry as er

        reg = er.async_get(self.hass)
        kandidaten = [
            e.entity_id
            for e in reg.entities.values()
            if e.platform == DOMAIN
            and e.domain == "sensor"
            and str(e.unique_id).endswith("_efficiency")
            and "_metric_" not in str(e.unique_id)
            and "_verbrauch_" not in str(e.unique_id)
            and str(self.coordinator.installation_id) in str(e.unique_id)
        ]
        if not kandidaten:
            return
        start = dt_util.utcnow() - timedelta(days=14)
        stat = await get_instance(self.hass).async_add_executor_job(
            statistics_during_period, self.hass, start, None, {kandidaten[0]}, "hour", None, {"mean"}
        )
        reihen = stat.get(kandidaten[0]) or []
        nenn = self.annahme("nennleistung")
        for zeile in reihen:
            mittel = zeile.get("mean")
            beginn = zeile.get("start")
            if mittel is None or beginn is None:
                continue
            zeitpunkt = datetime.fromtimestamp(beginn, tz=dt_util.UTC) if isinstance(beginn, (int, float)) else beginn
            tag = dt_util.as_local(zeitpunkt).date().isoformat()
            kwh = nenn * max(0.0, float(mittel)) / 100
            self.daten["tage"][tag] = self.daten["tage"].get(tag, 0.0) + kwh
            self.daten["energie_kwh"] += kwh
            self.daten["tag_beginn"].setdefault(tag, zeitpunkt.isoformat())
        if reihen:
            _LOGGER.info("Verbrauchsrechner: %s Stunden aus der Statistik übernommen", len(reihen))
            self.speichern()

    def speichern(self) -> None:
        self._store.async_delay_save(lambda: self.daten, 30)

    def beobachten(self, rueckruf) -> None:
        self._hoerer.append(rueckruf)

    def _melden(self) -> None:
        for r in self._hoerer:
            r()

    # ---------------------------------------------------------------- Annahmen

    def annahme(self, schluessel: str) -> float:
        wert = self.daten["annahmen"].get(schluessel)
        if wert is not None:
            return float(wert)
        if schluessel == "nennleistung":
            return self._nennleistung_erkannt() or 35.0
        return float(ANNAHMEN[schluessel][5])

    def annahme_setzen(self, schluessel: str, wert: float) -> None:
        self.daten["annahmen"][schluessel] = wert
        self.speichern()
        self._melden()

    def _kessel(self) -> dict | None:
        for widget in self.coordinator.widgets().values():
            if str(widget.get("widget_type", "")).upper().startswith("HEATER") and "efficiency" in widget.get("values", {}):
                return widget
        return None

    def _nennleistung_erkannt(self) -> float | None:
        kessel = self._kessel()
        if kessel:
            for k, v in kessel.get("values", {}).items():
                if "type" in k or "series" in k:
                    n = nennleistung_aus_typ(v)
                    if n:
                        return n
        return nennleistung_aus_typ(getattr(self.coordinator, "model", None))

    # ---------------------------------------------------------------- Zählen

    @callback
    def aktualisieren(self) -> None:
        """Bei jeder Abfrage: Leistung × Zeit aufsummieren."""
        kessel = self._kessel()
        if not kessel:
            return
        try:
            leistung = float(kessel["values"].get("efficiency"))
        except (TypeError, ValueError):
            return
        jetzt = dt_util.utcnow()
        letzte = self.daten.get("letzte_messung")
        self.daten["letzte_messung"] = jetzt.isoformat()
        if letzte:
            dt_h = (jetzt - datetime.fromisoformat(letzte)).total_seconds() / 3600
            if 0 < dt_h <= MAX_LUECKE_H:
                kwh = self.annahme("nennleistung") * max(0.0, leistung) / 100 * dt_h
                self.daten["energie_kwh"] += kwh
                tag = dt_util.as_local(jetzt).date().isoformat()
                self.daten["tage"][tag] = self.daten["tage"].get(tag, 0.0) + kwh
                self.daten["tag_beginn"].setdefault(tag, letzte)
                for alt in sorted(self.daten["tage"])[:-60]:
                    del self.daten["tage"][alt]
                    self.daten["tag_beginn"].pop(alt, None)
        self.speichern()
        self._melden()

    # ---------------------------------------------------------------- Ableitungen

    def tagesmittel_kwh(self) -> float | None:
        """Mittlere Wärme pro Tag: letzte bis zu 7 volle Tage, sonst Hochrechnung von heute."""
        heute = dt_util.now().date().isoformat()
        def stunden_erfasst(tag: str) -> float:
            beginn = self.daten["tag_beginn"].get(tag)
            tagesbeginn = dt_util.start_of_local_day(datetime.fromisoformat(tag + "T12:00:00").replace(tzinfo=dt_util.get_default_time_zone()))
            ende = min(dt_util.now(), tagesbeginn + timedelta(days=1))
            von = max(tagesbeginn, datetime.fromisoformat(beginn)) if beginn else tagesbeginn
            return max(0.0, (ende - von).total_seconds() / 3600)

        # Tage mit mindestens 20 erfassten Stunden zählen voll, angebrochene werden hochgerechnet
        summe = 0.0
        stunden = 0.0
        for tag in sorted(t for t in self.daten["tage"] if t <= heute)[-8:]:
            h = stunden_erfasst(tag)
            if h >= 3:
                summe += self.daten["tage"][tag]
                stunden += h
        if stunden < 3:
            return None
        return summe / stunden * 24

    def _srm_je_kwh(self) -> float:
        return 1 / (self.annahme("heizwert") * self.annahme("wirkungsgrad") / 100)

    def lager(self) -> dict[str, Any]:
        l = self.daten["lager"]
        menge = self.annahme("lager_menge")
        if not menge or "energie" not in l:
            return {}
        verbraucht = l.get("vorab", 0.0) + (self.daten["energie_kwh"] - l["energie"]) * self._srm_je_kwh()
        rest = max(0.0, menge - verbraucht)
        mittel = self.tagesmittel_kwh()
        pro_tag = mittel * self._srm_je_kwh() if mittel else None
        tage = rest / pro_tag if pro_tag else None
        return {
            "rest": round(rest, 1),
            "verbraucht": round(verbraucht, 1),
            "prozent": round(rest / menge * 100) if menge else None,
            "pro_tag": round(pro_tag, 2) if pro_tag else None,
            "tage": round(tage, 1) if tage is not None else None,
            "leer_am": (dt_util.now() + timedelta(days=tage)).date() if tage is not None else None,
            "gefuellt_am": l.get("datum"),
        }

    def _asche_l_je_kwh(self) -> float:
        kg = self._srm_je_kwh() * self.annahme("schuettdichte") * self.annahme("aschegehalt") / 100
        return kg / self.annahme("aschedichte") * self.daten.get("asche_faktor", 1.0)

    def asche(self) -> dict[str, Any]:
        a = self.daten["asche"]
        if "energie" not in a:
            return {}
        box = self.annahme("aschebox")
        liter = (self.daten["energie_kwh"] - a["energie"]) * self._asche_l_je_kwh()
        prozent = min(100.0, liter / box * 100) if box else None
        mittel = self.tagesmittel_kwh()
        pro_tag = mittel * self._asche_l_je_kwh() if mittel else None
        tage_bis_voll = max(0.0, (box - liter) / pro_tag) if pro_tag else None
        geleert = datetime.fromisoformat(a["datum"]) if a.get("datum") else None
        spaetestens = geleert + timedelta(days=self.annahme("wartung_max")) if geleert else None
        voll_am = dt_util.now() + timedelta(days=tage_bis_voll) if tage_bis_voll is not None else None
        faellig = min([d for d in (voll_am, spaetestens) if d is not None], default=None)
        return {
            "liter": round(liter, 1),
            "prozent": round(prozent) if prozent is not None else None,
            "pro_tag": round(pro_tag, 2) if pro_tag else None,
            "tage_bis_voll": round(tage_bis_voll, 1) if tage_bis_voll is not None else None,
            "voll_am": voll_am.date() if voll_am else None,
            "faellig_am": faellig.date() if faellig else None,
            "tage_bis_faellig": round(max(0.0, (faellig - dt_util.now()).total_seconds() / 86400), 1) if faellig else None,
            "grund": "Aschebox voll" if faellig and voll_am and faellig == voll_am else "Wartungsintervall",
            "geleert_am": geleert.date() if geleert else None,
            "zyklus_tage": round(box / pro_tag, 1) if pro_tag else None,
            "faktor": round(self.daten.get("asche_faktor", 1.0), 2),
        }

    # ---------------------------------------------------------------- Ereignisse

    def lager_gefuellt(self, menge: float | None, datum: datetime | None, bereits_verbraucht: float | None) -> None:
        if menge:
            self.daten["annahmen"]["lager_menge"] = float(menge)
        datum = datum or dt_util.now()
        vorab = bereits_verbraucht
        if vorab is None and datum < dt_util.now() - timedelta(hours=1):
            # Verbrauch zwischen Füllung und heute aus dem Tagesmittel schätzen
            mittel = self.tagesmittel_kwh() or 0.0
            vorab = (dt_util.now() - datum).total_seconds() / 86400 * mittel * self._srm_je_kwh()
        self.daten["lager"] = {"energie": self.daten["energie_kwh"], "datum": dt_util.as_local(datum).date().isoformat(), "vorab": float(vorab or 0.0)}
        self.speichern()
        self._melden()

    def asche_geleert(self, fuellstand: float | None = None, datum: datetime | None = None) -> None:
        """Leerung festhalten; mit tatsächlichem Füllstand (%) wird der Korrekturfaktor angepasst."""
        if fuellstand is not None and "energie" in self.daten["asche"]:
            geschaetzt = self.asche().get("prozent")
            if geschaetzt and geschaetzt > 5 and fuellstand > 5:
                neu = self.daten.get("asche_faktor", 1.0) * fuellstand / geschaetzt
                # gleitend anpassen, damit einzelne Ausreisser nicht alles verschieben
                self.daten["asche_faktor"] = round(0.5 * self.daten.get("asche_faktor", 1.0) + 0.5 * neu, 3)
        datum = datum or dt_util.now()
        basis = self.daten["energie_kwh"]
        if datum < dt_util.now() - timedelta(hours=1):
            # Leerung in der Vergangenheit: aufgezeichnete Tage ab dem Datum, davor das Tagesmittel
            tag0 = dt_util.as_local(datum).date().isoformat()
            erfasst = sum(v for t, v in self.daten["tage"].items() if t > tag0)
            erster = min(self.daten["tage"], default=None)
            ohne = 0.0
            if erster and erster > tag0:
                start = datetime.fromisoformat(erster + "T00:00:00").replace(tzinfo=dt_util.get_default_time_zone())
                ohne = max(0.0, (start - datum).total_seconds() / 86400) * (self.tagesmittel_kwh() or 0.0)
            elif not erster:
                ohne = (dt_util.now() - datum).total_seconds() / 86400 * (self.tagesmittel_kwh() or 0.0)
            basis = self.daten["energie_kwh"] - erfasst - ohne
        self.daten["asche"] = {"energie": basis, "datum": datum.isoformat()}
        self.speichern()
        self._melden()


# ==================================================================== Entitäten


class _Basis(CoordinatorEntity):
    _attr_has_entity_name = True

    def __init__(self, rechner: Verbrauchsrechner, schluessel: str, name: str) -> None:
        super().__init__(rechner.coordinator)
        self.rechner = rechner
        self._attr_unique_id = f"{DOMAIN}_{rechner.coordinator.installation_id}_verbrauch_{schluessel}"
        self._attr_name = name
        self._attr_device_info = hauptgeraet(rechner.coordinator)

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.rechner.beobachten(self.async_write_ha_state)


# (Schlüssel, Name, Einheit, Symbol, Quelle, Feld, Geräteklasse)
SENSOREN = [
    ("waerme_gesamt", "Kessel Wärme gesamt", UnitOfEnergy.KILO_WATT_HOUR, "mdi:fire", None, None, SensorDeviceClass.ENERGY),
    ("waerme_tagesmittel", "Kessel Wärme pro Tag", "kWh/d", "mdi:chart-bar", None, None, None),
    ("lager_rest", "Hackgut im Lager", "Srm", "mdi:warehouse", "lager", "rest", None),
    ("lager_reichweite", "Hackgut reicht noch", "d", "mdi:calendar-arrow-right", "lager", "tage", None),
    ("lager_leer_am", "Hackgut leer am", None, "mdi:calendar-alert", "lager", "leer_am", SensorDeviceClass.DATE),
    ("asche_fuellstand", "Aschebox Füllstand", "%", "mdi:delete-variant", "asche", "prozent", None),
    ("asche_tage", "Wartung fällig in", "d", "mdi:wrench-clock", "asche", "tage_bis_faellig", None),
    ("asche_faellig_am", "Wartung fällig am", None, "mdi:calendar-check", "asche", "faellig_am", SensorDeviceClass.DATE),
    ("asche_geleert_am", "Aschebox zuletzt geleert", None, "mdi:calendar-blank", "asche", "geleert_am", SensorDeviceClass.DATE),
]


class VerbrauchSensor(_Basis, SensorEntity):
    def __init__(self, rechner, schluessel, name, einheit, symbol, quelle, feld, klasse) -> None:
        super().__init__(rechner, schluessel, name)
        self._schluessel = schluessel
        self._quelle = quelle
        self._feld = feld
        self._attr_native_unit_of_measurement = einheit
        self._attr_icon = symbol
        self._attr_device_class = klasse
        if schluessel == "waerme_gesamt":
            self._attr_state_class = SensorStateClass.TOTAL_INCREASING
        elif einheit in ("Srm", "%", "d", "kWh/d"):
            self._attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def native_value(self):
        if self._schluessel == "waerme_gesamt":
            return round(self.rechner.daten.get("energie_kwh", 0.0), 1)
        if self._schluessel == "waerme_tagesmittel":
            m = self.rechner.tagesmittel_kwh()
            return round(m) if m is not None else None
        werte = self.rechner.lager() if self._quelle == "lager" else self.rechner.asche()
        return werte.get(self._feld)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        if self._quelle == "lager":
            return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in self.rechner.lager().items()}
        if self._quelle == "asche":
            return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in self.rechner.asche().items()}
        return None


class VerbrauchZahl(_Basis, NumberEntity):
    _attr_mode = NumberMode.BOX
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, rechner, schluessel) -> None:
        name, einheit, mi, ma, schritt, _vorgabe, symbol = ANNAHMEN[schluessel]
        super().__init__(rechner, "annahme_" + schluessel, name)
        self._schluessel = schluessel
        self._attr_native_unit_of_measurement = einheit
        self._attr_native_min_value = mi
        self._attr_native_max_value = ma
        self._attr_native_step = schritt
        self._attr_icon = symbol

    @property
    def native_value(self) -> float:
        return self.rechner.annahme(self._schluessel)

    async def async_set_native_value(self, value: float) -> None:
        self.rechner.annahme_setzen(self._schluessel, value)


class AscheGeleertKnopf(_Basis, ButtonEntity):
    _attr_icon = "mdi:check-circle-outline"

    def __init__(self, rechner) -> None:
        super().__init__(rechner, "asche_geleert", "Aschebox geleert")

    async def async_press(self) -> None:
        self.rechner.asche_geleert()


class LagerGefuelltKnopf(_Basis, ButtonEntity):
    _attr_icon = "mdi:warehouse"

    def __init__(self, rechner) -> None:
        super().__init__(rechner, "lager_gefuellt", "Lager aufgefüllt")

    async def async_press(self) -> None:
        self.rechner.lager_gefuellt(None, None, 0.0)


def sensoren(rechner: Verbrauchsrechner) -> list:
    return [VerbrauchSensor(rechner, *s) for s in SENSOREN]


def zahlen(rechner: Verbrauchsrechner) -> list:
    return [VerbrauchZahl(rechner, k) for k in ANNAHMEN]


def knoepfe(rechner: Verbrauchsrechner) -> list:
    return [AscheGeleertKnopf(rechner), LagerGefuelltKnopf(rechner)]
