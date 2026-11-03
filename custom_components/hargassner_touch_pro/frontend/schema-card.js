/*
 * Hargassner Schema-Karte – die Heizung als einfaches 2D-Bild nach dem Prinzipschema,
 * mit Bedienung in Alltagssprache für Personen ohne technischen Hintergrund.
 *
 * Konfiguration: unter «anlage» dieselben Einträge wie bei der Anlagen-Karte
 * (kessel, puffer, heizkreise, frischwasser, heizkurve, signale), dazu optional
 * «ruecklauf», «ladepumpe», «lagerstand», «systemdruck». Namen der Häuser, Räume
 * usw. kommen nur aus dieser Konfiguration.
 */

const KARTE_SCHEMA = "hargassner-schema-card";

function esc(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function zahl(v) {
  if (v === null || v === undefined || v === "" || v === "unknown" || v === "unavailable") return null;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function komma(n, st = 1) {
  return n === null || n === undefined ? "–" : Number(n).toFixed(st).replace(".", ",");
}
// Temperatur → Farbe (kalt blau, lauwarm grün/gelb, heiss rot)
function tempFarbe(t) {
  if (t === null || t === undefined) return "#9aa3ad";
  const stops = [
    [10, [41, 97, 217]],
    [25, [51, 158, 242]],
    [40, [77, 199, 140]],
    [52, [250, 204, 51]],
    [65, [250, 128, 31]],
    [80, [224, 26, 26]],
  ];
  if (t <= stops[0][0]) return `rgb(${stops[0][1]})`;
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, a] = stops[i - 1];
      const [t1, b] = stops[i];
      const f = (t - t0) / (t1 - t0);
      return `rgb(${a.map((x, k) => Math.round(x + (b[k] - x) * f)).join(",")})`;
    }
  }
  return `rgb(${stops[stops.length - 1][1]})`;
}

// Betriebsarten der Heizkreise in Alltagssprache
const BETRIEBSART = {
  Automatik: { text: "Nach Zeitplan", hilfe: "Warm zu den eingestellten Zeiten, sonst etwas kühler.", icon: "mdi:calendar-clock" },
  Heizen: { text: "Immer warm", hilfe: "Heizt rund um die Uhr auf die Wohlfühltemperatur.", icon: "mdi:sun-thermometer" },
  Absenken: { text: "Sparbetrieb", hilfe: "Hält rund um die Uhr die tiefere Spartemperatur.", icon: "mdi:leaf" },
  Aus: { text: "Aus", hilfe: "Heizt nicht, nur Frostschutz.", icon: "mdi:power" },
  "Vorübergehend heizen": { text: "Jetzt warm", hilfe: "Warm bis zum nächsten Wechsel im Zeitplan, danach wieder nach Plan.", icon: "mdi:clock-plus-outline" },
  "Vorübergehend absenken": { text: "Jetzt sparen", hilfe: "Kühler bis zum nächsten Wechsel im Zeitplan, danach wieder nach Plan.", icon: "mdi:clock-minus-outline" },
};
const KESSELPROGRAMM = {
  Automatik: { text: "Normalbetrieb", hilfe: "Der Kessel heizt, wann immer die Häuser oder das Warmwasser Wärme brauchen." },
  "Nur Warmwasser": { text: "Nur Warmwasser", hilfe: "Sommerbetrieb: Der Kessel heizt nur noch für das Warmwasser, die Häuser bleiben kalt." },
  "Feuerung stoppen": { text: "Feuer ausgehen lassen", hilfe: "Das Feuer brennt kontrolliert aus. Danach heizt der Kessel nicht mehr, bis wieder «Normalbetrieb» gewählt wird." },
  Aus: { text: "Aus", hilfe: "Der Kessel ist ausgeschaltet. Häuser und Warmwasser werden nur noch aus dem Wärmespeicher versorgt, solange er warm ist." },
};

