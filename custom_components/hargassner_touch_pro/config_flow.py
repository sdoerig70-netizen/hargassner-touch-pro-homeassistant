"""Einrichtungsassistent der Hargassner-Integration."""
from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_EMAIL, CONF_PASSWORD
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import HargassnerApi, HargassnerApiError, HargassnerAuthError
from .const import (
    CONF_INSTALLATION_ID,
    CONF_INSTALLATION_NAME,
    CONF_METRICS,
    CONF_SCAN_INTERVAL,
    CONF_WRITABLE,
    DEFAULT_METRICS,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_WRITABLE,
    DOMAIN,
    MAX_SCAN_INTERVAL,
    MIN_SCAN_INTERVAL,
)

_LOGGER = logging.getLogger(__name__)

STEP_USER_SCHEMA = vol.Schema({vol.Required(CONF_EMAIL): str, vol.Required(CONF_PASSWORD): str})


class HargassnerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._email = ""
        self._password = ""
        self._installations: list[dict] = []

    async def _anmelden(self, email: str, password: str) -> tuple[list[dict], dict[str, str]]:
        errors: dict[str, str] = {}
        api = HargassnerApi(async_get_clientsession(self.hass))
        try:
            await api.login(email, password)
            return await api.get_installations(), errors
        except HargassnerAuthError:
            errors["base"] = "invalid_auth"
        except HargassnerApiError:
            errors["base"] = "cannot_connect"
        except Exception:  # noqa: BLE001
            _LOGGER.exception("Unerwarteter Fehler bei der Anmeldung")
            errors["base"] = "unknown"
        return [], errors

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            installations, errors = await self._anmelden(user_input[CONF_EMAIL], user_input[CONF_PASSWORD])
            if not errors and not installations:
                errors["base"] = "no_installations"
            if not errors:
                self._email = user_input[CONF_EMAIL]
                self._password = user_input[CONF_PASSWORD]
                self._installations = installations
                if len(installations) == 1:
                    return await self._create_entry(installations[0])
                return await self.async_step_installation()
        return self.async_show_form(step_id="user", data_schema=STEP_USER_SCHEMA, errors=errors)

    async def async_step_installation(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if user_input is not None:
            installation = next(
                (i for i in self._installations if str(i.get("id")) == user_input[CONF_INSTALLATION_ID]),
                None,
            )
            if installation:
                return await self._create_entry(installation)
        options = {str(i.get("id")): i.get("name", str(i.get("id"))) for i in self._installations}
        schema = vol.Schema({vol.Required(CONF_INSTALLATION_ID): vol.In(options)})
        return self.async_show_form(step_id="installation", data_schema=schema)

    async def _create_entry(self, installation: dict) -> FlowResult:
        installation_id = str(installation.get("id"))
        installation_name = installation.get("name", installation_id)
        await self.async_set_unique_id(f"{DOMAIN}_{installation_id}")
        self._abort_if_unique_id_configured()
        return self.async_create_entry(
            title=installation_name,
            data={
                CONF_EMAIL: self._email,
                CONF_PASSWORD: self._password,
                CONF_INSTALLATION_ID: installation_id,
                CONF_INSTALLATION_NAME: installation_name,
            },
        )

    # ------------------------------------------------------------------ Neu anmelden

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> FlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}
        entry = self.hass.config_entries.async_get_entry(self.context["entry_id"])
        if user_input is not None and entry is not None:
            _, errors = await self._anmelden(entry.data[CONF_EMAIL], user_input[CONF_PASSWORD])
            if not errors:
                self.hass.config_entries.async_update_entry(
                    entry, data={**entry.data, CONF_PASSWORD: user_input[CONF_PASSWORD]}
                )
                await self.hass.config_entries.async_reload(entry.entry_id)
                return self.async_abort(reason="reauth_successful")
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema({vol.Required(CONF_PASSWORD): str}),
            errors=errors,
        )

    @staticmethod
    @config_entries.callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry) -> config_entries.OptionsFlow:
        return HargassnerOptionsFlow(config_entry)


class HargassnerOptionsFlow(config_entries.OptionsFlow):
    """Optionen: Abfrageintervall, Messkanäle, schreibbare Parameter."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        self._entry = config_entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)
        opts = self._entry.options
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_SCAN_INTERVAL, default=opts.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
                ): vol.All(vol.Coerce(int), vol.Range(min=MIN_SCAN_INTERVAL, max=MAX_SCAN_INTERVAL)),
                vol.Required(CONF_METRICS, default=opts.get(CONF_METRICS, DEFAULT_METRICS)): bool,
                vol.Required(CONF_WRITABLE, default=opts.get(CONF_WRITABLE, DEFAULT_WRITABLE)): bool,
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
