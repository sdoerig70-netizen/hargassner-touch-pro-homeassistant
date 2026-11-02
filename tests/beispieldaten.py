"""Beispielantworten der Hargassner-API (nachgebaut, keine echten Anlagendaten)."""

INSTALLATION = {
    "id": 4711, "name": "Musteranlage",
    "devices": [{"id": 99, "name": "ECO-HK 35", "software": {"version_code": "V14.0n"}}],
}

WIDGETS = [
    {
        "widget": "HEATER", "number": None,
        "values": {
            "name": "HEATER", "state": "STATE_EFFICIENCY_FIRE",
            "heater_temperature_current": 78.5, "heater_temperature_target": 80,
            "smoke_temperature": 142.0, "outdoor_temperature": 6.5,
            "outdoor_temperature_average": 7.1, "efficiency": 63, "fuel_stock": "1200",
            "heater_exhaust_guard": False, "return_temperature_current": 61.2,
        },
        "parameters": {
            "program": {"value": "PROGRAM_AUTOMATIC", "resource": "/installations/4711/heater/program",
                         "options": ["PROGRAM_OFF", "PROGRAM_AUTOMATIC", "PROGRAM_BOILER", "PROGRAM_CHIMNEY_SWEEPER"]},
            "fuel_stock": {"value": 1200, "resource": "/installations/4711/heater/fuel-stock", "min": 0, "max": 30000, "step": 1},
            "heater_temperature_target": {"value": 80, "resource": "/installations/4711/heater/target", "min": 60, "max": 90},
            "serial_info": {"value": "ECO-HK-35"},
        },
        "actions": {"start_ignition": {"resource": "/installations/4711/heater/ignition"}},
    },
    {
        "widget": "HEATING_CIRCUIT_FLOOR", "number": 1,
        "values": {
            "name": "Erdgeschoss", "state": "STATE_HEATING", "pump_active": True,
            "flow_temperature_current": 34.2, "flow_temperature_target": 35,
            "room_temperature_current": 21.3, "room_temperature_target": 21.5,
        },
        "parameters": {
            "mode": {"value": "MODE_AUTOMATIC", "resource": "/installations/4711/hc/1/mode",
                      "options": ["MODE_OFF", "MODE_AUTOMATIC", "MODE_HEATING", "MODE_REDUCTION",
                                  "MODE_BRIDGE_HEATING", "MODE_BRIDGE_REDUCTION"]},
            "room_temperature_heating": {"value": 21.5, "resource": "/installations/4711/hc/1/rth", "min": 14, "max": 26, "step": 0.5},
            "room_temperature_reduction": {"value": 18, "resource": "/installations/4711/hc/1/rtr", "min": 8, "max": 24, "step": 0.5},
            "steepness": {"value": 0.6, "resource": "/installations/4711/hc/1/steep", "min": 0.2, "max": 3.5, "step": 0.05},
            "deactivation_limit_heating": {"value": 18, "resource": "/installations/4711/hc/1/dlh"},
            "weather_mode": {"value": True, "resource": "/installations/4711/hc/1/weather"},
            "holiday_end_date": {"value": "2027-02-06", "resource": "/installations/4711/hc/1/holiday-end"},
        },
        "actions": {},
    },
    {
        "widget": "BUFFER", "number": None,
        "values": {"name": "BUFFER", "state": "STATE_CHARGING", "buffer_temperature_top": 76,
                   "buffer_temperature_center": 55, "buffer_temperature_bottom": 38,
                   "buffer_charge": 61, "pump_active": True},
        "parameters": {},
    },
    {
        "widget": "BOILER", "number": 1,
        "values": {"name": "BOILER", "state": "STATE_OFF", "boiler_temperature_current": 52.1,
                   "boiler_temperature_target": 55, "circulation_pump_active": False},
        "parameters": {
            "boiler_temperature_target": {"value": 55, "resource": "/installations/4711/boiler/1/target", "min": 20, "max": 75},
            "one_time_circulation": {"value": False, "resource": "/installations/4711/boiler/1/circ"},
            "mode": {"value": "MODE_AUTOMATIC", "resource": "/installations/4711/boiler/1/mode",
                      "options": [{"value": "MODE_OFF", "text": "Aus"}, {"value": "MODE_AUTOMATIC", "text": "Automatik"}]},
        },
    },
    {
        "widget": "FRESH_WATER_STATION", "number": 1,
        "values": {"name": "FRESH_WATER_STATION", "secondary_flow_temperature_current": 48.3,
                   "primary_return_temperature_current": 31.0, "flow_rate": 7.5, "mixer_valve_speed": 40},
        "parameters": {},
    },
]

METRIC_FIELDS = [
    {"text": "Kessel", "fields": [
        {"id": 1, "text": "Kesseltemperatur", "unit": "°C"},
        {"id": 2, "text": "Restsauerstoff", "unit": "%"},
        {"id": 3, "text": "Saugzug", "unit": "%"},
    ]},
    {"text": "Heizkreis 1", "fields": [{"id": 20, "text": "Mischer", "unit": "%"}]},
]

MEASUREMENTS = {"99": {"1": 78.4, "2": 9.1, "3": 55, "20": 37}}
