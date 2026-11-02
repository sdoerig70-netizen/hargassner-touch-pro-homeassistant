"""Gemeinsame Basis aller Hargassner-Entitäten."""
from __future__ import annotations

from typing import Any

from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .beschriftung import als_zahl, ist_zahl, parameter_name, zustand_zu_text
from .const import DOMAIN
from .coordinator import HargassnerCoordinator

# Bisherige Schlüssel der Sensoren, damit vorhandene Entitäts-IDs erhalten bleiben
ALTE_SENSOR_SCHLUESSEL: dict[tuple[str, str], str] = {
    ("HEATER", "heater_temperature_current"): "heater_temp_current",
    ("HEATER", "heater_temperature_target"): "heater_temp_target",
    ("HEATER", "state"): "heater_state",
    ("HEATER", "program"): "heater_program",
    ("HEATING_CIRCUIT", "flow_temperature_current"): "flow_temp_current",
    ("HEATING_CIRCUIT", "flow_temperature_target"): "flow_temp_target",
    ("HEATING_CIRCUIT", "room_temperature_current"): "room_temp_current",
    ("HEATING_CIRCUIT", "room_temperature_target"): "room_temp_target",
    ("HEATING_CIRCUIT", "state"): "circuit_state",
}


def alter_sensor_schluessel(widget_type: str, key: str) -> str:
    for (prefix, value_key), alt in ALTE_SENSOR_SCHLUESSEL.items():
        if value_key == key and widget_type.startswith(prefix):
            return alt
    return key


def hauptgeraet(coordinator: HargassnerCoordinator) -> DeviceInfo:
    return DeviceInfo(
        identifiers={(DOMAIN, coordinator.installation_id)},
        name=coordinator.installation_name,
        manufacturer="Hargassner",
        model=coordinator.model,
        sw_version=coordinator.sw_version,
    )


def messkanalgeraet(coordinator: HargassnerCoordinator) -> DeviceInfo:
    return DeviceInfo(
        identifiers={(DOMAIN, f"{coordinator.installation_id}_messkanaele")},
        name=f"{coordinator.installation_name} Messkanäle",
        manufacturer="Hargassner",
        model="Verlaufsaufzeichnung",
    )


def bausteingeraet(coordinator: HargassnerCoordinator, widget_key: str, display_name: str) -> DeviceInfo:
    return DeviceInfo(
        identifiers={(DOMAIN, f"{coordinator.installation_id}_{widget_key}")},
        name=f"{coordinator.installation_name} {display_name}",
        manufacturer="Hargassner",
        model=display_name,
    )


# ---------------------------------------------------------------- Parameter

def optionen(param: dict) -> list[tuple[Any, str]]:
    """Optionen eines Parameters als Liste (API-Wert, deutscher Text)."""
    raw = param.get("options")
    result: list[tuple[Any, str]] = []
    if isinstance(raw, dict):
        raw = [{"value": k, "text": v} for k, v in raw.items()]
    if not isinstance(raw, list):
        return result
    for opt in raw:
        if isinstance(opt, dict):
            wert = opt.get("value", opt.get("key", opt.get("id")))
            text = opt.get("text") or opt.get("label") or opt.get("name")
            if wert is None:
                continue
            anzeige = str(zustand_zu_text(wert)) if not text or text == wert else str(text)
        else:
            wert = opt
            anzeige = str(zustand_zu_text(opt))
        result.append((wert, anzeige))
    # doppelte Anzeigetexte eindeutig machen
    gesehen: dict[str, int] = {}
    eindeutig = []
    for wert, anzeige in result:
        if anzeige in gesehen:
            anzeige = f"{anzeige} ({wert})"
        gesehen[anzeige] = 1
        eindeutig.append((wert, anzeige))
    return eindeutig


def parameter_art(param: dict) -> str | None:
    """Plattform für einen Parameter bestimmen.

    Schreibbar (mit ``resource``): select, switch, number oder text.
    Nur lesbar: sensor oder binary_sensor.
    """
    if not isinstance(param, dict) or param.get("_doppelt"):
        return None
    if "items" in param and "value" not in param:
        return "zeitplan"  # Wochenuhr, Urlaubsprogramm: nur anzeigen
    schreibbar = bool(param.get("resource"))
    wert = param.get("value")
    if optionen(param):
        return "select" if schreibbar else "sensor"
    if isinstance(wert, bool):
        return "switch" if schreibbar else "binary_sensor"
    if ist_zahl(wert) or (wert is None and ("min" in param or "max" in param)):
        return "number" if schreibbar else "sensor"
    if isinstance(wert, str) or wert is None:
        return "text" if schreibbar else "sensor"
    return None


class HargassnerEntity(CoordinatorEntity[HargassnerCoordinator]):
    """Basisklasse für Werte, Parameter und Aktionen eines Bausteins."""

    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator: HargassnerCoordinator,
        widget_key: str,
        param_key: str,
        unique_suffix: str,
    ) -> None:
        super().__init__(coordinator)
        self._widget_key = widget_key
        self._param_key = param_key
        self._attr_unique_id = f"{DOMAIN}_{coordinator.installation_id}_{unique_suffix}"
        widget = (coordinator.data or {}).get(widget_key)
        if isinstance(widget, dict) and "display_name" in widget:
            self._attr_device_info = bausteingeraet(coordinator, widget_key, widget["display_name"])
        else:
            self._attr_device_info = hauptgeraet(coordinator)

    def _get_widget(self) -> dict | None:
        if self.coordinator.data:
            widget = self.coordinator.data.get(self._widget_key)
            return widget if isinstance(widget, dict) else None
        return None

    def _get_value(self) -> Any:
        widget = self._get_widget()
        return widget.get("values", {}).get(self._param_key) if widget else None

    def _get_parameter(self) -> dict | None:
        widget = self._get_widget()
        if widget:
            param = widget.get("parameters", {}).get(self._param_key)
            return param if isinstance(param, dict) else None
        return None

    def _get_resource(self) -> str | None:
        param = self._get_parameter()
        return param.get("resource") if param else None

    def _parameter_wert(self) -> Any:
        param = self._get_parameter()
        return param.get("value") if param else None

    @property
    def available(self) -> bool:
        return super().available and self._get_widget() is not None

    async def _async_schreiben(self, value: Any) -> None:
        resource = self._get_resource()
        if not resource:
            raise HomeAssistantError(f"{self.name}: Parameter ist nicht schreibbar")
        if not await self.coordinator.async_patch_value(resource, value):
            raise HomeAssistantError(
                f"{self.name}: Wert {value} konnte nicht gesetzt werden (siehe Protokoll)"
            )

    def _parameter_name(self) -> str:
        return parameter_name(self._param_key, self._get_parameter())

    def _zahl(self, value: Any) -> float | int | None:
        return als_zahl(value)
