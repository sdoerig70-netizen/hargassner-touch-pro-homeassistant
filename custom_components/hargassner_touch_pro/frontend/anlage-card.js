/*
 * Anlagen-Karte für die Integration «Hargassner Touch Pro».
 *
 * Bildet die Ansicht der Hargassner-App nach: Kacheln für Wetter, Kessel,
 * Puffer, Heizkreise und Frischwasserstation, dazu Kessel-Details und
 * Signale. Oben Reiter für Dashboard, Parameter, Messwerte und Heizkurve.
 *
 * Parameter und Messkanäle werden automatisch aus der Integration gefunden,
 * die Kacheln brauchen eine Zuordnung der Entitäten (siehe README).
 */

const PLATTFORM = "hargassner_touch_pro";

const FARBEN = ["#e2001a", "#2b7bd6", "#f08c00", "#3aa655", "#8e44ad", "#16a3b8", "#c0392b", "#7f8c8d", "#d35400", "#2c3e50"];

const WOCHENTAGE = ["SO", "MO", "DI", "MI", "DO", "FR", "SA"];
const WOCHENTAGE_KURZ = ["So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."];

function zahl(wert) {
  const n = parseFloat(wert);
  return Number.isFinite(n) ? n : null;
}

function komma(n, stellen) {
  return n.toFixed(stellen).replace(".", ",");
}

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (z) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[z]));
}

const TAGE_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const TAGE_KURZ = { MO: "Mo", TU: "Di", WE: "Mi", TH: "Do", FR: "Fr", SA: "Sa", SU: "So" };
const TAGE_NAMEN = { MO: "Montag", TU: "Dienstag", WE: "Mittwoch", TH: "Donnerstag", FR: "Freitag", SA: "Samstag", SU: "Sonntag" };

// «T06:00PT2H30M» → { von: 360, bis: 510 }, «T00:00P1D» → ganzer Tag
function zpLesen(text) {
  const m = String(text).match(/^T(\d{2}):(\d{2})(?:(P1D)|PT(?:(\d+)H)?(?:(\d+)M)?)$/);
  if (!m) return null;
  const von = +m[1] * 60 + +m[2];
  const dauer = m[3] ? 1440 : +(m[4] || 0) * 60 + +(m[5] || 0);
  return { von, bis: Math.min(1440, von + dauer) };
}

function zpSchreiben(f) {
  const start = `T${String(Math.floor(f.von / 60)).padStart(2, "0")}:${String(f.von % 60).padStart(2, "0")}`;
  if (f.von === 0 && f.bis >= 1440) return start + "P1D";
  const d = f.bis - f.von;
  return `${start}PT${Math.floor(d / 60) ? Math.floor(d / 60) + "H" : ""}${d % 60 ? (d % 60) + "M" : ""}`;
}

