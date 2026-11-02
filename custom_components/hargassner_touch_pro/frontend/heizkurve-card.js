/*
 * Heizkurven-Karte für die Integration «Hargassner Touch Pro».
 *
 * Zeigt pro Heizkreis die Heizkurve (Vorlauf-Soll über Aussentemperatur),
 * den aktuellen Arbeitspunkt, den Einfluss der Witterungsführung (A5b
 * Aus/ECO/ECO+) und die echten Sollwerte der letzten Tage. Steilheit und
 * Tagestemperatur lassen sich als Entwurf verschieben und dann übernehmen.
 *
 * Modell: Vorlauf = Raumsoll + Steilheit × (Raumsoll − Aussentemperatur).
 * ECO regelt laut Anleitung auf die gemittelte Aussentemperatur inklusive
 * 3 h Vorhersage, ECO+ inklusive 6 h Vorhersage.
 */

const XMIN = -20, XMAX = 20;
const FARBEN = ["#4fa3e0", "#f0a030", "#43a047", "#e5739b"];

const zahl = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const runden = (v, s = 1) => (v === null || v === undefined ? "–" : v.toFixed(s).replace(".", ","));

function vorlauf(raum, steil, aussen) {
  if (raum === null || steil === null || aussen === null) return null;
  return Math.max(raum, raum + steil * (raum - aussen));
}

class HargassnerHeizkurveCard extends HTMLElement {
  setConfig(config) {
    if (!config || !Array.isArray(config.heizkreise) || !config.heizkreise.length) {
      throw new Error("Bitte mindestens einen Eintrag unter «heizkreise» angeben.");
    }
    if (!config.aussen) throw new Error("Bitte «aussen» (gemittelte Aussentemperatur) angeben.");
    this._config = config;
    this._entwurf = {};
    this._verlauf = null;
    this._verlaufZeit = 0;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    if (this._aktiv) return; // während Schieberegler bewegt werden nicht neu zeichnen
    const jetzt = Date.now();
    if (jetzt - this._verlaufZeit > 10 * 60 * 1000) {
      this._verlaufZeit = jetzt;
      this._ladeVerlauf();
    }
    if (!this._letzte || jetzt - this._letzte > 2000) {
      this._letzte = jetzt;
      this._zeichne();
    }
  }

  getCardSize() {
    return 9;
  }

  connectedCallback() {
    // In der echten Breite zeichnen, damit Linien und Schrift nicht mitskaliert werden
    this._beobachter = new ResizeObserver(() => {
      const b = Math.round(this.getBoundingClientRect().width - 32);
      if (b > 200 && Math.abs(b - (this._breite || 0)) > 8) {
        this._breite = b;
        this._teilZeichnen();
      }
    });
    this._beobachter.observe(this);
  }

