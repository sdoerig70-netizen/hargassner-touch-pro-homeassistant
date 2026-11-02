"""Sensoren: alle Istwerte, nur lesbare Parameter und Messkanäle."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
import voluptuous as vol

from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_platform
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from .beschriftung import (
    als_zahl,
    einheit_fuer,
    ist_zahl,
    ist_zustand,
    schluessel_zu_name,
    zustand_zu_text,
)
from .const import DOMAIN
from .zeitprogramm import eintraege_pruefen, geraet_pfad
from .coordinator import HargassnerCoordinator
from .entity_base import (
    HargassnerEntity,
    alter_sensor_schluessel,
    messkanalgeraet,
    parameter_art,
)

_LOGGER = logging.getLogger(__name__)

# Werte, die keinen eigenen Sensor bekommen
UEBERSPRINGEN = {"name"}

ICONS = {
    "state": "mdi:state-machine",
    "program": "mdi:calendar-clock",
    "mode": "mdi:tune-variant",
    "fuel_stock": "mdi:sack",
    "efficiency": "mdi:gauge",
}


def _einordnen(unit: str | None) -> tuple[SensorDeviceClass | None, SensorStateClass | None]:
    if unit == "°C":
        return SensorDeviceClass.TEMPERATURE, SensorStateClass.MEASUREMENT
    if unit in ("bar", "hPa"):
        return SensorDeviceClass.PRESSURE, SensorStateClass.MEASUREMENT
    if unit == "m/s":
        return SensorDeviceClass.WIND_SPEED, SensorStateClass.MEASUREMENT
    if unit == "mm":
        return SensorDeviceClass.PRECIPITATION, SensorStateClass.MEASUREMENT
    if unit in ("kW", "W"):
        return SensorDeviceClass.POWER, SensorStateClass.MEASUREMENT
    if unit in ("kWh", "MWh", "Wh"):
        return SensorDeviceClass.ENERGY, SensorStateClass.TOTAL_INCREASING
    if unit == "kg":
        return SensorDeviceClass.WEIGHT, SensorStateClass.MEASUREMENT
    if unit == "h":
        return SensorDeviceClass.DURATION, SensorStateClass.TOTAL_INCREASING
    return None, SensorStateClass.MEASUREMENT


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: HargassnerCoordinator = hass.data[DOMAIN][entry.entry_id]
    bekannt: set[str] = set()

    plattform = entity_platform.async_get_current_platform()
    plattform.async_register_entity_service(
        "set_time_program",
        {vol.Required("eintraege"): list},
        "async_zeitprogramm_setzen",
    )

    @callback
    def _neue_entitaeten() -> None:
        neu: list[SensorEntity] = []
        for widget_key, widget in coordinator.widgets().items():
            wtype = widget["widget_type"]
            # Istwerte
            for key, value in widget.get("values", {}).items():
                if key == "forecast" and isinstance(value, dict):
                    uid = f"{widget_key}_prognose"
                    if uid not in bekannt:
                        bekannt.add(uid)
                        neu.append(HargassnerPrognoseSensor(coordinator, widget_key, key, uid))
                    continue
                if key in UEBERSPRINGEN or isinstance(value, (bool, dict, list)):
                    continue
                uid = f"{widget_key}_{alter_sensor_schluessel(wtype, key)}"
                if uid in bekannt:
                    continue
                bekannt.add(uid)
                neu.append(HargassnerWertSensor(coordinator, widget_key, key, uid, ist_parameter=False))
            # Nur lesbare Parameter
            for key, param in widget.get("parameters", {}).items():
                art = parameter_art(param)
                if art not in ("sensor", "zeitplan"):
                    continue
                uid = f"param_{widget_key}_{key}"
                if uid in bekannt:
                    continue
                bekannt.add(uid)
                if art == "zeitplan":
                    neu.append(HargassnerZeitplanSensor(coordinator, widget_key, key, uid))
                else:
                    neu.append(HargassnerWertSensor(coordinator, widget_key, key, uid, ist_parameter=True))
        # Messkanäle
        for metric_key, metric in coordinator.metrics().items():
            uid = f"metric_{metric_key}"
            if uid in bekannt:
                continue
            bekannt.add(uid)
            neu.append(HargassnerMesskanalSensor(coordinator, metric_key, metric))
        if neu:
            async_add_entities(neu)

    _neue_entitaeten()
    # Neue Werte (z. B. nach Firmware-Update) automatisch ergänzen
    entry.async_on_unload(coordinator.async_add_listener(_neue_entitaeten))


class HargassnerWertSensor(HargassnerEntity, SensorEntity):
    """Ein Istwert oder ein nur lesbarer Parameter eines Bausteins."""

    def __init__(
        self,
        coordinator: HargassnerCoordinator,
        widget_key: str,
        key: str,
        unique_suffix: str,
        ist_parameter: bool,
    ) -> None:
        super().__init__(coordinator, widget_key, key, unique_suffix)
        self._ist_parameter = ist_parameter
        self._attr_name = self._parameter_name() if ist_parameter else schluessel_zu_name(key)
        self._zeitstempel = key.startswith("timestamp")
        roh = self._roh()
        param = self._get_parameter() if ist_parameter else None
        unit = einheit_fuer(key, (param or {}).get("unit"))
        self._textwert = not ist_zahl(roh) and roh is not None
        if key == "air_humidity":
            unit = "%"
        if self._zeitstempel:
            self._textwert = False
            self._attr_device_class = SensorDeviceClass.TIMESTAMP
            self._attr_icon = "mdi:weather-sunset-up" if "sunrise" in key else "mdi:weather-sunset-down"
        elif self._textwert or ist_zustand(roh):
            self._textwert = True
            self._attr_icon = ICONS.get(key, "mdi:information-outline")
        else:
            device_class, state_class = _einordnen(unit)
            self._attr_native_unit_of_measurement = unit
            self._attr_device_class = device_class
            self._attr_state_class = state_class
            if key == "air_humidity":
                self._attr_device_class = SensorDeviceClass.HUMIDITY
            if key in ICONS:
                self._attr_icon = ICONS[key]
        if ist_parameter:
            self._attr_entity_category = EntityCategory.DIAGNOSTIC

    def _roh(self) -> Any:
        return self._parameter_wert() if self._ist_parameter else self._get_value()

    @property
    def native_value(self) -> Any:
        roh = self._roh()
        if roh is None:
            return None
        if self._zeitstempel:
            return dt_util.parse_datetime(str(roh))
        if self._textwert:
            return str(zustand_zu_text(roh))[:255]
        return als_zahl(roh)

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        roh = self._roh()
        if self._textwert and ist_zustand(roh):
            return {"api_wert": roh}
        return None


TAGE = {"MO": "Mo", "TU": "Di", "WE": "Mi", "TH": "Do", "FR": "Fr", "SA": "Sa", "SU": "So"}


def _zeit(text: str) -> str:
    """ISO-Zeitangabe wie «T06:00PT2H» oder «T00:00P1D» lesbar machen."""
    return (
        str(text).replace("P1D", " ganzer Tag").replace("PT", " für ").replace("T", "", 1)
        .replace("H", " h").replace("M", " min")
    )


class HargassnerZeitplanSensor(HargassnerEntity, SensorEntity):
    """Wochenuhr oder Urlaubsprogramm: Anzahl Einträge, Details als Attribute."""

    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator, widget_key, key, unique_suffix) -> None:
        super().__init__(coordinator, widget_key, key, unique_suffix)
        self._attr_name = self._parameter_name()
        self._attr_icon = "mdi:calendar-clock" if "weekly" in key else "mdi:palm-tree"

    def _eintraege(self) -> list[dict]:
        items = (self._get_parameter() or {}).get("items") or []
        return [i for i in items if isinstance(i, dict) and (i.get("days") or i.get("times") or i.get("start"))]

    @property
    def native_value(self) -> str:
        eintraege = self._eintraege()
        if not eintraege:
            return "Keine Einträge"
        teile = []
        for e in eintraege:
            tage = ", ".join(TAGE.get(t, t) for t in e.get("days", []))
            if len(e.get("days", [])) == 7:
                tage = "Täglich"
            zeiten = ", ".join(_zeit(z) for z in e.get("times", []))
            teile.append(f"{tage}: {zeiten}".strip(": ") if tage or zeiten else str(e)[:60])
        return "; ".join(teile)[:255]

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        param = self._get_parameter() or {}
        return {
            "eintraege": self._eintraege(),
            "zeitprogramm": "woche" if "weekly" in self._param_key else "urlaub",
            "schreibbar": bool(param.get("resource")) and "weekly" in self._param_key,
            "limit": param.get("limit", 7),
            "raster": param.get("step", "PT15M"),
        }

    async def async_zeitprogramm_setzen(self, eintraege: list) -> None:
        """Wochenuhr speichern (Dienst hargassner_touch_pro.set_time_program)."""
        param = self._get_parameter() or {}
        if "weekly" not in self._param_key or not param.get("resource"):
            raise HomeAssistantError(f"{self.name}: dieses Zeitprogramm lässt sich nicht einstellen")
        try:
            sauber = eintraege_pruefen(eintraege, int(param.get("limit") or 7))
        except ValueError as err:
            raise HomeAssistantError(f"{self.name}: {err}") from err
        if not sauber:
            raise HomeAssistantError(f"{self.name}: mindestens ein Eintrag nötig")
        if not await self.coordinator.async_patch_items(param["resource"], sauber, geraet_pfad(param)):
            raise HomeAssistantError(f"{self.name}: Zeitprogramm konnte nicht gespeichert werden (siehe Protokoll)")


class HargassnerPrognoseSensor(HargassnerEntity, SensorEntity):
    """Wettervorhersage der Hargassner-Cloud (für die Witterungsführung ECO/ECO+).

    Zustand: vorhergesagte Temperatur des nächsten Zeitpunkts.
    Attribute: stündlich (alle 3 h) und täglich, mit Zeit, Temperatur und Wetter.
    """

    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_native_unit_of_measurement = "°C"
    _attr_icon = "mdi:weather-partly-cloudy"

    def __init__(self, coordinator, widget_key, key, unique_suffix) -> None:
        super().__init__(coordinator, widget_key, key, unique_suffix)
        self._attr_name = "Prognose"

    def _prognose(self) -> dict:
        wert = self._get_value()
        return wert if isinstance(wert, dict) else {}

    @property
    def native_value(self) -> float | None:
        stuendlich = self._prognose().get("hourly") or []
        for eintrag in stuendlich:
            if isinstance(eintrag, dict) and eintrag.get("temperature_current") is not None:
                return als_zahl(eintrag["temperature_current"])
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        p = self._prognose()
        stuendlich = [
            {
                "zeit": e.get("timestamp"),
                "temperatur": e.get("temperature_current"),
                "wetter": zustand_zu_text(e.get("state")),
            }
            for e in p.get("hourly") or [] if isinstance(e, dict)
        ]
        taeglich = [
            {
                "datum": e.get("timestamp"),
                "min": e.get("temperature_min"),
                "max": e.get("temperature_max"),
                "wetter": zustand_zu_text(e.get("state")),
            }
            for e in p.get("daily") or [] if isinstance(e, dict)
        ]
        return {"stuendlich": stuendlich, "taeglich": taeglich}


class HargassnerMesskanalSensor(CoordinatorEntity[HargassnerCoordinator], SensorEntity):
    """Ein Messkanal aus der Verlaufsaufzeichnung (metric-fields)."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: HargassnerCoordinator, metric_key: str, metric: dict) -> None:
        super().__init__(coordinator)
        self._metric_key = metric_key
        self._attr_unique_id = f"{DOMAIN}_{coordinator.installation_id}_metric_{metric_key}"
        self._attr_device_info = messkanalgeraet(coordinator)
        name = str(metric.get("name") or f"Kanal {metric.get('channel_id')}")
        gruppe = str(metric.get("group") or "")
        self._attr_name = f"{gruppe} {name}".strip() if gruppe and gruppe not in name else name
        unit = einheit_fuer(name.lower(), metric.get("unit"))
        wert = metric.get("value")
        self._textwert = wert is not None and not ist_zahl(wert)
        if not self._textwert:
            device_class, state_class = _einordnen(unit)
            self._attr_native_unit_of_measurement = unit
            self._attr_device_class = device_class
            self._attr_state_class = state_class
        self._attr_icon = "mdi:chart-line"

    def _metric(self) -> dict | None:
        return self.coordinator.metrics().get(self._metric_key)

    @property
    def available(self) -> bool:
        return super().available and self._metric() is not None

    @property
    def native_value(self) -> Any:
        metric = self._metric()
        if not metric or metric.get("value") is None:
            return None
        wert = metric["value"]
        if self._textwert:
            return str(zustand_zu_text(wert))[:255]
        return als_zahl(wert)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        metric = self._metric() or {}
        return {"kanal": metric.get("channel_id"), "gruppe": metric.get("group") or None}
