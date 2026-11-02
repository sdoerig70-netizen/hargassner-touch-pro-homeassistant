"""Test mit den (anonymisierten) Daten einer echten Anlage Eco-HK 35.4 mit TouchPro."""
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.hargassner_touch_pro.const import DOMAIN

DATEN = json.loads((Path(__file__).parent / "fixtures" / "eco_hk_35.json").read_text())


async def test_echte_anlage(hass: HomeAssistant) -> None:
    p = "custom_components.hargassner_touch_pro.api.HargassnerApi."
    mocks = {
        "login": AsyncMock(return_value={}),
        "logout": AsyncMock(),
        "ensure_token_valid": AsyncMock(),
        "get_installation": AsyncMock(return_value={"devices": [{"id": 99, "type": "Eco-HK 35.4",
            "software": {"version_code": "V40.0HAR"}}]}),
        "get_widgets": AsyncMock(return_value=(DATEN["widgets"], {"online_state": True})),
        "get_metric_fields": AsyncMock(return_value=[
            {**f, "group": g["text"]} for g in DATEN["metric_fields"] for f in g["fields"]]),
        "get_latest_measurements": AsyncMock(return_value=DATEN["measurements"]),
        "patch_value": AsyncMock(return_value={}),
        "post_action": AsyncMock(return_value={}),
    }
    patches = [patch(p + k, v) for k, v in mocks.items()]
    for pt in patches:
        pt.start()
    try:
        entry = MockConfigEntry(domain=DOMAIN, data={"email": "a", "password": "b",
            "installation_id": "4711", "installation_name": "Musteranlage"})
        entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()

        from homeassistant.helpers import device_registry as dr
        geraete = sorted(d.name for d in dr.async_get(hass).devices.values())
        print("\nGERÄTE:", geraete)
        for s in sorted(hass.states.async_all(), key=lambda s: s.entity_id):
            print(f"{s.entity_id:75} {s.state[:40]:40} {s.attributes.get('unit_of_measurement', '')}")
        st = {s.attributes.get("friendly_name"): s for s in hass.states.async_all()}

        assert "Musteranlage Heizkreis 1 (Altbau)" in geraete
        assert "Musteranlage Heizkreis 2 (Neubau)" in geraete
        assert "Musteranlage Frischwasserstation 1 (Neubau)" in geraete
        assert "Musteranlage Kessel" in geraete
        assert "Musteranlage Wetter (Wetterort)" in geraete
        assert st["Musteranlage Heizkreis 1 (Altbau) A2 Steilheit"].state == "1.3"
        assert st["Musteranlage Heizkreis 2 (Neubau) A12 Steilheit"].state == "1.6"
        assert st["Musteranlage Heizkreis 1 (Altbau) 4 Tages-Raumtemperatur"].state == "20.0"
        assert st["Musteranlage Heizkreis 2 (Neubau) 7 Tages-Raumtemperatur"].state == "22.0"
        assert st["Musteranlage Heizkreis 1 (Altbau) A5b Witterungsführung"].state == "Eco"
        assert "Eco+" in st["Musteranlage Heizkreis 1 (Altbau) A5b Witterungsführung"].attributes["options"]
        assert st["Musteranlage Kessel PR001 Kesselprogramm"].state == "Automatik"
        assert st["Musteranlage Heizkreis 1 (Altbau) 3a Wochenuhr"].state == "Täglich: 00:00 ganzer Tag"
        # Parameter für alle Heizkreise nur einmal
        assert sum(1 for n in st if n and n.endswith("11 Alle Heizkreise aus über Aussentemperatur")) == 1
        assert st["Musteranlage Wetter (Wetterort) Zustand"].state == "Stark bewölkt"
        assert st["Musteranlage Wetter (Wetterort) Luftdruck"].attributes["unit_of_measurement"] == "hPa"
        assert st["Musteranlage Frischwasserstation 1 (Neubau) Auslauf-Solltemperatur"].state == "53"
        klima = st["Musteranlage Heizkreis 1 (Altbau)"]
        assert klima.attributes["current_temperature"] == 20  # aus dem Messkanal
        print("Entitäten:", len(st))
        assert await hass.config_entries.async_unload(entry.entry_id)
    finally:
        for pt in patches:
            pt.stop()


async def test_geraete_haengen_am_hauptgeraet(hass: HomeAssistant) -> None:
    from homeassistant.helpers import device_registry as dr
    p = "custom_components.hargassner_touch_pro.api.HargassnerApi."
    mocks = {"login": AsyncMock(return_value={}), "logout": AsyncMock(), "ensure_token_valid": AsyncMock(),
        "get_installation": AsyncMock(return_value={"devices": [{"id": 99}]}),
        "get_widgets": AsyncMock(return_value=(DATEN["widgets"], {})),
        "get_metric_fields": AsyncMock(return_value=[]), "get_latest_measurements": AsyncMock(return_value={})}
    ps = [patch(p + k, v) for k, v in mocks.items()]
    for x in ps:
        x.start()
    try:
        entry = MockConfigEntry(domain=DOMAIN, data={"email": "a", "password": "b",
            "installation_id": "4711", "installation_name": "Musteranlage"})
        entry.add_to_hass(hass)
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        reg = dr.async_get(hass)
        haupt = reg.async_get_device(identifiers={(DOMAIN, "4711")})
        kinder = [d for d in reg.devices.values() if d.via_device_id == haupt.id]
        assert len(kinder) >= 6
        assert await hass.config_entries.async_unload(entry.entry_id)
    finally:
        for x in ps:
            x.stop()
