"""Deutsche Bezeichnungen und Einordnung der Hargassner-Werte.

Die API liefert technische Schlüssel (z. B. ``flow_temperature_current``) und
Zustände (z. B. ``STATE_EFFICIENCY_FIRE``). Hier werden sie in deutsche Namen
übersetzt. Unbekannte Schlüssel werden Wort für Wort übersetzt, damit auch neue
Werte einer künftigen Firmware einen lesbaren Namen bekommen.
"""
from __future__ import annotations

import re
from typing import Any

# ---------------------------------------------------------------- Bausteine

WIDGET_NAMEN: dict[str, str] = {
    "HEATER": "Kessel",
    "BUFFER": "Puffer",
    "BOILER": "Warmwasser",
    "SOLAR": "Solar",
    "FRESH_WATER": "Frischwasserstation",
    "FRESH_WATER_STATION": "Frischwasserstation",
    "CIRCULATION": "Zirkulation",
    "HEATING_CIRCUIT": "Heizkreis",
    "HEATING_CIRCUIT_RADIATOR": "Heizkreis",
    "HEATING_CIRCUIT_FLOOR": "Heizkreis",
    "HEATING_CIRCUIT_BLOWER": "Heizkreis",
    "HEATING_CIRCUIT_EXTERNAL": "Heizkreis",
    "HEATING_CIRCUIT_CONTROLLER": "Heizkreisregler",
    "HEATING_CIRCUIT_POOL": "Schwimmbad",
    "HEATING_CIRCUIT_CUSTOM": "Heizkreis",
    "STORAGE": "Lager",
    "SILO": "Silo",
    "WEATHER": "Wetter",
}


def widget_name(
    widget_type: str, number: str, api_name: str | None, anlage: str | None = None
) -> str:
    """Name eines Bausteins: Typ und Nummer wie in der Anleitung, dahinter der Name aus der App.

    Beispiele: «Kessel», «Heizkreis 1 (Altbau)», «Frischwasserstation 1 (Neubau)».
    """
    basis = WIDGET_NAMEN.get(widget_type)
    if basis is None:
        for prefix, name in sorted(WIDGET_NAMEN.items(), key=lambda x: -len(x[0])):
            if widget_type.startswith(prefix):
                basis = name
                break
    if basis is None:
        basis = schluessel_zu_name(widget_type)
    name = f"{basis} {number}" if number else basis
    app = str(api_name).strip() if api_name else ""
    if app and app != widget_type and app != anlage and app.lower() != name.lower():
        name = f"{name} ({app})"
    return name


# ---------------------------------------------------------------- Parameter (Anleitung)

# Bezeichnungen nach der Parameterliste der Hargassner-Anleitung (Touch-Regelung).
# Die Parameternummer liefert die Cloud selbst und wird vorangestellt, z. B. «A2 Steilheit».
PARAMETER_NAMEN: dict[str, str] = {
    "program": "Kesselprogramm",
    "mode": "Betriebsart",
    "name": "Bezeichnung",
    "weather_mode": "Witterungsführung",
    "room_temperature_correction": "Raumtemperatur-Korrektur",
    "automatic_times_weekly": "Wochenuhr",
    "holiday_mode": "Urlaubsprogramm",
    "room_temperature_heating": "Tages-Raumtemperatur",
    "room_temperature_reduction": "Absenk-Raumtemperatur",
    "pool_heating": "Sommer-Badheizen",
    "deactivation_limit_heating": "Alle Heizkreise aus über Aussentemperatur",
    "deactivation_limit_reduction_day": "Alle Heizkreise aus bei Tagabsenkung",
    "deactivation_limit_reduction_night": "Alle Heizkreise aus bei Nachtabsenkung",
    "steepness": "Steilheit",
    "boiler_temperature_target": "Solltemperatur",
    "circulation_pump": "Zirkulationspumpe",
    "fuel_stock": "Lagerstand",
}

_NUMMER = re.compile(r"parameters/([^/]+)/chatbot")


