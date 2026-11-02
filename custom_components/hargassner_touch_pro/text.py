"""Texte: schreibbare Parameter ohne Zahl oder Optionen (z. B. Datum, Uhrzeit)."""
from __future__ import annotations

from homeassistant.components.text import TextEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_WRITABLE, DEFAULT_WRITABLE, DOMAIN
from .coordinator import HargassnerCoordinator
from .entity_base import HargassnerEntity, parameter_art


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
                if parameter_art(param) != "text":
                    continue
                uid = f"text_{widget_key}_{key}"
                if uid not in bekannt:
                    bekannt.add(uid)
                    neu.append(HargassnerText(coordinator, widget_key, key, uid))
        if neu:
            async_add_entities(neu)

    _neue_entitaeten()
    entry.async_on_unload(coordinator.async_add_listener(_neue_entitaeten))


class HargassnerText(HargassnerEntity, TextEntity):
    _attr_entity_category = EntityCategory.CONFIG
    _attr_native_max = 255

    def __init__(self, coordinator, widget_key, key, unique_suffix) -> None:
        super().__init__(coordinator, widget_key, key, unique_suffix)
        self._attr_name = self._parameter_name()
        param = self._get_parameter() or {}
        if isinstance(param.get("pattern"), str):
            self._attr_pattern = param["pattern"]

    @property
    def native_value(self) -> str | None:
        wert = self._parameter_wert()
        return None if wert is None else str(wert)[:255]

    async def async_set_value(self, value: str) -> None:
        await self._async_schreiben(value)
