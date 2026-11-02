"""Auswahlen: alle schreibbaren Parameter mit festen Optionen (Betriebsart, Programm …)."""
from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .beschriftung import zustand_zu_text
from .const import CONF_WRITABLE, DEFAULT_WRITABLE, DOMAIN
from .coordinator import HargassnerCoordinator
from .entity_base import HargassnerEntity, optionen, parameter_art

HAUPTAUSWAHL = {"mode", "program", "pool_heating"}


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
                if parameter_art(param) != "select":
                    continue
                uid = f"select_{widget_key}_{key}"
                if uid not in bekannt:
                    bekannt.add(uid)
                    neu.append(HargassnerAuswahl(coordinator, widget_key, key, uid))
        if neu:
            async_add_entities(neu)

    _neue_entitaeten()
    entry.async_on_unload(coordinator.async_add_listener(_neue_entitaeten))


class HargassnerAuswahl(HargassnerEntity, SelectEntity):
    def __init__(self, coordinator, widget_key, key, unique_suffix) -> None:
        super().__init__(coordinator, widget_key, key, unique_suffix)
        self._attr_name = self._parameter_name()
        self._attr_icon = "mdi:tune-variant" if key == "mode" else "mdi:format-list-bulleted"
        if key not in HAUPTAUSWAHL:
            self._attr_entity_category = EntityCategory.CONFIG

    def _optionen(self) -> list[tuple]:
        return optionen(self._get_parameter() or {})

    @property
    def options(self) -> list[str]:
        opts = [text for _, text in self._optionen()]
        aktuell = self.current_option
        if aktuell is not None and aktuell not in opts:
            opts.append(aktuell)
        return opts

    @property
    def current_option(self) -> str | None:
        wert = self._parameter_wert()
        if wert is None:
            return None
        for api_wert, text in self._optionen():
            if api_wert == wert:
                return text
        return str(zustand_zu_text(wert))

    async def async_select_option(self, option: str) -> None:
        for api_wert, text in self._optionen():
            if text == option:
                await self._async_schreiben(api_wert)
                return
        raise HomeAssistantError(f"{self.name}: unbekannte Option «{option}»")