def parameter_nummer(param: Any) -> str | None:
    """Parameternummer der Touch-Regelung (z. B. «A2», «PR011», «11»), falls die Cloud sie liefert."""
    if not isinstance(param, dict):
        return None
    for feld in ("number", "code", "parameter_number"):
        if isinstance(param.get(feld), (str, int)) and str(param[feld]).strip():
            return str(param[feld]).strip()
    treffer = _NUMMER.search(str(param.get("chatbot") or ""))
    return treffer.group(1) if treffer else None


def parameter_name(key: str, param: Any) -> str:
    """«Nummer Bezeichnung» nach Anleitung, z. B. «4 Tages-Raumtemperatur»."""
    name = PARAMETER_NAMEN.get(key) or schluessel_zu_name(key)
    nummer = parameter_nummer(param)
    return f"{nummer} {name}" if nummer else name


# ---------------------------------------------------------------- Wertnamen

NAMEN: dict[str, str] = {
    # Kessel
    "heater_temperature_current": "Kesseltemperatur",
    "heater_temperature_target": "Kessel-Solltemperatur",
    "smoke_temperature": "Abgastemperatur",
    "outdoor_temperature": "Aussentemperatur",
    "outdoor_temperature_average": "Aussentemperatur gemittelt",
    "state": "Zustand",
    "program": "Programm",
    "fuel_stock": "Brennstoffvorrat",
    "efficiency": "Leistung",
    "heater_exhaust_guard": "Abgasüberwachung",
    "system_pressure": "Anlagendruck",
    "return_temperature": "Rücklauftemperatur",
    "return_temperature_current": "Rücklauftemperatur",
    "return_temperature_target": "Rücklauf-Solltemperatur",
    "oxygen": "Restsauerstoff",
    "residual_oxygen": "Restsauerstoff",
    "ash_content": "Aschebehälter",
    "operating_hours": "Betriebsstunden",
    "ignitions": "Zündungen",
    # Heizkreis
    "flow_temperature_current": "Vorlauftemperatur",
    "flow_temperature_target": "Vorlauf-Solltemperatur",
    "room_temperature_current": "Raumtemperatur",
    "room_temperature_target": "Raum-Solltemperatur",
    "room_temperature_heating": "Raumtemperatur Heizbetrieb",
    "room_temperature_reduction": "Raumtemperatur Absenkbetrieb",
    "room_temperature_correction": "Raumtemperatur-Korrektur",
    "deactivation_limit_heating": "Abschaltgrenze Heizbetrieb",
    "deactivation_limit_reduction_day": "Abschaltgrenze Absenkbetrieb Tag",
    "deactivation_limit_reduction_night": "Abschaltgrenze Absenkbetrieb Nacht",
    "steepness": "Heizkurve Steilheit",
    "mode": "Betriebsart",
    "weather_mode": "Witterungsgeführt",
    "pool_heating": "Schwimmbadheizung",
    "pump_active": "Pumpe aktiv",
    "active": "Aktiv",
    "mixer": "Mischer",
    "mixer_position": "Mischerstellung",
    # Puffer
    "buffer_temperature_top": "Puffertemperatur oben",
    "buffer_temperature_center_top": "Puffertemperatur Mitte oben",
    "buffer_temperature_center": "Puffertemperatur Mitte",
    "buffer_temperature_center_bottom": "Puffertemperatur Mitte unten",
    "buffer_temperature_bottom": "Puffertemperatur unten",
    "buffer_charge": "Pufferladung",
    "capacity": "Kapazität",
    "force_charging_active": "Zwangsladung aktiv",
    # Warmwasser / Boiler
    "boiler_temperature_current": "Warmwassertemperatur",
    "boiler_temperature_target": "Warmwasser-Solltemperatur",
    "boiler_charge": "Warmwasserladung",
    "circulation_pump_active": "Zirkulationspumpe aktiv",
    "one_time_circulation": "Einmalige Zirkulation",
    "one_time_charging": "Einmalige Ladung",
    # Regler / Frischwasser / Solar
    "source_temperature": "Quellentemperatur",
    "request_temperature": "Anforderungstemperatur",
    "max_requirement": "Höchste Anforderung",
    "primary_return_temperature_current": "Rücklauftemperatur primär",
    "primary_flow_temperature_current": "Vorlauftemperatur primär",
    "secondary_flow_temperature_current": "Vorlauftemperatur sekundär",
    "secondary_flow_temperature_target": "Vorlauf-Solltemperatur sekundär",
    "collector_temperature": "Kollektortemperatur",
    "flow_rate": "Durchfluss",
    # Wetter
    "temperature_current": "Temperatur",
    "air_humidity": "Luftfeuchtigkeit",
    "air_pressure": "Luftdruck",
    "cloud_percent": "Bewölkung",
    "wind_degree": "Windrichtung",
    "wind_speed": "Windgeschwindigkeit",
    "precip_amount": "Niederschlag",
    "daytime": "Tag",
    "timestamp_sunrise": "Sonnenaufgang",
    "timestamp_sunset": "Sonnenuntergang",
    # Frischwasserstation
    "valve_temperature_target": "Auslauf-Solltemperatur",
    "flow_count_daily": "Zapfmenge heute",
    "flow_count_total": "Zapfmenge gesamt",
    # Sonstiges
    "device_type": "Kesseltyp",
    # Aktionen
    "start_ignition": "Zündung starten",
    "stop_firing": "Feuerung stoppen",
    "start_charging": "Ladung starten",
    "reset": "Zurücksetzen",
}