function isoTag(datum) {
  const d = new Date(datum);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function uhrzeit(datum) {
  return datum.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}

/* ---------- Wetter-Symbole ---------- */

function wetterArt(text, nacht) {
  const t = String(text || "").toLowerCase();
  if (/gewitter/.test(t)) return "gewitter";
  if (/schnee|graupel/.test(t)) return "schnee";
  if (/regen|schauer|niesel/.test(t)) return "regen";
  if (/nebel|dunst/.test(t)) return "nebel";
  if (/stark|bedeckt/.test(t)) return "bewoelkt";
  if (/leicht|teilweise|heiter|wolkig|bewölkt/.test(t)) return nacht ? "nacht_wolke" : "teilweise";
  if (/klar|sonnig/.test(t)) return nacht ? "nacht" : "sonne";
  return nacht ? "nacht_wolke" : "teilweise";
}

function wetterSymbol(art, groesse) {
  const sonne = (x, y, r) => {
    let strahlen = "";
    for (let i = 0; i < 8; i++) {
      const w = (i * Math.PI) / 4;
      strahlen += `<line x1="${x + Math.cos(w) * (r + 3)}" y1="${y + Math.sin(w) * (r + 3)}" x2="${x + Math.cos(w) * (r + 8)}" y2="${y + Math.sin(w) * (r + 8)}" stroke="#f7b500" stroke-width="3" stroke-linecap="round"/>`;
    }
    return `${strahlen}<circle cx="${x}" cy="${y}" r="${r}" fill="#fbc531"/>`;
  };
  const mond = (x, y, r) => `<path d="M${x + r * 0.3} ${y - r} a${r} ${r} 0 1 0 ${r * 0.7} ${r * 1.55} a${r * 0.8} ${r * 0.8} 0 0 1 ${-r * 0.7} ${-r * 1.55}z" fill="#f7b500"/>`;
  const wolke = (x, y, s, farbe) =>
    `<path transform="translate(${x} ${y}) scale(${s})" d="M10 30 a10 10 0 0 1 2-19.8 a14 14 0 0 1 26.5-3.5 a11 11 0 0 1 13.5 11 a8 8 0 0 1-2 15.8 z" fill="${farbe}"/>`;
  const tropfen = (y, farbe) =>
    [22, 32, 42].map((x) => `<line x1="${x}" y1="${y}" x2="${x - 4}" y2="${y + 9}" stroke="${farbe}" stroke-width="2.5" stroke-linecap="round"/>`).join("");
  let inhalt = "";
  switch (art) {
    case "sonne":
      inhalt = sonne(32, 32, 13);
      break;
    case "nacht":
      inhalt = mond(30, 32, 14);
      break;
    case "teilweise":
      inhalt = sonne(40, 22, 10) + wolke(6, 22, 0.95, "#a9b4c0");
      break;
    case "nacht_wolke":
      inhalt = mond(38, 20, 10) + wolke(6, 24, 0.95, "#a9b4c0");
      break;
    case "bewoelkt":
      inhalt = wolke(14, 12, 0.8, "#c3cbd4") + wolke(4, 22, 0.95, "#97a3b0");
      break;
    case "regen":
      inhalt = wolke(6, 8, 0.95, "#97a3b0") + tropfen(46, "#2b7bd6");
      break;
    case "schnee":
      inhalt = wolke(6, 8, 0.95, "#a9b4c0") + [20, 32, 44].map((x) => `<circle cx="${x}" cy="52" r="3" fill="#7fb3e6"/>`).join("");
      break;
    case "gewitter":
      inhalt = wolke(6, 8, 0.95, "#7d8894") + `<path d="M34 40 l-8 12 h7 l-4 10 l11-14 h-7 l4-8z" fill="#f7b500"/>`;
      break;
    default:
      inhalt = wolke(6, 18, 0.95, "#a9b4c0");
  }
  return `<svg viewBox="0 0 64 64" width="${groesse}" height="${groesse}">${inhalt}</svg>`;
}

/* ---------- Anlagen-Grafiken ---------- */

function blase(x, y, text, farbe, r = 10) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" stroke="${farbe}" stroke-width="1.6"/>
    <text x="${x}" y="${y + 3.2}" text-anchor="middle" font-size="${text.length > 3 ? 7.5 : 8.5}" fill="${farbe}" font-weight="600">${esc(text)}</text>`;
}

function pumpe(x, y, aktiv) {
  const farbe = aktiv ? "#56a83c" : "#a0a0a0";
  return `<circle cx="${x}" cy="${y}" r="9" fill="#fff" stroke="#8c8c8c" stroke-width="1.2"/>
    <path d="M${x - 5.5} ${y - 3.5} h11 l-5.5 9z" fill="${farbe}"/>`;
}

function grafikKessel(temp, abgas, brennt) {
  const flamme = brennt ? "#f07a1a" : "#b5b5b5";
  return `<svg viewBox="0 0 120 112" class="grafik">
    <defs><linearGradient id="kg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f58a2a"/><stop offset="1" stop-color="#e2531b"/></linearGradient></defs>
    <path d="M30 18 H18 V12" fill="none" stroke="#9a9a9a" stroke-width="4"/>
    <rect x="28" y="6" width="80" height="100" rx="3" fill="#8e8e8e"/>
    <rect x="34" y="11" width="68" height="78" fill="url(#kg)"/>
    <rect x="34" y="89" width="68" height="12" fill="#c8c8c8"/>
    <circle cx="68" cy="40" r="17" fill="#fff" stroke="#e2001a" stroke-width="2"/>
    <text x="68" y="45" text-anchor="middle" font-size="13" font-weight="700" fill="#e2001a">${esc(temp)}</text>
    <circle cx="68" cy="76" r="11" fill="#fff"/>
    <path d="M68 66 c5 6 7 9 7 13 a7 7 0 0 1-14 0 c0-4 3-6 4-9 c1 3 2 4 3 4 c0-3-1-5 0-8z" fill="${flamme}"/>
    ${blase(16, 22, abgas, "#e2001a", 11)}
  </svg>`;
}

function grafikPuffer(ladung, oben, mitte, unten, pumpeAn) {
  return `<svg viewBox="0 0 120 112" class="grafik">
    <defs><linearGradient id="pg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#d0103a"/><stop offset=".5" stop-color="#7a3b84"/><stop offset="1" stop-color="#1f62b5"/></linearGradient></defs>
    <path d="M44 94 V100 H18 V92" fill="none" stroke="#9a9a9a" stroke-width="3"/>
    <rect x="36" y="6" width="50" height="92" rx="25" fill="url(#pg)" stroke="#c9c9c9" stroke-width="2"/>
    <text x="61" y="57" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">${esc(ladung)}</text>
    ${blase(96, 24, oben, "#d0103a")}
    ${blase(96, 52, mitte, "#7a3b84")}
    ${blase(96, 80, unten, "#1f62b5")}
    ${pumpe(18, 92, pumpeAn)}
  </svg>`;
}

function grafikHeizkreis(vorlauf, pumpeAn) {
  let rippen = "";
  for (let i = 0; i < 9; i++) rippen += `<rect x="${36 + i * 8}" y="14" width="6" height="40" rx="2" fill="#f7b731" stroke="#e08e0b" stroke-width="1"/>`;
  return `<svg viewBox="0 0 120 112" class="grafik">
    <path d="M18 70 V18 H36" fill="none" stroke="#e2531b" stroke-width="4"/>
    <rect x="34" y="16" width="76" height="6" fill="#f7b731" stroke="#e08e0b" stroke-width="1"/>
    <rect x="34" y="48" width="76" height="6" fill="#f7b731" stroke="#e08e0b" stroke-width="1"/>
    ${rippen}
    ${blase(18, 40, vorlauf, "#e2001a", 11)}
    ${pumpe(18, 72, pumpeAn)}
  </svg>`;
}

function grafikFrischwasser(temp, pumpeAn) {
  return `<svg viewBox="0 0 120 112" class="grafik">
    <defs><linearGradient id="fg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f58a2a"/><stop offset="1" stop-color="#e2531b"/></linearGradient></defs>
    <path d="M50 76 V84 H18 V94" fill="none" stroke="#9a9a9a" stroke-width="3"/>
    <rect x="40" y="10" width="54" height="68" rx="24" fill="url(#fg)" stroke="#c9c9c9" stroke-width="2"/>
    <circle cx="67" cy="44" r="15" fill="#fff" stroke="#e2001a" stroke-width="2"/>
    <text x="67" y="48.5" text-anchor="middle" font-size="12" font-weight="700" fill="#e2001a">${esc(temp)}</text>
    ${pumpe(18, 96, pumpeAn)}
  </svg>`;
}

/* ---------- Stil ---------- */

const STIL = `
:host { display:block; }
.app { background:#e4e5e7; color:#333; font-family:"Helvetica Neue", Helvetica, Arial, sans-serif; min-height:100vh; }
:host([eingebettet]) .app { min-height:0; }
.kopf { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px; background:#fff; border-bottom:1px solid #d5d6d8; padding:0 16px; min-height:44px; }
.pfad { font-size:13px; color:#555; }
.pfad b { color:#2b7bd6; font-weight:400; }
.reiter { display:flex; flex-wrap:wrap; }
.reiter button { border:0; background:none; font:inherit; font-size:13px; color:#666; padding:12px 10px; cursor:pointer; display:flex; align-items:center; gap:5px; }
.reiter button.aktiv { color:#222; font-weight:700; }
.reiter ha-icon { --mdc-icon-size:16px; }
.inhalt { padding:16px; box-sizing:border-box; width:100%; }
.raster { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap:18px; }
.kachel { background:linear-gradient(180deg, #f6f6f4 0%, #ebebe8 100%); border-radius:3px; box-shadow:0 1px 3px rgba(0,0,0,.22); padding:14px 20px 18px; position:relative; overflow:hidden; min-height:200px; }
.kachel .wasser { position:absolute; right:-6px; bottom:-34px; font-size:150px; font-weight:700; color:rgba(0,0,0,.035); pointer-events:none; line-height:1; }
.kachel h2 { margin:2px 0 12px; font-size:22px; font-weight:400; text-transform:uppercase; letter-spacing:.3px; color:#333; }
.knoepfe { position:absolute; top:10px; right:12px; display:flex; gap:6px; }
.knopf { width:30px; height:30px; border:0; border-radius:2px; display:flex; align-items:center; justify-content:center; cursor:pointer; color:#fff; }
.knopf.blau { background:#3a8fd8; }
.knopf.grau { background:#a3a3a3; }
.knopf.gruen { background:#3aa655; }
.knopf.orange { background:#f08c00; }
.zp-hinter { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:20; display:flex; align-items:flex-start; justify-content:center; overflow:auto; padding:40px 12px; box-sizing:border-box; }
.zp { background:#fff; border-radius:3px; box-shadow:0 6px 30px rgba(0,0,0,.35); width:min(860px, 100%); padding:18px 22px; box-sizing:border-box; }
.zp h3 { margin:0 0 4px; font-size:17px; }
.zp .unter { font-size:12px; color:#777; margin-bottom:14px; }
.zp-woche { display:grid; grid-template-columns:34px 1fr; gap:4px 8px; align-items:center; font-size:11.5px; margin-bottom:6px; }
.zp-balken { position:relative; height:14px; background:#eef0f2; border-radius:2px; overflow:hidden; }
.zp-balken i { position:absolute; top:0; bottom:0; background:#3aa655; }
.zp-skala { display:flex; justify-content:space-between; font-size:10px; color:#999; margin:0 0 14px 42px; }
.zp-eintrag { border:1px solid #e3e3e3; border-radius:3px; padding:10px 12px; margin-bottom:10px; }
.zp-kopf { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
.zp-tage { display:flex; gap:4px; flex-wrap:wrap; }
.zp-tage button { width:38px; height:30px; border:1px solid #d0d0d0; background:#fff; border-radius:2px; font:inherit; font-size:12px; cursor:pointer; color:#555; }
.zp-tage button.an { background:#3a8fd8; border-color:#3a8fd8; color:#fff; font-weight:700; }
.zp-fenster { display:flex; align-items:center; gap:8px; font-size:12.5px; margin:6px 0; flex-wrap:wrap; }
.zp-fenster input { font:inherit; font-size:13px; padding:4px 6px; border:1px solid #d0d0d0; border-radius:2px; }
.zp-link { border:0; background:none; color:#2b7bd6; font:inherit; font-size:12.5px; cursor:pointer; padding:4px 0; }
.zp-link.rot { color:#e2001a; }
.zp-fuss { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:14px; flex-wrap:wrap; }
.zp-fuss .knoepfe2 { display:flex; gap:8px; margin-left:auto; }
.zp-fuss button.haupt { background:#3aa655; color:#fff; border:0; padding:8px 18px; border-radius:2px; font:inherit; font-weight:700; cursor:pointer; }
.zp-fuss button.neben { background:#fff; color:#333; border:1px solid #d0d0d0; padding:8px 14px; border-radius:2px; font:inherit; cursor:pointer; }
.zp-fehler { color:#e2001a; font-size:12.5px; }
.knopf ha-icon { --mdc-icon-size:18px; }
.koerper { display:grid; grid-template-columns:136px 1fr; gap:14px; align-items:start; }
.grafik { width:136px; height:auto; display:block; }
.info .name { font-size:12px; font-weight:700; text-transform:uppercase; margin:0 0 6px; letter-spacing:.3px; }
.zeile { display:flex; justify-content:space-between; gap:8px; font-size:13px; padding:3px 0; cursor:pointer; }
.zeile:hover { color:#2b7bd6; }
.zeile .wert { text-align:right; white-space:nowrap; }
.zeile .soll { color:#999; font-size:11px; }
.korrektur { display:flex; align-items:center; justify-content:center; gap:6px; margin-top:6px; font-size:10px; color:#666; }
.korrektur button { width:24px; height:22px; border:0; border-radius:2px; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.25); font-size:16px; line-height:1; cursor:pointer; }
.korrektur button.minus { color:#3a8fd8; }
.korrektur button.plus { color:#e2001a; }
.wetter { display:grid; grid-template-columns:1fr 1fr; gap:6px 14px; }
.wetter .gross { display:flex; align-items:center; gap:4px; }
.wetter .temp { font-size:22px; }
.wetter .text { font-size:10.5px; color:#666; }
.wetter .zeile ha-icon { --mdc-icon-size:13px; color:#777; margin-right:3px; }
.sonne { display:flex; justify-content:space-between; font-size:11px; color:#555; margin-top:4px; grid-column:1; }
.sonne ha-icon { --mdc-icon-size:13px; }
.vorschau { display:flex; justify-content:space-around; margin-top:10px; grid-column:1 / -1; }
.vorschau div { text-align:center; font-size:12px; color:#555; }
.signale { display:grid; grid-template-columns:1fr 1fr; gap:2px 18px; }
.led { width:9px; height:9px; border-radius:50%; display:inline-block; margin-right:6px; background:#bdbdbd; box-shadow:inset 0 0 0 1px rgba(0,0,0,.12); }
.led.an { background:#56a83c; }
.led.warn { background:#f0a500; }
.led.fehler { background:#e2001a; }
.signale .zeile { justify-content:flex-start; align-items:center; }
.liste .zeile { font-size:12px; padding:3.5px 0; border-bottom:1px solid rgba(0,0,0,.05); }
.zweispalt { display:grid; grid-template-columns:240px minmax(0, 1fr); gap:16px; align-items:start; }
@media (max-width: 720px) { .zweispalt { grid-template-columns:1fr; } }
.gruppen { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
.gruppen button { display:flex; align-items:center; gap:4px; border:0; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.18); border-radius:2px; padding:9px 14px; font:inherit; font-size:12.5px; font-weight:700; color:#333; cursor:pointer; }
.gruppen button.aktiv { background:#3a8fd8; color:#fff; }
.gruppen button small { font-weight:400; color:inherit; opacity:.6; font-size:10px; margin-left:4px; }
.gruppen ha-icon { --mdc-icon-size:16px; margin-right:6px; }
.blatt { background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.18); border-radius:2px; padding:12px 16px; }
.blatt h3 { margin:4px 0 10px; font-size:15px; font-weight:700; }
.param { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 0; border-bottom:1px solid #eee; font-size:12.5px; }
.param:last-child { border-bottom:0; }
.param .label { cursor:pointer; }
.param .label:hover { color:#2b7bd6; }
.param .nur { color:#666; text-align:right; }
.stepper { display:flex; align-items:center; gap:6px; }
.stepper button { width:26px; height:26px; border:1px solid #d0d0d0; background:#f7f7f7; color:#333; border-radius:2px; font-size:15px; cursor:pointer; }
.stepper span { min-width:70px; text-align:center; font-weight:700; }
.stepper span.wartet { color:#f08c00; }
select { font:inherit; font-size:12.5px; padding:4px 6px; border:1px solid #d0d0d0; border-radius:2px; background:#fff; color:#333; max-width:220px; }
.schalter { width:38px; height:20px; border-radius:10px; background:#bdbdbd; position:relative; cursor:pointer; border:0; }
.schalter::after { content:""; position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff; transition:left .15s; }
.schalter.an { background:#56a83c; }
.schalter.an::after { left:20px; }
.zeitraum { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:10px; font-size:12px; color:#555; }
.zeitraum button { border:1px solid #d0d0d0; background:#fff; color:#333; padding:5px 10px; font:inherit; font-size:12px; cursor:pointer; border-radius:2px; }
.zeitraum button.aktiv { background:#3a8fd8; color:#fff; border-color:#3a8fd8; }
.zeitraum input[type=date] { font:inherit; font-size:12px; padding:4px 6px; border:1px solid #d0d0d0; border-radius:2px; background:#fff; color:#333; }
.zeitraum .trenner { width:1px; height:22px; background:#ddd; margin:0 4px; }
.navi { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
.navi button { border:1px solid #d0d0d0; background:#fff; color:#333; min-width:34px; height:30px; font:inherit; font-size:15px; cursor:pointer; border-radius:2px; }
.navi .datum { flex:1; text-align:center; border:1px solid #d0d0d0; background:#fff; border-radius:2px; padding:5px 10px; font-size:13px; font-weight:700; }
.navi button.jetzt { font-size:12px; font-weight:700; color:#3aa655; border-color:#3aa655; padding:0 12px; }
.navi button.jetzt.aktiv { background:#3aa655; color:#fff; }
.navi button:disabled { opacity:.35; cursor:default; }
.zeitraum .zoominfo { font-size:11.5px; color:#666; margin-left:auto; }
.diagramm { margin-bottom:16px; position:relative; }
.diagramm svg { cursor:crosshair; touch-action:pan-y; user-select:none; }
.diagramm h4 { margin:0 0 4px; font-size:12px; color:#555; font-weight:700; }
.diagramm svg { width:100%; height:auto; display:block; max-width:100%; }
.legende { display:flex; flex-wrap:wrap; gap:4px 12px; font-size:11.5px; margin-top:4px; }
.legende span { cursor:pointer; display:flex; align-items:center; gap:5px; }
.legende span.aus { opacity:.35; }
.legende i { width:12px; height:3px; display:inline-block; }
.tipp { position:absolute; pointer-events:none; background:rgba(40,40,40,.92); color:#fff; font-size:11px; padding:6px 8px; border-radius:3px; white-space:nowrap; display:none; z-index:2; }
.leer { color:#777; font-size:12.5px; padding:20px 0; text-align:center; }
.kurve-rahmen { --primary-text-color:#333; --secondary-text-color:#777; --divider-color:#d8d8d8; --card-background-color:#fff; --ha-card-background:#fff; --secondary-background-color:#f1f1f1; --ha-card-box-shadow:0 1px 3px rgba(0,0,0,.22); --ha-card-border-radius:3px; }
`;

/* ---------- Karte ---------- */

class HargassnerAnlageCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._reiter = "dashboard";
    this._paramGruppe = null;
    this._messGruppe = null;
    this._zeitraum = "heute";
    this._eigen = null;
    this._versatz = 0;
    this._zoom = null;
    this._ausgeblendet = new Set();
    this._ausstehend = {};
    this._verlauf = {};
    this._signatur = "";
    this.shadowRoot.addEventListener("click", (e) => this._klick(e));
    this.shadowRoot.addEventListener("change", (e) => this._aenderung(e));
  }

  setConfig(config) {
    this._config = config || {};
    this._signatur = "";
    if (this._hass) this._render(true);
  }

  set hass(hass) {
    const erstes = !this._hass;
    this._hass = hass;
    if (this._kurve) this._kurve.hass = hass;
    if (erstes) {
      this._render(true);
      return;
    }
    if (this._reiter === "dashboard" || this._reiter === "parameter") {
      const sig = this._berechneSignatur();
      if (sig !== this._signatur && !this._fokusIntern()) this._render(false);
    }
  }

  getCardSize() {
    return 12;
  }

  connectedCallback() {
    this._takt = setInterval(() => {
      if (this._reiter === "messwerte") this._ladeVerlauf(true);
    }, 5 * 60 * 1000);
  }

  disconnectedCallback() {
    clearInterval(this._takt);
    if (this._fensterHorcher) window.removeEventListener("resize", this._fensterHorcher);
    this._fensterHorcher = null;
    this._beobachter?.disconnect();
  }

  /* --- Hilfen für Zustände --- */

  _s(id) {
    return id ? this._hass.states[id] : undefined;
  }

  _roh(id) {
    const s = this._s(id);
    if (!s || s.state === "unknown" || s.state === "unavailable" || s.state === "") return null;
    return s.state;
  }

  _zahl(id) {
    return zahl(this._roh(id));
  }

  _einheit(id) {
    return this._s(id)?.attributes.unit_of_measurement || "";
  }

  _fmt(id, stellen = 1, einheit) {
    const roh = this._roh(id);
    if (roh === null) return "–";
    const n = zahl(roh);
    const e = einheit !== undefined ? einheit : this._einheit(id);
    if (n === null || !/^-?[\d.]+$/.test(roh)) return esc(roh) + (e ? " " + e : "");
    let wert = n;
    let ein = e;
    if (e === "bar" && n > 0.5 && n < 1.2) {
      wert = n * 1000;
      ein = "hPa";
    }
    const st = Number.isInteger(wert) && stellen < 2 ? 0 : stellen;
    const text = komma(wert, st);
    if (!ein) return text;
    return ein === "°C" || ein === "%" ? text + ein : text + " " + ein;
  }

  _grad(id) {
    const n = this._zahl(id);
    return n === null ? "–" : Math.trunc(n) + "°";
  }

  _an(id) {
    const r = this._roh(id);
    return r === "on" || r === "1" || r === "True" || r === "true";
  }

  _berechneSignatur() {
    const teile = [this._reiter, this._paramGruppe];
    for (const [id, s] of Object.entries(this._hass.states)) {
      if (this._relevant(id)) teile.push(id + "=" + s.state);
    }
    teile.push(JSON.stringify(this._ausstehend));
    return teile.join("|");
  }

  _relevant(id) {
    const e = this._hass.entities?.[id];
    if (e && e.platform === PLATTFORM) return true;
    return this._konfigIds().has(id);
  }

  _konfigIds() {
    if (this._ids) return this._ids;
    const ids = new Set();
    const sammeln = (o) => {
      if (!o) return;
      if (typeof o === "string" && /^[a-z_]+\.[a-z0-9_]+$/.test(o)) ids.add(o);
      else if (Array.isArray(o)) o.forEach(sammeln);
      else if (typeof o === "object") Object.values(o).forEach(sammeln);
    };
    sammeln(this._config);
    this._ids = ids;
    return ids;
  }

  _fokusIntern() {
    const a = this.shadowRoot.activeElement;
    return (a && (a.tagName === "SELECT" || a.tagName === "INPUT")) || !!this._zpOffen;
  }

  _mehrInfo(id) {
    if (!id) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: id }, bubbles: true, composed: true }));
  }

  /* --- Ereignisse --- */

  _klick(e) {
    const el = e.target.closest("[data-tab],[data-mehr],[data-pgruppe],[data-mgruppe],[data-schritt],[data-schalter],[data-zeitraum],[data-linie],[data-param],[data-zoom],[data-schieben],[data-trend],[data-zp],[data-zpa]");
    if (!el) return;
    const d = el.dataset;
    if (d.zpa !== undefined) {
      this._zpAktion(d);
    } else if (d.zp) {
      this._zpOeffnen(d.zp);
    } else if (d.trend) {
      const [typ, nr] = d.trend.split("|");
      const gruppen = this._messGruppen().filter((g) => g.typ === typ);
      const g = gruppen.find((x) => String(x.nr) === String(nr)) || gruppen[0];
      if (g) this._messGruppe = g.name;
      this._reiter = "messwerte";
      this._zoom = null;
      this._render(true);
    } else if (d.tab) {
      this._reiter = d.tab;
      this._render(true);
    } else if (d.param !== undefined) {
      this._reiter = "parameter";
      this._paramGruppe = d.param || null;
      this._render(true);
    } else if (d.mehr) {
      this._mehrInfo(d.mehr);
    } else if (d.pgruppe) {
      this._paramGruppe = d.pgruppe;
      this._render(true);
    } else if (d.mgruppe) {
      this._messGruppe = d.mgruppe;
      this._render(true);
    } else if (d.zeitraum) {
      if (d.zeitraum === "eigen") {
        if (!this._eigen) {
          const [von, bis] = this._zeitfenster();
          this._eigen = { von: isoTag(von), bis: isoTag(new Date(bis - 1)) };
        }
      }
      this._zeitraum = d.zeitraum;
      this._versatz = 0;
      this._zoom = null;
      this._render(true);
    } else if (d.zoom) {
      this._zoomen(d.zoom);
    } else if (d.schieben) {
      this._schieben(d.schieben);
    } else if (d.linie) {
      if (this._ausgeblendet.has(d.linie)) this._ausgeblendet.delete(d.linie);
      else this._ausgeblendet.add(d.linie);
      this._zeichneDiagramme();
    } else if (d.schritt) {
      this._schritt(d.entity, parseFloat(d.schritt));
    } else if (d.schalter) {
      this._hass.callService("switch", this._an(d.schalter) ? "turn_off" : "turn_on", { entity_id: d.schalter });
    }
  }

  _aenderung(e) {
    const el = e.target;
    if (el.dataset.auswahl) {
      this._hass.callService("select", "select_option", { entity_id: el.dataset.auswahl, option: el.value });
    } else if (el.dataset.zpzeit) {
      this._zpZeit(el.dataset.zpzeit, el.value);
    } else if (el.dataset.datum) {
      if (!el.value) return;
      this._eigen = { ...(this._eigen || {}), [el.dataset.datum]: el.value };
      if (this._eigen.von > this._eigen.bis) {
        if (el.dataset.datum === "von") this._eigen.bis = el.value;
        else this._eigen.von = el.value;
      }
      this._zeitraum = "eigen";
      this._versatz = 0;
      this._zoom = null;
      this._render(true);
    }
  }

  _schritt(id, richtung) {
    const s = this._s(id);
    if (!s) return;
    const a = s.attributes;
    const schritt = a.step || 0.5;
    const basis = this._ausstehend[id]?.wert ?? zahl(s.state) ?? 0;
    let neu = Math.round((basis + richtung * schritt) / schritt) * schritt;
    neu = Math.min(a.max ?? neu, Math.max(a.min ?? neu, neu));
    neu = parseFloat(neu.toFixed(3));
    clearTimeout(this._ausstehend[id]?.timer);
    const timer = setTimeout(() => {
      this._hass.callService("number", "set_value", { entity_id: id, value: neu }).finally(() => {
        setTimeout(() => {
          delete this._ausstehend[id];
          this._render(false);
        }, 1500);
      });
    }, 1200);
    this._ausstehend[id] = { wert: neu, timer };
    this._render(false);
  }

  _wertMitAusstehend(id, stellen = 1) {
    const a = this._ausstehend[id];
    if (a) return { text: komma(a.wert, stellen) + (this._einheit(id) ? " " + this._einheit(id) : ""), wartet: true };
    return { text: this._fmt(id, stellen), wartet: false };
  }

  /* --- Rendern --- */

  _render(voll) {
    if (!this._hass || !this._config) return;
    this._ids = null;
    this._signatur = this._berechneSignatur();
    const c = this._config;
    const reiter = [
      ["dashboard", "Dashboard", "mdi:speedometer"],
      ["parameter", "Parameter", "mdi:wrench"],
      ["messwerte", "Messwerte", "mdi:chart-line"],
    ];
    if (c.heizkurve) reiter.push(["heizkurve", "Heizkurve", "mdi:chart-bell-curve-cumulative"]);
    const aktuellerName = reiter.find((r) => r[0] === this._reiter)?.[1] || "";
    let inhalt = "";
    if (this._reiter === "dashboard") inhalt = this._dashboard();
    else if (this._reiter === "parameter") inhalt = this._parameter();
    else if (this._reiter === "messwerte") inhalt = this._messwerte();
    else if (this._reiter === "heizkurve") inhalt = `<div class="kurve-rahmen" id="kurve"></div>`;

    if (!voll && this._reiter === "heizkurve") return;
    const html = `<style>${STIL}</style>
      <div class="app">
        <div class="kopf">
          <div class="pfad"><b>${esc(c.titel || "Anlage")}</b> &rsaquo; ${esc(aktuellerName)}</div>
          <div class="reiter">${reiter
            .map(([k, n, i]) => `<button data-tab="${k}" class="${k === this._reiter ? "aktiv" : ""}"><ha-icon icon="${i}"></ha-icon>${n}</button>`)
            .join("")}</div>
        </div>
        <div class="inhalt">${inhalt}</div>
        ${this._zpEditor()}
      </div>`;
    this.shadowRoot.innerHTML = html;

    if (this._reiter === "heizkurve") {
      this._kurve = document.createElement("hargassner-heizkurve-card");
      try {
        this._kurve.setConfig(c.heizkurve);
      } catch (e) {
        /* Konfigurationsfehler zeigt die Karte selbst */
      }
      this._kurve.hass = this._hass;
      this.shadowRoot.getElementById("kurve").appendChild(this._kurve);
    } else {
      this._kurve = null;
    }
    if (this._reiter === "messwerte") this._ladeVerlauf(false);
  }

  /* --- Zeitprogramm (Wochenuhr) --- */

  _zpOeffnen(id) {
    const a = this._s(id)?.attributes || {};
    if (!a.schreibbar) {
      this._mehrInfo(id);
      return;
    }
    const eintraege = (a.eintraege || [])
      .filter((e) => (e.days || []).length || (e.times || []).length)
      .map((e) => ({ tage: [...(e.days || [])], fenster: (e.times || []).slice(0, 2).map(zpLesen).filter(Boolean) }));
    if (!eintraege.length) eintraege.push({ tage: ["MO", "TU", "WE", "TH", "FR"], fenster: [{ von: 360, bis: 1320 }] });
    this._zpOffen = { id, eintraege, limit: a.limit || 7, fehler: "", speichert: false };
    this._render(true);
  }

  _zpAktion(d) {
    const z = this._zpOffen;
    if (!z) return;
    const [i, j] = String(d.zpa).split("|").map((x) => parseInt(x, 10));
    switch (d.zpart) {
      case "tag": {
        const t = z.eintraege[i].tage;
        const k = t.indexOf(d.tag);
        if (k >= 0) t.splice(k, 1);
        else t.push(d.tag);
        break;
      }
      case "fenster-neu":
        if (z.eintraege[i].fenster.length < 2) {
          const letztes = z.eintraege[i].fenster.at(-1);
          const von = letztes ? Math.min(letztes.bis + 60, 1380) : 360;
          z.eintraege[i].fenster.push({ von, bis: Math.min(von + 120, 1440) });
        }
        break;
      case "fenster-weg":
        z.eintraege[i].fenster.splice(j, 1);
        break;
      case "neu":
        if (z.eintraege.length < z.limit) z.eintraege.push({ tage: [], fenster: [{ von: 360, bis: 1320 }] });
        break;
      case "weg":
        z.eintraege.splice(i, 1);
        break;
      case "ganz":
        z.eintraege[i].fenster = [{ von: 0, bis: 1440 }];
        break;
      case "abbrechen":
        this._zpOffen = null;
        break;
      case "speichern":
        this._zpSpeichern();
        return;
      default:
        return;
    }
    if (this._zpOffen) z.fehler = "";
    this._render(true);
  }

  _zpZeit(schluessel, wert) {
    const z = this._zpOffen;
    if (!z || !wert) return;
    const [i, j, art] = schluessel.split("|");
    const [h, m] = wert.split(":").map(Number);
    let min = h * 60 + m;
    min = Math.round(min / 15) * 15;
    const f = z.eintraege[+i].fenster[+j];
    if (art === "bis" && min === 0) min = 1440;
    f[art] = min;
    z.fehler = "";
    this._render(true);
  }

  _zpPruefen() {
    const z = this._zpOffen;
    const fertig = [];
    for (const [n, e] of z.eintraege.entries()) {
      if (!e.tage.length && !e.fenster.length) continue;
      if (!e.tage.length) return [null, `Eintrag ${n + 1}: bitte mindestens einen Tag wählen.`];
      if (!e.fenster.length) return [null, `Eintrag ${n + 1}: bitte ein Zeitfenster eintragen.`];
      const fenster = [...e.fenster].sort((a, b) => a.von - b.von);
      for (const f of fenster) if (f.bis <= f.von) return [null, `Eintrag ${n + 1}: «bis» muss nach «von» liegen.`];
      if (fenster.length === 2 && fenster[1].von < fenster[0].bis) return [null, `Eintrag ${n + 1}: die Zeitfenster überschneiden sich.`];
      fertig.push({ days: TAGE_CODES.filter((t) => e.tage.includes(t)), times: fenster.map(zpSchreiben) });
    }
    if (!fertig.length) return [null, "Bitte mindestens einen Eintrag mit Tagen und Zeit anlegen."];
    const doppelt = TAGE_CODES.filter((t) => fertig.filter((e) => e.days.includes(t)).length > 1);
    if (doppelt.length) return [fertig, null, `Hinweis: ${doppelt.map((t) => TAGE_NAMEN[t]).join(", ")} kommt in mehreren Einträgen vor, die Zeiten gelten dann zusammen.`];
    return [fertig, null];
  }

  async _zpSpeichern() {
    const z = this._zpOffen;
    const [eintraege, fehler] = this._zpPruefen();
    if (fehler) {
      z.fehler = fehler;
      this._render(true);
      return;
    }
    z.speichert = true;
    this._render(true);
    try {
      await this._hass.callService(PLATTFORM, "set_time_program", { eintraege }, { entity_id: z.id });
      this._zpOffen = null;
    } catch (e) {
      z.fehler = "Speichern fehlgeschlagen: " + (e.message || e);
      z.speichert = false;
    }
    this._render(true);
  }

  _zpEditor() {
    const z = this._zpOffen;
    if (!z) return "";
    const name = this._s(z.id)?.attributes.friendly_name ? this._anzeigename(z.id) : "Zeitprogramm";
    const [, , hinweis] = this._zpPruefen();
    // Wochenübersicht aus dem aktuellen Entwurf
    const woche = TAGE_CODES.map((t) => {
      const balken = z.eintraege
        .filter((e) => e.tage.includes(t))
        .flatMap((e) => e.fenster)
        .map((f) => `<i style="left:${(f.von / 1440) * 100}%;width:${(Math.max(0, f.bis - f.von) / 1440) * 100}%"></i>`)
        .join("");
      return `<span>${TAGE_KURZ[t]}</span><div class="zp-balken">${balken}</div>`;
    }).join("");
    const uhr = (min) => `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    const eintraege = z.eintraege
      .map((e, i) => {
        const tage = TAGE_CODES.map((t) => `<button class="${e.tage.includes(t) ? "an" : ""}" data-zpa="${i}" data-zpart="tag" data-tag="${t}">${TAGE_KURZ[t]}</button>`).join("");
        const fenster = e.fenster
          .map(
            (f, j) => `<div class="zp-fenster">${f.von === 0 && f.bis === 1440 ? "<b>Ganzer Tag</b>" : ""}
              von <input type="time" step="900" value="${uhr(f.von)}" data-zpzeit="${i}|${j}|von">
              bis <input type="time" step="900" value="${uhr(f.bis)}" data-zpzeit="${i}|${j}|bis">
              <button class="zp-link rot" data-zpa="${i}|${j}" data-zpart="fenster-weg">entfernen</button></div>`
          )
          .join("");
        return `<div class="zp-eintrag">
          <div class="zp-kopf"><div class="zp-tage">${tage}</div>
            <button class="zp-link rot" data-zpa="${i}" data-zpart="weg">Eintrag löschen</button></div>
          ${fenster}
          ${e.fenster.length < 2 ? `<button class="zp-link" data-zpa="${i}" data-zpart="fenster-neu">+ Zeitfenster</button>` : ""}
          <button class="zp-link" style="margin-left:14px" data-zpa="${i}" data-zpart="ganz">ganzer Tag</button>
        </div>`;
      })
      .join("");
    return `<div class="zp-hinter"><div class="zp">
      <h3>${esc(name)}</h3>
      <div class="unter">In den grünen Zeiten heizt der Kreis mit Tagestemperatur, sonst abgesenkt. Raster 15 Minuten, bis zu zwei Zeitfenster und ${z.limit} Einträge. «bis 00:00» heisst bis Mitternacht.</div>
      <div class="zp-woche">${woche}</div>
      <div class="zp-skala"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
      ${eintraege}
      ${z.eintraege.length < z.limit ? `<button class="zp-link" data-zpa="" data-zpart="neu">+ Eintrag für weitere Tage</button>` : ""}
      <div class="zp-fuss">
        <span class="zp-fehler" style="${z.fehler ? "" : "color:#777"}">${esc(z.fehler || hinweis || "")}</span>
        <div class="knoepfe2"><button class="neben" data-zpa="" data-zpart="abbrechen">Abbrechen</button>
          <button class="haupt" data-zpa="" data-zpart="speichern" ${z.speichert ? "disabled" : ""}>${z.speichert ? "Speichert …" : "Speichern"}</button></div>
      </div></div></div>`;
  }

  /* --- Dashboard --- */

  _kachel(titel, inhalt, { knoepfe = "", wasser = "" } = {}) {
    return `<div class="kachel">${wasser ? `<div class="wasser">${esc(wasser)}</div>` : ""}
      <div class="knoepfe">${knoepfe}</div>
      <h2>${esc(titel)}</h2>${inhalt}</div>`;
  }

  _knoepfe(wochenuhr, geraetVon, { trend = null, kurve = false } = {}) {
    let html = "";
    if (trend) html += `<button class="knopf gruen" data-trend="${esc(trend)}" title="Trends"><ha-icon icon="mdi:chart-line"></ha-icon></button>`;
    if (kurve && this._config.heizkurve) html += `<button class="knopf orange" data-tab="heizkurve" title="Heizkurve"><ha-icon icon="mdi:chart-bell-curve-cumulative"></ha-icon></button>`;
    if (geraetVon) {
      const geraet = this._hass.entities?.[geraetVon]?.device_id || "";
      html += `<button class="knopf grau" data-param="${esc(geraet)}" title="Parameter"><ha-icon icon="mdi:wrench"></ha-icon></button>`;
    }
    if (wochenuhr) html += `<button class="knopf blau" data-zp="${esc(wochenuhr)}" title="Zeitprogramm"><ha-icon icon="mdi:clock-outline"></ha-icon></button>`;
    return html;
  }

  _zeile(label, id, { stellen = 1, soll, sollLabel = "soll", wert } = {}) {
    const text = wert !== undefined ? wert : this._fmt(id, stellen);
    const sollText = soll ? ` <span class="soll">(${sollLabel} ${this._fmt(soll, stellen)})</span>` : "";
    return `<div class="zeile" data-mehr="${esc(id || "")}"><span>${esc(label)}</span><span class="wert">${text}${sollText}</span></div>`;
  }

  _dashboard() {
    const c = this._config;
    const kacheln = [];
    if (c.wetter) kacheln.push(this._kachelWetter(c.wetter));
    if (c.kessel) kacheln.push(this._kachelKessel(c.kessel));
    if (c.puffer) kacheln.push(this._kachelPuffer(c.puffer));
    (c.heizkreise || []).forEach((hk, i) => kacheln.push(this._kachelHeizkreis(hk, i + 1)));
    (c.frischwasser || []).forEach((fw, i) => kacheln.push(this._kachelFrischwasser(fw, i + 1)));
    (c.listen || []).forEach((l) => kacheln.push(this._kachelListe(l)));
    if (c.signale) kacheln.push(this._kachelSignale(c.signale));
    return `<div class="raster">${kacheln.join("")}</div>`;
  }

  _kachelWetter(w) {
    const nacht = w.tag ? !this._an(w.tag) : false;
    const art = wetterArt(this._roh(w.zustand), nacht);
    const zeit = (id) => {
      const r = this._roh(id);
      const d = r ? new Date(r) : null;
      return d && !isNaN(d) ? uhrzeit(d) : "–";
    };
    const p = this._s(w.prognose)?.attributes || {};
    const sonnenuntergang = this._roh(w.sonnenuntergang) ? new Date(this._roh(w.sonnenuntergang)) : null;
    const sonnenaufgang = this._roh(w.sonnenaufgang) ? new Date(this._roh(w.sonnenaufgang)) : null;
    const istNacht = (d) => {
      if (!sonnenaufgang || !sonnenuntergang) return false;
      const m = d.getHours() * 60 + d.getMinutes();
      const auf = sonnenaufgang.getHours() * 60 + sonnenaufgang.getMinutes();
      const unter = sonnenuntergang.getHours() * 60 + sonnenuntergang.getMinutes();
      return m < auf || m > unter;
    };
    const vorschau = [];
    (p.stuendlich || []).slice(0, 2).forEach((h) => {
      const d = new Date(h.zeit);
      vorschau.push(`<div>${uhrzeit(d)}<br>${wetterSymbol(wetterArt(h.wetter, istNacht(d)), 30)}<br>${Math.round(h.temperatur)}°C</div>`);
    });
    (p.taeglich || []).slice(0, 2).forEach((t) => {
      const d = new Date(t.datum + "T12:00:00");
      vorschau.push(`<div>${WOCHENTAGE[d.getDay()]}<br>${wetterSymbol(wetterArt(t.wetter, false), 30)}<br>${Math.round(t.min)}°C | ${Math.round(t.max)}°C</div>`);
    });
    const temp = this._zahl(w.temperatur);
    const inhalt = `<div class="wetter">
      <div>
        <div class="gross" data-mehr="${esc(w.zustand || "")}">${wetterSymbol(art, 64)}
          <div><div class="temp">${temp === null ? "–" : Math.round(temp) + "°C"}</div><div class="text">${esc(this._roh(w.zustand) || "")}</div></div></div>
        <div class="sonne"><span data-mehr="${esc(w.sonnenaufgang || "")}"><ha-icon icon="mdi:weather-sunset-up"></ha-icon> ${zeit(w.sonnenaufgang)}</span>
          <span data-mehr="${esc(w.sonnenuntergang || "")}">${zeit(w.sonnenuntergang)} <ha-icon icon="mdi:weather-sunset-down"></ha-icon></span></div>
      </div>
      <div>
        ${this._zeileIcon("mdi:weather-pouring", "Niederschlag", w.niederschlag)}
        ${this._zeileIcon("mdi:weather-cloudy", "Bewölkung", w.bewoelkung, 0)}
        ${this._zeileIcon("mdi:water-percent", "Feuchtigkeit", w.feuchte, 0)}
        ${this._zeileIcon("mdi:weather-windy", "Windstärke", w.wind, 0)}
        ${this._zeileIcon("mdi:gauge", "Luftdruck", w.luftdruck, 0)}
      </div>
      <div class="vorschau">${vorschau.join("")}</div>
    </div>`;
    return this._kachel(w.titel || "Wetter", inhalt);
  }

  _zeileIcon(icon, label, id, stellen = 1) {
    if (!id) return "";
    return `<div class="zeile" data-mehr="${esc(id)}"><span><ha-icon icon="${icon}"></ha-icon>${esc(label)}</span><span class="wert">${this._fmt(id, stellen)}</span></div>`;
  }

  _kachelKessel(k) {
    const leistung = this._zahl(k.leistung) || 0;
    const zustand = String(this._roh(k.zustand) || "");
    const brennt = leistung > 0 || /brand|zünd/i.test(zustand);
    const inhalt = `<div class="koerper">
      <div data-mehr="${esc(k.temperatur || "")}">${grafikKessel(this._grad(k.temperatur), this._grad(k.abgas), brennt)}</div>
      <div class="info">
        <div class="name">${esc(k.name || "")}</div>
        ${k.typ ? this._zeile("Typ", k.typ) : ""}
        ${k.programm ? this._zeile("Funktion", k.programm) : ""}
        ${this._zeile("Zustand", k.zustand)}
        ${this._zeile("Leistung", k.leistung, { stellen: 0 })}
        ${this._zeile("Kesseltemp.", k.temperatur, { soll: k.solltemperatur })}
        ${this._zeile("Rauchgastemp.", k.abgas)}
        ${k.ruecklauf ? this._zeile("Rücklauftemp.", k.ruecklauf, { soll: k.ruecklauf_soll }) : ""}
      </div></div>`;
    return this._kachel(k.titel || "Kessel", inhalt, { knoepfe: this._knoepfe(k.wochenuhr, k.programm || k.zustand, { trend: "heater|" }) });
  }

  _kachelPuffer(p) {
    const ladung = this._zahl(p.ladung);
    const inhalt = `<div class="koerper">
      <div data-mehr="${esc(p.ladung || "")}">${grafikPuffer(ladung === null ? "–" : Math.round(ladung) + "%", this._grad(p.oben), this._grad(p.mitte), this._grad(p.unten), this._an(p.pumpe))}</div>
      <div class="info">
        <div class="name">${esc(p.name || "Puffer")}</div>
        ${p.kapazitaet ? this._zeile("Kapazität", p.kapazitaet, { wert: this._fmt(p.kapazitaet, 0, this._einheit(p.kapazitaet) || "l") }) : ""}
        ${this._zeile("Füllgrad", p.ladung)}
        ${p.anforderung ? this._zeile("Höchste Anforderung", p.anforderung, { stellen: 0 }) : ""}
        ${p.zustand ? this._zeile("Zustand", p.zustand) : ""}
        ${this._zeile("Oben / Mitte / Unten", p.oben, { wert: `${this._grad(p.oben)} / ${this._grad(p.mitte)} / ${this._grad(p.unten)}` })}
      </div></div>`;
    return this._kachel(p.titel || "Puffer", inhalt, { knoepfe: this._knoepfe(p.wochenuhr, p.zustand || p.ladung, { trend: "buffer|" + (p.nummer ?? "") }) });
  }

  _kachelHeizkreis(h, nr) {
    let korrektur = "";
    if (h.korrektur && this._s(h.korrektur)) {
      const w = this._ausstehend[h.korrektur]?.wert ?? this._zahl(h.korrektur) ?? 0;
      const text = (w > 0 ? "+" : w < 0 ? "−" : "±") + komma(Math.abs(w), 1) + "°";
      korrektur = `<div class="korrektur">
        <button class="minus" data-schritt="-1" data-entity="${esc(h.korrektur)}" title="Raumtemperatur-Korrektur senken">−</button>
        <span data-mehr="${esc(h.korrektur)}" style="${this._ausstehend[h.korrektur] ? "color:#f08c00" : ""}">${text}</span>
        <button class="plus" data-schritt="1" data-entity="${esc(h.korrektur)}" title="Raumtemperatur-Korrektur erhöhen">+</button></div>`;
    }
    const inhalt = `<div class="koerper">
      <div><div data-mehr="${esc(h.vorlauf || "")}">${grafikHeizkreis(this._grad(h.vorlauf), this._an(h.pumpe))}</div>${korrektur}</div>
      <div class="info">
        ${h.name ? `<div class="name">${esc(h.name)}</div>` : ""}
        ${h.betriebsart ? this._zeile("Funktion", h.betriebsart) : ""}
        ${this._zeile("Zustand", h.zustand)}
        ${this._zeile("Vorlauftemp.", h.vorlauf, { soll: h.vorlauf_soll })}
        ${h.raum ? this._zeile("Raumtemp.", h.raum, { soll: h.raum_soll }) : ""}
        ${h.aussen ? this._zeile("Außentemp.", h.aussen, { soll: h.aussen_gemittelt, sollLabel: "Ø" }) : ""}
        ${h.witterung ? this._zeile("Wetter-Einfluss", h.witterung) : ""}
        ${h.steilheit ? this._zeile("Steilheit", h.steilheit, { stellen: 2 }) : ""}
      </div></div>`;
    return this._kachel(h.titel || `Heizkreis ${nr}`, inhalt, {
      knoepfe: this._knoepfe(h.wochenuhr, h.betriebsart || h.zustand, { trend: "heating_circuit|" + (h.nummer ?? nr), kurve: true }),
      wasser: h.wasserzeichen !== undefined ? h.wasserzeichen : h.nummer ?? nr,
    });
  }

  _kachelFrischwasser(f, nr) {
    const liter = (id) => this._fmt(id, 0, this._einheit(id) || "l");
    const inhalt = `<div class="koerper">
      <div data-mehr="${esc(f.auslauf_soll || "")}">${grafikFrischwasser(this._grad(f.auslauf_soll), this._an(f.pumpe))}</div>
      <div class="info">
        <div class="name">${esc(f.name || "")}</div>
        ${this._zeile("Auslauftemp. Soll", f.auslauf_soll, { stellen: 0 })}
        ${this._zeile("Vorlauftemp. Ist", f.vorlauf, { stellen: 0 })}
        ${f.fuehler ? this._zeile("Fühler FWS", f.fuehler) : ""}
        ${this._zeile("Durchfluss", f.durchfluss)}
        ${f.heute ? this._zeile("Tagesverbrauch", f.heute, { wert: liter(f.heute) }) : ""}
        ${f.gesamt ? this._zeile("Gesamtverbrauch", f.gesamt, { wert: liter(f.gesamt) }) : ""}
      </div></div>`;
    return this._kachel(f.titel || `Frischwasser Station ${nr}`, inhalt, { knoepfe: this._knoepfe(f.wochenuhr, f.auslauf_soll, { trend: "fresh_water|" + (f.nummer ?? nr) }) });
  }

  _kachelListe(l) {
    const zeilen = (l.zeilen || [])
      .map((z) => this._zeile(z.name, z.entity, { soll: z.soll, stellen: z.stellen ?? 1 }))
      .join("");
    return this._kachel(l.titel || "Werte", `<div class="liste">${zeilen}</div>`);
  }

  _kachelSignale(s) {
    const zeilen = (s.zeilen || [])
      .map((z) => {
        const an = this._an(z.entity);
        const roh = this._roh(z.entity);
        let klasse = "";
        if (roh === null) klasse = "";
        else if (an) klasse = z.art === "fehler" ? "fehler" : z.art === "warnung" ? "warn" : "an";
        const text = roh === null ? "unbekannt" : an ? z.an || "Ein" : z.aus || "Aus";
        return `<div class="zeile" data-mehr="${esc(z.entity)}" title="${esc(text)}"><span class="led ${klasse}"></span>${esc(z.name)}</div>`;
      })
      .join("");
    return this._kachel(s.titel || "Signale", `<div class="signale">${zeilen}</div>`);
  }

  /* --- Parameter --- */

  _integrationsEntitaeten() {
    return Object.values(this._hass.entities || {}).filter((e) => e.platform === PLATTFORM && this._hass.states[e.entity_id]);
  }

  _anzeigename(id) {
    const s = this._s(id);
    const e = this._hass.entities?.[id];
    let name = s?.attributes.friendly_name || id;
    const geraet = e?.device_id ? this._hass.devices?.[e.device_id] : null;
    const gname = geraet?.name_by_user || geraet?.name;
    if (gname && name.startsWith(gname + " ")) name = name.slice(gname.length + 1);
    const anlage = this._config.titel;
    if (anlage && name.startsWith(anlage + " ")) name = name.slice(anlage.length + 1);
    return name;
  }

  _parameterGruppen() {
    const gruppen = new Map();
    for (const e of this._integrationsEntitaeten()) {
      const domain = e.entity_id.split(".")[0];
      const s = this._hass.states[e.entity_id];
      const istParam = ["number", "select", "switch", "text"].includes(domain) || (domain === "sensor" && e.entity_category === "diagnostic" && !s.attributes.kanal);
      if (!istParam || e.hidden) continue;
      const g = e.device_id || "ohne";
      if (!gruppen.has(g)) {
        const d = this._hass.devices?.[e.device_id];
        let name = d?.name_by_user || d?.name || "Weitere";
        // «Heizkreis 1 (Altbau)» → «Altbau»: der Name aus der App ist eindeutiger
        name = name.replace(/^.*Heizkreis \d+ \((.+)\)$/, "$1");
        const anlage = this._config.titel;
        if (anlage && name.startsWith(anlage + " ")) name = name.slice(anlage.length + 1);
        gruppen.set(g, { id: g, name, eintraege: [] });
      }
      gruppen.get(g).eintraege.push(e.entity_id);
    }
    const reihenfolge = (n) => (/kessel/i.test(n) ? 0 : /puffer/i.test(n) ? 1 : /heizkreis/i.test(n) ? 2 : /warmwasser|frischwasser/i.test(n) ? 3 : 4);
    return [...gruppen.values()].sort((a, b) => reihenfolge(a.name) - reihenfolge(b.name) || a.name.localeCompare(b.name, "de"));
  }

  _parameter() {
    const gruppen = this._parameterGruppen();
    if (!gruppen.length) return `<div class="blatt leer">Keine Parameter gefunden.</div>`;
    if (!this._paramGruppe || !gruppen.some((g) => g.id === this._paramGruppe)) this._paramGruppe = gruppen[0].id;
    const aktiv = gruppen.find((g) => g.id === this._paramGruppe);
    const icon = (n) => (/kessel/i.test(n) ? "mdi:fire" : /puffer/i.test(n) ? "mdi:storage-tank" : /heizkreis/i.test(n) ? "mdi:radiator" : /wasser/i.test(n) ? "mdi:faucet" : /wetter/i.test(n) ? "mdi:weather-partly-cloudy" : "mdi:cog");
    const liste = gruppen
      .map((g) => `<button data-pgruppe="${esc(g.id)}" class="${g.id === aktiv.id ? "aktiv" : ""}"><ha-icon icon="${icon(g.name)}"></ha-icon>${esc(g.name)}</button>`)
      .join("");
    const sortiert = [...aktiv.eintraege].sort((a, b) => {
      const na = this._anzeigename(a);
      const nb = this._anzeigename(b);
      const sa = /^[A-Z]*\d/.test(na) ? 0 : 1;
      const sb = /^[A-Z]*\d/.test(nb) ? 0 : 1;
      return sa - sb || na.localeCompare(nb, "de", { numeric: true });
    });
    const zeilen = sortiert.map((id) => this._parameterZeile(id)).join("");
    return `<div class="gruppen">${liste}</div>
      <div class="blatt"><h3>${esc(aktiv.name)}</h3>${zeilen}</div>`;
  }

  _parameterZeile(id) {
    const s = this._s(id);
    const domain = id.split(".")[0];
    const name = esc(this._anzeigename(id));
    let feld = "";
    if (domain === "number") {
      const st = s.attributes.step || 1;
      const stellen = st < 0.1 ? 2 : st < 1 ? 1 : 0;
      const w = this._wertMitAusstehend(id, stellen);
      feld = `<div class="stepper"><button data-schritt="-1" data-entity="${esc(id)}">−</button>
        <span class="${w.wartet ? "wartet" : ""}">${w.text}</span>
        <button data-schritt="1" data-entity="${esc(id)}">+</button></div>`;
    } else if (domain === "select") {
      const opts = (s.attributes.options || []).map((o) => `<option ${o === s.state ? "selected" : ""}>${esc(o)}</option>`).join("");
      feld = `<select data-auswahl="${esc(id)}">${opts}</select>`;
    } else if (domain === "switch") {
      feld = `<button class="schalter ${s.state === "on" ? "an" : ""}" data-schalter="${esc(id)}" title="${s.state === "on" ? "Ein" : "Aus"}"></button>`;
    } else {
      feld = `<span class="nur">${this._fmt(id)}</span>`;
    }
    return `<div class="param"><span class="label" data-mehr="${esc(id)}">${name}</span>${feld}</div>`;
  }

  /* --- Messwerte --- */

  _messGruppen() {
    const gruppen = new Map();
    for (const e of this._integrationsEntitaeten()) {
      const s = this._hass.states[e.entity_id];
      const kanal = s.attributes.kanal;
      if (!kanal) continue;
      const teile = kanal.split(".");
      const typ = teile[0];
      const nr = teile[teile.length - 1];
      let name = s.attributes.gruppe || typ;
      if (typ === "heating_circuit") name += this._config.heizkreis_nummern ? ` (HK ${nr})` : "";
      else if (typ === "fresh_water") name += ` (FWS ${nr})`;
      else if (typ === "hot_water") name += ` (WW ${nr})`;
      if (!gruppen.has(name)) gruppen.set(name, { name, typ, nr, kanaele: [] });
      gruppen.get(name).kanaele.push(e.entity_id);
    }
    // Heizkreise: nur der Trend von Vorlauf und Vorlauf-Soll (oder «trend» aus der Konfiguration)
    this._kanalNamen = {};
    this._gestrichelt = new Set();
    for (const g of gruppen.values()) {
      if (g.typ !== "heating_circuit") continue;
      const hks = this._config.heizkreise || [];
      const hk = hks.find((h) => String(h.nummer) === String(g.nr)) || hks[parseInt(g.nr, 10) - 1];
      if (!hk) continue;
      let trend = hk.trend;
      if (!trend) {
        trend = [];
        if (hk.vorlauf) trend.push({ entity: hk.vorlauf, name: "Vorlauftemperatur" });
        if (hk.vorlauf_soll) trend.push({ entity: hk.vorlauf_soll, name: "Vorlauf-Solltemperatur", gestrichelt: true });
      }
      trend = trend.map((x) => (typeof x === "string" ? { entity: x } : x)).filter((x) => this._hass.states[x.entity]);
      if (!trend.length) continue;
      g.kanaele = trend.map((x) => x.entity);
      for (const x of trend) {
        if (x.name) this._kanalNamen[x.entity] = x.name;
        if (x.gestrichelt) this._gestrichelt.add(x.entity);
      }
    }
    const reihenfolge = { heater: 0, buffer: 2, heating_circuit: 3, hot_water: 4, fresh_water: 5 };
    return [...gruppen.values()].sort((a, b) => (reihenfolge[a.typ] ?? 9) - (reihenfolge[b.typ] ?? 9) || (parseInt(a.nr, 10) || 0) - (parseInt(b.nr, 10) || 0) || a.name.localeCompare(b.name, "de"));
  }

  _kanalName(id, gruppe) {
    if (this._kanalNamen?.[id]) return this._kanalNamen[id];
    let n = this._anzeigename(id);
    const basis = gruppe.replace(/\s*\(.*\)$/, "");
    if (n.startsWith("Messkanäle ")) n = n.slice(11);
    if (n.startsWith(basis + " ")) n = n.slice(basis.length + 1);
    n = n.replace(new RegExp("\\s*\\((" + basis.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "|HK \\d+|FWS \\d+|WW \\d+)\\)$"), "");
    return n;
  }

  _messwerte() {
    const gruppen = this._messGruppen();
    if (!gruppen.length) return `<div class="blatt leer">Keine Messkanäle gefunden. In den Optionen der Integration «Alle Messkanäle laden» einschalten.</div>`;
    if (!this._messGruppe || !gruppen.some((g) => g.name === this._messGruppe)) this._messGruppe = gruppen[0].name;
    const icon = { heater: "mdi:fire", buffer: "mdi:storage-tank", heating_circuit: "mdi:thermometer", fresh_water: "mdi:faucet", hot_water: "mdi:water-boiler" };
    const liste = gruppen
      .map((g) => {
        const m = g.name.match(/^(.*?)(\s*\(.*\))?$/);
        return `<button data-mgruppe="${esc(g.name)}" class="${g.name === this._messGruppe ? "aktiv" : ""}"><ha-icon icon="${icon[g.typ] || "mdi:chart-line"}"></ha-icon>${esc(m[1])}<small>${esc((m[2] || "").trim())}</small></button>`;
      })
      .join("");
    const zeitraeume = [
      ["heute", "Heute"],
      ["gestern", "Gestern"],
      ["24h", "24 Stunden"],
      ["7d", "7 Tage"],
      ["30d", "30 Tage"],
      ["eigen", "Datumsbereich"],
    ];
    let knoepfe = zeitraeume.map(([k, n]) => `<button data-zeitraum="${k}" class="${k === this._zeitraum ? "aktiv" : ""}">${n}</button>`).join("");
    if (this._zeitraum === "eigen" && this._eigen) {
      const heute = isoTag(new Date());
      knoepfe += `<span class="trenner"></span>von <input type="date" data-datum="von" value="${this._eigen.von}" max="${heute}">
        bis <input type="date" data-datum="bis" value="${this._eigen.bis}" max="${heute}">`;
    }
    knoepfe += `<span class="trenner"></span><button data-zoom="rein" title="Hineinzoomen">＋</button><button data-zoom="raus" title="Herauszoomen">－</button>
      <button data-zoom="zurueck" id="zoomzurueck" style="display:none">Zoom zurücksetzen</button>
      <span class="zoominfo" id="zoominfo">Zoomen: Mausrad oder Bereich aufziehen · Verschieben: Umschalttaste + Mausrad</span>`;
    return `<div class="gruppen">${liste}</div>
      <div class="blatt"><div class="zeitraum">${knoepfe}</div>${this._navigation()}<div id="diagramme"><div class="leer">Lade Verlauf …</div></div></div>`;
  }

  _zeitfenster() {
    const [von, bis] = this._grundfenster();
    if (!this._versatz) return [von, bis];
    if (this._zeitraum === "heute" || this._zeitraum === "gestern") {
      const a = new Date(von);
      a.setDate(a.getDate() + this._versatz);
      const b = new Date(a);
      b.setDate(b.getDate() + 1);
      return [a, b];
    }
    const dauer = bis - von;
    return [new Date(von.getTime() + this._versatz * dauer), new Date(bis.getTime() + this._versatz * dauer)];
  }

  _navigation() {
    const [von, bis] = this._zeitfenster();
    const f = (d) => `${WOCHENTAGE_KURZ[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
    const ende = new Date(bis - 1);
    let text = f(von);
    if (isoTag(von) !== isoTag(ende)) text += ` – ${f(ende)}${ende.getFullYear() !== new Date().getFullYear() ? ende.getFullYear() : ""}`;
    else if (von.getFullYear() !== new Date().getFullYear()) text += von.getFullYear();
    const amEnde = bis >= new Date(Date.now() - 60000);
    const live = !this._versatz && this._zeitraum !== "eigen";
    return `<div class="navi"><button data-schieben="-1" title="Zurück">‹</button><div class="datum">${esc(text)}</div>
      <button data-schieben="1" title="Weiter" ${amEnde ? "disabled" : ""}>›</button>
      <button data-schieben="jetzt" class="jetzt ${live ? "aktiv" : ""}">jetzt</button></div>`;
  }

  _schieben(art) {
    if (art === "jetzt") {
      if (this._zeitraum === "eigen" || this._zeitraum === "gestern") this._zeitraum = "heute";
      this._versatz = 0;
    } else if (this._zeitraum === "eigen" && this._eigen) {
      const a = new Date(this._eigen.von + "T00:00:00");
      const b = new Date(this._eigen.bis + "T00:00:00");
      const tage = Math.round((b - a) / 86400000) + 1;
      a.setDate(a.getDate() + tage * Number(art));
      b.setDate(b.getDate() + tage * Number(art));
      if (a > new Date()) return;
      this._eigen = { von: isoTag(a), bis: isoTag(b > new Date() ? new Date() : b) };
    } else {
      this._versatz = Math.min(0, this._versatz + Number(art));
    }
    this._zoom = null;
    this._render(true);
  }

  _grundfenster() {
    const jetzt = new Date();
    const mitternacht = new Date(jetzt);
    mitternacht.setHours(0, 0, 0, 0);
    switch (this._zeitraum) {
      case "gestern":
        return [new Date(mitternacht - 86400000), mitternacht];
      case "24h":
        return [new Date(jetzt - 86400000), jetzt];
      case "7d":
        return [new Date(jetzt - 7 * 86400000), jetzt];
      case "30d":
        return [new Date(jetzt - 30 * 86400000), jetzt];
      case "eigen": {
        if (!this._eigen) return [mitternacht, jetzt];
        const von = new Date(this._eigen.von + "T00:00:00");
        const bis = new Date(this._eigen.bis + "T00:00:00");
        bis.setDate(bis.getDate() + 1);
        return [von, bis > jetzt ? jetzt : bis];
      }
      default:
        return [mitternacht, new Date(Math.max(jetzt, mitternacht.getTime() + 3600000))];
    }
  }

  async _ladeVerlauf(neu) {
    const gruppe = this._messGruppen().find((g) => g.name === this._messGruppe);
    if (!gruppe) return;
    const schluessel = gruppe.name + "|" + this._zeitraum + "|" + this._versatz + (this._zeitraum === "eigen" && this._eigen ? "|" + this._eigen.von + "|" + this._eigen.bis : "");
    const cache = this._verlauf[schluessel];
    if (!neu && cache && Date.now() - cache.zeit < 5 * 60 * 1000) {
      this._daten = cache;
      this._zeichneDiagramme();
      return;
    }
    const [von, bis] = this._zeitfenster();
    try {
      const antwort = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: von.toISOString(),
        end_time: (bis > new Date() ? new Date() : bis).toISOString(),
        entity_ids: gruppe.kanaele,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const reihen = {};
      for (const id of gruppe.kanaele) {
        const punkte = [];
        for (const p of antwort[id] || []) {
          const t = (p.lu ?? p.lc ?? 0) * 1000;
          const w = zahl(p.s);
          if (t && w !== null) punkte.push([Math.max(t, von.getTime()), w]);
        }
        reihen[id] = punkte;
      }
      this._verlauf[schluessel] = { zeit: Date.now(), gruppe: gruppe.name, von, bis, reihen, kanaele: gruppe.kanaele };
      if (gruppe.name === this._messGruppe && this._reiter === "messwerte") {
        this._daten = this._verlauf[schluessel];
        this._zeichneDiagramme();
      }
    } catch (e) {
      const ziel = this.shadowRoot.getElementById("diagramme");
      if (ziel) ziel.innerHTML = `<div class="leer">Verlauf konnte nicht geladen werden: ${esc(e.message || e)}</div>`;
    }
  }

  /* --- Ansichtsfenster (Zoom) --- */

  _fenster() {
    const d = this._daten;
    if (this._zoom) return this._zoom;
    return [d.von.getTime(), d.bis.getTime()];
  }

  _setzeZoom(t0, t1) {
    const d = this._daten;
    if (!d) return;
    const a = d.von.getTime();
    const b = d.bis.getTime();
    const min = 10 * 60 * 1000;
    if (t1 - t0 < min) {
      const m = (t0 + t1) / 2;
      t0 = m - min / 2;
      t1 = m + min / 2;
    }
    if (t1 - t0 >= b - a) {
      this._zoom = null;
    } else {
      if (t0 < a) (t1 += a - t0), (t0 = a);
      if (t1 > b) (t0 -= t1 - b), (t1 = b);
      this._zoom = [Math.max(a, t0), Math.min(b, t1)];
    }
    this._zeichneDiagramme();
  }

  _zoomen(art) {
    if (!this._daten) return;
    const [t0, t1] = this._fenster();
    const m = (t0 + t1) / 2;
    const halb = (t1 - t0) / 2;
    if (art === "rein") this._setzeZoom(m - halb / 2, m + halb / 2);
    else if (art === "raus") this._setzeZoom(m - halb * 2, m + halb * 2);
    else {
      this._zoom = null;
      this._zeichneDiagramme();
    }
  }

  _zeichneDiagramme() {
    const ziel = this.shadowRoot.getElementById("diagramme");
    const d = this._daten;
    if (!ziel || !d || d.gruppe !== this._messGruppe) return;
    this._breite = Math.max(320, Math.round(ziel.clientWidth || 800));
    if (!this._beobachter) {
      this._beobachter = new ResizeObserver(() => {
        const z = this.shadowRoot.getElementById("diagramme");
        if (z && this._daten && Math.abs(z.clientWidth - (this._breite || 0)) > 8) this._zeichneDiagramme();
      });
    }
    this._beobachter.disconnect();
    this._beobachter.observe(ziel);
    const nachEinheit = new Map();
    d.kanaele.forEach((id, i) => {
      const einheit = this._einheit(id) || "Signal";
      if (!nachEinheit.has(einheit)) nachEinheit.set(einheit, []);
      nachEinheit.get(einheit).push({ id, farbe: FARBEN[i % FARBEN.length], name: this._kanalName(id, d.gruppe), gestrichelt: this._gestrichelt?.has(id) });
    });
    const titel = { "°C": "Temperaturen (°C)", "%": "Prozent (%)", bar: "Druck (bar)", kg: "Menge (kg)", Signal: "Signale (0 = aus, 1 = ein)" };
    let html = "";
    let nr = 0;
    const aus = this._config.messwerte_ohne ?? ["Signal", "bar"];
    const mitWerten = (einheit) => (nachEinheit.get(einheit) || []).filter((l) => d.reihen[l.id]?.length);
    // Prozentwerte (Ventil, Pumpe, Ladung) als zweite Achse rechts zu den Temperaturen
    let rechts = [];
    if (mitWerten("°C").length && mitWerten("%").length && !aus.includes("%")) {
      rechts = mitWerten("%").map((l) => ({ ...l, rechts: true }));
      nachEinheit.delete("%");
    }
    // Diagramme füllen die verfügbare Höhe bis zum unteren Fensterrand
    const geplant = [...nachEinheit].filter(([e, l]) => !aus.includes(e) && l.some((x) => d.reihen[x.id]?.length));
    const signale = geplant.filter(([e]) => e === "Signal").length;
    const normale = geplant.length - signale;
    const oben = ziel.getBoundingClientRect().top;
    const fenster = this._config.diagramm_hoehe ? null : window.innerHeight;
    const frei = fenster ? fenster - oben - 34 - geplant.length * 58 - signale * 140 : 0;
    this._hoehe = this._config.diagramm_hoehe || (normale ? Math.max(240, Math.floor(frei / normale)) : 260);
    this._fensterHoehe = window.innerHeight;
    if (!this._fensterHorcher) {
      this._fensterHorcher = () => {
        if (this._reiter === "messwerte" && this._daten && Math.abs(window.innerHeight - (this._fensterHoehe || 0)) > 20) this._zeichneDiagramme();
      };
      window.addEventListener("resize", this._fensterHorcher);
    }
    for (const [einheit, linien] of nachEinheit) {
      if (aus.includes(einheit)) continue;
      const links = linien.filter((l) => d.reihen[l.id]?.length);
      if (!links.length) continue;
      const zweite = einheit === "°C" ? rechts : [];
      const mitDaten = [...links, ...zweite];
      const kopf = zweite.length ? `${esc(titel[einheit] || einheit)}<span style="float:right;color:#f08c00">Prozent (%)</span>` : esc(titel[einheit] || einheit);
      html += `<div class="diagramm" data-nr="${nr}"><h4>${kopf}</h4>
        ${this._svgDiagramm(links, d, einheit === "Signal", nr, zweite)}
        <div class="legende">${mitDaten
          .map((l) => `<span data-linie="${esc(l.id)}" class="${this._ausgeblendet.has(l.id) ? "aus" : ""}"><i style="background:${l.farbe}"></i>${esc(l.name)}</span>`)
          .join("")}</div><div class="tipp"></div></div>`;
      nr++;
    }
    const ohne = d.kanaele.filter((id) => !d.reihen[id]?.length).map((id) => this._kanalName(id, d.gruppe));
    if (ohne.length && this._config.messwerte_leere_zeigen) html += `<div class="leer" style="padding:6px 0;text-align:left">Ohne Werte im Zeitraum: ${esc(ohne.join(", "))}</div>`;
    ziel.innerHTML = html || `<div class="leer">Keine Werte für den ausgewählten Zeitraum vorhanden.</div>`;

    const zurueck = this.shadowRoot.getElementById("zoomzurueck");
    const info = this.shadowRoot.getElementById("zoominfo");
    if (zurueck) zurueck.style.display = this._zoom ? "" : "none";
    if (info) {
      const f = (t) => new Date(t).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      info.textContent = this._zoom ? `Ausschnitt ${f(this._zoom[0])} – ${f(this._zoom[1])}` : "Zoomen: Mausrad oder Bereich aufziehen · Verschieben: Umschalttaste + Mausrad";
    }

    ziel.querySelectorAll(".diagramm svg").forEach((svg) => {
      svg.addEventListener("pointerdown", (e) => this._ziehStart(e, svg));
      svg.addEventListener("pointermove", (e) => {
        if (this._zug) this._ziehen(e);
        else this._tipp(e, svg);
      });
      svg.addEventListener("pointerup", (e) => this._ziehEnde(e));
      svg.addEventListener("pointercancel", () => this._ziehAbbruch());
      svg.addEventListener("dblclick", () => this._zoomen("raus"));
      svg.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          const [t0, t1] = this._fenster();
          const breite = t1 - t0;
          const delta = e.deltaY || e.deltaX;
          if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            const schub = (delta > 0 ? 1 : -1) * breite * 0.12;
            this._setzeZoom(t0 + schub, t1 + schub);
            return;
          }
          const t = this._zeitBei(this._svgX(e, svg), svg);
          const f = delta > 0 ? 1.25 : 0.8;
          this._setzeZoom(t - (t - t0) * f, t + (t1 - t) * f);
        },
        { passive: false }
      );
      svg.addEventListener("pointerleave", () => {
        svg.parentElement.querySelector(".tipp").style.display = "none";
        const l = svg.querySelector(".fadenkreuz");
        if (l) l.setAttribute("visibility", "hidden");
      });
    });
  }

  /* --- Bereich mit der Maus aufziehen --- */

  _svgX(e, svg) {
    const box = svg.getBoundingClientRect();
    return ((e.clientX - box.left) / box.width) * Number(svg.dataset.b);
  }

  _zeitBei(px, svg) {
    const L = Number(svg.dataset.l);
    const R = Number(svg.dataset.r);
    const B = Number(svg.dataset.b);
    const [t0, t1] = this._fenster();
    const anteil = Math.min(1, Math.max(0, (px - L) / (B - L - R)));
    return t0 + anteil * (t1 - t0);
  }

  _ziehStart(e, svg) {
    if (e.button !== 0) return;
    const px = this._svgX(e, svg);
    if (px < Number(svg.dataset.l)) return;
    this._zug = { svg, start: px, ende: px, pointer: e.pointerId };
    try {
      svg.setPointerCapture(e.pointerId);
    } catch (err) {
      /* egal */
    }
  }

  _ziehen(e) {
    const z = this._zug;
    const L = Number(z.svg.dataset.l);
    const B = Number(z.svg.dataset.b);
    const R = Number(z.svg.dataset.r);
    z.ende = Math.min(B - R, Math.max(L, this._svgX(e, z.svg)));
    const rect = z.svg.querySelector(".auswahl");
    rect.setAttribute("x", Math.min(z.start, z.ende));
    rect.setAttribute("width", Math.abs(z.ende - z.start));
    rect.setAttribute("visibility", "visible");
    z.svg.parentElement.querySelector(".tipp").style.display = "none";
  }

  _ziehEnde() {
    const z = this._zug;
    if (!z) return;
    this._zug = null;
    if (Math.abs(z.ende - z.start) < 8) {
      z.svg.querySelector(".auswahl").setAttribute("visibility", "hidden");
      return;
    }
    const a = this._zeitBei(Math.min(z.start, z.ende), z.svg);
    const b = this._zeitBei(Math.max(z.start, z.ende), z.svg);
    this._setzeZoom(a, b);
  }

  _ziehAbbruch() {
    if (this._zug) this._zug.svg.querySelector(".auswahl").setAttribute("visibility", "hidden");
    this._zug = null;
  }

  _zeitTicks(t0, t1, B) {
    const M = 60000;
    const H = 3600000;
    const T = 86400000;
    const schritte = [5 * M, 10 * M, 15 * M, 30 * M, H, 2 * H, 3 * H, 6 * H, 12 * H, T, 2 * T, 7 * T, 14 * T];
    const maxTicks = Math.max(3, Math.floor(B / 95));
    const tick = schritte.find((s) => (t1 - t0) / s <= maxTicks) || 30 * T;
    const start = new Date(t0);
    if (tick >= T) start.setHours(0, 0, 0, 0);
    else start.setMinutes(Math.floor(start.getMinutes() / Math.max(1, tick / M)) * Math.max(1, tick / M), 0, 0);
    const liste = [];
    for (let t = start.getTime(); t <= t1; ) {
      if (t >= t0) liste.push(t);
      if (tick >= T) {
        const n = new Date(t);
        n.setDate(n.getDate() + tick / T);
        t = n.getTime();
      } else t += tick;
    }
    const mehrereTage = new Date(t0).toDateString() !== new Date(t1).toDateString();
    return liste.map((t) => {
      const dt = new Date(t);
      let text;
      if (tick >= T) text = `${WOCHENTAGE[dt.getDay()]} ${dt.getDate()}.${dt.getMonth() + 1}.`;
      else if (mehrereTage && dt.getHours() === 0 && dt.getMinutes() === 0) text = `${dt.getDate()}.${dt.getMonth() + 1}.`;
      else text = uhrzeit(dt);
      return [t, text];
    });
  }

  _svgDiagramm(linien, d, signal, nr, rechts = []) {
    const B = this._breite || 800;
    const H = signal ? 140 : this._hoehe || 300;
    const L = 44;
    const zweiteSichtbar = rechts.filter((l) => !this._ausgeblendet.has(l.id));
    const R = rechts.length ? 44 : 12;
    const O = 10;
    const U = 26;
    const [t0, t1] = this._fenster();
    const sichtbar = linien.filter((l) => !this._ausgeblendet.has(l.id));
    let min = Infinity;
    let max = -Infinity;
    for (const l of sichtbar) {
      const reihe = d.reihen[l.id];
      for (let i = 0; i < reihe.length; i++) {
        const [t, w] = reihe[i];
        const naechster = reihe[i + 1]?.[0] ?? Infinity;
        if (naechster < t0 || t > t1) continue; // nur Werte, die im Ausschnitt gelten
        min = Math.min(min, w);
        max = Math.max(max, w);
      }
    }
    if (signal) {
      min = 0;
      max = 1;
    }
    if (!Number.isFinite(min)) {
      min = 0;
      max = 1;
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const spanne = max - min;
    const roh = spanne / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(roh)));
    const schritt = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= roh) || roh;
    const ymin = signal ? 0 : Math.floor(min / schritt) * schritt;
    const ymax = signal ? 1 : Math.ceil(max / schritt) * schritt;
    const x = (t) => L + ((t - t0) / (t1 - t0)) * (B - L - R);
    const y = (w) => O + (1 - (w - ymin) / (ymax - ymin || 1)) * (H - O - U);
    let gitter = "";
    for (let w = ymin; w <= ymax + 1e-9; w += signal ? 1 : schritt) {
      gitter += `<line x1="${L}" x2="${B - R}" y1="${y(w)}" y2="${y(w)}" stroke="#e6e6e6"/>
        <text x="${L - 6}" y="${y(w) + 3.5}" text-anchor="end" font-size="10.5" fill="#888">${komma(w, schritt < 1 && !signal ? 1 : 0)}</text>`;
    }
    for (const [t, text] of this._zeitTicks(t0, t1, B)) {
      gitter += `<line x1="${x(t)}" x2="${x(t)}" y1="${O}" y2="${H - U}" stroke="#f0f0f0"/>
        <text x="${x(t)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="#888">${text}</text>`;
    }
    if (rechts.length) {
      // rechte Achse 0–100 %, auf das linke Raster gelegt
      const n = Math.round((ymax - ymin) / schritt) || 1;
      for (let i = 0; i <= n; i++) {
        const w = ymin + i * schritt;
        gitter += `<text x="${B - R + 6}" y="${y(w) + 3.5}" font-size="10.5" fill="#f08c00">${Math.round((i / n) * 100)}%</text>`;
      }
    }
    const yRechts = (p) => y(ymin + (Math.min(100, Math.max(0, p)) / 100) * (ymax - ymin));
    const jetzt = Date.now();
    const clip = `clip${nr}`;
    let pfade = "";
    for (const l of [...sichtbar, ...zweiteSichtbar]) {
      const yy = l.rechts ? yRechts : y;
      const punkte = d.reihen[l.id];
      if (!punkte.length) continue;
      // nur den sichtbaren Teil (plus je einen Punkt davor und danach) zeichnen
      let a = 0;
      while (a + 1 < punkte.length && punkte[a + 1][0] <= t0) a++;
      let b = punkte.length - 1;
      while (b - 1 > a && punkte[b - 1][0] >= t1) b--;
      let p = "";
      for (let i = a; i <= b; i++) {
        const [t, w] = punkte[i];
        if (i === a) p += `M${x(Math.max(t, t0 - (t1 - t0))).toFixed(1)} ${yy(w).toFixed(1)}`;
        else p += ` H${x(t).toFixed(1)} V${yy(w).toFixed(1)}`;
      }
      if (punkte[b][0] < t1) p += ` H${x(Math.min(jetzt, t1)).toFixed(1)}`;
      pfade += `<path d="${p}" fill="none" stroke="${l.farbe}" stroke-width="1.5"${l.gestrichelt ? ' stroke-dasharray="6 4"' : ""} stroke-linejoin="round"/>`;
    }
    return `<svg viewBox="0 0 ${B} ${H}" width="${B}" height="${H}" data-nr="${nr}" data-l="${L}" data-r="${R}" data-b="${B}">
      <defs><clipPath id="${clip}"><rect x="${L}" y="0" width="${B - L - R}" height="${H}"/></clipPath></defs>
      ${gitter}<g clip-path="url(#${clip})">${pfade}</g>
      <rect class="auswahl" x="0" y="${O}" width="0" height="${H - O - U}" fill="rgba(58,143,216,.15)" stroke="#3a8fd8" stroke-width="1" visibility="hidden"/>
      <line class="fadenkreuz" x1="0" x2="0" y1="${O}" y2="${H - U}" stroke="#555" stroke-dasharray="3 3" visibility="hidden"/></svg>`;
  }

  _tipp(e, svg) {
    const d = this._daten;
    if (!d) return;
    const box = svg.getBoundingClientRect();
    const px = this._svgX(e, svg);
    if (px < Number(svg.dataset.l) || px > Number(svg.dataset.b) - Number(svg.dataset.r)) return;
    const t = this._zeitBei(px, svg);
    if (t > Date.now()) return;
    const kreuz = svg.querySelector(".fadenkreuz");
    kreuz.setAttribute("x1", px);
    kreuz.setAttribute("x2", px);
    kreuz.setAttribute("visibility", "visible");
    const legende = svg.parentElement.querySelectorAll(".legende span");
    let zeilen = `<b>${new Date(t).toLocaleString("de-CH", { weekday: "short", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</b>`;
    legende.forEach((sp) => {
      const id = sp.dataset.linie;
      if (this._ausgeblendet.has(id)) return;
      let wert = null;
      for (const [tt, w] of d.reihen[id] || []) {
        if (tt > t) break;
        wert = w;
      }
      if (wert === null) return;
      const farbe = sp.querySelector("i").style.background;
      const ein = this._einheit(id);
      zeilen += `<br><span style="color:${farbe}">■</span> ${esc(sp.textContent)}: ${komma(wert, Number.isInteger(wert) ? 0 : 1)}${ein ? " " + ein : ""}`;
    });
    const tipp = svg.parentElement.querySelector(".tipp");
    tipp.innerHTML = zeilen;
    tipp.style.display = "block";
    const rel = e.clientX - box.left;
    tipp.style.left = (rel > box.width / 2 ? rel - tipp.offsetWidth - 12 : rel + 12) + "px";
    tipp.style.top = e.clientY - box.top + 20 + "px";
  }

  /** Von aussen (z. B. 3D-Ansicht) eine Seite öffnen: reiter, trend «typ|nr», geraet (Parameter), zeitprogramm. */
  oeffne({ reiter, trend, geraet, zeitprogramm } = {}) {
    if (trend) {
      const [typ, nr] = String(trend).split("|");
      const gruppen = this._messGruppen().filter((g) => g.typ === typ);
      const g = gruppen.find((x) => String(x.nr) === String(nr)) || gruppen[0];
      if (g) this._messGruppe = g.name;
      this._reiter = "messwerte";
    } else if (geraet !== undefined) {
      this._paramGruppe = geraet || null;
      this._reiter = "parameter";
    } else if (reiter) this._reiter = reiter;
    this._zoom = null;
    this._render(true);
    if (zeitprogramm) this._zpOeffnen(zeitprogramm);
  }

  static getStubConfig() {
    return { titel: "Anlage" };
  }
}

// Wie bei der Heizkurven-Karte: erneut anmelden, falls das Frontend seine
// Element-Registry nach dem frühen Laden ersetzt.
const ANLAGE_KARTE = "hargassner-anlage-card";

function anlageKarteAnmelden() {
  if (customElements.get(ANLAGE_KARTE)) return true;
  try {
    customElements.define(ANLAGE_KARTE, class extends HargassnerAnlageCard {});
  } catch (e) {
    return false;
  }
  return true;
}

anlageKarteAnmelden();
window.customCards = window.customCards || [];
if (!window.customCards.some((k) => k.type === ANLAGE_KARTE)) {
  window.customCards.push({
    type: ANLAGE_KARTE,
    name: "Hargassner Anlage",
    description: "Anlagenübersicht im Stil der Hargassner-App mit Parametern, Messwerten und Heizkurve",
  });
}
let anlageVersuche = 0;
const anlagePruefer = setInterval(() => {
  anlageKarteAnmelden();
  if (++anlageVersuche >= 60) clearInterval(anlagePruefer);
}, 500);
