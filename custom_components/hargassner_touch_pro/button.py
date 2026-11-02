"""Tasten: alle Aktionen der Bausteine (z. B. Zündung starten)."""
from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .beschriftung import schluessel_zu_name
from .const import CONF_WRITABLE, DEFAULT_WRITABLE, DOMAIN
from .coordinator import HargassnerCoordinator
from .entity_base import HargassnerEntity

ICONS = {"start_ignition": "mdi:fire", "stop_firing": "mdi:fire-off"}


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: HargassnerCoordinator = hass.data[DOMAIN][entry.entry_id]
    rechner = hass.data[DOMAIN].get(f"_verbrauch_{entry.entry_id}")
    if rechner:
        from . import verbrauch

        async_add_entities(verbrauch.knoepfe(rechner))
    if not entry.options.get(CONF_WRITABLE, DEFAULT_WRITABLE):
        return
    bekannt: set[str] = set()

    @callback
    def _neue_entitaeten() -> None:
        neu = []
        for widget_key, widget in coordinator.widgets().items():
            for key, action in widget.get("actions", {}).items():
                if not action.get("resource"):
                    continue
                uid = f"button_{widget_key}_{key}"
                if uid not in bekannt:
                    bekannt.add(uid)
                    neu.append(HargassnerTaste(coordinator, widget_key, key, uid))
        if neu:
            async_add_entities(neu)

    _neue_entitaeten()
    entry.async_on_unload(coordinator.async_add_listener(_neue_entitaeten))


class HargassnerTaste(HargassnerEntity, ButtonEntity):
    def __init__(self, coordinator, widget_key, key, unique_suffix) -> None:
        super().__init__(coordinator, widget_key, key, unique_suffix)
        self._attr_name = schluessel_zu_name(key)
        self._attr_icon = ICONS.get(key, "mdi:gesture-tap-button")

    def _resource(self) -> str | None:
        widget = self._get_widget() or {}
        action = widget.get("actions", {}).get(self._param_key)
        return action.get("resource") if isinstance(action, dict) else None

    @property
    def available(self) -> bool:
        return super().available and bool(self._resource())

    async def async_press(self) -> None:
        resource = self._resource()
        if not resource or not await self.coordinator.async_post_action(resource):
            raise HomeAssistantError(f"{self.name}: Aktion fehlgeschlagen (siehe Protokoll)")
