"""Coordinator: fragt die Hargassner-Cloud regelmässig ab."""
from __future__ import annotations

import logging
import time
from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import HargassnerApi, HargassnerApiError, HargassnerAuthError, HargassnerNotFoundError
from .beschriftung import widget_name as deutscher_widget_name
from .const import (
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    METRIC_FIELDS_REFRESH_HOURS,
    METRICS_WINDOW_MINUTES,
)

_LOGGER = logging.getLogger(__name__)


class HargassnerCoordinator(DataUpdateCoordinator):
    """Holt Bausteine (Werte, Parameter, Aktionen) und Messkanäle."""

    def __init__(
        self,
        hass: HomeAssistant,
        api: HargassnerApi,
        installation_id: str,
        installation_name: str,
        scan_interval: int = DEFAULT_SCAN_INTERVAL,
        metrics_enabled: bool = True,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{installation_id}",
            update_interval=timedelta(seconds=scan_interval),
        )
        self.api = api
        self.installation_id = installation_id
        self.installation_name = installation_name
        self.metrics_enabled = metrics_enabled
        self.online_state: bool = True
        self.devices: list[dict] = []
        self.model: str = "Heizkessel"
        self.sw_version: str | None = None
        self._channels: dict[str, list[dict]] = {}
        self._channels_loaded_at: float = 0.0
        self._metrics_unavailable: set[str] = set()
        self._last_good_data: dict[str, Any] | None = None

    # ------------------------------------------------------------------ Anlage

    async def async_load_installation(self) -> None:
        """Geräte der Anlage laden (für Messkanäle und Geräteinfo)."""
        try:
            installation = await self.api.get_installation(self.installation_id)
        except HargassnerApiError as err:
            _LOGGER.warning("Anlagendetails nicht abrufbar: %s", err)
            return
        devices = installation.get("devices")
        self.devices = [d for d in devices if isinstance(d, dict)] if isinstance(devices, list) else []
        for device in self.devices:
            model = device.get("name") or device.get("type") or device.get("model")
            if model:
                self.model = str(model)
            software = device.get("software")
            if isinstance(software, dict):
                version = software.get("version_code") or software.get("version")
                if version:
                    self.sw_version = str(version)
            break

    async def _async_load_channels(self) -> None:
        """Kanalliste aller Geräte laden (einmal täglich neu)."""
        alter = time.time() - self._channels_loaded_at
        if self._channels and alter < METRIC_FIELDS_REFRESH_HOURS * 3600:
            return
        channels: dict[str, list[dict]] = {}
        for device in self.devices:
            device_id = str(device.get("id", ""))
            if not device_id or device_id in self._metrics_unavailable:
                continue
            try:
                channels[device_id] = await self.api.get_metric_fields(device_id)
            except HargassnerNotFoundError:
                _LOGGER.info("Gerät %s bietet keine Messkanäle an", device_id)
                self._metrics_unavailable.add(device_id)
            except HargassnerApiError as err:
                _LOGGER.warning("Messkanäle für Gerät %s nicht abrufbar: %s", device_id, err)
                if device_id in self._channels:
                    channels[device_id] = self._channels[device_id]
        self._channels = channels
        self._channels_loaded_at = time.time()
        _LOGGER.debug(
            "Messkanäle geladen: %s", {d: len(c) for d, c in channels.items()}
        )

    async def _async_fetch_metrics(self) -> dict[str, dict]:
        """Alle Messkanäle mit ihrem letzten Wert."""
        if not self.metrics_enabled or not self.devices:
            return {}
        await self._async_load_channels()
        result: dict[str, dict] = {}
        for device_id, channels in self._channels.items():
            if not channels:
                continue
            ids = [str(c["id"]) for c in channels]
            try:
                latest = await self.api.get_latest_measurements(
                    device_id, ids, METRICS_WINDOW_MINUTES
                )
            except HargassnerApiError as err:
                _LOGGER.debug("Messwerte für Gerät %s nicht abrufbar: %s", device_id, err)
                latest = {}
            for channel in channels:
                cid = str(channel["id"])
                result[f"{device_id}_{cid}"] = {
                    "device_id": device_id,
                    "channel_id": cid,
                    "name": channel.get("legend") or channel.get("text") or channel.get("name") or f"Kanal {cid}",
                    "group": channel.get("group") or "",
                    "unit": channel.get("unit") or None,
                    "value": latest.get(cid),
                }
        return result

    # ------------------------------------------------------------------ Abfrage

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            await self.api.ensure_token_valid()
        except HargassnerAuthError as err:
            _LOGGER.error("Erneute Anmeldung fehlgeschlagen: %s", err)
            if self._last_good_data:
                return self._last_good_data
            raise UpdateFailed(f"Anmeldefehler: {err}") from err

        try:
            widgets, meta = await self.api.get_widgets(self.installation_id)
        except HargassnerAuthError as err:
            if self._last_good_data:
                _LOGGER.warning("Anmeldefehler, verwende letzte Werte: %s", err)
                return self._last_good_data
            raise UpdateFailed(f"Anmeldefehler: {err}") from err
        except HargassnerApiError as err:
            if self._last_good_data:
                _LOGGER.warning("API-Fehler, behalte letzte Werte: %s", err)
                stale = dict(self._last_good_data)
                stale["_online"] = False
                return stale
            raise UpdateFailed(f"API-Fehler: {err}") from err

        self.online_state = meta.get("online_state", True) if isinstance(meta, dict) else True
        result: dict[str, Any] = {"_online": self.online_state, "_meta": meta}

        gesehene_ressourcen: set[str] = set()
        for widget in widgets:
            if not isinstance(widget, dict):
                continue
            widget_type = str(widget.get("widget", "UNKNOWN"))
            widget_number = str(widget.get("number") or "")

            raw_values = widget.get("values")
            values = raw_values if isinstance(raw_values, dict) else {}
            api_name = values.get("name")
            widget_name = api_name or widget_type

            raw_parameters = widget.get("parameters")
            parameters = (
                {k: dict(v) for k, v in raw_parameters.items() if isinstance(v, dict)}
                if isinstance(raw_parameters, dict)
                else {}
            )
            # Parameter für alle Heizkreise (z. B. 11–13) nur einmal anlegen
            for param in parameters.values():
                resource = param.get("resource")
                if resource and resource in gesehene_ressourcen:
                    param["_doppelt"] = True
                elif resource:
                    gesehene_ressourcen.add(resource)
            raw_actions = widget.get("actions")
            actions = (
                {k: v for k, v in raw_actions.items() if isinstance(v, dict)}
                if isinstance(raw_actions, dict)
                else {}
            )

            # Schlüssel unverändert lassen, damit bestehende Entitäts-IDs gleich bleiben
            suffix = f"_{widget_number}" if widget_number else ""
            widget_key = (
                f"{widget_type}{suffix}_{widget_name}".replace(" ", "_").replace(".", "_").upper()
            )

            result[widget_key] = {
                "widget_type": widget_type,
                "widget_name": widget_name,
                "widget_number": widget_number,
                "display_name": deutscher_widget_name(
                    widget_type, widget_number, api_name, self.installation_name
                ),
                "parameters": parameters,
                "values": values,
                "actions": actions,
            }

        try:
            result["_metrics"] = await self._async_fetch_metrics()
        except HargassnerApiError as err:
            _LOGGER.debug("Messkanäle übersprungen: %s", err)
            result["_metrics"] = (self._last_good_data or {}).get("_metrics", {})

        self._last_good_data = dict(result)
        self._last_good_data["_online"] = True
        return result

    # ------------------------------------------------------------------ Hilfen

    def widgets(self) -> dict[str, dict]:
        """Nur die Bausteine (ohne interne Schlüssel)."""
        return {
            k: v
            for k, v in (self.data or {}).items()
            if isinstance(v, dict) and "widget_type" in v
        }

    def metrics(self) -> dict[str, dict]:
        return (self.data or {}).get("_metrics", {}) or {}

    def messwert(self, channel_id: str) -> Any:
        """Wert eines Messkanals über seine Kanal-ID (z. B. heating_circuit.room_temperature_current.1)."""
        for metric in self.metrics().values():
            if metric.get("channel_id") == channel_id:
                return metric.get("value")
        return None

    async def async_patch_value(self, resource_url: str, value: Any) -> bool:
        try:
            await self.api.patch_value(resource_url, value)
        except HargassnerApiError as err:
            _LOGGER.error("Wert konnte nicht gesetzt werden (%s): %s", resource_url, err)
            return False
        await self.async_request_refresh()
        return True

    async def async_patch_items(self, resource_url: str, items: list[dict], geraet_pfad: str | None) -> bool:
        try:
            await self.api.patch_items(resource_url, items, geraet_pfad)
        except HargassnerApiError as err:
            _LOGGER.error("Zeitprogramm konnte nicht gespeichert werden (%s): %s", geraet_pfad or resource_url, err)
            return False
        await self.async_request_refresh()
        return True

    async def async_post_action(self, resource_url: str) -> bool:
        try:
            await self.api.post_action(resource_url)
        except HargassnerApiError as err:
            _LOGGER.error("Aktion fehlgeschlagen (%s): %s", resource_url, err)
            return False
        await self.async_request_refresh()
        return True
