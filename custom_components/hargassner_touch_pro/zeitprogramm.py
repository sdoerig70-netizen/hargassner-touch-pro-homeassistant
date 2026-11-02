"""Wochenuhr (Zeitprogramm) prüfen und für die Cloud aufbereiten."""
from __future__ import annotations

import re
from typing import Any

TAGE_CODES = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")
_ZEIT = re.compile(r"^T(\d{2}):(\d{2})(?:P1D|PT(?:(\d+)H)?(?:(\d+)M)?)$")


def zeitfenster_gueltig(text: str) -> bool:
    """«T06:00PT2H30M» oder «T00:00P1D»: Start im Raster, Dauer > 0, Ende spätestens 24:00."""
    m = _ZEIT.match(str(text))
    if not m:
        return False
    stunde, minute = int(m.group(1)), int(m.group(2))
    if stunde > 23 or minute > 59:
        return False
    if text.endswith("P1D"):
        return stunde == 0 and minute == 0
    dauer = int(m.group(3) or 0) * 60 + int(m.group(4) or 0)
    return 0 < dauer and stunde * 60 + minute + dauer <= 24 * 60


def eintraege_pruefen(eintraege: Any, limit: int = 7, max_zeiten: int = 2) -> list[dict]:
    """Einträge prüfen, leere entfernen. Wirft ValueError mit verständlicher Meldung."""
    if not isinstance(eintraege, list):
        raise ValueError("«eintraege» muss eine Liste sein")
    sauber: list[dict] = []
    for nr, eintrag in enumerate(eintraege, start=1):
        if not isinstance(eintrag, dict):
            raise ValueError(f"Eintrag {nr} ist kein Objekt mit «days» und «times»")
        tage = [str(t).upper() for t in eintrag.get("days") or []]
        zeiten = [str(z) for z in eintrag.get("times") or []]
        if not tage and not zeiten:
            continue
        falsch = [t for t in tage if t not in TAGE_CODES]
        if falsch:
            raise ValueError(f"Eintrag {nr}: unbekannte Tage {', '.join(falsch)}")
        if not tage:
            raise ValueError(f"Eintrag {nr}: mindestens ein Tag nötig")
        if not zeiten:
            raise ValueError(f"Eintrag {nr}: mindestens ein Zeitfenster nötig")
        if len(zeiten) > max_zeiten:
            raise ValueError(f"Eintrag {nr}: höchstens {max_zeiten} Zeitfenster")
        for z in zeiten:
            if not zeitfenster_gueltig(z):
                raise ValueError(f"Eintrag {nr}: Zeitfenster «{z}» ist ungültig")
        tage = [t for t in TAGE_CODES if t in tage]
        sauber.append({"days": tage, "times": sorted(zeiten)})
    if len(sauber) > limit:
        raise ValueError(f"Höchstens {limit} Einträge möglich")
    return sauber


def geraet_pfad(param: dict) -> str | None:
    """Aus «devices/99/parameters/3a/chatbot/query» den Geräteparameter ableiten."""
    m = re.match(r"^/?(devices/[^/]+/parameters/[^/]+)", str(param.get("chatbot") or ""))
    return "/" + m.group(1) if m else None