WOERTER: dict[str, str] = {
    "temperature": "Temperatur", "temp": "Temperatur", "current": "Ist",
    "target": "Soll", "flow": "Vorlauf", "return": "Rücklauf", "room": "Raum",
    "outdoor": "Aussen", "average": "gemittelt", "buffer": "Puffer",
    "boiler": "Warmwasser", "heater": "Kessel", "heating": "Heizen",
    "reduction": "Absenken", "day": "Tag", "night": "Nacht", "limit": "Grenze",
    "deactivation": "Abschalt", "pump": "Pumpe", "active": "aktiv",
    "state": "Zustand", "mode": "Betriebsart", "program": "Programm",
    "charge": "Ladung", "charging": "Ladung", "force": "Zwang", "top": "oben",
    "bottom": "unten", "center": "Mitte", "smoke": "Abgas", "fuel": "Brennstoff",
    "stock": "Vorrat", "efficiency": "Leistung", "pressure": "Druck",
    "system": "Anlage", "circulation": "Zirkulation", "one": "einmalig",
    "time": "Zeit", "start": "Start", "end": "Ende", "date": "Datum",
    "holiday": "Ferien", "vacation": "Ferien", "absence": "Abwesenheit",
    "solar": "Solar", "collector": "Kollektor", "pool": "Schwimmbad",
    "weather": "Witterung", "source": "Quelle", "request": "Anforderung",
    "max": "max.", "min": "min.", "requirement": "Anforderung", "primary": "primär",
    "secondary": "sekundär", "mixer": "Mischer", "position": "Stellung",
    "valve": "Ventil", "hysteresis": "Hysterese", "offset": "Korrektur",
    "correction": "Korrektur", "steepness": "Steilheit", "curve": "Kurve",
    "level": "Stufe", "ash": "Asche", "ignition": "Zündung", "fan": "Gebläse",
    "speed": "Drehzahl", "oxygen": "Sauerstoff", "lambda": "Lambda",
    "power": "Leistung", "energy": "Energie", "hours": "Stunden",
    "operating": "Betrieb", "counter": "Zähler", "count": "Anzahl",
    "enabled": "aktiviert", "disabled": "deaktiviert", "on": "ein", "off": "aus",
    "auto": "Automatik", "automatic": "Automatik", "manual": "Hand",
    "screed": "Estrich", "frost": "Frost", "protection": "Schutz",
    "summer": "Sommer", "winter": "Winter", "fresh": "Frisch", "water": "wasser",
    "storage": "Lager", "silo": "Silo", "pellets": "Pellets", "wood": "Holz",
    "chips": "Hackgut", "feed": "Zufuhr", "auger": "Schnecke", "grate": "Rost",
    "door": "Tür", "open": "offen", "closed": "zu", "error": "Störung",
    "warning": "Warnung", "event": "Ereignis", "last": "letzte", "latest": "letzte",
    "serial": "Serien", "info": "Info", "number": "Nummer", "name": "Name",
    "version": "Version", "software": "Software", "firmware": "Firmware",
    "type": "Typ", "status": "Status", "value": "Wert", "rate": "Rate",
    "consumption": "Verbrauch", "total": "gesamt", "daily": "täglich",
    "week": "Woche", "month": "Monat", "year": "Jahr", "begin": "Beginn",
    "until": "bis", "from": "ab", "duration": "Dauer", "interval": "Intervall",
    "delay": "Verzögerung", "release": "Freigabe", "block": "Sperre",
    "dhw": "Warmwasser", "hc": "Heizkreis", "fws": "Frischwasserstation",
}


