"""Binärsensoren: Ein/Aus-Istwerte (Pumpen, Zwangsladung …) und Cloud-Verbindung."""
from __future__ import annotations

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .beschriftung import schluessel_zu_name
from .const import DOMAIN
from .coordinator import HargassnerCoordinator
from .entity_base import HargassnerEntity, hauptgeraet, parameter_art


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: HargassnerCoordinator = hass.data[DOMAIN][entry.entry_id]
    bekannt: set[str] = set()

    @callback
    def _neue_entitaeten() -> None:
        neu: list[BinarySensorEntity] = []
        for widget_key, widget in coordinator.widgets().items():
            for key, value in widget.get("values", {}).items():
                if not isinstance(value, bool):
                    continue
                uid = f"binary_{widget_key}_{key}"
                if uid not in bekannt:
                    bekannt.add(uid)
                    neu.append(HargassnerBinaerSensor(coordinator, widget_key, key, uid, False))
            for key, param in widget.get("parameters", {}).items():
                if parameter_art(param) != "binary_sensor":
                    continue
                uid = f"binary_param_{widget_key}_{key}"
                if uid not in bekannt:
                    bekannt.add(uid)
                    neu.append(HargassnerBinaerSensor(coordinator, widget_key, key, uid, True))
        if neu:
            async_add_entities(neu)

    async_add_entities([HargassnerOnlineSensor(coordinator)])
    _neue_entitaeten()
    entry.async_on_unload(coordinator.async_add_listener(_neue_entitaeten))


class HargassnerBinaerSensor(HargassnerEntity, BinarySensorEntity):
    def __init__(self, coordinator, widget_key, key, unique_suffix, ist_parameter) -> None:
        super().__init__(coordinator, widget_key, key, unique_suffix)
        self._ist_parameter = ist_parameter
        self._attr_name = self._parameter_name() if ist_parameter else schluessel_zu_name(key)
        if "pump" in key:
            self._attr_device_class = BinarySensorDeviceClass.RUNNING
            self._attr_icon = "mdi:pump"
        elif key in ("active", "heater_exhaust_guard") or key.endswith("_active"):
            self._attr_device_class = BinarySensorDeviceClass.RUNNING
        if ist_parameter:
            self._attr_entity_category = EntityCategory.DIAGNOSTIC

    @property
    def is_on(self) -> bool | None:
        wert = self._parameter_wert() if self._ist_parameter else self._get_value()
        return wert if isinstance(wert, bool) else None


class HargassnerOnlineSensor(CoordinatorEntity[HargassnerCoordinator], BinarySensorEntity):
    """Zeigt, ob der Kessel mit der Hargassner-Cloud verbunden ist."""

    _attr_has_entity_name = True
    _attr_name = "Cloud-Verbindung"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: HargassnerCoordinator) -> None:
        super().__init__(coordinator)
        self._attr_unique_id = f"{DOMAIN}_{coordinator.installation_id}_online_state"
        self._attr_device_info = hauptgeraet(coordinator)

    @property
    def is_on(self) -> bool | None:
        if self.coordinator.data is None:
            return None
        return bool(self.coordinator.data.get("_online", True))
