"""Integrationstest mit nachgebauter Hargassner-API."""
from unittest.mock import AsyncMock, patch

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.hargassner_touch_pro.const import DOMAIN

from .beispieldaten import INSTALLATION, MEASUREMENTS, METRIC_FIELDS, WIDGETS


def _api_patch():
    p = "custom_components.hargassner_touch_pro.api.HargassnerApi."
    patches = {
        "login": AsyncMock(return_value={"access_token": "x"}),
        "logout": AsyncMock(),
        "ensure_token_valid": AsyncMock(),
        "get_installation": AsyncMock(return_value=INSTALLATION),
        "get_widgets": AsyncMock(return_value=(WIDGETS, {"online_state": True})),
        "get_metric_fields": AsyncMock(side_effect=lambda dev: [
            {**f, "group": g["text"]} for g in METRIC_FIELDS for f in g["fields"]]),
        "get_latest_measurements": AsyncMock(side_effect=lambda dev, ids, w: MEASUREMENTS[dev]),
        "patch_value": AsyncMock(return_value={}),
        "post_action": AsyncMock(return_value={}),
    }
    return patches, [patch(p + k, v) for k, v in patches.items()]


async def _setup(hass):
    mocks, patches = _api_patch()
    for pt in patches:
        pt.start()
    entry = MockConfigEntry(domain=DOMAIN, data={
        "email": "a@b.ch", "password": "x", "installation_id": "4711", "installation_name": "Musteranlage"})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry, mocks, patches


def _zustand(hass, platform, name):
    treffer = [s for s in hass.states.async_all(platform) if s.attributes.get("friendly_name") == name]
    assert treffer, f"{name} fehlt. Vorhanden: " + ", ".join(
        sorted(s.attributes.get("friendly_name", "") for s in hass.states.async_all(platform)))
    return treffer[0]


