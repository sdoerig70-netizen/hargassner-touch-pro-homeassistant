"""Auswertung der API-Antworten ohne Netzwerk."""
from unittest.mock import AsyncMock

from custom_components.hargassner_touch_pro.api import HargassnerApi


async def test_messkanaele_und_letzter_wert() -> None:
    api = HargassnerApi(session=None)
    api._request = AsyncMock(return_value={"data": [
        {"text": "Kessel", "fields": [{"id": 1, "text": "Kesseltemperatur", "unit": "°C"}, {"text": "ohne id"}]},
        {"type": "HC", "fields": [{"id": "20", "legend": "Mischer", "unit": "%"}]},
    ]})
    kanaele = await api.get_metric_fields("99")
    assert [(k["id"], k["group"]) for k in kanaele] == [(1, "Kessel"), ("20", "HC")]

    api._request = AsyncMock(return_value={"data": [
        {"time": "2026-11-01T10:10:00Z", "values": {"1": 80.0, "20": None}},
        {"time": "2026-11-01T10:00:00Z", "values": {"1": 70.0, "20": 30}},
    ]})
    werte = await api.get_latest_measurements("99", ["1", "20"], 120)
    assert werte == {"1": 80.0, "20": 30}
    params = api._request.call_args.kwargs["params"]
    assert params["channels"] == "1;20"