  disconnectedCallback() {
    this._beobachter?.disconnect();
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  // ------------------------------------------------------------------ Daten

  _wert(id) {
    if (!id || !this._hass) return null;
    const st = this._hass.states[id];
    return st ? zahl(st.state) : null;
  }

  _zustand(id) {
    const st = id && this._hass ? this._hass.states[id] : null;
    return st ? st.state : null;
  }

  _prognose(stunden) {
    const st = this._config.prognose && this._hass.states[this._config.prognose];
    const liste = (st && st.attributes && st.attributes.stuendlich) || [];
    const jetzt = Date.now();
    const werte = [];
    let naechster = null;
    for (const e of liste) {
      const t = Date.parse(e.zeit);
      const temp = zahl(e.temperatur);
      if (!Number.isFinite(t) || temp === null || t <= jetzt) continue;
      if (naechster === null) naechster = temp;
      if (t <= jetzt + stunden * 3600 * 1000) werte.push(temp);
    }
    if (!werte.length && naechster !== null) werte.push(naechster);
    return werte;
  }

  _aussenFuer(modus, aussenGem) {
    if (aussenGem === null) return null;
    const m = (modus || "").toLowerCase();
    if (!m.startsWith("eco")) return aussenGem;
    const progn = this._prognose(m.includes("+") ? 6 : 3);
    if (!progn.length) return aussenGem;
    const alle = [aussenGem, ...progn];
    return alle.reduce((a, b) => a + b, 0) / alle.length;
  }

  _hk(i) {
    const k = this._config.heizkreise[i];
    const e = this._entwurf[i] || {};
    const steil = this._wert(k.steilheit);
    const tag = this._wert(k.tagestemperatur);
    return {
      k,
      farbe: k.farbe || FARBEN[i % FARBEN.length],
      name: k.name || `Heizkreis ${i + 1}`,
      steil,
      tag,
      absenk: this._wert(k.absenktemperatur),
      steilNeu: e.steil ?? steil,
      tagNeu: e.tag ?? tag,
      modus: this._zustand(k.witterung),
      soll: this._wert(k.vorlauf_soll),
      ist: this._wert(k.vorlauf_ist),
      geaendert: (e.steil !== undefined && e.steil !== steil) || (e.tag !== undefined && e.tag !== tag),
    };
  }

  async _ladeVerlauf() {
    const ids = [this._config.aussen, ...this._config.heizkreise.map((k) => k.vorlauf_soll)].filter(Boolean);
    try {
      const start = new Date(Date.now() - (this._config.tage || 7) * 86400e3).toISOString();
      const h = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start,
        entity_ids: [...new Set(ids)],
        minimal_response: true,
        no_attributes: true,
      });
      const reihe = (id) =>
        (h[id] || [])
          .map((x) => [((x.lu ?? x.lc) || 0) * 1000, zahl(x.s)])
          .filter((x) => x[1] !== null)
          .sort((a, b) => a[0] - b[0]);
      const aussen = reihe(this._config.aussen);
      const punkte = {};
      this._config.heizkreise.forEach((k, i) => {
        const soll = reihe(k.vorlauf_soll);
        const p = [];
        let j = 0;
        for (const [t, v] of soll) {
          while (j + 1 < aussen.length && aussen[j + 1][0] <= t) j++;
          if (aussen.length && aussen[j][0] <= t) p.push([aussen[j][1], v]);
        }
        punkte[i] = p.slice(-400);
      });
      this._verlauf = punkte;
      this._zeichne();
    } catch (err) {
      this._verlauf = {};
    }
  }

  // ------------------------------------------------------------------ Aktionen

  async _uebernehmen(i) {
    const h = this._hk(i);
    const aufrufe = [];
    if (h.steilNeu !== h.steil && h.k.steilheit)
      aufrufe.push(this._hass.callService("number", "set_value", { entity_id: h.k.steilheit, value: h.steilNeu }));
    if (h.tagNeu !== h.tag && h.k.tagestemperatur)
      aufrufe.push(this._hass.callService("number", "set_value", { entity_id: h.k.tagestemperatur, value: h.tagNeu }));
    await Promise.all(aufrufe);
    delete this._entwurf[i];
    this._zeichne();
  }

  _modusSetzen(i, option) {
    const k = this._config.heizkreise[i];
    if (k.witterung) this._hass.callService("select", "select_option", { entity_id: k.witterung, option });
  }

  // ------------------------------------------------------------------ Zeichnen

  _svg(hks, aussenGem, aussenAkt) {
    const W = this._breite || 640, H = Math.round(Math.min(460, Math.max(300, W * 0.4))), L = 46, R = 14, T = 14, B = 36;
    let ymax = 60;
    for (const h of hks) {
      for (const [r, s] of [[h.tag, h.steil], [h.tagNeu, h.steilNeu]]) {
        const v = vorlauf(r, s, XMIN);
        if (v !== null) ymax = Math.max(ymax, v);
      }
      if (h.soll !== null) ymax = Math.max(ymax, h.soll);
    }
    ymax = Math.min(120, Math.ceil((ymax + 2) / 10) * 10);
    const YMIN = 15;
    const x = (t) => L + ((t - XMIN) / (XMAX - XMIN)) * (W - L - R);
    const y = (v) => T + (1 - (v - YMIN) / (ymax - YMIN)) * (H - T - B);
    const linie = (raum, steil) => {
      const p = [];
      for (let t = XMIN; t <= XMAX; t += 1) {
        const v = vorlauf(raum, steil, t);
        if (v !== null) p.push(`${x(t).toFixed(1)},${y(Math.min(v, ymax)).toFixed(1)}`);
      }
      return p.join(" ");
    };
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Heizkurve">`;
    // Abschaltgrenzen
    const grenze = this._wert(this._config.abschaltgrenze);
    if (grenze !== null && grenze < XMAX) {
      s += `<rect x="${x(grenze)}" y="${T}" width="${x(XMAX) - x(grenze)}" height="${H - T - B}" class="aus"/>`;
      s += `<text x="${(x(grenze) + x(XMAX)) / 2}" y="${T + 14}" class="klein mitte">Heizung aus</text>`;
      s += `<text x="${(x(grenze) + x(XMAX)) / 2}" y="${T + 28}" class="klein mitte">ab ${runden(grenze, 0)} °C</text>`;
    }
    // Raster
    for (let t = XMIN; t <= XMAX; t += 5) {
      s += `<line x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - B}" class="raster"/>`;
      s += `<text x="${x(t)}" y="${H - B + 16}" class="achse mitte">${t}</text>`;
    }
    for (let v = 20; v <= ymax; v += 10) {
      s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="raster"/>`;
      s += `<text x="${L - 6}" y="${y(v) + 4}" class="achse rechts">${v}</text>`;
    }
    s += `<text x="${(L + W - R) / 2}" y="${H - 4}" class="achse mitte">Aussentemperatur °C</text>`;
    s += `<text x="12" y="${(T + H - B) / 2}" class="achse mitte" transform="rotate(-90 12 ${(T + H - B) / 2})">Vorlauf °C</text>`;
    // Vergleichskurven
    for (const st of [0.5, 1, 1.5, 2, 2.5, 3]) {
      s += `<polyline points="${linie(20, st)}" class="referenz"/>`;
      const v = vorlauf(20, st, XMIN);
      if (v <= ymax) s += `<text x="${x(XMIN) + 3}" y="${y(v) - 3}" class="referenztext">${String(st).replace(".", ",")}</text>`;
    }
    // Verlaufspunkte
    if (this._verlauf && this._config.punkte !== false) {
      hks.forEach((h, i) => {
        for (const [t, v] of this._verlauf[i] || []) {
          if (t >= XMIN && t <= XMAX && v >= YMIN && v <= ymax)
            s += `<circle cx="${x(t)}" cy="${y(v)}" r="1.6" fill="${h.farbe}" class="punkt"/>`;
        }
      });
    }
    // Kurven
    hks.forEach((h) => {
      if (h.absenk !== null && h.steil !== null)
        s += `<polyline points="${linie(h.absenk, h.steil)}" stroke="${h.farbe}" class="absenk"/>`;
      if (h.tag !== null && h.steil !== null)
        s += `<polyline points="${linie(h.tag, h.steil)}" stroke="${h.farbe}" class="tag"/>`;
      if (h.geaendert) s += `<polyline points="${linie(h.tagNeu, h.steilNeu)}" stroke="${h.farbe}" class="entwurf"/>`;
    });
    // Arbeitspunkte
    hks.forEach((h) => {
      if (aussenGem === null || h.tag === null) return;
      const raum = h.geaendert ? h.tagNeu : h.tag;
      const steil = h.geaendert ? h.steilNeu : h.steil;
      const tEff = this._aussenFuer(h.modus, aussenGem);
      const v0 = vorlauf(raum, steil, aussenGem);
      const v1 = vorlauf(raum, steil, tEff);
      s += `<circle cx="${x(aussenGem)}" cy="${y(v0)}" r="4.5" class="offen" stroke="${h.farbe}"/>`;
      if (Math.abs(tEff - aussenGem) > 0.05) {
        s += `<line x1="${x(aussenGem)}" y1="${y(v0)}" x2="${x(tEff)}" y2="${y(v1)}" stroke="${h.farbe}" class="pfeil" marker-end="url(#spitze)"/>`;
      }
      s += `<circle cx="${x(tEff)}" cy="${y(v1)}" r="4.5" fill="${h.farbe}" class="voll"/>`;
      if (h.soll !== null) {
        const cx = x(tEff), cy = y(h.soll);
        s += `<path d="M${cx} ${cy - 7} L${cx + 7} ${cy} L${cx} ${cy + 7} L${cx - 7} ${cy} Z" class="soll" stroke="${h.farbe}"/>`;
      }
    });
    if (aussenAkt !== null && aussenAkt >= XMIN && aussenAkt <= XMAX) {
      s += `<line x1="${x(aussenAkt)}" x2="${x(aussenAkt)}" y1="${T}" y2="${H - B}" class="jetzt"/>`;
    }
    s += `<defs><marker id="spitze" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`;
    s += `</svg>`;
    return s;
  }

  _zeichne() {
    if (!this._config || !this._hass || !this.shadowRoot) return;
    const hks = this._config.heizkreise.map((_, i) => this._hk(i));
    const aussenGem = this._wert(this._config.aussen);
    const aussenAkt = this._wert(this._config.aussen_aktuell);
    const progn3 = this._prognose(3), progn6 = this._prognose(6);
    const mittel = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

    let zeilen = "";
    hks.forEach((h, i) => {
      const raum = h.geaendert ? h.tagNeu : h.tag;
      const steil = h.geaendert ? h.steilNeu : h.steil;
      const t0 = aussenGem, t3 = this._aussenFuer("eco", aussenGem), t6 = this._aussenFuer("eco+", aussenGem);
      const m = (h.modus || "").toLowerCase();
      const aktiv = (n) => (n === "aus" ? !m.startsWith("eco") : n === "eco" ? m === "eco" : m === "eco+") ? "aktiv" : "";
      const stAttr = this._hass.states[h.k.steilheit]?.attributes || {};
      const tagAttr = this._hass.states[h.k.tagestemperatur]?.attributes || {};
      const optionen = this._hass.states[h.k.witterung]?.attributes?.options || [];
      zeilen += `
        <div class="hk" style="--farbe:${h.farbe}">
          <div class="kopf"><span class="farbe"></span><b>${h.name}</b>
            ${h.soll !== null ? `<span class="rechts">Soll jetzt <b>${runden(h.soll)} °C</b>${h.ist !== null ? ` · Ist ${runden(h.ist)} °C` : ""}</span>` : ""}
          </div>
          <div class="werte">
            <div class="${aktiv("aus")}"><small>Witterung aus</small><b>${runden(vorlauf(raum, steil, t0))} °C</b><small>bei ${runden(t0)} °C</small></div>
            <div class="${aktiv("eco")}"><small>ECO (3 h)</small><b>${runden(vorlauf(raum, steil, t3))} °C</b><small>bei ${runden(t3)} °C</small></div>
            <div class="${aktiv("eco+")}"><small>ECO+ (6 h)</small><b>${runden(vorlauf(raum, steil, t6))} °C</b><small>bei ${runden(t6)} °C</small></div>
          </div>
          <label class="regler">Steilheit <b>${runden(steil, 2)}</b>${h.geaendert && h.steilNeu !== h.steil ? ` <small>(bisher ${runden(h.steil, 2)})</small>` : ""}
            <input type="range" data-i="${i}" data-feld="steil" min="${stAttr.min ?? 0.2}" max="${stAttr.max ?? 3.5}" step="${stAttr.step ?? 0.05}" value="${steil ?? 1}">
          </label>
          <label class="regler">Tages-Raumtemperatur <b>${runden(raum)} °C</b>${h.geaendert && h.tagNeu !== h.tag ? ` <small>(bisher ${runden(h.tag)} °C)</small>` : ""}
            <input type="range" data-i="${i}" data-feld="tag" min="${tagAttr.min ?? 14}" max="${tagAttr.max ?? 26}" step="${tagAttr.step ?? 0.5}" value="${raum ?? 20}">
          </label>
          <div class="knoepfe">
            ${optionen.length ? `<label>Witterungsführung <select data-i="${i}" class="modus">${optionen.map((o) => `<option ${o === h.modus ? "selected" : ""}>${o}</option>`).join("")}</select></label>` : ""}
            ${h.geaendert ? `<button data-i="${i}" class="zurueck">Verwerfen</button><button data-i="${i}" class="ok">Übernehmen</button>` : ""}
          </div>
        </div>`;
    });

    const prognoseText = progn3.length
      ? `Vorhersage: ${progn6.map((t) => runden(t) + " °C").join(", ")} · ECO rechnet mit ${runden(this._aussenFuer("eco", aussenGem))} °C, ECO+ mit ${runden(this._aussenFuer("eco+", aussenGem))} °C`
      : "Keine Vorhersage verfügbar";

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        ha-card { padding:16px; }
        h2 { margin:0 0 4px; font-size:1.2em; font-weight:500; }
        .info { color:var(--secondary-text-color); font-size:.85em; margin-bottom:8px; }
        svg { width:100%; height:auto; display:block; color:var(--primary-text-color); }
        .raster { stroke:var(--divider-color); stroke-width:1; }
        .achse { fill:var(--secondary-text-color); font-size:12px; }
        .mitte { text-anchor:middle; } .rechts { text-anchor:end; }
        .klein { fill:var(--secondary-text-color); font-size:11px; }
        .aus { fill:var(--secondary-text-color); opacity:.08; }
        .referenz { fill:none; stroke:var(--secondary-text-color); stroke-width:1; opacity:.25; }
        .referenztext { fill:var(--secondary-text-color); font-size:10px; opacity:.7; }
        .tag { fill:none; stroke-width:2; }
        .absenk { fill:none; stroke-width:1.5; stroke-dasharray:6 4; opacity:.8; }
        .entwurf { fill:none; stroke-width:2; stroke-dasharray:3 3; opacity:.9; }
        .punkt { opacity:.25; }
        .offen { fill:var(--card-background-color); stroke-width:2; }
        .voll { stroke:var(--card-background-color); stroke-width:1.5; }
        .soll { fill:var(--primary-text-color); stroke-width:2; }
        .pfeil { stroke-width:1.5; }
        .jetzt { stroke:var(--primary-text-color); stroke-dasharray:2 3; opacity:.5; }
        .legende { display:flex; flex-wrap:wrap; gap:4px 14px; font-size:.8em; color:var(--secondary-text-color); margin:6px 0 10px; }
        .legende span { display:inline-flex; align-items:center; gap:5px; }
        .sym { display:inline-block; width:18px; height:0; border-top:3px solid var(--primary-text-color); }
        .sym.gestr { border-top:2px dashed var(--primary-text-color); }
        .sym.punktiert { border-top:3px dotted var(--primary-text-color); }
        .rund { width:9px; height:9px; border-radius:50%; background:var(--primary-text-color); border:none; }
        .ring { width:7px; height:7px; border-radius:50%; border:2px solid var(--primary-text-color); }
        .raute { width:8px; height:8px; background:var(--primary-text-color); transform:rotate(45deg); border:none; }
        .hks { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; }
        .hk { border:1px solid var(--divider-color); border-left:4px solid var(--farbe); border-radius:8px; padding:10px 12px; }
        .kopf { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .kopf .rechts { margin-left:auto; font-size:.85em; color:var(--secondary-text-color); }
        .farbe { width:10px; height:10px; border-radius:50%; background:var(--farbe); }
        .werte { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin:10px 0; }
        .werte div { display:flex; flex-direction:column; align-items:center; padding:6px 4px; border-radius:6px; background:var(--secondary-background-color); opacity:.75; }
        .werte div.aktiv { opacity:1; outline:2px solid var(--farbe); }
        .werte small { font-size:.75em; color:var(--secondary-text-color); }
        .regler { display:block; font-size:.9em; margin-top:6px; }
        .regler input { width:100%; accent-color:var(--farbe); }
        .knoepfe { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:8px; font-size:.9em; }
        .knoepfe select { margin-left:6px; padding:4px; background:var(--card-background-color); color:var(--primary-text-color); border:1px solid var(--divider-color); border-radius:4px; }
        button { border:none; border-radius:6px; padding:6px 12px; cursor:pointer; font:inherit; }
        button.ok { background:var(--farbe); color:#fff; margin-left:auto; }
        button.zurueck { background:var(--secondary-background-color); color:var(--primary-text-color); }
        .hinweis { font-size:.75em; color:var(--secondary-text-color); margin-top:10px; line-height:1.4; }
      </style>
      <ha-card>
        <h2>${this._config.titel || "Heizkurve"}</h2>
        <div class="info">Aussen gemittelt ${runden(aussenGem)} °C${aussenAkt !== null ? ` · aktuell ${runden(aussenAkt)} °C` : ""} · ${prognoseText}</div>
        ${this._svg(hks, aussenGem, aussenAkt)}
        <div class="legende">
          <span><i class="sym"></i>Tageskurve</span>
          <span><i class="sym gestr"></i>Absenkkurve</span>
          <span><i class="sym punktiert"></i>Entwurf</span>
          <span><i class="sym ring"></i>ohne Wetter</span>
          <span><i class="sym rund"></i>mit Witterungsführung</span>
          <span><i class="sym raute"></i>Sollwert der Anlage</span>
          ${this._config.punkte !== false ? `<span>Punkte: Vorlauf-Sollwert der letzten ${this._config.tage || 7} Tage, eingetragen bei der damaligen Aussentemperatur</span>` : ""}
        </div>
        <div class="hks">${zeilen}</div>
        <div class="hinweis">Modell: Vorlauf = Raumsoll + Steilheit × (Raumsoll − Aussentemperatur), graue Linien zeigen die Steilheiten 0,5–3 bei 20 °C.
        ECO regelt auf die gemittelte Aussentemperatur inklusive 3 h Vorhersage, ECO+ inklusive 6 h. Weicht die Raute vom gefüllten Punkt ab,
        wirken weitere Einflüsse (z. B. gemeinsamer Vorlauf ohne Mischer, Mindest- oder Maximaltemperatur A3/A4).</div>
      </ha-card>`;

    this.shadowRoot.querySelectorAll("input[type=range]").forEach((el) => {
      el.addEventListener("pointerdown", () => (this._aktiv = true));
      el.addEventListener("input", (ev) => {
        const i = Number(ev.target.dataset.i);
        const feld = ev.target.dataset.feld;
        this._entwurf[i] = { ...(this._entwurf[i] || {}), [feld]: zahl(ev.target.value) };
        this._aktiv = true;
        const anzeige = ev.target.parentElement.querySelector("b");
        if (anzeige) anzeige.textContent = feld === "steil" ? runden(zahl(ev.target.value), 2) : `${runden(zahl(ev.target.value))} °C`;
        this._teilZeichnen(i);
      });
      el.addEventListener("change", () => {
        this._aktiv = false;
        this._zeichne();
      });
    });
    this.shadowRoot.querySelectorAll("button.ok").forEach((b) =>
      b.addEventListener("click", () => this._uebernehmen(Number(b.dataset.i)))
    );
    this.shadowRoot.querySelectorAll("button.zurueck").forEach((b) =>
      b.addEventListener("click", () => {
        delete this._entwurf[Number(b.dataset.i)];
        this._zeichne();
      })
    );
    this.shadowRoot.querySelectorAll("select.modus").forEach((s) =>
      s.addEventListener("change", () => this._modusSetzen(Number(s.dataset.i), s.value))
    );
  }

  _teilZeichnen() {
    // Nur das Diagramm neu zeichnen, damit der Schieberegler nicht den Fokus verliert
    const hks = this._config.heizkreise.map((_, i) => this._hk(i));
    const alt = this.shadowRoot.querySelector("svg");
    if (!alt) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = this._svg(hks, this._wert(this._config.aussen), this._wert(this._config.aussen_aktuell));
    alt.replaceWith(tmp.firstElementChild);
  }

  static getStubConfig() {
    return { heizkreise: [{ name: "Heizkreis 1" }], aussen: "" };
  }
}

// Die Integration lädt die Karte sehr früh. Ersetzt das Frontend danach
// seine Element-Registry, geht die Definition verloren. Darum wird sie in
// den ersten 30 Sekunden bei Bedarf erneut angemeldet.
const KARTE = "hargassner-heizkurve-card";

function karteAnmelden() {
  if (customElements.get(KARTE)) return true;
  try {
    customElements.define(KARTE, class extends HargassnerHeizkurveCard {});
  } catch (e) {
    return false;
  }
  return true;
}

karteAnmelden();
window.customCards = window.customCards || [];
if (!window.customCards.some((k) => k.type === KARTE)) {
  window.customCards.push({
    type: KARTE,
    name: "Hargassner Heizkurve",
    description: "Heizkurve mit Arbeitspunkt, Witterungsführung und Entwurf für Steilheit und Raumtemperatur",
  });
}
let versuche = 0;
const pruefer = setInterval(() => {
  karteAnmelden();
  if (++versuche >= 60) clearInterval(pruefer);
}, 500);
