"""Thermostate: ein Thermostat pro Heizkreis."""
from __future__ import annotations

from typing import Any

from homeassistant.components.climate import ClimateEntity, ClimateEntityFeature, HVACMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import ATTR_TEMPERATURE, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .beschriftung import als_zahl
from .const import CONF_WRITABLE, DEFAULT_WRITABLE, DOMAIN
from .coordinator import HargassnerCoordinator
from .entity_base import HargassnerEntity, optionen

# Betriebsart der App ↔ Modus in Home Assistant
HVAC_ZU_MODUS = {
    HVACMode.AUTO: "MODE_AUTOMATIC",
    HVACMode.HEAT: "MODE_HEATING",
    HVACMode.OFF: "MODE_OFF",
}
MODUS_ZU_HVAC = {v: k for k, v in HVAC_ZU_MODUS.items()}


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: HargassnerCoordinator = hass.data[DOMAIN][entry.entry_id]
    if not entry.options.get(CONF_WRITABLE, DEFAULT_WRITABLE):
        return
    entities = [
        HargassnerThermostat(coordinator, widget_key)
        for widget_key, widget in coordinator.widgets().items()
        if widget["widget_type"].startswith("HEATING_CIRCUIT")
        and isinstance(widget.get("parameters", {}).get("room_temperature_heating"), dict)
    ]
    async_add_entities(entities)


class HargassnerThermostat(HargassnerEntity, ClimateEntity):
    _attr_name = None  # Name des Heizkreis-Geräts
    _attr_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_supported_features = (
        ClimateEntityFeature.TARGET_TEMPERATURE
        | ClimateEntityFeature.TURN_ON
        | ClimateEntityFeature.TURN_OFF
    )

    def __init__(self, coordinator: HargassnerCoordinator, widget_key: str) -> None:
        super().__init__(coordinator, widget_key, "room_temperature_heating", f"climate_{widget_key}")

    def _param(self, key: str) -> dict | None:
        widget = self._get_widget()
        param = widget.get("parameters", {}).get(key) if widget else None
        return param if isinstance(param, dict) else None

    @property
    def hvac_modes(self) -> list[HVACMode]:
        mode = self._param("mode")
        moegliche = {wert for wert, _ in optionen(mode)} if mode else set()
        modes = [hvac for hvac, wert in HVAC_ZU_MODUS.items() if not moegliche or wert in moegliche]
        return modes or [HVACMode.AUTO, HVACMode.OFF]

    @property
    def hvac_mode(self) -> HVACMode:
        mode = self._param("mode")
        wert = mode.get("value") if mode else None
        if wert in MODUS_ZU_HVAC:
            return MODUS_ZU_HVAC[wert]
        return HVACMode.AUTO  # Absenken, Brücken usw. laufen im Automatikbereich

    @property
    def target_temperature_step(self) -> float:
        p = self._param("room_temperature_heating") or {}
        return float(als_zahl(p.get("step")) or 0.5)

    @property
    def min_temp(self) -> float:
        p = self._param("room_temperature_heating") or {}
        return float(als_zahl(p.get("min")) or 14.0)

    @property
    def max_temp(self) -> float:
        p = self._param("room_temperature_heating") or {}
        return float(als_zahl(p.get("max")) or 26.0)

    @property
    def current_temperature(self) -> float | None:
        widget = self._get_widget() or {}
        wert = als_zahl(widget.get("values", {}).get("room_temperature_current"))
        if wert is None and widget.get("widget_number"):
            # Ohne Raumfühler im Baustein: Wert aus dem Messkanal des Heizkreises
            wert = als_zahl(
                self.coordinator.messwert(
                    f"heating_circuit.room_temperature_current.{widget['widget_number']}"
                )
            )
        return float(wert) if wert is not None else None

    @property
    def target_temperature(self) -> float | None:
        p = self._param("room_temperature_heating") or {}
        wert = als_zahl(p.get("value"))
        return float(wert) if wert is not None else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        widget = self._get_widget() or {}
        values = widget.get("values", {})
        reduktion = self._param("room_temperature_reduction") or {}
        return {
            "vorlauftemperatur": values.get("flow_temperature_current"),
            "vorlauf_solltemperatur": values.get("flow_temperature_target"),
            "absenk_raumtemperatur": reduktion.get("value"),
        }

    async def async_set_temperature(self, **kwargs: Any) -> None:
        temp = kwargs.get(ATTR_TEMPERATURE)
        if temp is not None:
            await self._async_schreiben_param("room_temperature_heating", temp)

    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        await self._async_schreiben_param("mode", HVAC_ZU_MODUS[hvac_mode])

    async def async_turn_on(self) -> None:
        await self.async_set_hvac_mode(HVACMode.AUTO)

    async def async_turn_off(self) -> None:
        await self.async_set_hvac_mode(HVACMode.OFF)

    async def _async_schreiben_param(self, key: str, value: Any) -> None:
        alt = self._param_key
        self._param_key = key
        try:
            await self._async_schreiben(value)
        finally:
            self._param_key = alt
