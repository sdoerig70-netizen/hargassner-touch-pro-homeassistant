"""Zahlen: alle schreibbaren Zahlen-Parameter (Solltemperaturen, Heizkurve, Grenzen …)."""
from __future__ import annotations

import logging

from homeassistant.components.number import NumberDeviceClass, NumberEntity, NumberMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .beschriftung import als_zahl, einheit_fuer
from .const import CONF_WRITABLE, DEFAULT_WRITABLE, DOMAIN
from .coordinator import HargassnerCoordinator
from .entity_base import HargassnerEntity, parameter_art

_LOGGER = logging.getLogger(__name__)

# Rückfallwerte, falls die API kein min/max/step mitliefert
VORGABEN: dict[str, tuple[float, float, float]] = {
    "room_temperature_heating": (14.0, 26.0, 0.5),
    "room_temperature_reduction": (8.0, 24.0, 0.5),
    "room_temperature_correction": (-5.0, 5.0, 0.5),
    "deactivation_limit_heating": (0.0, 50.0, 1.0),
    "deactivation_limit_reduction_day": (-40.0, 50.0, 1.0),
    "deactivation_limit_reduction_night": (-40.0, 50.0, 1.0),
    "steepness": (0.2, 3.5, 0.05),
    "fuel_stock": (0.0, 32000.0, 1.0),
    "boiler_temperature_target": (20.0, 80.0, 1.0),
    "heater_temperature_target": (40.0, 95.0, 1.0),
}

# Wichtige Einstellungen bleiben in den Steuerelementen, der Rest unter «Konfiguration»
HAUPTEINSTELLUNGEN = {
    "room_temperature_heating",
    "room_temperature_reduction",
    "boiler_temperature_target",
    "fuel_stock",
}


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: HargassnerCoordinator = hass.data[DOMAIN][entry.entry_id]
    if not entry.options.get(CONF_WRITABLE, DEFAULT_WRITABLE):
        return
    bekannt: set[str] = set()

    @callback
    def _neue_entitaeten() -> None:
        neu = []
        for widget_key, widget in coordinator.widgets().items():
            for key, param in widget.get("parameters", {}).items():
                if parameter_art(param) != "number":
                    continue
                uid = f"number_{widget_key}_{key}"
                if uid not in bekannt:
                    bekannt.add(uid)
                    neu.append(HargassnerZahl(coordinator, widget_key, key, uid))
        if neu:
            async_add_entities(neu)

    _neue_entitaeten()
    entry.async_on_unload(coordinator.async_add_listener(_neue_entitaeten))


class HargassnerZahl(HargassnerEntity, NumberEntity):
    _attr_mode = NumberMode.BOX

    def __init__(self, coordinator, widget_key, key, unique_suffix) -> None:
        super().__init__(coordinator, widget_key, key, unique_suffix)
        self._attr_name = self._parameter_name()
        param = self._get_parameter() or {}
        unit = einheit_fuer(key, param.get("unit"))
        self._attr_native_unit_of_measurement = unit
        if unit == "°C":
            self._attr_device_class = NumberDeviceClass.TEMPERATURE
        if key == "steepness":
            self._attr_icon = "mdi:slope-uphill"
        elif key == "fuel_stock":
            self._attr_icon = "mdi:sack"
        if key not in HAUPTEINSTELLUNGEN:
            self._attr_entity_category = EntityCategory.CONFIG

    def _grenze(self, *namen: str) -> float | None:
        param = self._get_parameter() or {}
        for name in namen:
            wert = als_zahl(param.get(name))
            if wert is not None:
                return float(wert)
        return None

    @property
    def native_min_value(self) -> float:
        wert = self._grenze("min", "minimum", "min_value")
        if wert is not None:
            return wert
        return VORGABEN.get(self._param_key, (-1000.0, 100000.0, 1.0))[0]

    @property
    def native_max_value(self) -> float:
        wert = self._grenze("max", "maximum", "max_value")
        if wert is not None:
            return wert
        return VORGABEN.get(self._param_key, (-1000.0, 100000.0, 1.0))[1]

    @property
    def native_step(self) -> float:
        wert = self._grenze("step", "increment", "resolution")
        if wert:
            return wert
        if self._param_key in VORGABEN:
            return VORGABEN[self._param_key][2]
        aktuell = als_zahl(self._parameter_wert())
        return 0.1 if isinstance(aktuell, float) and not float(aktuell).is_integer() else 1.0

    @property
    def native_value(self) -> float | None:
        wert = als_zahl(self._parameter_wert())
        return float(wert) if wert is not None else None

    async def async_set_native_value(self, value: float) -> None:
        # Ganzzahlen auch als Ganzzahl senden, wenn die Schrittweite ganzzahlig ist
        if float(self.native_step).is_integer() and float(value).is_integer():
            value = int(value)
        await self._async_schreiben(value)