async def test_alle_entitaeten(hass: HomeAssistant) -> None:
    entry, mocks, patches = await _setup(hass)
    try:
        alle = hass.states.async_all()
        for s in sorted(alle, key=lambda s: s.entity_id):
            print(f"{s.entity_id:70} {s.state:22} {s.attributes.get('friendly_name')}")

        # Istwerte auf Deutsch
        assert _zustand(hass, "sensor", "Musteranlage Kessel Zustand").state == "Leistungsbrand"
        assert _zustand(hass, "sensor", "Musteranlage Kessel Kesseltemperatur").state == "78.5"
        assert _zustand(hass, "sensor", "Musteranlage Kessel Rücklauftemperatur").attributes["unit_of_measurement"] == "°C"
        assert _zustand(hass, "sensor", "Musteranlage Heizkreis 1 (Erdgeschoss) Zustand").state == "Heizen"
        assert _zustand(hass, "sensor", "Musteranlage Frischwasserstation 1 Vorlauftemperatur sekundär").state == "48.3"
        assert _zustand(hass, "sensor", "Musteranlage Frischwasserstation 1 Durchfluss").state == "7.5"
        assert _zustand(hass, "binary_sensor", "Musteranlage Heizkreis 1 (Erdgeschoss) Pumpe aktiv").state == "on"
        assert _zustand(hass, "binary_sensor", "Musteranlage Cloud-Verbindung").state == "on"
        assert _zustand(hass, "sensor", "Musteranlage Kessel Serien Info").state == "ECO-HK-35"
        # Messkanäle
        assert _zustand(hass, "sensor", "Musteranlage Messkanäle Kessel Restsauerstoff").state == "9.1"
        assert _zustand(hass, "sensor", "Musteranlage Messkanäle Heizkreis 1 Mischer").state == "37"

        # Schreibbare Parameter
        prog = _zustand(hass, "select", "Musteranlage Kessel Kesselprogramm")
        assert prog.state == "Automatik"
        assert "Kaminfeger" in prog.attributes["options"]
        mode = _zustand(hass, "select", "Musteranlage Heizkreis 1 (Erdgeschoss) Betriebsart")
        assert "Vorübergehend heizen" in mode.attributes["options"]
        assert _zustand(hass, "select", "Musteranlage Warmwasser 1 Betriebsart").state == "Automatik"
        steil = _zustand(hass, "number", "Musteranlage Heizkreis 1 (Erdgeschoss) Steilheit")
        assert steil.attributes["step"] == 0.05
        assert _zustand(hass, "number", "Musteranlage Warmwasser 1 Solltemperatur").state == "55.0"
        assert _zustand(hass, "switch", "Musteranlage Heizkreis 1 (Erdgeschoss) Witterungsführung").state == "on"
        assert _zustand(hass, "text", "Musteranlage Heizkreis 1 (Erdgeschoss) Ferien Ende Datum").state == "2027-02-06"
        _zustand(hass, "button", "Musteranlage Kessel Zündung starten")
        klima = _zustand(hass, "climate", "Musteranlage Heizkreis 1 (Erdgeschoss)")
        assert klima.attributes["temperature"] == 21.5 and klima.state == "auto"

        # Schreiben
        await hass.services.async_call("select", "select_option",
            {"entity_id": mode.entity_id, "option": "Vorübergehend heizen"}, blocking=True)
        mocks["patch_value"].assert_awaited_with("/installations/4711/hc/1/mode", "MODE_BRIDGE_HEATING")
        await hass.services.async_call("number", "set_value",
            {"entity_id": steil.entity_id, "value": 0.75}, blocking=True)
        mocks["patch_value"].assert_awaited_with("/installations/4711/hc/1/steep", 0.75)
        ww = _zustand(hass, "number", "Musteranlage Warmwasser 1 Solltemperatur")
        await hass.services.async_call("number", "set_value", {"entity_id": ww.entity_id, "value": 58}, blocking=True)
        mocks["patch_value"].assert_awaited_with("/installations/4711/boiler/1/target", 58)
        sw = _zustand(hass, "switch", "Musteranlage Warmwasser 1 Einmalige Zirkulation")
        await hass.services.async_call("switch", "turn_on", {"entity_id": sw.entity_id}, blocking=True)
        mocks["patch_value"].assert_awaited_with("/installations/4711/boiler/1/circ", True)
        await hass.services.async_call("climate", "set_temperature",
            {"entity_id": klima.entity_id, "temperature": 22}, blocking=True)
        mocks["patch_value"].assert_awaited_with("/installations/4711/hc/1/rth", 22)
        await hass.services.async_call("climate", "set_hvac_mode",
            {"entity_id": klima.entity_id, "hvac_mode": "off"}, blocking=True)
        mocks["patch_value"].assert_awaited_with("/installations/4711/hc/1/mode", "MODE_OFF")
        btn = _zustand(hass, "button", "Musteranlage Kessel Zündung starten")
        await hass.services.async_call("button", "press", {"entity_id": btn.entity_id}, blocking=True)
        mocks["post_action"].assert_awaited_with("/installations/4711/heater/ignition")
        await hass.services.async_call(DOMAIN, "set_parameter",
            {"baustein": "Heizkreis 1", "parameter": "room_temperature_reduction", "wert": "17,5"}, blocking=True)
        mocks["patch_value"].assert_awaited_with("/installations/4711/hc/1/rtr", 17.5)
        await hass.services.async_call(DOMAIN, "set_parameter",
            {"baustein": "Kessel", "parameter": "program", "wert": "PROGRAM_BOILER"}, blocking=True)
        mocks["patch_value"].assert_awaited_with("/installations/4711/heater/program", "PROGRAM_BOILER")

        # Bisherige IDs bleiben erhalten
        reg = er.async_get(hass)
        assert reg.async_get_entity_id("sensor", DOMAIN, "hargassner_touch_pro_4711_HEATER_HEATER_heater_temp_current")
        assert reg.async_get_entity_id("number", DOMAIN, "hargassner_touch_pro_4711_number_HEATING_CIRCUIT_FLOOR_1_ERDGESCHOSS_steepness")

        # Diagnose
        from custom_components.hargassner_touch_pro.diagnostics import async_get_config_entry_diagnostics
        diag = await async_get_config_entry_diagnostics(hass, entry)
        assert diag["eintrag"]["password"] == "**REDACTED**"
        assert diag["messkanaele"] == 4
        print("Entitäten gesamt:", len(alle))
    finally:
        assert await hass.config_entries.async_unload(entry.entry_id)
        for pt in patches:
            pt.stop()


async def test_nur_lesen(hass: HomeAssistant) -> None:
    mocks, patches = _api_patch()
    for pt in patches:
        pt.start()
    try:
        entry = MockConfigEntry(domain=DOMAIN, options={"writable": False, "metrics": False}, data={
            "email": "a@b.ch", "password": "x", "installation_id": "4711", "installation_name": "Musteranlage"})
        entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        assert not hass.states.async_all("number") and not hass.states.async_all("select")
        assert not any("Restsauerstoff" in s.name for s in hass.states.async_all("sensor"))
        assert await hass.config_entries.async_unload(entry.entry_id)
    finally:
        for pt in patches:
            pt.stop()