const STIL = `
:host { display:block; }
.karte { background:#f4f5f7; color:#22262b; font-family:"Helvetica Neue", Helvetica, Arial, sans-serif; padding:14px; box-sizing:border-box; min-height:100%; }
.kopf { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
.kopf h1 { margin:0; font-size:22px; font-weight:600; }
.kopf .aussen { display:flex; align-items:center; gap:6px; background:#fff; border-radius:20px; padding:6px 14px; box-shadow:0 1px 3px rgba(0,0,0,.12); font-size:15px; }
.kopf .rechts { margin-left:auto; display:flex; gap:8px; }
.knopf-klein { border:1px solid #cfd4da; background:#fff; border-radius:8px; padding:8px 12px; font:inherit; font-size:13px; cursor:pointer; color:#444; display:flex; gap:6px; align-items:center; }
.knopf-klein ha-icon { --mdc-icon-size:18px; }
.lage { border-radius:12px; padding:14px 18px; margin-bottom:14px; display:flex; gap:14px; align-items:center; font-size:17px; line-height:1.35; box-shadow:0 1px 3px rgba(0,0,0,.1); }
.lage ha-icon { --mdc-icon-size:34px; flex:none; }
.lage.gut { background:#e7f6ec; color:#1d5e33; }
.lage.info { background:#e8f1fc; color:#1d4a80; }
.lage.warn { background:#fff4dc; color:#7a5200; }
.lage.fehler { background:#fde7e7; color:#8c1d1d; }
.lage small { display:block; font-size:13.5px; opacity:.85; margin-top:2px; }
.bild { background:#fff; border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,.1); padding:6px; margin-bottom:14px; position:relative; }
.bild svg { width:100%; height:auto; display:block; }
.bild .rollen { overflow-x:auto; -webkit-overflow-scrolling:touch; }
.bildfuss { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:4px 8px 4px; font-size:12px; color:#8a9099; }
.vollbild { overflow:auto; background:#fff; font-family:"Helvetica Neue", Helvetica, Arial, sans-serif; color:#22262b; touch-action:pan-x pan-y pinch-zoom; }
.vollbild svg { width:1500px; max-width:none; height:auto; display:block; }
@media (max-width: 700px) {
  .bild .rollen svg { width:900px; max-width:none; }
}
.bild .hinweis { position:absolute; left:14px; bottom:10px; font-size:12px; color:#8a9099; }
[data-teil] { cursor:pointer; }
[data-teil]:hover .rahmen { stroke:#2b7bd6; stroke-width:3; }
.fluss { stroke-dasharray:10 14; animation:fliessen 1.1s linear infinite; }
@keyframes fliessen { to { stroke-dashoffset:-24; } }
.dreht { transform-box:fill-box; transform-origin:center; animation:drehen 1.2s linear infinite; }
.dreht.langsam { animation-duration:6s; }
@keyframes drehen { to { transform:rotate(360deg); } }
.flamme { transform-box:fill-box; transform-origin:50% 100%; animation:flackern .5s ease-in-out infinite alternate; }
@keyframes flackern { from { transform:scale(1, .92); } to { transform:scale(.94, 1.06); } }
.rauch { animation:steigen 3s linear infinite; opacity:0; }
@keyframes steigen { 0% { transform:translate(0, 0); opacity:.6; } 100% { transform:translate(10px, -40px); opacity:0; } }
.raster { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 330px), 1fr)); gap:14px; }
.feld { background:#fff; border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,.1); padding:16px 18px; display:flex; flex-direction:column; gap:12px; }
.feld h2 { margin:0; font-size:19px; display:flex; align-items:center; gap:8px; }
.feld h2 ha-icon { --mdc-icon-size:24px; color:#5b6470; }
.feld h2 .zustand { margin-left:auto; font-size:13px; font-weight:600; padding:4px 10px; border-radius:12px; background:#eef0f3; color:#555; }
.feld h2 .zustand.an { background:#e7f6ec; color:#1d5e33; }
.gross { display:flex; align-items:baseline; gap:8px; }
.gross b { font-size:34px; font-weight:600; }
.gross span { color:#6b7280; font-size:14px; }
.regler { display:flex; align-items:center; gap:12px; }
.regler .text { flex:1; }
.regler .text div { font-size:13.5px; color:#6b7280; }
.regler .text b { font-size:26px; }
.regler .text b.wartet { color:#d97706; }
.rund { width:52px; height:52px; border-radius:50%; border:0; font-size:28px; line-height:1; cursor:pointer; color:#fff; flex:none; }
.rund.minus { background:#3b82f6; }
.rund.plus { background:#ef4444; }
.rund:disabled { opacity:.35; cursor:default; }
.wahl { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.wahl button { border:2px solid #dde1e6; background:#fff; border-radius:10px; padding:10px 8px; font:inherit; font-size:14px; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:4px; color:#333; }
.wahl button ha-icon { --mdc-icon-size:22px; color:#6b7280; }
.wahl button.an { border-color:#2b7bd6; background:#eef5fe; color:#1d4a80; font-weight:600; }
.wahl button.an ha-icon { color:#2b7bd6; }
.wahl.klein button { flex-direction:row; justify-content:center; font-size:13px; padding:8px; }
.erklaerung { font-size:13.5px; color:#555; background:#f6f7f9; border-radius:8px; padding:8px 10px; line-height:1.4; }
.zeilen div { display:flex; justify-content:space-between; font-size:14px; padding:4px 0; border-bottom:1px solid #f0f1f3; }
.zeilen div span:last-child { font-weight:600; }
.links { display:flex; gap:8px; flex-wrap:wrap; }
.ueber { position:fixed; inset:0; z-index:20; background:rgba(0,0,0,.45); display:flex; align-items:stretch; justify-content:center; padding:24px; box-sizing:border-box; }
.ueber.zu { display:none; }
.fenster { background:#e4e5e7; border-radius:10px; width:min(1500px,100%); display:flex; flex-direction:column; overflow:hidden; box-shadow:0 8px 40px rgba(0,0,0,.4); }
.fenster .fkopf { display:flex; align-items:center; padding:10px 14px; background:#fff; border-bottom:1px solid #ddd; font-size:16px; font-weight:600; }
.fenster .fkopf button { margin-left:auto; border:0; background:#eee; border-radius:6px; padding:8px 14px; font:inherit; cursor:pointer; }
.fenster .finhalt { overflow:auto; flex:1; }
.erklaer-inhalt { padding:18px 22px; background:#fff; font-size:15px; line-height:1.5; }
.erklaer-inhalt h3 { margin:0 0 8px; }
.bestaetigen { position:fixed; inset:0; z-index:30; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; padding:20px; }
.bestaetigen .box { background:#fff; border-radius:12px; padding:20px 22px; max-width:440px; font-size:15px; line-height:1.45; box-shadow:0 8px 40px rgba(0,0,0,.35); }
.bestaetigen .box h3 { margin:0 0 8px; }
.bestaetigen .knoepfe { display:flex; justify-content:flex-end; gap:10px; margin-top:16px; }
.bestaetigen button { border:0; border-radius:8px; padding:10px 16px; font:inherit; cursor:pointer; }
.bestaetigen .ja { background:#2b7bd6; color:#fff; font-weight:600; }
.bestaetigen .nein { background:#eef0f3; }
.rund-breit { border:0; border-radius:10px; padding:12px 14px; font:inherit; font-size:15px; font-weight:600; background:#16a34a; color:#fff; cursor:pointer; }
@media (max-width: 600px) { .ueber { padding:0; } .kopf h1 { font-size:19px; } }
`;

class HargassnerSchemaCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._ausstehend = {};
    this._frage = null;
  }

  setConfig(config) {
    if (!config || !config.anlage) throw new Error("Bitte unter «anlage» die Konfiguration der Anlagen-Karte angeben (kessel, puffer, heizkreise …).");
    this._config = config;
    if (this._hass) this._zeichnen();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const sig = this._signatur();
    if (sig !== this._letzteSignatur && !this._fokusIntern()) {
      this._letzteSignatur = sig;
      this._zeichnen();
    }
    if (this._eingebettet) this._eingebettet.hass = hass;
  }

  getCardSize() {
    return 14;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }

  /* --------- Hilfen --------- */

  get _a() {
    return this._config.anlage;
  }
  _s(id) {
    return id ? this._hass.states[id] : undefined;
  }
  _roh(id) {
    const s = this._s(id);
    return !s || ["unknown", "unavailable", ""].includes(s.state) ? null : s.state;
  }
  _z(id) {
    return zahl(this._roh(id));
  }
  _an(id) {
    const r = this._roh(id);
    return r === "on" || r === "true" || (zahl(r) ?? 0) > 0;
  }
  _grad(id, st = 0) {
    const z = this._z(id);
    return z === null ? "–" : komma(z, st) + " °C";
  }
  get _v() {
    return this._config.verbrauch || {};
  }
  _attr(id) {
    return this._s(id)?.attributes || {};
  }
  _datumText(id) {
    const r = this._roh(id);
    if (!r) return null;
    const d = new Date(r + "T12:00:00");
    return isNaN(d) ? null : d.toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "long" });
  }
  _tageText(t) {
    if (t === null || t === undefined) return "–";
    if (t < 1) return "heute";
    if (t < 1.5) return "morgen";
    return `in ca. ${Math.round(t)} Tagen`;
  }

  _fokusIntern() {
    const a = this.shadowRoot.activeElement;
    return !!this._frage || (a && (a.tagName === "SELECT" || a.tagName === "INPUT"));
  }

  _signatur() {
    const ids = new Set();
    const sammeln = (o) => {
      if (!o) return;
      if (typeof o === "string" && /^[a-z_]+\.[a-z0-9_]+$/.test(o)) ids.add(o);
      else if (Array.isArray(o)) o.forEach(sammeln);
      else if (typeof o === "object") Object.values(o).forEach(sammeln);
    };
    sammeln(this._config);
    return [...ids].map((i) => i + "=" + (this._hass.states[i]?.state ?? "")).join("|") + JSON.stringify(Object.keys(this._ausstehend));
  }

  /* --------- Zustand in Alltagssprache --------- */

  _lage() {
    const a = this._a;
    const k = a.kessel || {};
    const leistung = this._z(k.leistung) ?? 0;
    const ladung = this._z(a.puffer?.ladung);
    const zustand = String(this._roh(k.zustand) || "");
    const programm = this._roh(k.programm);
    // Störungen und Warnungen zuerst
    for (const s of a.signale?.zeilen || []) {
      if (s.art === "fehler" && this._an(s.entity)) return { art: "fehler", icon: "mdi:alert-octagon", text: `Störung: ${s.name}`, klein: "Bitte die Fachperson informieren. Nichts am Kessel öffnen." };
    }
    if (this._config.cloud && !this._an(this._config.cloud)) return { art: "warn", icon: "mdi:cloud-off-outline", text: "Keine Verbindung zur Heizung", klein: "Die angezeigten Werte sind eventuell nicht aktuell. Die Heizung selbst läuft trotzdem weiter." };
    for (const s of a.signale?.zeilen || []) {
      if (s.art === "warnung" && this._an(s.entity)) return { art: "warn", icon: "mdi:alert", text: `Hinweis: ${s.name}`, klein: "Die Heizung läuft weiter. Bei Unsicherheit die Fachperson fragen." };
    }
    const speicher = ladung === null ? "" : ` Der Wärmespeicher ist zu ${Math.round(ladung)} % gefüllt.`;
    const wartung = this._z(this._v.wartung_tage);
    if (wartung !== null && wartung < 1) return { art: "warn", icon: "mdi:wrench-clock", text: "Bitte jetzt die Aschebox leeren und den Kessel reinigen.", klein: "Danach unten bei «Wartung» auf «Erledigt» tippen." };
    const lagerTage = this._z(this._v.lager_reichweite);
    if (lagerTage !== null && lagerTage < 10) return { art: "warn", icon: "mdi:warehouse", text: `Die Holzschnitzel reichen nur noch ${this._tageText(lagerTage).replace("in ca. ", "ca. ")}.`, klein: "Bitte rechtzeitig neue Schnitzel bestellen." };
    if (programm === "Aus") return { art: "warn", icon: "mdi:power", text: "Der Holzkessel ist ausgeschaltet.", klein: "Häuser und Warmwasser bekommen nur noch Wärme, solange der Speicher warm ist." + speicher };
    if (programm === "Feuerung stoppen") return { art: "warn", icon: "mdi:fire-off", text: "Das Feuer im Holzkessel wird gestoppt.", klein: "Danach heizt der Kessel nicht mehr, bis wieder «Normalbetrieb» gewählt wird." };
    if (leistung > 0) return { art: "gut", icon: "mdi:fire", text: "Alles in Ordnung. Der Holzkessel brennt und lädt den Wärmespeicher.", klein: `Er arbeitet mit ${Math.round(leistung)} % Leistung.` + speicher };
    if (/zünd|anheiz|start/i.test(zustand)) return { art: "info", icon: "mdi:fire-circle", text: "Der Holzkessel startet gerade.", klein: "In wenigen Minuten brennt das Feuer." + speicher };
    if (ladung !== null && ladung < 15) return { art: "info", icon: "mdi:battery-low", text: "Der Wärmespeicher ist fast leer.", klein: "Der Holzkessel startet von selbst, sobald Wärme gebraucht wird." };
    return { art: "gut", icon: "mdi:check-circle", text: "Alles in Ordnung. Der Holzkessel ruht gerade.", klein: "Die Häuser und das Warmwasser bekommen ihre Wärme aus dem Wärmespeicher." + speicher };
  }

  /* --------- Das Schema --------- */

  _rohr(d, temp, fliesst, breite = 9) {
    const f = tempFarbe(temp);
    return `<path d="${d}" fill="none" stroke="${f}" stroke-width="${breite}" stroke-linecap="round" stroke-linejoin="round"/>
      ${fliesst ? `<path class="fluss" d="${d}" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="${Math.max(2, breite - 5)}" stroke-linecap="round" stroke-linejoin="round"/>` : ""}`;
  }

  // Pumpe: Pfeil in Flussrichtung (Grad, 0 = nach rechts), Ring dreht, wenn sie läuft
  _pumpe(x, y, an, richtung = 0) {
    return `<g><circle cx="${x}" cy="${y}" r="15" fill="#fff" stroke="#3a4048" stroke-width="2.5"/>
      ${an ? `<circle class="dreht" cx="${x}" cy="${y}" r="11" fill="none" stroke="#22a05a" stroke-width="2.5" stroke-dasharray="6 5"/>` : ""}
      <path transform="rotate(${richtung} ${x} ${y})" d="M${x + 8} ${y} L${x - 5} ${y - 7} L${x - 5} ${y + 7} Z" fill="${an ? "#22a05a" : "#9aa3ad"}"/></g>`;
  }

  _schema() {
    const a = this._a;
    const k = a.kessel || {};
    const p = a.puffer || {};
    const f = a.frischwasser?.[0];
    const hk = a.heizkreise || [];
    const leistung = this._z(k.leistung) ?? 0;
    const brennt = leistung > 0;
    const kT = this._z(k.temperatur);
    const pO = this._z(p.oben);
    const pM = this._z(p.mitte) ?? pO;
    const pU = this._z(p.unten);
    const rl = this._z(this._config.ruecklauf) ?? pU;
    const laden = brennt || this._an(this._config.ladepumpe);
    const ladung = this._z(p.ladung);
    const breite = 1200;
    // Häuser verteilt rechts
    const n = Math.max(1, hk.length);
    const hx = (i) => (n === 1 ? 1000 : 870 + (i * 240) / (n - 1));
    let s = `<svg viewBox="0 0 ${breite} 660" role="img" aria-label="Heizung als Schema">
      <defs>
        <linearGradient id="speicher" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${tempFarbe(pO)}"/><stop offset=".5" stop-color="${tempFarbe(pM)}"/><stop offset="1" stop-color="${tempFarbe(pU)}"/>
        </linearGradient>
        <clipPath id="speicherform"><rect x="420" y="210" width="140" height="350" rx="60"/></clipPath>
      </defs>`;

    /* Holzschnitzel-Lager und Förderschnecke */
    s += `<g data-teil="lager">
      <rect class="rahmen" x="40" y="70" width="200" height="110" rx="10" fill="#efe4d1" stroke="#b9a07a" stroke-width="2"/>
      ${(() => {
        const pr = this._attr(this._v.lager_rest).prozent;
        const h = pr === undefined || pr === null ? 40 : Math.max(4, Math.min(62, (pr / 100) * 62));
        return `<path d="M52 172 Q90 ${172 - h * 1.6} 140 ${172 - h} T228 172 Z" fill="#c69c62"/>`;
      })()}
      <text x="140" y="95" text-anchor="middle" font-size="16" font-weight="600" fill="#5c4527">Holzschnitzel-Lager</text>
      ${this._z(this._v.lager_rest) !== null ? `<rect x="88" y="130" width="104" height="28" rx="6" fill="rgba(255,255,255,.9)"/><text x="140" y="150" text-anchor="middle" font-size="16" font-weight="700" fill="#3d2e1a">≈ ${komma(this._z(this._v.lager_rest), 0)} m³</text>` : ""}
      <rect x="128" y="180" width="18" height="120" fill="#8a9097"/>
      ${brennt ? `<path class="fluss" d="M137 182 V298" stroke="#d8c39b" stroke-width="8" fill="none"/>` : ""}
    </g>`;

    /* Holzkessel */
    s += `<g data-teil="kessel">
      <rect class="rahmen" x="60" y="300" width="170" height="260" rx="14" fill="#b3191f" stroke="#7a1015" stroke-width="2"/>
      <rect x="82" y="330" width="126" height="34" rx="6" fill="#2a2d31"/>
      <text x="145" y="353" text-anchor="middle" font-size="18" font-weight="600" fill="#fff">${esc(this._grad(k.temperatur))}</text>
      <rect x="95" y="395" width="100" height="110" rx="10" fill="#2a1a12"/>
      ${
        brennt
          ? `<g class="flamme"><path d="M145 498 C110 480 118 440 135 425 C135 445 150 450 148 432 C160 445 178 470 160 498 Z" fill="#ff8a1f"/><path d="M146 498 C132 488 135 468 143 458 C145 470 155 470 152 460 C160 472 162 490 152 498 Z" fill="#ffd43b"/></g>`
          : `<text x="145" y="458" text-anchor="middle" font-size="14" fill="#9b8f86">ruht</text>`
      }
      <text x="145" y="590" text-anchor="middle" font-size="17" font-weight="600" fill="#22262b">Holzkessel</text>
      ${brennt ? [0, 1, 2].map((i) => `<circle class="rauch" style="animation-delay:${i}s" cx="82" cy="292" r="10" fill="#c8ccd2"/>`).join("") : ""}
      <rect x="72" y="282" width="20" height="18" fill="#6b7078"/>
    </g>`;

    /* Leitungen Kessel ↔ Speicher (mit Rücklaufanhebung) */
    s += `<g data-teil="kessel">${this._rohr("M230 330 H320 V240 H420", kT, laden)}${this._rohr("M420 535 H230", rl, laden)}${this._pumpe(300, 535, laden, 180)}</g>`;

    /* Ausdehnungsgefäss */
    s += `<g data-teil="ae">
      <path d="M320 535 V555" stroke="#8a9097" stroke-width="4"/>
      <rect class="rahmen" x="300" y="555" width="40" height="70" rx="18" fill="#c0262c" stroke="#7a1015" stroke-width="2"/>
    </g>`;

    /* Solar: Kollektor und Wendel unten im Speicher (Anschlüsse links) */
    const so = this._config.solar || null;
    const soAktiv = !!(so && (so.kollektor || so.pumpe));
    const soT = soAktiv ? this._z(so.kollektor) : null;
    const soPumpe = soAktiv && this._an(so.pumpe);
    const soVl = soAktiv ? soT ?? pU : null;
    const solarRohr = (d, t) =>
      soAktiv ? this._rohr(d, t, soPumpe, 6) : `<path d="${d}" fill="none" stroke="#c3c8cf" stroke-width="5" stroke-dasharray="7 6" stroke-linecap="round" stroke-linejoin="round"/>`;
    s += `<g data-teil="solar">
      <path class="rahmen" d="M330 118 L362 52 L478 52 L446 118 Z" fill="${soAktiv ? "#1f3b63" : "#e6e9ed"}" stroke="${soAktiv ? "#0f2440" : "#b7bdc5"}" stroke-width="2"/>
      ${[0, 1, 2, 3].map((i) => `<path d="M${351 + i * 29} 118 L${383 + i * 29} 52" stroke="${soAktiv ? "#4a6a96" : "#cfd4da"}" stroke-width="1.5"/>`).join("")}
      <text x="400" y="40" text-anchor="middle" font-size="14" font-weight="600" fill="${soAktiv ? "#22262b" : "#8a9099"}">${soAktiv ? "Sonnenkollektor" + (soT !== null ? " " + komma(soT, 0) + " °C" : "") : "Solar (möglich)"}</text>
      ${solarRohr("M372 118 V470 H420", soVl)}
      ${solarRohr("M420 515 H398 V118", pU)}
      ${soAktiv && so.pumpe ? this._pumpe(398, 420, soPumpe, -90) : ""}
    </g>`;

    /* Wärmespeicher */
    const fuell = ladung === null ? 0 : Math.max(0, Math.min(100, ladung));
    s += `<g data-teil="puffer">
      <rect x="420" y="210" width="140" height="350" rx="60" fill="#e9ecef"/>
      <rect x="420" y="${560 - 3.5 * fuell}" width="140" height="${3.5 * fuell}" fill="url(#speicher)" clip-path="url(#speicherform)"/>
      <path d="M420 470 h40 ${[0, 1, 2].map(() => "l20 9 l-20 9").join(" ")} h-40" fill="none" stroke="${soAktiv ? "#1f3b63" : "#b7bdc5"}" stroke-width="3" ${soAktiv ? "" : 'stroke-dasharray="5 4"'} opacity=".8"/>
      <rect class="rahmen" x="420" y="210" width="140" height="350" rx="60" fill="none" stroke="#3a4048" stroke-width="3"/>
      <text x="490" y="196" text-anchor="middle" font-size="17" font-weight="600">Wärmespeicher</text>
      <rect x="452" y="364" width="76" height="40" rx="8" fill="rgba(255,255,255,.88)"/>
      <text x="490" y="392" text-anchor="middle" font-size="24" font-weight="700">${ladung === null ? "–" : Math.round(ladung) + " %"}</text>
      <text x="490" y="262" text-anchor="middle" font-size="14" font-weight="600" fill="#22262b">${esc(this._grad(p.oben))}</text>
      <text x="490" y="545" text-anchor="middle" font-size="14" font-weight="600" fill="#22262b">${esc(this._grad(p.unten))}</text>
    </g>`;

    /* Warmwasser-Station */
    if (f) {
      const fp = this._an(f.pumpe);
      const zapft = (this._z(f.durchfluss) ?? 0) > 0 || fp;
      s += `<g data-teil="warmwasser">
        ${this._rohr("M545 232 H590 V200 H610", this._z(f.vorlauf) ?? pO, fp, 7)}
        ${this._rohr("M655 250 V540 H558", pU, fp, 7)}
        <rect class="rahmen" x="610" y="150" width="130" height="100" rx="10" fill="#f8fafc" stroke="#3a4048" stroke-width="2"/>
        <text x="675" y="190" text-anchor="middle" font-size="15" font-weight="600">Warmwasser</text>
        <text x="675" y="220" text-anchor="middle" font-size="20" font-weight="700" fill="${tempFarbe(this._z(f.auslauf_soll))}">${esc(this._grad(f.auslauf_soll))}</text>
        ${this._rohr("M715 150 V112", this._z(f.auslauf_soll), zapft, 7)}
        <path d="M701 112 h28 a6 6 0 0 1 6 6 v6 h-12 v-6 h-22 z" fill="#5b6470"/>
        ${zapft ? `<path class="fluss" d="M729 128 V146" stroke="#4aa3ff" stroke-width="4"/>` : ""}
        <text x="718" y="98" text-anchor="middle" font-size="13" fill="#6b7280">Wasserhahn</text>
      </g>`;
    }

    /* Häuser mit Heizgruppen */
    const hkFliesst = hk.some((h) => this._an(h.pumpe));
    const letzte = hx(hk.length - 1) + 20;
    s += `<g data-teil="verteiler">${this._rohr(`M560 330 H${letzte - 40}`, pM, hkFliesst)}${this._rohr(`M${letzte} 610 H520 V552`, pU, hkFliesst)}</g>`;
    hk.forEach((h, i) => {
      const x = hx(i);
      const an = this._an(h.pumpe);
      const vl = this._z(h.vorlauf);
      const rlH = vl === null ? pU : Math.max(pU ?? 0, vl - 8);
      const raum = this._z(h.raum);
      s += `<g data-teil="hk${i}">
        ${this._rohr(`M${x - 20} 330 V160`, vl, an)}
        ${this._rohr(`M${x + 20} 160 V610`, rlH, an)}
        <path d="M${x - 33} 280 l13 -10 l13 10 z M${x - 33} 280 l13 10 l13 -10 z" fill="#b08d57"/>
        ${this._pumpe(x - 20, 215, an, -90)}
        <path class="rahmen" d="M${x - 75} 160 V95 L${x} 45 L${x + 75} 95 V160 Z" fill="#fff" stroke="#3a4048" stroke-width="3"/>
        <rect x="${x - 15}" y="125" width="30" height="35" fill="#cdd3da"/>
        <text x="${x}" y="88" text-anchor="middle" font-size="16" font-weight="600">${esc(h.titel || "Haus " + (i + 1))}</text>
        <text x="${x}" y="112" text-anchor="middle" font-size="14" fill="#6b7280">${raum !== null ? "innen " + komma(raum, 1) + " °C" : esc(this._roh(h.zustand) || "")}</text>
        <text x="${x - 42}" y="210" text-anchor="end" font-size="13" fill="#6b7280">${an ? "heizt" : "Pause"}</text>
        <text x="${x - 42}" y="228" text-anchor="end" font-size="13" fill="#6b7280">${vl !== null ? komma(vl, 0) + " °C" : ""}</text>
      </g>`;
    });
    s += `</svg>`;
    return s;
  }

  /* --------- Bedienfelder --------- */

  _wertMitAusstehend(id) {
    const s = this._s(id);
    return this._ausstehend[id]?.wert ?? zahl(s?.state);
  }

  _regler(titel, untertitel, id) {
    const s = this._s(id);
    if (!s) return "";
    const w = this._wertMitAusstehend(id);
    const at = s.attributes;
    const wartet = !!this._ausstehend[id];
    return `<div class="regler">
      <button class="rund minus" data-schritt="-1" data-entity="${esc(id)}" ${w !== null && at.min !== undefined && w <= at.min ? "disabled" : ""} aria-label="kühler">−</button>
      <div class="text"><div>${esc(titel)}</div><b class="${wartet ? "wartet" : ""}">${w === null ? "–" : komma(w, 1) + " °C"}</b><div>${wartet ? "wird übernommen …" : esc(untertitel)}</div></div>
      <button class="rund plus" data-schritt="1" data-entity="${esc(id)}" ${w !== null && at.max !== undefined && w >= at.max ? "disabled" : ""} aria-label="wärmer">+</button>
    </div>`;
  }

  _feldHaus(h, i) {
    const kurve = this._a.heizkurve?.heizkreise?.[i] || {};
    const an = this._an(h.pumpe);
    const art = this._roh(h.betriebsart);
    const opts = this._s(h.betriebsart)?.attributes.options || [];
    const haupt = ["Automatik", "Heizen", "Absenken", "Aus"].filter((o) => opts.includes(o));
    const neben = ["Vorübergehend heizen", "Vorübergehend absenken"].filter((o) => opts.includes(o));
    const knopf = (o) => `<button class="${o === art ? "an" : ""}" data-art="${esc(h.betriebsart)}" data-wert="${esc(o)}"><ha-icon icon="${BETRIEBSART[o]?.icon || "mdi:circle-outline"}"></ha-icon>${esc(BETRIEBSART[o]?.text || o)}</button>`;
    const temp = kurve.tagestemperatur || h.tagestemperatur;
    const spar = kurve.absenktemperatur || h.absenktemperatur;
    return `<div class="feld">
      <h2><ha-icon icon="mdi:home-thermometer-outline"></ha-icon>${esc(h.titel || "Haus " + (i + 1))}<span class="zustand ${an ? "an" : ""}">${an ? "heizt gerade" : "macht Pause"}</span></h2>
      ${temp ? this._regler("Wohlfühltemperatur", "tagsüber bzw. im Zeitplan", temp) : h.korrektur ? this._regler("Etwas wärmer oder kühler", "Korrektur gegenüber normal", h.korrektur) : ""}
      ${spar ? this._regler("Spartemperatur", "nachts bzw. ausserhalb des Zeitplans", spar) : ""}
      ${h.betriebsart ? `<div><div class="wahl">${haupt.map(knopf).join("")}</div>${neben.length ? `<div class="wahl klein" style="margin-top:8px">${neben.map(knopf).join("")}</div>` : ""}</div>` : ""}
      ${art && BETRIEBSART[art] ? `<div class="erklaerung"><b>${esc(BETRIEBSART[art].text)}:</b> ${esc(BETRIEBSART[art].hilfe)}</div>` : ""}
      <div class="links">
        ${h.wochenuhr ? `<button class="knopf-klein" data-zp="${esc(h.wochenuhr)}"><ha-icon icon="mdi:calendar-clock"></ha-icon>Zeitplan ändern</button>` : ""}
        <button class="knopf-klein" data-trend="heating_circuit|${esc(h.nummer ?? i + 1)}"><ha-icon icon="mdi:chart-line"></ha-icon>Verlauf ansehen</button>
      </div>
    </div>`;
  }

  _feldWarmwasser(f) {
    const an = this._an(f.pumpe);
    return `<div class="feld">
      <h2><ha-icon icon="mdi:water-boiler"></ha-icon>Warmwasser<span class="zustand ${an ? "an" : ""}">${an ? "wird gerade bereitet" : "bereit"}</span></h2>
      <div class="gross"><b>${esc(this._grad(f.auslauf_soll))}</b><span>am Wasserhahn</span></div>
      <div class="zeilen">
        ${f.heute ? `<div><span>Heute verbraucht</span><span>${komma(this._z(f.heute), 0)} Liter</span></div>` : ""}
        ${f.gesamt ? `<div><span>Insgesamt</span><span>${komma(this._z(f.gesamt), 0)} Liter</span></div>` : ""}
      </div>
      <div class="erklaerung">Das Warmwasser wird erst beim Aufdrehen frisch aus dem Wärmespeicher erwärmt. Ist der Speicher warm, reicht es auch ohne laufenden Kessel.</div>
      <div class="links"><button class="knopf-klein" data-trend="fresh_water|1"><ha-icon icon="mdi:chart-line"></ha-icon>Verlauf ansehen</button></div>
    </div>`;
  }

  _feldWartung() {
    const v = this._v;
    const tage = this._z(v.wartung_tage);
    const at = this._attr(v.wartung_tage);
    const prozent = this._z(v.asche_fuellstand) ?? at.prozent ?? 0;
    const faellig = this._datumText(v.wartung_am);
    const zyklus = at.zyklus_tage;
    const farbe = tage !== null && tage < 1 ? "#dc2626" : tage !== null && tage < 3 ? "#d97706" : "#16a34a";
    const geleert = this._datumText(v.asche_geleert_am);
    return `<div class="feld">
      <h2><ha-icon icon="mdi:wrench-clock"></ha-icon>Wartung<span class="zustand ${tage !== null && tage < 1 ? "" : "an"}" style="${tage !== null && tage < 1 ? "background:#fde7e7;color:#8c1d1d" : ""}">${tage !== null && tage < 1 ? "jetzt fällig" : "in Ordnung"}</span></h2>
      <div><div style="font-size:14px;color:#6b7280">Aschebox leeren und Kessel reinigen</div>
        <div class="gross"><b style="color:${farbe}">${esc(this._tageText(tage))}</b>${faellig ? `<span>${esc(faellig)}</span>` : ""}</div></div>
      <div><div style="display:flex;justify-content:space-between;font-size:13px;color:#6b7280"><span>Aschebox geschätzt</span><span>${Math.round(prozent)} % voll</span></div>
        <div style="height:14px;background:#eef0f3;border-radius:7px;overflow:hidden;margin-top:4px"><div style="height:100%;width:${Math.min(100, prozent)}%;background:${farbe}"></div></div></div>
      <div class="erklaerung">Berechnet aus der Laufzeit des Kessels.${zyklus ? ` Bei der Heizleistung der letzten Tage ist die Box nach etwa ${Math.round(zyklus)} Tagen voll.` : ""} Spätestens nach ${komma(this._z(v.wartung_max) ?? 14, 0)} Tagen wird an die Wartung erinnert.${geleert ? ` Zuletzt geleert: ${esc(geleert)}.` : ""}</div>
      ${v.asche_geleert ? `<button class="rund-breit" data-asche>✓ Erledigt: Aschebox geleert</button>` : ""}
    </div>`;
  }

  _feldLager() {
    const v = this._v;
    const rest = this._z(v.lager_rest);
    const at = this._attr(v.lager_rest);
    const tage = this._z(v.lager_reichweite);
    const leer = this._datumText(v.lager_leer_am);
    const menge = this._z(v.lager_menge);
    return `<div class="feld">
      <h2><ha-icon icon="mdi:warehouse"></ha-icon>Holzschnitzel<span class="zustand ${tage !== null && tage < 10 ? "" : "an"}">${at.prozent !== undefined && at.prozent !== null ? at.prozent + " % voll" : ""}</span></h2>
      <div class="gross"><b>≈ ${rest === null ? "–" : komma(rest, 0)} m³</b><span>noch im Lager</span></div>
      <div class="zeilen">
        <div><span>Reicht noch</span><span>${tage === null ? "–" : "ca. " + Math.round(tage) + " Tage"}</span></div>
        ${leer ? `<div><span>Voraussichtlich leer</span><span>${esc(leer)}</span></div>` : ""}
        ${at.pro_tag ? `<div><span>Verbrauch zurzeit</span><span>ca. ${komma(at.pro_tag, 1)} m³ pro Tag</span></div>` : ""}
        ${at.gefuellt_am ? `<div><span>Zuletzt gefüllt</span><span>${esc(new Date(at.gefuellt_am + "T12:00:00").toLocaleDateString("de-CH"))}${menge ? ", " + komma(menge, 0) + " m³" : ""}</span></div>` : ""}
      </div>
      <div class="erklaerung">Geschätzt aus der Laufzeit des Kessels. Bei kaltem Wetter steigt der Verbrauch, die Reichweite wird dann kürzer.</div>
      <button class="knopf-klein" data-lager><ha-icon icon="mdi:truck-delivery-outline"></ha-icon>Lager wurde aufgefüllt</button>
    </div>`;
  }

  _feldKessel() {
    const k = this._a.kessel || {};
    const p = this._a.puffer || {};
    const leistung = this._z(k.leistung) ?? 0;
    const prog = this._roh(k.programm);
    const opts = (this._s(k.programm)?.attributes.options || []).filter((o) => KESSELPROGRAMM[o]);
    const reihenfolge = ["Automatik", "Nur Warmwasser", "Feuerung stoppen", "Aus"].filter((o) => opts.includes(o));
    return `<div class="feld">
      <h2><ha-icon icon="mdi:fire"></ha-icon>Holzkessel<span class="zustand ${leistung > 0 ? "an" : ""}">${leistung > 0 ? "brennt" : "ruht"}</span></h2>
      <div class="zeilen">
        <div><span>Temperatur im Kessel</span><span>${esc(this._grad(k.temperatur))}</span></div>
        <div><span>Wärmespeicher gefüllt</span><span>${this._z(p.ladung) === null ? "–" : Math.round(this._z(p.ladung)) + " %"}</span></div>
        ${this._config.lagerstand && this._z(this._config.lagerstand) !== null ? `<div><span>Holzschnitzel im Lager</span><span>${komma(this._z(this._config.lagerstand), 0)} kg</span></div>` : ""}
      </div>
      ${
        k.programm
          ? `<div><div style="font-size:13.5px;color:#6b7280;margin-bottom:6px">Betrieb (Änderungen fragen vorher nach)</div>
        <div class="wahl">${reihenfolge.map((o) => `<button class="${o === prog ? "an" : ""}" data-kessel="${esc(k.programm)}" data-wert="${esc(o)}">${esc(KESSELPROGRAMM[o].text)}</button>`).join("")}</div></div>`
          : ""
      }
      ${prog && KESSELPROGRAMM[prog] ? `<div class="erklaerung">${esc(KESSELPROGRAMM[prog].hilfe)}</div>` : ""}
      <div class="links"><button class="knopf-klein" data-trend="heater|"><ha-icon icon="mdi:chart-line"></ha-icon>Verlauf ansehen</button></div>
    </div>`;
  }

  /* --------- Zeichnen --------- */

  _zeichnen() {
    if (!this._hass || !this._config) return;
    const a = this._a;
    const lage = this._lage();
    const aussen = this._z(a.heizkurve?.aussen_aktuell || a.kessel?.aussen);
    const offenUeber = this.shadowRoot.getElementById("ueber");
    const ueberZu = !offenUeber || offenUeber.classList.contains("zu");
    const ueberInhalt = !ueberZu ? offenUeber.querySelector(".finhalt").firstElementChild : null;
    const ueberTitel = !ueberZu ? offenUeber.querySelector("#utitel").textContent : "";
    this.shadowRoot.innerHTML = `<style>${STIL}</style>
      <div class="karte">
        <div class="kopf">
          <h1>${esc(this._config.titel || "Heizung")}</h1>
          ${aussen !== null ? `<div class="aussen" data-teil="aussen"><ha-icon icon="mdi:thermometer"></ha-icon>Draussen ${komma(aussen, 1)} °C</div>` : ""}
          <div class="rechts"><button class="knopf-klein" data-fach><ha-icon icon="mdi:tools"></ha-icon>Für Fachleute</button></div>
        </div>
        <div class="lage ${lage.art}"><ha-icon icon="${lage.icon}"></ha-icon><div>${esc(lage.text)}<small>${esc(lage.klein)}</small></div></div>
        <div class="bild">
          <div class="rollen">${this._schema()}</div>
          <div class="bildfuss"><span>Tippen Sie auf einen Teil der Heizung für eine Erklärung.${"ontouchstart" in window ? " Zum Verschieben wischen." : ""}</span>
            <button class="knopf-klein" data-gross><ha-icon icon="mdi:magnify-plus-outline"></ha-icon>Grösser anzeigen</button></div></div>
        <div class="raster">
          ${(a.heizkreise || []).map((h, i) => this._feldHaus(h, i)).join("")}
          ${a.frischwasser?.[0] ? this._feldWarmwasser(a.frischwasser[0]) : ""}
          ${this._v.wartung_tage ? this._feldWartung() : ""}
          ${this._v.lager_rest ? this._feldLager() : ""}
          ${a.kessel ? this._feldKessel() : ""}
        </div>
      </div>
      <div class="ueber ${ueberZu ? "zu" : ""}" id="ueber"><div class="fenster"><div class="fkopf"><span id="utitel">${esc(ueberTitel)}</span><button data-schliessen>Schliessen</button></div><div class="finhalt"></div></div></div>
      ${this._frage ? this._frageHtml() : ""}`;
    if (ueberInhalt) this.shadowRoot.querySelector("#ueber .finhalt").appendChild(ueberInhalt);
    if (!this._verbunden) {
      this.shadowRoot.addEventListener("click", (e) => this._klick(e));
      this._verbunden = true;
    }
  }

  /* --------- Erklärungen beim Antippen --------- */

  _erklaerung(teil) {
    const a = this._a;
    const k = a.kessel || {};
    const p = a.puffer || {};
    const texte = {
      lager: ["Holzschnitzel-Lager", `Hier lagern die Holzschnitzel. Ein Rührwerk am Boden und eine Förderschnecke bringen sie automatisch zum Kessel, sobald er brennt.${this._z(this._v.lager_rest) !== null ? ` Geschätzt sind noch etwa ${komma(this._z(this._v.lager_rest), 0)} m³ im Lager, das reicht ${this._tageText(this._z(this._v.lager_reichweite)).replace("in ca. ", "ca. ")}.` : ""}`],
      kessel: ["Holzkessel", `Der Kessel verbrennt die Holzschnitzel und erwärmt damit Wasser. Dieses warme Wasser fliesst in den Wärmespeicher. Er startet und stoppt von selbst. Zurzeit: ${(this._z(k.leistung) ?? 0) > 0 ? "er brennt" : "er ruht"}, Temperatur ${this._grad(k.temperatur)}.`],
      ae: ["Ausdehnungsgefäss", "Warmes Wasser braucht mehr Platz als kaltes. Dieses rote Gefäss fängt das zusätzliche Wasser auf und hält den Druck in den Leitungen gleichmässig. Es muss nicht bedient werden."],
      puffer: ["Wärmespeicher", `Ein grosser, gut isolierter Wassertank. Er speichert die Wärme vom Kessel, damit die Häuser und das Warmwasser auch dann warm bleiben, wenn der Kessel ruht. Der Kessel füllt ihn von oben mit heissem Wasser. Das Warmwasser nimmt ganz oben das heisseste Wasser, die Häuser etwas tiefer. Abgekühltes Wasser kommt unten zurück. Oben ist das Wasser am heissesten (${this._grad(p.oben)}), unten am kühlsten (${this._grad(p.unten)}). Gefüllt: ${this._z(p.ladung) === null ? "–" : Math.round(this._z(p.ladung)) + " %"}.`],
      warmwasser: ["Warmwasser-Station", "Erwärmt das Trinkwasser frisch, genau dann, wenn ein Wasserhahn aufgedreht wird. Die Wärme kommt aus dem Wärmespeicher. Es wird also kein Warmwasser auf Vorrat gehalten."],
      verteiler: ["Leitungen zu den Häusern", "Warmes Wasser fliesst vom Wärmespeicher zu den Häusern, gibt dort in den Heizkörpern Wärme ab und kommt abgekühlt zurück. Die Farbe zeigt die Temperatur: rot heiss, gelb warm, grün lauwarm, blau kühl. Wandernde Striche bedeuten, dass gerade Wasser fliesst."],
      solar: [
        "Sonnenkollektor",
        (this._config.solar && (this._config.solar.kollektor || this._config.solar.pumpe))
          ? "Auf dem Dach erwärmt die Sonne eine Flüssigkeit. Die Solarpumpe schickt sie durch die Wendel unten im Wärmespeicher. So hilft die Sonne mit, und der Holzkessel muss seltener brennen."
          : "Der Wärmespeicher hat unten eine Wendel für Sonnenkollektoren. Sie ist vorbereitet, aber zurzeit nicht angeschlossen. Mit Kollektoren auf dem Dach könnte die Sonne im Sommer das Warmwasser und in der Übergangszeit einen Teil der Heizwärme liefern.",
      ],
      aussen: ["Aussentemperatur", "Die Heizung misst die Temperatur draussen. Je kälter es ist, desto wärmer schickt sie das Wasser zu den Häusern."],
    };
    let t = texte[teil];
    if (!t && teil.startsWith("hk")) {
      const h = a.heizkreise?.[+teil.slice(2)] || {};
      t = [h.titel || "Haus", `Die Pumpe schickt warmes Wasser zu den Heizkörpern dieses Hauses. Ein Mischventil mischt dabei so viel kühleres Wasser bei, dass die Temperatur genau passt. Zurzeit ${this._an(h.pumpe) ? "heizt es" : "macht es Pause"}, das Wasser zum Haus hat ${this._grad(h.vorlauf)}. Die Temperatur im Haus stellen Sie unten im Feld «${h.titel || "Haus"}» ein.`];
    }
    if (!t) return;
    const el = document.createElement("div");
    el.className = "erklaer-inhalt";
    el.innerHTML = `<h3>${esc(t[0])}</h3><p>${esc(t[1])}</p>`;
    this._ueberOeffnen(t[0], el, true);
  }

  /* --------- Überlagerung, Rückfrage, Bedienung --------- */

  _ueberOeffnen(titel, element, klein) {
    const u = this.shadowRoot.getElementById("ueber");
    this.shadowRoot.getElementById("utitel").textContent = titel;
    const inhalt = u.querySelector(".finhalt");
    inhalt.innerHTML = "";
    inhalt.appendChild(element);
    u.querySelector(".fenster").style.cssText = klein ? "width:min(560px,100%);height:auto;align-self:center" : "";
    u.classList.remove("zu");
  }

  _oeffneAnlage(titel, opts) {
    if (!customElements.get("hargassner-anlage-card")) return;
    const el = document.createElement("hargassner-anlage-card");
    el.setAttribute("eingebettet", "");
    el.setConfig({ ...this._a, type: "custom:hargassner-anlage-card" });
    el.hass = this._hass;
    this._eingebettet = el;
    this._ueberOeffnen(titel, el);
    requestAnimationFrame(() => el.oeffne(opts));
  }

  _frageHtml() {
    const q = this._frage;
    return `<div class="bestaetigen"><div class="box"><h3>${esc(q.titel)}</h3><div>${esc(q.text)}</div>${q.felder || ""}
      <div class="knoepfe"><button class="nein" data-frage="nein">Abbrechen</button><button class="ja" data-frage="ja">${esc(q.ja || "Ja, ändern")}</button></div></div></div>`;
  }

  _klick(e) {
    const el = e.target.closest("[data-schritt],[data-art],[data-kessel],[data-zp],[data-trend],[data-fach],[data-schliessen],[data-frage],[data-teil],[data-asche],[data-lager],[data-voll],[data-gross]");
    if (!el) return;
    const d = el.dataset;
    if (d.frage) {
      const q = this._frage;
      this._frage = null;
      if (d.frage === "ja" && q) q.aktion(this.shadowRoot.querySelector(".bestaetigen"));
      this._zeichnen();
    } else if (d.gross !== undefined) {
      const el2 = document.createElement("div");
      el2.className = "vollbild";
      el2.innerHTML = this._schema();
      this._ueberOeffnen("Schema", el2);
      requestAnimationFrame(() => (el2.scrollLeft = 0));
    } else if (d.voll !== undefined) {
      this.shadowRoot.querySelectorAll("[data-voll]").forEach((b) => b.classList.toggle("an", b === el));
    } else if (d.asche !== undefined) {
      const stufen = [["", "Weiss nicht"], ["25", "Fast leer"], ["50", "Halb voll"], ["75", "Fast voll"], ["100", "Ganz voll"]];
      this._frage = {
        titel: "Aschebox geleert und Kessel gereinigt?",
        text: "Wie voll war die Box ungefähr? Damit wird die Berechnung genauer.",
        felder: `<div class="wahl klein" style="margin-top:12px">${stufen.map(([w, t]) => `<button data-voll="${w}" class="${w === "" ? "an" : ""}">${t}</button>`).join("")}</div>`,
        ja: "Ja, erledigt",
        aktion: (box) => {
          const w = box?.querySelector("[data-voll].an")?.dataset.voll;
          const daten = w ? { fuellstand: parseFloat(w) } : {};
          this._hass.callService("hargassner_touch_pro", "asche_geleert", daten);
        },
      };
      this._zeichnen();
    } else if (d.lager !== undefined) {
      const vorher = this._z(this._v.lager_menge) || "";
      this._frage = {
        titel: "Lager aufgefüllt?",
        text: "Wie viele Kubikmeter Holzschnitzel sind jetzt im Lager (lose gemessen, wie auf dem Lieferschein)?",
        felder: `<div style="margin-top:12px;display:flex;align-items:center;gap:8px"><input type="number" min="1" max="500" step="0.5" value="${vorher}" data-menge style="font:inherit;font-size:20px;width:120px;padding:6px 8px;border:1px solid #cfd4da;border-radius:8px"> m³</div>`,
        ja: "Speichern",
        aktion: (box) => {
          const menge = parseFloat(box?.querySelector("[data-menge]")?.value);
          if (menge > 0) this._hass.callService("hargassner_touch_pro", "lager_gefuellt", { menge });
        },
      };
      this._zeichnen();
    } else if (d.schritt) this._schritt(d.entity, parseFloat(d.schritt));
    else if (d.art) {
      if (this._roh(d.art) === d.wert) return;
      const name = BETRIEBSART[d.wert]?.text || d.wert;
      if (d.wert === "Aus") {
        this._frage = { titel: "Heizung für dieses Haus ausschalten?", text: "Das Haus wird dann nicht mehr geheizt, nur noch vor Frost geschützt.", ja: "Ja, ausschalten", aktion: () => this._waehlen(d.art, d.wert) };
        this._zeichnen();
      } else {
        this._waehlen(d.art, d.wert);
        this._toast?.(name);
      }
    } else if (d.kessel) {
      if (this._roh(d.kessel) === d.wert) return;
      const ziel = KESSELPROGRAMM[d.wert];
      this._frage = { titel: `Holzkessel auf «${ziel?.text || d.wert}» stellen?`, text: ziel?.hilfe || "", ja: "Ja, umstellen", aktion: () => this._waehlen(d.kessel, d.wert) };
      this._zeichnen();
    } else if (d.zp) this._oeffneAnlage("Zeitplan", { reiter: "dashboard", zeitprogramm: d.zp });
    else if (d.trend !== undefined) this._oeffneAnlage("Verlauf", { trend: d.trend });
    else if (d.fach !== undefined) this._oeffneAnlage("Für Fachleute", { reiter: "dashboard" });
    else if (d.schliessen !== undefined) {
      const u = this.shadowRoot.getElementById("ueber");
      u.classList.add("zu");
      u.querySelector(".finhalt").innerHTML = "";
      this._eingebettet = null;
    } else if (d.teil) this._erklaerung(d.teil);
  }

  _waehlen(id, wert) {
    this._hass.callService("select", "select_option", { entity_id: id, option: wert });
  }

  _schritt(id, richtung) {
    const s = this._s(id);
    if (!s) return;
    const at = s.attributes;
    const st = at.step || 0.5;
    const basis = this._ausstehend[id]?.wert ?? zahl(s.state) ?? 0;
    let neu = Math.round((basis + richtung * st) / st) * st;
    neu = parseFloat(Math.min(at.max ?? neu, Math.max(at.min ?? neu, neu)).toFixed(3));
    clearTimeout(this._ausstehend[id]?.timer);
    const timer = setTimeout(() => {
      this._hass.callService("number", "set_value", { entity_id: id, value: neu }).finally(() => {
        delete this._ausstehend[id];
        this._zeichnen();
      });
    }, 1500);
    this._ausstehend[id] = { wert: neu, timer };
    this._zeichnen();
  }

  static getStubConfig() {
    return { anlage: { titel: "Anlage" } };
  }
}

function schemaKarteAnmelden() {
  if (customElements.get(KARTE_SCHEMA)) return true;
  try {
    customElements.define(KARTE_SCHEMA, class extends HargassnerSchemaCard {});
  } catch (e) {
    return false;
  }
  return true;
}
schemaKarteAnmelden();
window.customCards = window.customCards || [];
if (!window.customCards.some((k) => k.type === KARTE_SCHEMA)) {
  window.customCards.push({ type: KARTE_SCHEMA, name: "Hargassner Schema", description: "Heizung als einfaches Schema mit Bedienung in Alltagssprache" });
}
let versucheSchema = 0;
const prueferSchema = setInterval(() => {
  schemaKarteAnmelden();
  if (++versucheSchema >= 60) clearInterval(prueferSchema);
}, 500);
