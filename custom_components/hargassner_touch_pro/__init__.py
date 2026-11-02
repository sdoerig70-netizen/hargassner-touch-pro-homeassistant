"""Hargassner-Integration für Home Assistant (Cloud-API)."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_EMAIL, CONF_PASSWORD, Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady, HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import HargassnerApi, HargassnerApiError, HargassnerAuthError
from .const import (
    CONF_INSTALLATION_ID,
    CONF_INSTALLATION_NAME,
    CONF_METRICS,
    CONF_SCAN_INTERVAL,
    DEFAULT_METRICS,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    SERVICE_SET_PARAMETER,
    SERVICE_START_IGNITION,
)
from .coordinator import HargassnerCoordinator
from .verbrauch import Verbrauchsrechner
from .entity_base import bausteingeraet, hauptgeraet, messkanalgeraet
from .beschriftung import widget_name as deutscher_widget_name

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [
    Platform.SENSOR,
    Platform.BINARY_SENSOR,
    Platform.CLIMATE,
    Platform.NUMBER,
    Platform.SWITCH,
    Platform.SELECT,
    Platform.TEXT,
    Platform.BUTTON,
]

def _wert(value: Any) -> Any:
    """Wert aus dem Dienstaufruf: Wahrheitswert, Zahl oder Text."""
    if isinstance(value, (bool, int, float)):
        return value
    text = str(value).strip()
    if text.lower() in ("true", "ein", "on", "ja"):
        return True
    if text.lower() in ("false", "aus", "off", "nein"):
        return False
    try:
        return float(text.replace(",", "."))
    except ValueError:
        return text


SET_PARAMETER_SCHEMA = vol.Schema(
    {
        vol.Required("baustein"): cv.string,
        vol.Required("parameter"): cv.string,
        vol.Required("wert"): _wert,
        vol.Optional("anlage"): cv.string,
    }
)
START_IGNITION_SCHEMA = vol.Schema({vol.Optional("anlage"): cv.string})
LAGER_SCHEMA = vol.Schema(
    {
        vol.Required("menge"): vol.Coerce(float),
        vol.Optional("datum"): cv.datetime,
        vol.Optional("bereits_verbraucht"): vol.Coerce(float),
        vol.Optional("anlage"): cv.string,
    }
)
ASCHE_SCHEMA = vol.Schema({vol.Optional("fuellstand"): vol.Coerce(float), vol.Optional("anlage"): cv.string})


def _rechner(hass: HomeAssistant, anlage: str | None) -> list:
    return [
        hass.data[DOMAIN].get(f"_verbrauch_{eid}")
        for eid, c in hass.data.get(DOMAIN, {}).items()
        if isinstance(c, HargassnerCoordinator) and (not anlage or anlage in (c.installation_id, c.installation_name))
    ]


def _koordinatoren(hass: HomeAssistant, anlage: str | None) -> list[HargassnerCoordinator]:
    alle = [c for c in hass.data.get(DOMAIN, {}).values() if isinstance(c, HargassnerCoordinator)]
    if anlage:
        alle = [c for c in alle if anlage in (c.installation_id, c.installation_name)]
    return alle


def _baustein_finden(coord: HargassnerCoordinator, baustein: str) -> dict | None:
    """Baustein über Schlüssel, deutschen Namen, App-Namen oder Typ finden."""
    suche = baustein.strip().lower()
    for key, widget in coord.widgets().items():
        kandidaten = {
            key.lower(),
            str(widget.get("display_name", "")).lower(),
            str(widget.get("widget_name", "")).lower(),
            f"{widget['widget_type']}_{widget.get('widget_number', '')}".strip("_").lower(),
            str(widget["widget_type"]).lower(),
            deutscher_widget_name(widget["widget_type"], widget.get("widget_number", ""), None).lower(),
        }
        if widget["widget_type"].startswith("HEATING_CIRCUIT") and widget.get("widget_number"):
            kandidaten.add(f"heizkreis {widget['widget_number']}")
        if suche in kandidaten:
            return widget
    return None


KARTEN_BASIS = "/hargassner_touch_pro"
KARTEN = ("heizkurve-card.js", "anlage-card.js", "anlage-3d-card.js", "schema-card.js")


async def _karte_registrieren(hass: HomeAssistant) -> None:
    """Heizkurven-Karte bereitstellen und im Frontend laden (einmal pro Start)."""
    if hass.data.setdefault(DOMAIN, {}).get("_karte"):
        return
    from pathlib import Path

    from homeassistant.components.frontend import add_extra_js_url
    from homeassistant.components.http import StaticPathConfig

    ordner = Path(__file__).parent / "frontend"
    pfade = []
    for name in KARTEN:
        datei = ordner / name
        url = f"{KARTEN_BASIS}/{name}"
        pfade.append(StaticPathConfig(url, str(datei), False))
        version = await hass.async_add_executor_job(lambda d=datei: int(d.stat().st_mtime))
        add_extra_js_url(hass, f"{url}?v={version}")
    # Bibliotheken und Gebäudemodell der 3D-Ansicht (three.js, gebaeude.json)
    pfade.append(StaticPathConfig(f"{KARTEN_BASIS}/lib", str(ordner / "lib"), False))
    await hass.http.async_register_static_paths(pfade)
    hass.data[DOMAIN]["_karte"] = True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    try:
        await _karte_registrieren(hass)
    except Exception as err:  # noqa: BLE001 – die Karte ist optional
        _LOGGER.warning("Heizkurven-Karte konnte nicht registriert werden: %s", err)

    session = async_get_clientsession(hass)
    api = HargassnerApi(session)

    try:
        await api.login(entry.data[CONF_EMAIL], entry.data[CONF_PASSWORD])
    except HargassnerAuthError as err:
        raise ConfigEntryAuthFailed(f"Anmeldung fehlgeschlagen: {err}") from err
    except HargassnerApiError as err:
        raise ConfigEntryNotReady(f"Hargassner-Cloud nicht erreichbar: {err}") from err

    coordinator = HargassnerCoordinator(
        hass,
        api,
        installation_id=entry.data[CONF_INSTALLATION_ID],
        installation_name=entry.data.get(CONF_INSTALLATION_NAME, "Hargassner"),
        scan_interval=entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
        metrics_enabled=entry.options.get(CONF_METRICS, DEFAULT_METRICS),
    )
    await coordinator.async_load_installation()
    await coordinator.async_config_entry_first_refresh()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    # Brennstoff- und Wartungsrechner (Hackgut im Lager, Aschebox)
    rechner = Verbrauchsrechner(hass, coordinator, entry.entry_id)
    await rechner.async_laden()
    hass.data[DOMAIN][f"_verbrauch_{entry.entry_id}"] = rechner
    entry.async_on_unload(coordinator.async_add_listener(rechner.aktualisieren))

    # Hauptgerät anlegen und die Bausteine darunter hängen (per via_device_id; das
    # veraltete via_device in DeviceInfo lehnen neuere Home-Assistant-Versionen ab)
    geraete = dr.async_get(hass)
    haupt = geraete.async_get_or_create(config_entry_id=entry.entry_id, **hauptgeraet(coordinator))
    unter = [messkanalgeraet(coordinator)] + [
        bausteingeraet(coordinator, key, widget["display_name"])
        for key, widget in coordinator.widgets().items()
    ]
    for info in unter:
        geraet = geraete.async_get_or_create(config_entry_id=entry.entry_id, **info)
        if geraet.via_device_id != haupt.id:
            geraete.async_update_device(geraet.id, via_device_id=haupt.id)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _dienste_registrieren(hass)
    entry.async_on_unload(entry.add_update_listener(_async_update_options))
    return True


def _dienste_registrieren(hass: HomeAssistant) -> None:
    async def zuendung_starten(call: ServiceCall) -> None:
        for coord in _koordinatoren(hass, call.data.get("anlage")):
            for widget in coord.widgets().values():
                action = widget.get("actions", {}).get("start_ignition")
                if isinstance(action, dict) and action.get("resource"):
                    if not await coord.async_post_action(action["resource"]):
                        raise HomeAssistantError("Zündung konnte nicht gestartet werden")
                    _LOGGER.info("Zündung gestartet: %s", coord.installation_name)
                    return
        raise HomeAssistantError("Keine Anlage mit der Aktion «Zündung starten» gefunden")

    async def parameter_setzen(call: ServiceCall) -> None:
        baustein = call.data["baustein"]
        parameter = call.data["parameter"]
        wert: Any = call.data["wert"]
        for coord in _koordinatoren(hass, call.data.get("anlage")):
            widget = _baustein_finden(coord, baustein)
            if widget is None:
                continue
            param = widget.get("parameters", {}).get(parameter)
            if not isinstance(param, dict) or not param.get("resource"):
                raise HomeAssistantError(
                    f"Parameter «{parameter}» im Baustein «{baustein}» ist nicht schreibbar. "
                    f"Vorhanden: {', '.join(sorted(widget.get('parameters', {})))}"
                )
            if isinstance(wert, float) and wert.is_integer() and isinstance(param.get("value"), int):
                wert = int(wert)
            if not await coord.async_patch_value(param["resource"], wert):
                raise HomeAssistantError(f"«{parameter}» konnte nicht auf {wert} gesetzt werden")
            return
        raise HomeAssistantError(f"Baustein «{baustein}» nicht gefunden")

    async def lager_gefuellt(call: ServiceCall) -> None:
        from homeassistant.util import dt as dt_util

        datum = call.data.get("datum")
        if datum is not None and datum.tzinfo is None:
            datum = datum.replace(tzinfo=dt_util.get_default_time_zone())
        for r in _rechner(hass, call.data.get("anlage")):
            if r:
                r.lager_gefuellt(call.data["menge"], datum, call.data.get("bereits_verbraucht"))

    async def asche_geleert(call: ServiceCall) -> None:
        for r in _rechner(hass, call.data.get("anlage")):
            if r:
                r.asche_geleert(call.data.get("fuellstand"))

    for name, funktion, schema in (("lager_gefuellt", lager_gefuellt, LAGER_SCHEMA), ("asche_geleert", asche_geleert, ASCHE_SCHEMA)):
        if not hass.services.has_service(DOMAIN, name):
            hass.services.async_register(DOMAIN, name, funktion, schema=schema)

    if not hass.services.has_service(DOMAIN, SERVICE_START_IGNITION):
        hass.services.async_register(
            DOMAIN, SERVICE_START_IGNITION, zuendung_starten, schema=START_IGNITION_SCHEMA
        )
    if not hass.services.has_service(DOMAIN, SERVICE_SET_PARAMETER):
        hass.services.async_register(
            DOMAIN, SERVICE_SET_PARAMETER, parameter_setzen, schema=SET_PARAMETER_SCHEMA
        )


async def _async_update_options(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        coordinator: HargassnerCoordinator = hass.data[DOMAIN].pop(entry.entry_id)
        hass.data[DOMAIN].pop(f"_verbrauch_{entry.entry_id}", None)
        await coordinator.api.logout()
        if not [k for k in hass.data[DOMAIN] if not str(k).startswith("_")]:
            hass.services.async_remove(DOMAIN, SERVICE_START_IGNITION)
            hass.services.async_remove(DOMAIN, SERVICE_SET_PARAMETER)
            hass.services.async_remove(DOMAIN, "lager_gefuellt")
            hass.services.async_remove(DOMAIN, "asche_geleert")
    return unload_ok
