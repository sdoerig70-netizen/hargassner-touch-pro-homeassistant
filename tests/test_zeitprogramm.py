"""Tests für die Prüfung der Wochenuhr."""
import importlib.util
import pathlib

import pytest

_pfad = pathlib.Path(__file__).parents[1] / "custom_components/hargassner_touch_pro/zeitprogramm.py"
_spec = importlib.util.spec_from_file_location("zeitprogramm", _pfad)
zp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(zp)


def test_gueltige_zeitfenster():
    for z in ("T06:00PT2H", "T06:15PT45M", "T22:00PT2H", "T00:00P1D", "T05:30PT12H30M"):
        assert zp.zeitfenster_gueltig(z), z


def test_ungueltige_zeitfenster():
    for z in ("T23:00PT2H", "T06:00PT0M", "06:00", "T06:00P1D", "T25:00PT1H"):
        assert not zp.zeitfenster_gueltig(z), z


def test_eintraege_sortiert_und_leere_entfernt():
    roh = [{"days": ["fr", "MO"], "times": ["T16:00PT6H", "T06:00PT2H"]}, {"days": [], "times": []}]
    assert zp.eintraege_pruefen(roh) == [{"days": ["MO", "FR"], "times": ["T06:00PT2H", "T16:00PT6H"]}]


@pytest.mark.parametrize(
    "roh",
    [
        [{"days": ["XX"], "times": ["T06:00PT2H"]}],
        [{"days": ["MO"], "times": []}],
        [{"days": ["MO"], "times": ["T06:00PT1H", "T08:00PT1H", "T10:00PT1H"]}],
        [{"days": ["MO"], "times": ["T06:00PT1H"]}] * 8,
    ],
)
def test_fehler(roh):
    with pytest.raises(ValueError):
        zp.eintraege_pruefen(roh)


def test_geraet_pfad():
    assert zp.geraet_pfad({"chatbot": "devices/99/parameters/3a/chatbot/query"}) == "/devices/99/parameters/3a"
    assert zp.geraet_pfad({}) is None
