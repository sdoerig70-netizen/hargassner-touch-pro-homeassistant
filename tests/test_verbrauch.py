"""Tests für den Brennstoff- und Wartungsrechner (ohne laufendes Home Assistant)."""
from datetime import timedelta

from homeassistant.util import dt as dt_util

from custom_components.hargassner_touch_pro import verbrauch as v


class _Speicher:
    def __init__(self, *a, **k):
        pass

    async def async_load(self):
        return None

    def async_delay_save(self, f, d):
        pass


class _Koordinator:
    installation_id = "4711"
    model = "Eco-HK 35.4"

    def __init__(self):
        self.leistung = 0

    def widgets(self):
        return {"k": {"widget_type": "HEATER", "values": {"efficiency": self.leistung, "type": "Eco-HK 35.4"}}}


def _rechner(monkeypatch):
    monkeypatch.setattr(v, "Store", _Speicher)
    r = v.Verbrauchsrechner(None, _Koordinator(), "e")
    r.daten = {"energie_kwh": 0.0, "tage": {}, "annahmen": {}, "asche_faktor": 1.0, "lager": {}, "asche": {}, "tag_beginn": {}}
    return r


def test_nennleistung_aus_typ():
    assert v.nennleistung_aus_typ("Eco-HK 35.4") == 35
    assert v.nennleistung_aus_typ("ECO-HK-60") == 60
    assert v.nennleistung_aus_typ(None) is None


def test_lager_und_asche(monkeypatch):
    r = _rechner(monkeypatch)
    assert r.annahme("nennleistung") == 35
    # zwei volle Tage mit je 350 kWh
    gestern = (dt_util.now() - timedelta(days=1)).date().isoformat()
    vorgestern = (dt_util.now() - timedelta(days=2)).date().isoformat()
    r.daten["tage"] = {vorgestern: 350.0, gestern: 350.0}
    r.daten["energie_kwh"] = 700.0
    assert round(r.tagesmittel_kwh()) == 350
    r.lager_gefuellt(24, None, 0.0)
    r.asche_geleert()
    r.daten["energie_kwh"] += 350 * 5
    lager = r.lager()
    asche = r.asche()
    srm_pro_tag = 350 / (745 * 0.9)
    assert abs(lager["rest"] - (24 - 5 * srm_pro_tag)) < 0.1
    assert abs(lager["tage"] - lager["rest"] / srm_pro_tag) < 0.3
    liter_pro_tag = srm_pro_tag * 216 * 0.01 / 0.6
    assert abs(asche["liter"] - 5 * liter_pro_tag) < 0.2
    assert abs(asche["zyklus_tage"] - 30 / liter_pro_tag) < 0.3


def test_asche_lernt(monkeypatch):
    r = _rechner(monkeypatch)
    gestern = (dt_util.now() - timedelta(days=1)).date().isoformat()
    r.daten["tage"] = {gestern: 350.0}
    r.asche_geleert()
    r.daten["energie_kwh"] += 350 * 5
    geschaetzt = r.asche()["prozent"]
    r.asche_geleert(fuellstand=geschaetzt * 1.5)
    assert 1.2 < r.daten["asche_faktor"] < 1.3
