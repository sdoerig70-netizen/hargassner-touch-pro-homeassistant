"""Diagnose: Rohdaten der Anlage zum Herunterladen (ohne Zugangsdaten)."""
from __future__ import annotations

from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_EMAIL, CONF_PASSWORD
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .coordinator import HargassnerCoordinator
from .entity_base import parameter_art

SCHWAERZEN = {
    CONF_EMAIL, CONF_PASSWORD, "access_token", "refresh_token", "serial", "serial_number",
    "mac", "ip", "gateway_id", "customer_id", "email", "phone", "address", "latitude", "longitude",
}


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ConfigEntry) -> dict[str, Any]:
    coordinator: HargassnerCoordinator = hass.data[DOMAIN][entry.entry_id]
    uebersicht = {}
    for key, widget in coordinator.widgets().items():
        uebersicht[widget.get("display_name", key)] = {
            "typ": widget["widget_type"],
            "istwerte": sorted(widget.get("values", {})),
            "parameter": {k: parameter_art(p) for k, p in widget.get("parameters", {}).items()},
            "aktionen": sorted(widget.get("actions", {})),
        }
    return {
        "eintrag": async_redact_data(dict(entry.data), SCHWAERZEN),
        "optionen": dict(entry.options),
        "modell": coordinator.model,
        "software": coordinator.sw_version,
        "geraete": async_redact_data(coordinator.devices, SCHWAERZEN),
        "uebersicht": uebersicht,
        "messkanaele": len(coordinator.metrics()),
        "rohdaten": async_redact_data(coordinator.data or {}, SCHWAERZEN),
    }