def schluessel_zu_name(key: str) -> str:
    """Technischen Schlüssel in einen deutschen Namen umwandeln."""
    if key in NAMEN:
        return NAMEN[key]
    teile = [t for t in re.split(r"[_\-\s]+", str(key).lower()) if t]
    if not teile:
        return str(key)
    woerter = [WOERTER.get(t, t) for t in teile]
    text = " ".join(woerter)
    return text[:1].upper() + text[1:]


# ---------------------------------------------------------------- Zustände

ZUSTAENDE: dict[str, str] = {
    # Kessel
    "OFF": "Aus", "ON": "Ein", "IGNITION": "Zündung", "IGNITION_WAIT": "Zündung warten",
    "EFFICIENCY_FIRE": "Leistungsbrand", "THROTTLE_EFFICIENCY_FIRE": "Teillast",
    "BURN_OUT": "Ausbrand", "EMBERS_KEEPING": "Gluterhaltung",
    "RESIDUAL_HEATING": "Restwärmenutzung", "OVERHEATING": "Übertemperatur",
    "DEASHING": "Entaschung", "FILLING": "Füllen", "PREPARATION": "Vorbereitung",
    "OVERHEAT_PROTECTION": "Sicherheitstemperaturbegrenzer", "MANUAL": "Handbetrieb",
    "DOOR_OPEN": "Tür offen", "DOOR_CLOSED": "Tür zu", "BLOCK_PROTECTION": "Blockierschutz",
    "ASH_DRAWER_OPEN": "Aschelade offen", "BURN_ASSISTANT": "Verbrennungsassistent",
    "BACKUP_MODE_LOGS": "Notbetrieb Stückholz", "ERROR": "Störung", "STANDBY": "Bereit",
    # Puffer / Boiler
    "BOILER_CHARGING": "Ladung", "CHARGING": "Ladung", "IGNORE_REQUEST": "Anforderung ignoriert",
    # Heizkreis
    "HEATING": "Heizen", "COOLING": "Kühlen", "REDUCTION": "Absenken",
    "REDUCTION_TRANSITION": "Übergang Absenken",
    "DAILY_NIGHTLY_DEACTIVATION": "Tag-/Nachtabschaltung",
    "SUMMER_DEACTIVATION": "Sommerabschaltung", "FREEZE_PROTECTION": "Frostschutz",
    "SCREED_HEATING": "Estrichheizen", "SOLAR_HEATING": "Solarheizen",
    # Betriebsarten
    "AUTOMATIC": "Automatik", "BRIDGE_HEATING": "Vorübergehend heizen",
    "BRIDGE_REDUCTION": "Vorübergehend absenken", "DRY_OUT": "Estrichtrocknung",
    "CIRCULATION": "Zirkulation", "UNKNOWN": "Unbekannt",
    # Programme
    "BOILER": "Nur Warmwasser", "CHIMNEY_SWEEPER": "Kaminfeger",
    "COMBINATION_OFF": "Kombibetrieb aus", "COMBINATION_ON": "Kombibetrieb ein",
    "PELLETS_DISABLED": "Pellets deaktiviert", "STOP_FIRING": "Feuerung stoppen",
    # Witterungsführung
    "WEATHER_OFF": "Aus", "WEATHER_ECO": "Eco", "WEATHER_ECO_PLUS": "Eco+",
    # Wetter
    "WEATHER_CLEAR": "Klar", "WEATHER_SUN": "Sonnig", "WEATHER_SUNNY": "Sonnig",
    "WEATHER_CLOUD": "Bewölkt", "WEATHER_CLOUD_MASS": "Stark bewölkt",
    "WEATHER_CLOUD_SUN": "Teilweise bewölkt", "WEATHER_PARTLY_CLOUDY": "Teilweise bewölkt",
    "WEATHER_RAIN": "Regen", "WEATHER_RAIN_LIGHT": "Leichter Regen", "WEATHER_DRIZZLE": "Nieselregen",
    "WEATHER_SNOW": "Schnee", "WEATHER_SLEET": "Schneeregen", "WEATHER_FOG": "Nebel",
    "WEATHER_THUNDERSTORM": "Gewitter", "WEATHER_THUNDER": "Gewitter",
    # Bad-/Schwimmbadheizung
    "POOL_HEATING_OFF": "Aus", "POOL_HEATING_ON": "Ein", "POOL_HEATING_AUTOMATIC": "Automatik",
}

