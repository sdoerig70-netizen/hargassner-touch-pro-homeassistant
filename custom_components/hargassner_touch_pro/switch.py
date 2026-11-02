"""Schalter: alle schreibbaren Ein/Aus-Parameter (witterungsgeführt, Zirkulation …)."""
from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_WRITABLE, DEFAULT_WRITABLE, DOMAIN
from .coordinator import HargassnerCoordinator
from .entity_base import HargassnerEntity, parameter_art

ICONS = {
    "weather_mode": "mdi:weather-partly-cloudy",
    "pool_heating": "mdi:pool",
    "one_time_circulation": "mdi:water-sync",
}
HAUPTSCHALTER = {"pool_heating", "one_time_circulation", "one_time_charging"}


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
                if parameter_art(param) != "switch":
                    continue
                uid = f"switch_{widget_key}_{key}"
                if uid not in bekannt:
                    bekannt.add(uid)
                    neu.append(HargassnerSchalter(coordinator, widget_key, key, uid))
        if neu:
            async_add_entities(neu)

    _neue_entitaeten()
    entry.async_on_unload(coordinator.async_add_listener(_neue_entitaeten))


class HargassnerSchalter(HargassnerEntity, SwitchEntity):
    def __init__(self, coordinator, widget_key, key, unique_suffix) -> None:
        super().__init__(coordinator, widget_key, key, unique_suffix)
        self._attr_name = self._parameter_name()
        self._attr_icon = ICONS.get(key)
        if key not in HAUPTSCHALTER:
            self._attr_entity_category = EntityCategory.CONFIG

    @property
    def is_on(self) -> bool | None:
        wert = self._parameter_wert()
        return wert if isinstance(wert, bool) else None

    async def async_turn_on(self, **kwargs) -> None:
        await self._async_schreiben(True)

    async def async_turn_off(self, **kwargs) -> None:
        await self._async_schreiben(False)
