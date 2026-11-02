"""Konstanten der Hargassner-Integration."""

DOMAIN = "hargassner_touch_pro"

# API
API_BASE_URL = "https://web.hargassner.at/api"
API_LOGIN = "/auth/login"
API_LOGOUT = "/auth/logout"
API_REFRESH = "/auth/refresh"
API_INSTALLATIONS = "/installations"
API_WIDGETS = "/widgets"
API_DEVICES = "/devices"
API_METRIC_FIELDS = "/metric-fields"
API_MEASUREMENTS = "/measurements"

# Sprache der API-Antworten (Kanalnamen, Texte)
API_LANGUAGE = "de-CH,de;q=0.9"

# OAuth (aus dem JS-Bundle der App)
CLIENT_ID = 2
CLIENT_SECRET = "F6ye9z5oLaqW6IkGtihTzBpdFM7EAnYdc1Kwoydl"
APP_BRANDING = "BRANDING_HARGASSNER"

# Konfigurationsschlüssel
CONF_INSTALLATION_ID = "installation_id"
CONF_INSTALLATION_NAME = "installation_name"
CONF_SCAN_INTERVAL = "scan_interval"
CONF_METRICS = "metrics"
CONF_WRITABLE = "writable"

# Standardwerte
DEFAULT_SCAN_INTERVAL = 60
MIN_SCAN_INTERVAL = 30
MAX_SCAN_INTERVAL = 600
DEFAULT_METRICS = True
DEFAULT_WRITABLE = True

# Messkanäle: Zeitfenster für den letzten Messwert und Neuladen der Kanalliste
METRICS_WINDOW_MINUTES = 120
METRIC_FIELDS_REFRESH_HOURS = 24

# Dienste
SERVICE_START_IGNITION = "start_ignition"
SERVICE_SET_PARAMETER = "set_parameter"