_PRAEFIXE = ("STATE_", "MODE_", "PROGRAM_", "POOL_HEATING_", "STATUS_", "WEATHER_")


def ist_zustand(value: Any) -> bool:
    """True für Aufzählungswerte wie ``STATE_ON`` oder ``MODE_AUTOMATIC``."""
    return isinstance(value, str) and bool(re.fullmatch(r"[A-Z][A-Z0-9_]+", value))


def zustand_zu_text(value: Any) -> Any:
    """Aufzählungswert ins Deutsche übersetzen; andere Werte unverändert zurückgeben."""
    if not ist_zustand(value):
        return value
    if value in ZUSTAENDE:
        return ZUSTAENDE[value]
    kern = value
    for prefix in _PRAEFIXE:
        if kern.startswith(prefix):
            kern = kern[len(prefix):]
            break
    if kern in ZUSTAENDE:
        return ZUSTAENDE[kern]
    return schluessel_zu_name(kern.lower())


# ---------------------------------------------------------------- Einheiten

def einheit_fuer(key: str, api_unit: Any = None) -> str | None:
    """Einheit aus der API übernehmen oder aus dem Schlüssel ableiten."""
    if isinstance(api_unit, str) and api_unit.strip():
        unit = api_unit.strip()
        return {"°c": "°C", "c": "°C", "grad": "°C", "prozent": "%"}.get(unit.lower(), unit)
    k = key.lower()
    feste = {
        "air_humidity": "%", "cloud_percent": "%", "air_pressure": "hPa", "wind_degree": "°",
        "wind_speed": "m/s", "precip_amount": "mm", "flow_rate": "l/min",
        "max_requirement": "°C", "steepness": None,
    }
    if k in feste:
        return feste[k]
    if "temperature" in k or k.endswith("_temp") or "deactivation_limit" in k:
        return "°C"
    if k in ("efficiency", "buffer_charge", "boiler_charge", "mixer_position") or k.endswith(
        ("_percent", "_charge", "_position", "oxygen")
    ):
        return "%"
    if k == "fuel_stock" or k.endswith("_kg"):
        return "kg"
    if "pressure" in k:
        return "bar"
    if k.endswith("_hours") or k == "operating_hours":
        return "h"
    return None


def ist_zahl(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return True
    if isinstance(value, str):
        try:
            float(value.replace(",", "."))
            return True
        except ValueError:
            return False
    return False


def als_zahl(value: Any) -> float | int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return value
    try:
        f = float(str(value).replace(",", "."))
    except ValueError:
        return None
    return int(f) if f.is_integer() and "." not in str(value) else f


def ist_wahrheitswert(value: Any) -> bool:
    return isinstance(value, bool)
