"""Client für die Hargassner-Cloud-API (web.hargassner.at)."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import aiohttp

from .const import (
    API_BASE_URL,
    API_DEVICES,
    API_INSTALLATIONS,
    API_LANGUAGE,
    API_LOGIN,
    API_LOGOUT,
    API_MEASUREMENTS,
    API_METRIC_FIELDS,
    API_REFRESH,
    API_WIDGETS,
    APP_BRANDING,
    CLIENT_ID,
    CLIENT_SECRET,
)

_LOGGER = logging.getLogger(__name__)


class HargassnerApiError(Exception):
    """Allgemeiner API-Fehler."""


class HargassnerAuthError(HargassnerApiError):
    """Anmeldung fehlgeschlagen."""


class HargassnerNotFoundError(HargassnerApiError):
    """Endpunkt oder Ressource nicht vorhanden (HTTP 403/404)."""


def _unwrap_list(data: Any) -> list:
    """Liste aus {"data": [...]} oder direkt aus einer Liste holen."""
    if isinstance(data, dict):
        inner = data.get("data", [])
        if isinstance(inner, list):
            return inner
        if isinstance(inner, dict):
            return [inner]
        return []
    return data if isinstance(data, list) else []


class HargassnerApi:
    """Client für die Hargassner-Cloud-API."""

    def __init__(self, session: aiohttp.ClientSession) -> None:
        self._session = session
        self._base_url = API_BASE_URL
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._token_expires_at: float = 0.0
        self._email: str = ""
        self._password: str = ""

    @property
    def is_authenticated(self) -> bool:
        return self._access_token is not None

    @property
    def token_needs_refresh(self) -> bool:
        """True, wenn das Token in weniger als 5 Minuten abläuft."""
        return time.time() > (self._token_expires_at - 300)

    def _headers(self) -> dict:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Accept-Language": API_LANGUAGE,
            "Branding": APP_BRANDING,
        }
        if self._access_token:
            headers["Authorization"] = f"Bearer {self._access_token}"
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        json: dict | None = None,
        params: dict | None = None,
        _retry_auth: bool = True,
        extra_headers: dict | None = None,
        mit_kopf: bool = False,
    ) -> Any:
        url = path if path.startswith("http") else self._base_url + path
        _LOGGER.debug("%s %s", method, url)
        try:
            async with self._session.request(
                method,
                url,
                headers={**self._headers(), **(extra_headers or {})},
                json=json,
                params=params,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                _LOGGER.debug("Antwort: %s", resp.status)

                # Token abgelaufen: einmal erneuern und wiederholen
                if resp.status == 401 and _retry_auth:
                    _LOGGER.info("Token abgelaufen, erneuere Anmeldung")
                    await self._refresh_or_relogin()
                    return await self._request(
                        method, path, json=json, params=params, _retry_auth=False,
                        extra_headers=extra_headers, mit_kopf=mit_kopf,
                    )

                if resp.status == 401:
                    raise HargassnerAuthError("Nicht autorisiert, auch nach Token-Erneuerung")
                if resp.status in (403, 404):
                    raise HargassnerNotFoundError(f"Nicht gefunden: {path} (HTTP {resp.status})")
                if resp.status >= 400:
                    text = await resp.text()
                    raise HargassnerApiError(f"API-Fehler {resp.status}: {text}")
                if resp.status == 204 or resp.content_length == 0:
                    daten: Any = {}
                elif "json" in (resp.content_type or ""):
                    daten = await resp.json(content_type=None)
                else:
                    daten = await resp.text()
                return (daten, dict(resp.headers)) if mit_kopf else daten
        except aiohttp.ClientError as err:
            raise HargassnerApiError(f"Netzwerkfehler: {err}") from err

    # ------------------------------------------------------------------ Anmeldung

    async def _refresh_or_relogin(self) -> None:
        """Refresh-Token versuchen, sonst neu anmelden."""
        if self._refresh_token:
            try:
                await self._do_refresh()
                return
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("Token-Erneuerung fehlgeschlagen (%s), melde neu an", err)
        if self._email and self._password:
            await self.login(self._email, self._password)
        else:
            raise HargassnerAuthError("Neuanmeldung nicht möglich: keine Zugangsdaten gespeichert")

    async def _do_refresh(self) -> None:
        payload = {
            "grant_type": "refresh_token",
            "refresh_token": self._refresh_token,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
        }
        data = await self._request("POST", API_REFRESH, json=payload, _retry_auth=False)
        self._store_tokens(data)

    def _store_tokens(self, data: dict) -> None:
        inner = data.get("data", data) if isinstance(data, dict) else data
        self._access_token = inner.get("access_token")
        self._refresh_token = inner.get("refresh_token", self._refresh_token)
        expires_in = inner.get("expires_in", 3600)
        self._token_expires_at = time.time() + expires_in
        if not self._access_token:
            raise HargassnerAuthError("Kein access_token in der Antwort")
        _LOGGER.debug("Token gespeichert, gültig für %ss", expires_in)

    async def login(self, email: str, password: str) -> dict:
        """Anmelden und Token speichern."""
        self._email = email
        self._password = password
        payload = {
            "email": email,
            "password": password,
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
        }
        data = await self._request("POST", API_LOGIN, json=payload, _retry_auth=False)
        if not isinstance(data, dict):
            raise HargassnerAuthError(f"Unerwartete Antwort beim Anmelden: {type(data)}")
        self._store_tokens(data)
        _LOGGER.debug("Anmeldung erfolgreich")
        return data

    async def logout(self) -> None:
        try:
            await self._request("POST", API_LOGOUT, json={}, _retry_auth=False)
        except HargassnerApiError:
            pass
        self._access_token = None
        self._refresh_token = None

    async def ensure_token_valid(self) -> None:
        """Token rechtzeitig vor Ablauf erneuern."""
        if self.token_needs_refresh:
            _LOGGER.debug("Erneuere Token vorsorglich")
            await self._refresh_or_relogin()

    # ------------------------------------------------------------------ Anlagen

    async def get_installations(self) -> list[dict]:
        """Alle Anlagen des Kontos, inkl. Geräte, Software und Gateway."""
        path = f"{API_INSTALLATIONS}?with=devices.software%3Bdevices.gateway&sort=name"
        return _unwrap_list(await self._request("GET", path))

    async def get_installation(self, installation_id: str) -> dict:
        """Details einer Anlage mit ihren Geräten."""
        path = f"{API_INSTALLATIONS}/{installation_id}?with=devices.software%3Bdevices.gateway"
        data = await self._request("GET", path)
        inner = data.get("data", data) if isinstance(data, dict) else {}
        return inner if isinstance(inner, dict) else {}

    async def get_widgets(self, installation_id: str) -> tuple[list[dict], dict]:
        """Bausteine (Kessel, Heizkreise, Puffer, Boiler …) mit Werten, Parametern, Aktionen."""
        path = f"{API_INSTALLATIONS}/{installation_id}{API_WIDGETS}"
        data = await self._request("GET", path)
        if isinstance(data, dict):
            widgets = data.get("data", [])
            meta = data.get("meta", {})
            return (widgets if isinstance(widgets, list) else []), meta
        if isinstance(data, list):
            return data, {}
        return [], {}

    async def get_events(self, installation_id: str) -> list[dict]:
        """Ereignisse und Störungen der Anlage."""
        path = f"{API_INSTALLATIONS}/{installation_id}/events"
        return _unwrap_list(await self._request("GET", path))

    # ------------------------------------------------------------------ Messkanäle

    async def get_metric_fields(self, device_id: str) -> list[dict]:
        """Alle Messkanäle eines Geräts.

        Antwort: Gruppen mit ``fields``; jedes Feld hat ``id``, ``text``/``legend``
        und ``unit``. Rückgabe ist eine flache Liste mit dem Gruppennamen in ``group``.
        """
        path = f"{API_DEVICES}/{device_id}{API_METRIC_FIELDS}"
        channels: list[dict] = []
        for group in _unwrap_list(await self._request("GET", path)):
            if not isinstance(group, dict):
                continue
            group_name = group.get("text") or group.get("name") or group.get("type") or ""
            fields = group.get("fields")
            if not isinstance(fields, list):
                continue
            for field in fields:
                if isinstance(field, dict) and field.get("id") is not None:
                    channels.append({**field, "group": str(group_name)})
        return channels

    async def get_latest_measurements(
        self, device_id: str, channel_ids: list[str], window_minutes: int
    ) -> dict[str, Any]:
        """Letzten vorhandenen Messwert je Kanal im Zeitfenster holen."""
        if not channel_ids:
            return {}
        now = datetime.now(timezone.utc)
        params = {
            "channels": ";".join(channel_ids),
            "from": (now - timedelta(minutes=window_minutes)).isoformat(),
            "to": (now + timedelta(minutes=5)).isoformat(),
        }
        path = f"{API_DEVICES}/{device_id}{API_MEASUREMENTS}"
        samples = _unwrap_list(await self._request("GET", path, params=params))
        latest: dict[str, Any] = {}

        def _zeit(sample: Any) -> str:
            if not isinstance(sample, dict):
                return ""
            for key in ("time", "timestamp", "date", "created_at", "t"):
                if sample.get(key) is not None:
                    return str(sample[key])
            return ""

        # Älteste zuerst durchgehen, neuere überschreiben ältere Werte
        if any(_zeit(s) for s in samples):
            samples = sorted(samples, key=_zeit)
        for sample in samples:
            values = sample.get("values") if isinstance(sample, dict) else None
            if not isinstance(values, dict):
                continue
            for key, value in values.items():
                if value is not None:
                    latest[str(key)] = value
        return latest

    # ------------------------------------------------------------------ Schreiben

    async def patch_value(self, resource_url: str, value: Any) -> dict:
        """Parameter setzen."""
        return await self._request("PATCH", resource_url, json={"value": value})

    async def patch_items(self, resource_url: str, items: list[dict], geraet_pfad: str | None = None) -> dict:
        """Wochenuhr schreiben.

        Die Web-App speichert die Wochenuhr am Geräteparameter
        (``/devices/<id>/parameters/<nr>``) mit ``{"items": [...]}`` und dem ETag
        aus dem vorherigen Lesen als ``If-Match``. Ohne Gerätepfad wird der
        Baustein-Parameter direkt beschrieben.
        """
        if geraet_pfad:
            _, kopf = await self._request("GET", geraet_pfad, mit_kopf=True)
            etag = next((v for k, v in kopf.items() if k.lower() == "etag"), None)
            return await self._request(
                "PATCH", geraet_pfad, json={"items": items},
                extra_headers={"If-Match": etag} if etag else None,
            )
        return await self._request("PATCH", resource_url, json={"items": items})

    async def post_action(self, resource_url: str) -> dict:
        """Aktion auslösen (z. B. Zündung)."""
        return await self._request("POST", resource_url, json=None)
