/*
 * Hargassner 3D-Anlage – Heizraum und Lager als begehbares 3D-Modell.
 *
 * Die Karte enthält keine anlagenbezogenen Daten. Gebäude (z. B. aus einem IFC exportiert),
 * Positionen und Masse der Bauteile kommen aus dem Anlagenmodell in der Konfiguration
 * («modell»: Objekt oder URL einer JSON-Datei, z. B. /local/…). Koordinaten in Metern,
 * x und y im Grundriss, z = Höhe. Aufbau siehe dashboard/anlage-3d-beispiel.json.
 *
 * Zustände kommen live aus Home Assistant: Rohrfarben nach Temperatur, Strömung wenn
 * Pumpen laufen, Pufferschichtung, Flamme bei Leistung, Rührwerk und Schnecke bei Betrieb.
 * Klick auf ein Bauteil öffnet die Werte und Bedienung; Trends, Parameter, Zeitprogramm und
 * Heizkurve öffnen die bestehenden Karten (hargassner-anlage-card, hargassner-heizkurve-card).
 */

const LIB = "/hargassner_touch_pro/lib";
const KARTE_3D = "hargassner-anlage-3d-card";

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

// Temperatur → Farbe (20 °C blau, 45 °C gelb, 80 °C rot), als [r, g, b] 0–1
function tempFarbe(t) {
  if (t === null || t === undefined) return [0.62, 0.65, 0.7];
  const stops = [
    [10, [0.16, 0.38, 0.85]],
    [25, [0.2, 0.62, 0.95]],
    [40, [0.3, 0.78, 0.55]],
    [52, [0.98, 0.8, 0.2]],
    [65, [0.98, 0.5, 0.12]],
    [80, [0.88, 0.1, 0.1]],
  ];
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, a] = stops[i - 1];
      const [t1, b] = stops[i];
      const f = (t - t0) / (t1 - t0);
      return a.map((x, k) => x + (b[k] - x) * f);
    }
  }
  return stops[stops.length - 1][1];
}
const cssFarbe = (rgb) => `rgb(${rgb.map((x) => Math.round(x * 255)).join(",")})`;

const STIL = `
:host { display:block; }
.huelle { position:relative; width:100%; height:var(--hoehe, calc(100vh - var(--header-height, 56px))); min-height:420px; background:linear-gradient(180deg,#dfe4ea 0%,#f3f4f6 60%,#e9ebee 100%); overflow:hidden; font-family:"Helvetica Neue", Helvetica, Arial, sans-serif; color:#2b2b2b; }
canvas { display:block; width:100%; height:100%; outline:none; }
.leiste { position:absolute; top:10px; left:10px; right:10px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; pointer-events:none; z-index:3; }
.leiste > * { pointer-events:auto; }
.gruppe { display:flex; background:rgba(255,255,255,.92); border-radius:6px; box-shadow:0 1px 4px rgba(0,0,0,.18); overflow:hidden; }
.gruppe button { border:0; background:none; padding:7px 11px; font:inherit; font-size:12.5px; color:#333; cursor:pointer; display:flex; align-items:center; gap:5px; }
.gruppe button + button { border-left:1px solid #e6e6e6; }
.gruppe button.an { background:#2b7bd6; color:#fff; }
.gruppe ha-icon { --mdc-icon-size:16px; }
.titel { background:rgba(255,255,255,.92); border-radius:6px; padding:6px 12px; box-shadow:0 1px 4px rgba(0,0,0,.18); font-size:13px; }
.titel b { font-size:14px; }
.status { position:absolute; left:10px; bottom:10px; display:flex; gap:8px; flex-wrap:wrap; z-index:3; max-width:calc(100% - 20px); }
.chip { background:rgba(255,255,255,.93); border-radius:16px; padding:5px 11px; font-size:12px; box-shadow:0 1px 3px rgba(0,0,0,.18); cursor:pointer; display:flex; align-items:center; gap:6px; white-space:nowrap; }
.chip i { width:9px; height:9px; border-radius:50%; display:inline-block; background:#bbb; }
.chip i.an { background:#3aa655; } .chip i.warn { background:#f0a500; } .chip i.fehler { background:#e2001a; }
.legende { position:absolute; right:10px; bottom:10px; background:rgba(255,255,255,.93); border-radius:6px; padding:7px 10px; font-size:11px; box-shadow:0 1px 3px rgba(0,0,0,.18); z-index:3; }
.legende .balken { width:180px; height:9px; border-radius:4px; margin:4px 0 2px; background:linear-gradient(90deg, ${[10, 25, 40, 52, 65, 80].map((t) => cssFarbe(tempFarbe(t))).join(",")}); }
.legende .skala { display:flex; justify-content:space-between; color:#666; }
.marken { position:absolute; inset:0; pointer-events:none; z-index:2; }
.marke { position:absolute; transform:translate(-50%, -100%); background:rgba(255,255,255,.94); border-radius:5px; padding:3px 7px 4px; font-size:11.5px; line-height:1.25; box-shadow:0 1px 4px rgba(0,0,0,.25); white-space:nowrap; pointer-events:auto; cursor:pointer; border-left:3px solid var(--f, #999); }
.marke b { font-size:12.5px; }
.marke small { color:#666; display:block; font-size:10.5px; }
.marke.aus { display:none; }
.panel { position:absolute; top:58px; right:10px; bottom:46px; width:min(380px, calc(100% - 20px)); background:rgba(255,255,255,.97); border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,.25); z-index:4; display:flex; flex-direction:column; overflow:hidden; }
.panel.zu { display:none; }
.pkopf { padding:12px 14px 8px; border-bottom:1px solid #eee; display:flex; gap:8px; align-items:flex-start; }
.pkopf h3 { margin:0; font-size:16px; }
.pkopf small { color:#777; font-size:11.5px; display:block; margin-top:2px; }
.pkopf button { margin-left:auto; border:0; background:none; font-size:20px; cursor:pointer; color:#777; line-height:1; }
.pinhalt { overflow:auto; padding:8px 14px 14px; flex:1; }
.pknoepfe { display:flex; flex-wrap:wrap; gap:6px; padding:10px 14px; border-bottom:1px solid #eee; }
.pknoepfe button { border:0; border-radius:4px; padding:7px 10px; font:inherit; font-size:12px; color:#fff; cursor:pointer; display:flex; gap:5px; align-items:center; }
.pknoepfe ha-icon { --mdc-icon-size:15px; }
.b-trend { background:#3aa655; } .b-kurve { background:#f08c00; } .b-param { background:#8c8c8c; } .b-zp { background:#2b7bd6; } .b-aktion { background:#c0392b; }
.zeile { display:flex; justify-content:space-between; gap:10px; padding:6px 0; border-bottom:1px solid #f1f1f1; font-size:13px; align-items:center; }
.zeile .l { color:#555; cursor:pointer; }
.zeile .l:hover { color:#2b7bd6; }
.zeile .w { font-weight:600; text-align:right; }
.zeile .w small { color:#999; font-weight:400; }
.abschnitt { font-size:11px; text-transform:uppercase; letter-spacing:.4px; color:#999; margin:12px 0 2px; }
select { font:inherit; font-size:12.5px; padding:4px 6px; border:1px solid #d0d0d0; border-radius:3px; background:#fff; }
.stepper { display:flex; align-items:center; gap:6px; }
.stepper button { width:26px; height:26px; border:1px solid #d0d0d0; background:#f7f7f7; border-radius:3px; cursor:pointer; font-size:15px; }
.stepper span { min-width:62px; text-align:center; font-weight:700; }
.stepper span.wartet { color:#f08c00; }
.info { font-size:11.5px; color:#777; line-height:1.45; margin-top:10px; }
.ueber { position:absolute; inset:0; z-index:6; background:rgba(0,0,0,.4); display:flex; align-items:stretch; justify-content:center; padding:24px; box-sizing:border-box; }
.ueber.zu { display:none; }
.ueber .fenster { background:#e4e5e7; border-radius:8px; width:min(1500px,100%); display:flex; flex-direction:column; overflow:hidden; box-shadow:0 8px 40px rgba(0,0,0,.4); }
.ueber .fkopf { display:flex; align-items:center; padding:8px 12px; background:#fff; border-bottom:1px solid #ddd; font-size:14px; font-weight:700; }
.ueber .fkopf button { margin-left:auto; border:0; background:#eee; border-radius:4px; padding:6px 12px; font:inherit; cursor:pointer; }
.ueber .finhalt { overflow:auto; flex:1; }
.fehlt { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center; padding:30px; color:#555; font-size:14px; z-index:7; }
@media (max-width: 700px) {
  .panel { top:auto; bottom:0; right:0; left:0; width:auto; height:55%; border-radius:12px 12px 0 0; }
  .legende { display:none; }
  .ueber { padding:0; }
}
`;

// Ansichten: Kamera-Position und Blickziel in IFC-Koordinaten
const ANSICHT_NAMEN = {
  gesamt: { name: "Gesamt", icon: "mdi:home-outline" },
  heizraum: { name: "Heizraum", icon: "mdi:fire" },
  gruppen: { name: "Heizgruppen", icon: "mdi:pipe-valve" },
  lager: { name: "Lager", icon: "mdi:warehouse" },
};

class HargassnerAnlage3DCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._optionen = { waende: true, dach: false, marken: true, stroemung: true };
    this._auswahl = null;
    this._ausstehend = {};
    this._bereit = false;
  }

  setConfig(config) {
    if (!config || !config.anlage) throw new Error("Bitte unter «anlage» die Konfiguration der Anlagen-Karte angeben (kessel, puffer, heizkreise …).");
    this._config = config;
    if (config.hoehe) this.style.setProperty("--hoehe", config.hoehe);
  }

  set hass(hass) {
    const erstes = !this._hass;
    this._hass = hass;
    if (erstes) this._aufbauen();
    else if (this._bereit) this._zustandAnwenden();
    if (this._eingebettet) this._eingebettet.hass = hass;
    if (this._kurve) this._kurve.hass = hass;
  }

  getCardSize() {
    return 14;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }

  connectedCallback() {
    if (this._renderer && !this._lauf) this._schleife();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this._lauf);
    this._lauf = null;
  }

  /* ---------------- Hilfen für Zustände ---------------- */

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
    return r === "on" || r === "1" || r === "1.0" || r === "true" || (zahl(r) ?? 0) > 0;
  }
  _ein(id) {
    return this._s(id)?.attributes.unit_of_measurement || "";
  }
  _fmt(id, st = 1) {
    const r = this._roh(id);
    if (r === null) return "–";
    const n = zahl(r);
    const e = this._ein(id);
    if (n === null || !/^-?[\d.]+$/.test(r)) return esc(r);
    return komma(n, st) + (e ? " " + e : "");
  }
  _name(id) {
    return this._s(id)?.attributes.friendly_name || id;
  }

  /* ---------------- Aufbau ---------------- */

  async _aufbauen() {
    this.shadowRoot.innerHTML = `<style>${STIL}</style>
      <div class="huelle">
        <div class="leiste">
          <div class="titel"><b>${esc(this._config.titel || this._a.titel || "Heizung")}</b> · 3D</div>
          <div class="gruppe" id="ansichten"></div>
          <div class="gruppe" id="optionen">
            <button data-option="waende" title="Wände durchsichtig ein/aus"><ha-icon icon="mdi:wall"></ha-icon>Wände</button>
            <button data-option="dach"><ha-icon icon="mdi:home-roof"></ha-icon>Dach</button>
            <button data-option="marken"><ha-icon icon="mdi:tag-text-outline"></ha-icon>Werte</button>
            <button data-option="stroemung"><ha-icon icon="mdi:waves-arrow-right"></ha-icon>Strömung</button>
          </div>
        </div>
        <canvas tabindex="0"></canvas>
        <div class="marken" id="marken"></div>
        <div class="status" id="status"></div>
        <div class="legende">Temperatur in Rohren und Puffer<div class="balken"></div><div class="skala"><span>10°</span><span>40°</span><span>60°</span><span>80°</span></div></div>
        <div class="panel zu" id="panel"></div>
        <div class="ueber zu" id="ueber"><div class="fenster"><div class="fkopf"><span id="utitel"></span><button data-schliessen="ueber">Schliessen</button></div><div class="finhalt" id="uinhalt"></div></div></div>
      </div>`;
    this.shadowRoot.addEventListener("click", (e) => this._klick(e));
    this.shadowRoot.addEventListener("change", (e) => this._aenderung(e));
    this._optionenZeigen();

    try {
      const [THREE, { OrbitControls }] = await Promise.all([import(`${LIB}/three.module.min.js`), import(`${LIB}/OrbitControls.js`)]);
      this.THREE = THREE;
      this._OrbitControls = OrbitControls;
      let modell = this._config.modell;
      if (typeof modell === "string") {
        const antwort = await fetch(modell, { cache: "no-cache" });
        if (!antwort.ok) throw new Error(`Anlagenmodell ${modell} nicht gefunden (HTTP ${antwort.status})`);
        modell = await antwort.json();
      }
      if (!modell || typeof modell !== "object") throw new Error("Kein Anlagenmodell angegeben. Bitte unter «modell» ein Objekt oder die URL einer JSON-Datei eintragen.");
      this._m = modell;
      const ans = this._m.ansichten || {};
      this.shadowRoot.getElementById("ansichten").innerHTML = Object.keys(ans)
        .map((k) => `<button data-ansicht="${esc(k)}"><ha-icon icon="${(ANSICHT_NAMEN[k] || {}).icon || "mdi:eye-outline"}"></ha-icon>${esc(ans[k].name || ANSICHT_NAMEN[k]?.name || k)}</button>`)
        .join("");
      this._szene(this._m.gebaeude);
    } catch (e) {
      const d = document.createElement("div");
      d.className = "fehlt";
      d.textContent = "Die 3D-Ansicht konnte nicht starten: " + (e.message || e);
      this.shadowRoot.querySelector(".huelle").appendChild(d);
    }
  }

  // IFC (x, y, z) → three.js (x, z, -y)
  _p(x, y, z) {
    return new this.THREE.Vector3(x, z, -y);
  }

  _szene(gebaeude) {
    const T = this.THREE;
    const canvas = this.shadowRoot.querySelector("canvas");
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    this._renderer = renderer;
    const szene = new T.Scene();
    this._szeneObj = szene;
    const kamera = new T.PerspectiveCamera(42, 1, 0.05, 200);
    this._kamera = kamera;
    const steuerung = new this._OrbitControls(kamera, canvas);
    steuerung.enableDamping = true;
    steuerung.dampingFactor = 0.09;
    steuerung.maxPolarAngle = Math.PI * 0.495;
    steuerung.minDistance = 0.6;
    steuerung.maxDistance = 40;
    this._steuerung = steuerung;

    szene.add(new T.HemisphereLight(0xffffff, 0xb8b2a8, 1.25));
    const sonne = new T.DirectionalLight(0xffffff, 1.6);
    sonne.position.set(8, 14, 6);
    sonne.castShadow = true;
    sonne.shadow.mapSize.set(2048, 2048);
    Object.assign(sonne.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
    const mitte = this._m.mitte || [0, 0, 0];
    sonne.target.position.copy(this._p(...mitte));
    szene.add(sonne, sonne.target);

    // Boden rund ums Gebäude
    const boden = new T.Mesh(new T.CircleGeometry(16, 48), new T.MeshStandardMaterial({ color: 0xd9dcd5, roughness: 1 }));
    boden.rotation.x = -Math.PI / 2;
    boden.position.copy(this._p(mitte[0], mitte[1], (this._m.boden_z ?? -0.21)));
    boden.receiveShadow = true;
    szene.add(boden);

    this._teile = {}; // Klickbare Bauteile: id → [Meshes]
    this._rohre = []; // { mesh, textur, temp(), fliesst() }
    this._marken = []; // { id, pos, el }
    this._gebaeudeBauen(gebaeude);
    this._anlageBauen();
    this._markenBauen();

    this._ansicht(Object.keys(this._m.ansichten || {})[0], true);
    this._groesse = new ResizeObserver(() => this._anpassen());
    this._groesse.observe(this.shadowRoot.querySelector(".huelle"));
    this._anpassen();

    // Klick / Tippen auf Bauteile (nicht beim Drehen)
    let start = null;
    canvas.addEventListener("pointerdown", (e) => (start = [e.clientX, e.clientY]));
    canvas.addEventListener("pointerup", (e) => {
      if (!start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 6) return;
      const id = this._treffer(e);
      if (id) this._waehlen(id);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.buttons) return;
      canvas.style.cursor = this._treffer(e) ? "pointer" : "grab";
    });

    this._uhr = new T.Clock();
    this._bereit = true;
    this._optionenZeigen();
    this._zustandAnwenden();
    this._schleife();
  }

  _anpassen() {
    const h = this.shadowRoot.querySelector(".huelle");
    const b = h.clientWidth;
    const hh = h.clientHeight;
    if (!b || !hh) return;
    this._renderer.setSize(b, hh, false);
    this._kamera.aspect = b / hh;
    this._kamera.updateProjectionMatrix();
  }

  _ansicht(k, sofort) {
    const a = this._m.ansichten?.[k];
    if (!a) {
      this._kamera.position.set(10, 8, 10);
      this._steuerung.target.set(0, 1, 0);
      this._steuerung.update();
      return;
    }
    const cam = this._p(...a.cam);
    const ziel = this._p(...a.ziel);
    if (sofort) {
      this._kamera.position.copy(cam);
      this._steuerung.target.copy(ziel);
      this._steuerung.update();
    } else {
      this._flug = { von: this._kamera.position.clone(), nach: cam, zVon: this._steuerung.target.clone(), zNach: ziel, t: 0 };
    }
    this._aktuelleAnsicht = k;
    this.shadowRoot.querySelectorAll("[data-ansicht]").forEach((b) => b.classList.toggle("an", b.dataset.ansicht === k));
  }

  /* ---------------- Gebäude aus dem IFC ---------------- */

  _gebaeudeBauen(g) {
    const T = this.THREE;
    this._waende = [];
    this._dach = [];
    const stoffe = {
      wand: new T.MeshStandardMaterial({ color: 0xc9c6c0, roughness: 0.95, transparent: true, opacity: 0.16, depthWrite: false, side: T.DoubleSide }),
      decke: new T.MeshStandardMaterial({ color: 0xbdb8b0, roughness: 1, side: T.DoubleSide }),
      dach: new T.MeshStandardMaterial({ color: 0x9a8f86, roughness: 1, transparent: true, opacity: 0.35, depthWrite: false, side: T.DoubleSide }),
    };
    this._wandStoff = stoffe.wand;
    if (!g?.teile) {
      // Ohne Gebäudemodell: Räume als Quader [x0, y0, z0, x1, y1, z1]
      for (const r of this._m.raeume || []) {
        const boden = this._kiste([r[0], r[1], r[2] - 0.2], [r[3], r[4], r[2]], stoffe.decke);
        boden.receiveShadow = true;
        const huelle = this._kiste(r.slice(0, 3), r.slice(3, 6), stoffe.wand);
        huelle.castShadow = false;
        const kanten = new T.LineSegments(new T.EdgesGeometry(huelle.geometry), new T.LineBasicMaterial({ color: 0x8d8984, transparent: true, opacity: 0.55 }));
        kanten.position.copy(huelle.position);
        this._szeneObj.add(kanten);
        this._waende.push(huelle, kanten);
      }
      return;
    }
    for (const [art, liste] of Object.entries(g.teile)) {
      for (const t of liste) {
        const geo = new T.BufferGeometry();
        const v = new Float32Array(t.v.length);
        for (let i = 0; i < t.v.length; i += 3) {
          v[i] = t.v[i];
          v[i + 1] = t.v[i + 2];
          v[i + 2] = -t.v[i + 1];
        }
        geo.setAttribute("position", new T.BufferAttribute(v, 3));
        geo.setIndex(t.f);
        geo.computeVertexNormals();
        const m = new T.Mesh(geo, stoffe[art]);
        m.receiveShadow = art === "decke";
        m.castShadow = false;
        if (art === "wand") {
          this._waende.push(m);
          const kanten = new T.LineSegments(new T.EdgesGeometry(geo, 30), new T.LineBasicMaterial({ color: 0x8d8984, transparent: true, opacity: 0.55 }));
          this._waende.push(kanten);
          this._szeneObj.add(kanten);
        }
        if (art === "dach") this._dach.push(m);
        this._szeneObj.add(m);
      }
    }
  }

  /* ---------------- Bausteine ---------------- */

  _stoff(farbe, opt = {}) {
    return new this.THREE.MeshStandardMaterial({ color: farbe, roughness: opt.rauh ?? 0.55, metalness: opt.metall ?? 0.15, ...opt.extra });
  }

  _teil(id, mesh) {
    mesh.userData.teil = id;
    mesh.castShadow = true;
    (this._teile[id] = this._teile[id] || []).push(mesh);
    this._szeneObj.add(mesh);
    return mesh;
  }

  // Quader von Ecke [x0,y0,z0] bis [x1,y1,z1]
  _kiste(a, b, farbe, id) {
    const T = this.THREE;
    const m = new T.Mesh(new T.BoxGeometry(Math.abs(b[0] - a[0]), Math.abs(b[2] - a[2]), Math.abs(b[1] - a[1])), typeof farbe === "number" ? this._stoff(farbe) : farbe);
    m.position.copy(this._p((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2));
    if (id) return this._teil(id, m);
    m.castShadow = true;
    this._szeneObj.add(m);
    return m;
  }

  // Stehender Zylinder: Mitte unten [x, y, z], Radius, Höhe
  _zylinder(x, y, z, r, h, farbe, id, seg = 40) {
    const T = this.THREE;
    const m = new T.Mesh(new T.CylinderGeometry(r, r, h, seg), typeof farbe === "number" ? this._stoff(farbe) : farbe);
    m.position.copy(this._p(x, y, z + h / 2));
    return id ? this._teil(id, m) : (this._szeneObj.add(m), m);
  }

  // Rohr entlang Punkten; temp() liefert °C, fliesst() ob eine Pumpe fördert
  _rohr(punkte, r, { id, temp, fliesst, farbe, rueckwaerts } = {}) {
    const T = this.THREE;
    const pfad = new T.CurvePath();
    const v = punkte.map((p) => this._p(...p));
    let laenge = 0;
    for (let i = 1; i < v.length; i++) {
      pfad.add(new T.LineCurve3(v[i - 1], v[i]));
      laenge += v[i].distanceTo(v[i - 1]);
    }
    const geo = new T.TubeGeometry(pfad, Math.max(8, Math.round(laenge * 24)), r, 12, false);
    let textur = null;
    if (temp) {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 4;
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, 64, 4);
      g.fillStyle = "rgba(255,255,255,0.0)";
      const verlauf = g.createLinearGradient(0, 0, 64, 0);
      verlauf.addColorStop(0, "#ffffff");
      verlauf.addColorStop(0.55, "#ffffff");
      verlauf.addColorStop(0.75, "#9a9a9a");
      verlauf.addColorStop(1, "#ffffff");
      g.fillStyle = verlauf;
      g.fillRect(0, 0, 64, 4);
      textur = new T.CanvasTexture(c);
      textur.wrapS = T.RepeatWrapping;
      textur.repeat.set(Math.max(1, laenge * 4), 1);
      textur.colorSpace = T.SRGBColorSpace;
    }
    const stoff = new T.MeshStandardMaterial({ color: farbe ?? 0x9ea4ad, roughness: 0.4, metalness: 0.25, map: textur });
    const m = new T.Mesh(geo, stoff);
    m.castShadow = true;
    if (id) this._teil(id, m);
    else this._szeneObj.add(m);
    // Ecken als Kugeln, damit Bögen sauber aussehen
    for (let i = 1; i < v.length - 1; i++) {
      const k = new T.Mesh(new T.SphereGeometry(r * 1.02, 12, 8), stoff);
      k.position.copy(v[i]);
      if (id) this._teil(id, k);
      else this._szeneObj.add(k);
    }
    if (temp) this._rohre.push({ stoff, textur, temp, fliesst: fliesst || (() => false), richtung: rueckwaerts ? -1 : 1 });
    return m;
  }

  // Pumpe: Ring mit Laufrad, dreht wenn aktiv
  _pumpe(pos, id, achse = "x") {
    const T = this.THREE;
    const g = new T.Group();
    const gehaeuse = new T.Mesh(new T.CylinderGeometry(0.075, 0.075, 0.09, 24), this._stoff(0x2c5aa0, { metall: 0.3 }));
    const kopf = new T.Mesh(new T.BoxGeometry(0.1, 0.07, 0.1), this._stoff(0x1f2d3d));
    kopf.position.y = 0.07;
    const rad = new T.Mesh(new T.BoxGeometry(0.13, 0.012, 0.03), this._stoff(0xffffff));
    rad.position.y = -0.047;
    g.add(gehaeuse, kopf, rad);
    if (achse === "y") g.rotation.x = Math.PI / 2;
    else g.rotation.z = Math.PI / 2;
    g.position.copy(this._p(...pos));
    g.traverse((o) => o.isMesh && ((o.userData.teil = id), (o.castShadow = true), (this._teile[id] = this._teile[id] || []).push(o)));
    this._szeneObj.add(g);
    return rad;
  }

  // Mischer: Kugel mit Stellantrieb
  _mischer(pos, id) {
    const T = this.THREE;
    const k = new T.Mesh(new T.SphereGeometry(0.06, 16, 12), this._stoff(0xb08d57, { metall: 0.6, rauh: 0.3 }));
    k.position.copy(this._p(...pos));
    this._teil(id, k);
    const antrieb = new T.Mesh(new T.BoxGeometry(0.09, 0.09, 0.11), this._stoff(0x404850));
    antrieb.position.copy(this._p(pos[0], pos[1] + 0.09, pos[2]));
    this._teil(id, antrieb);
  }

  _anlageBauen() {
    const T = this.THREE;
    const M = this._m;
    const a = this._a;
    const hk = a.heizkreise || [];
    const kT = () => this._z(a.kessel?.temperatur);
    const pO = () => this._z(a.puffer?.oben);
    const pM = () => this._z(a.puffer?.mitte) ?? pO();
    const pU = () => this._z(a.puffer?.unten);
    const rlK = () => this._z(this._config.ruecklauf) ?? pU();
    const kesselLaeuft = () => (this._z(a.kessel?.leistung) ?? 0) > 0;
    const ladepumpe = () => this._an(this._config.ladepumpe) || kesselLaeuft();
    const fwsPumpe = () => this._an(a.frischwasser?.[0]?.pumpe);
    const box = (b) => [b.slice(0, 3), b.slice(3, 6)];
    const rohre = M.rohre || {};
    this._rad = {};

    /* --- Kessel mit Einschub und Rücklaufanhebung --- */
    const k = M.kessel;
    if (k) {
      const rot = this._stoff(0xa8161c, { rauh: 0.45 });
      const [k0, k1] = box(k.box);
      const deckel = k.deckel ?? 0.1;
      this._kiste(k0, [k1[0], k1[1], k1[2] - deckel], rot, "kessel");
      this._kiste([k0[0], k0[1], k1[2] - deckel], k1, 0x2f3237, "kessel");
      if (k.bedien) this._kiste(...box(k.bedien), 0x2a2d31, "kessel");
      if (k.einschub) this._kiste(...box(k.einschub), 0x5d6168, "austragung");
      if (k.schleuse) this._kiste(...box(k.schleuse), 0x7a7f86, "austragung");
      // Sichtfenster mit Flamme (x, y, z der Fenstermitte, Blickrichtung in Grad um die Hochachse)
      const f = k.fenster || [k0[0] - 0.005, (k0[1] + k1[1]) / 2, 0.55, -90];
      this._flamme = new T.Mesh(new T.PlaneGeometry(0.28, 0.32), new T.MeshBasicMaterial({ color: 0x331100 }));
      this._flamme.position.copy(this._p(f[0], f[1], f[2]));
      this._flamme.rotation.y = ((f[3] ?? -90) * Math.PI) / 180;
      this._teil("kessel", this._flamme);
      this._flammLicht = new T.PointLight(0xff7a20, 0, 3.5);
      const l = k.licht || [f[0] - 0.2, f[1], f[2] + 0.05];
      this._flammLicht.position.copy(this._p(...l));
      this._szeneObj.add(this._flammLicht);
      if (k.rm) this._mischer(k.rm, "kessel");
      if (k.rp) this._rad.rp = this._pumpe(k.rp, "kessel");
    }

    /* --- Pufferspeicher mit Temperaturschichtung --- */
    const pu = M.puffer;
    if (pu) {
      const [px, py] = pu.mitte;
      const pz = pu.boden ?? 0;
      this._pufferMasse = { x: px, y: py, z: pz, h: pu.h };
      const pufferGeo = new T.CylinderGeometry(pu.r, pu.r, pu.h, 48, 24, true);
      pufferGeo.setAttribute("color", new T.BufferAttribute(new Float32Array(pufferGeo.attributes.position.count * 3), 3));
      this._pufferGeo = pufferGeo;
      const puffer = new T.Mesh(pufferGeo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 }));
      puffer.position.copy(this._p(px, py, pz + pu.h / 2));
      this._teil("puffer", puffer);
      this._zylinder(px, py, pz + pu.h, pu.r + 0.01, 0.06, 0x3a3d42, "puffer");
      this._zylinder(px, py, pz, pu.r + 0.01, 0.04, 0x3a3d42, "puffer");
      this._ladering = new T.Mesh(new T.TorusGeometry(pu.r + 0.02, 0.018, 8, 48), new T.MeshBasicMaterial({ color: 0xffffff }));
      this._ladering.rotation.x = Math.PI / 2;
      this._teil("puffer", this._ladering);
    }

    /* --- Ausdehnungsgefäss --- */
    const ae = M.ae;
    if (ae) {
      const [x, y] = ae.mitte;
      const rot = this._stoff(0xb01d22, { rauh: 0.35 });
      this._zylinder(x, y, 0.08, ae.r, ae.h - ae.r - 0.08, rot, "ae");
      const kuppe = new T.Mesh(new T.SphereGeometry(ae.r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), rot);
      kuppe.position.copy(this._p(x, y, ae.h - ae.r));
      this._teil("ae", kuppe);
      this._zylinder(x, y, 0, ae.r * 0.73, 0.08, 0x333333, "ae");
    }

    /* --- Frischwasserstation --- */
    const fw = M.fws;
    if (fw) {
      this._kiste(...box(fw.box), this._stoff(0xf2f2f2, { rauh: 0.6 }), "fws");
      if (fw.regler) this._kiste(...box(fw.regler), 0x2a2d31, "fws");
      if (fw.pumpe) this._rad.fws = this._pumpe(fw.pumpe, "fws", fw.pumpe_achse || "y");
    }

    /* --- Heizgruppen: Vorlauf mit Mischer und Pumpe, Rücklauf --- */
    this._rad.hk = [];
    (M.heizgruppen || []).forEach((g, i) => {
      const h = hk[i];
      if (!h) return;
      const id = "hk" + (i + 1);
      const vl = () => this._z(h.vorlauf);
      const rl = () => {
        const v = vl();
        return v === null ? pU() : Math.max(pU() ?? 0, v - 8);
      };
      const pumpe = () => this._an(h.pumpe);
      const d = g.abstand ?? 0.09;
      this._rohr([[g.x - d, g.y, g.vl_z ?? 0.75], [g.x - d, g.y, g.oben]], 0.024, { id, temp: vl, fliesst: pumpe });
      this._rohr([[g.x + d, g.y, g.oben], [g.x + d, g.y, g.rl_z ?? 0.45]], 0.024, { id, temp: rl, fliesst: pumpe });
      this._mischer([g.x - d, g.y, g.mischer_z ?? 1.0], id);
      this._rad.hk[i] = this._pumpe([g.x - d, g.y + 0.07, g.pumpe_z ?? 1.45], id);
      this._zylinder(g.x - d, g.y + 0.08, g.fuehler_z ?? 1.92, 0.035, 0.03, 0xffffff, id);
      this._kiste([g.x - 0.16, g.y - 0.08, g.oben - 0.02], [g.x + 0.16, g.y + 0.12, g.oben + 0.02], 0x777777, id);
    });

    /* --- Rohrleitungen --- */
    const R = 0.032;
    const fwsVl = () => this._z(a.frischwasser?.[0]?.vorlauf) ?? pO();
    const zapfung = () => (this._z(a.frischwasser?.[0]?.durchfluss) ?? 0) > 0;
    const hkPumpen = () => hk.some((h) => this._an(h.pumpe));
    const ww = () => this._z(a.frischwasser?.[0]?.auslauf_soll);
    const leitungen = [
      ["kessel_vl", R, { id: "kessel", temp: kT, fliesst: ladepumpe }],
      ["kessel_rl", R, { id: "kessel", temp: rlK, fliesst: ladepumpe }],
      ["bypass", 0.02, { id: "kessel", temp: kT, fliesst: ladepumpe }],
      ["ae", 0.012, { farbe: 0x8a8f96 }],
      ["fws_vl", 0.022, { id: "fws", temp: fwsVl, fliesst: fwsPumpe }],
      ["fws_rl", 0.022, { id: "fws", temp: () => pU(), fliesst: fwsPumpe }],
      ["ww", 0.016, { id: "fws", temp: ww, fliesst: zapfung }],
      ["kw", 0.016, { id: "fws", temp: () => 12, fliesst: zapfung }],
      ["verteiler_vl", R, { id: "verteiler", temp: pM, fliesst: hkPumpen }],
      ["verteiler_rl", R, { id: "verteiler", temp: pU, fliesst: hkPumpen }],
    ];
    for (const [name, r, opt] of leitungen) if (rohre[name]?.length > 1) this._rohr(rohre[name], r, opt);

    /* --- Lager: Rührwerk, Austragungskanal, Fallrohr --- */
    const lg = M.lager;
    if (lg) {
      const [rx, ry, rz] = lg.ruehrwerk;
      this._lagerMitte = [rx, ry, rz];
      this._ruehrwerk = new T.Group();
      this._ruehrwerk.add(new T.Mesh(new T.CylinderGeometry(0.38, 0.38, 0.08, 32), this._stoff(0xa8161c)));
      for (let s = 0; s < 2; s++) {
        const arm = new T.Mesh(new T.BoxGeometry(lg.radius - 0.05, 0.012, 0.09), this._stoff(0x4a4f56, { metall: 0.6 }));
        arm.position.x = (s ? -1 : 1) * (lg.radius - 0.05) / 2;
        arm.rotation.y = 0.35;
        this._ruehrwerk.add(arm);
      }
      const kreis = new T.Mesh(new T.RingGeometry(lg.radius - 0.03, lg.radius, 96), new T.MeshBasicMaterial({ color: 0x777777, side: T.DoubleSide, transparent: true, opacity: 0.5 }));
      kreis.rotation.x = -Math.PI / 2;
      kreis.position.copy(this._p(rx, ry, rz - 0.04));
      this._szeneObj.add(kreis);
      this._ruehrwerk.position.copy(this._p(rx, ry, rz));
      this._ruehrwerk.traverse((o) => o.isMesh && ((o.userData.teil = "austragung"), (this._teile.austragung = this._teile.austragung || []).push(o)));
      this._szeneObj.add(this._ruehrwerk);
      if (lg.kanal?.length > 1) {
        this._schnecke = this._rohr(lg.kanal, 0.075, { id: "austragung", temp: () => null, fliesst: kesselLaeuft });
        this._schnecke.material.color.set(0x6b7078);
      }
      if (lg.antrieb) this._kiste(...box(lg.antrieb), 0x3b3f45, "austragung");
      if (lg.fallrohr) {
        const [fx, fy, z0, z1] = lg.fallrohr;
        this._zylinder(fx, fy, z0, 0.075, z1 - z0, this._stoff(0x8a9097, { metall: 0.5, rauh: 0.35 }), "austragung");
      }
      const haufen = new T.Mesh(new T.CylinderGeometry(lg.radius * 0.7, lg.radius + 0.05, 1, 40, 1), new T.MeshStandardMaterial({ color: 0xb08a55, roughness: 1, transparent: true, opacity: 0.55 }));
      this._haufen = haufen;
      this._teil("austragung", haufen);
      if (lg.palisade) {
        const { von, bis, anzahl = 8, hoehe = 0.18 } = lg.palisade;
        const holz = this._stoff(0x9c7a4f, { extra: { transparent: true, opacity: 0.55 } });
        for (let s = 0; s < anzahl; s++) this._kiste([von[0], von[1], von[2] + s * (hoehe + 0.04)], [bis[0], bis[1], von[2] + s * (hoehe + 0.04) + hoehe], holz);
      }
    }

    /* --- Abgasrohr und Kamin --- */
    const abgas = () => this._z(a.kessel?.abgas);
    if (M.abgas?.pfad?.length > 1) this._rohr(M.abgas.pfad, 0.075, { id: "abgas", temp: abgas, fliesst: kesselLaeuft });
    this._rauch = [];
    if (M.abgas?.kamin) {
      this._kaminPos = this._p(...M.abgas.kamin);
      for (let s = 0; s < 14; s++) {
        const r = new T.Mesh(new T.SphereGeometry(0.12, 10, 8), new T.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0 }));
        r.userData.phase = s / 14;
        this._szeneObj.add(r);
        this._rauch.push(r);
      }
    }

    /* --- Aussenfühler --- */
    if (M.aussen?.box) this._kiste(...box(M.aussen.box), 0xf5f5f5, "aussen");
  }

  /* ---------------- Werte-Marken ---------------- */

  _markenBauen() {
    const a = this._a;
    const mk = this._m.marken || {};
    const tx = (id, feld, ersatz) => this._m.texte?.[id]?.[feld] ?? ersatz;
    const liste = [
      ["kessel", mk.kessel, () => `<b>${esc(tx("kessel", "kurz", "Kessel"))} ${this._fmt(a.kessel?.temperatur)}</b><small>${esc(this._roh(a.kessel?.zustand) || "–")} · ${this._fmt(a.kessel?.leistung, 0)}</small>`, () => tempFarbe(this._z(a.kessel?.temperatur))],
      ["puffer", mk.puffer, () => `<b>${esc(tx("puffer", "kurz", "Puffer"))} ${this._fmt(a.puffer?.ladung, 0)}</b><small>${this._fmt(a.puffer?.oben, 0)} / ${this._fmt(a.puffer?.mitte, 0)} / ${this._fmt(a.puffer?.unten, 0)}</small>`, () => tempFarbe(this._z(a.puffer?.oben))],
      ["fws", mk.fws, () => `<b>${esc(tx("fws", "kurz", "Warmwasser"))} ${this._fmt(a.frischwasser?.[0]?.auslauf_soll, 0)}</b><small>Zapfung heute ${this._fmt(a.frischwasser?.[0]?.heute, 0)}</small>`, () => tempFarbe(this._z(a.frischwasser?.[0]?.auslauf_soll))],
      ["austragung", mk.austragung, () => `<b>${esc(tx("austragung", "kurz", "Lager"))}</b><small>Lagerstand ${this._z(this._config.lagerstand ?? null) === null ? "unbekannt" : this._fmt(this._config.lagerstand, 0)}</small>`, () => [0.69, 0.54, 0.33]],
      ["ae", mk.ae, () => `<b>Druck ${this._fmt(this._config.systemdruck, 2)}</b><small>${esc(tx("ae", "kurz", "Ausdehnungsgefäss"))}</small>`, () => [0.6, 0.6, 0.65]],
      ["aussen", mk.aussen, () => `<b>Aussen ${this._fmt(a.heizkurve?.aussen_aktuell || a.kessel?.aussen)}</b><small>Ø ${this._fmt(a.heizkurve?.aussen)}</small>`, () => tempFarbe(this._z(a.heizkurve?.aussen_aktuell))],
    ];
    (a.heizkreise || []).forEach((h, i) => {
      if (!mk.hk?.[i]) return;
      liste.push(["hk" + (i + 1), mk.hk[i], () => `<b>${esc(h.titel || "Heizkreis " + (i + 1))} ${this._fmt(h.vorlauf)}</b><small>Soll ${this._fmt(h.vorlauf_soll)} · ${esc(this._roh(h.zustand) || "–")}</small>`, () => tempFarbe(this._z(h.vorlauf))]);
    });
    const kasten = this.shadowRoot.getElementById("marken");
    kasten.innerHTML = "";
    this._marken = liste
      .filter(([, pos]) => pos)
      .map(([id, pos, text, farbe]) => {
        const el = document.createElement("div");
        el.className = "marke";
        el.dataset.teil = id;
        kasten.appendChild(el);
        return { id, pos: this._p(...pos), text, farbe, el };
      });
  }

  _markenZeichnen() {
    if (!this._marken) return;
    const b = this._renderer.domElement.clientWidth;
    const h = this._renderer.domElement.clientHeight;
    const v = new this.THREE.Vector3();
    const platziert = [];
    const liste = this._marken.map((m) => {
      v.copy(m.pos).project(this._kamera);
      const sichtbar = this._optionen.marken && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      return { m, sichtbar, x: ((v.x + 1) / 2) * b, y: ((1 - v.y) / 2) * h, tiefe: v.z };
    });
    // Nahe Marken zuerst; überlappende nach oben schieben, damit alle lesbar bleiben
    liste.sort((a, c) => a.tiefe - c.tiefe);
    for (const e of liste) {
      e.m.el.classList.toggle("aus", !e.sichtbar);
      if (!e.sichtbar) continue;
      const bw = e.m.el.offsetWidth || 120;
      const bh = (e.m.el.offsetHeight || 34) + 4;
      let y = e.y;
      for (let runde = 0; runde < 8; runde++) {
        const kollision = platziert.find((p) => Math.abs(p.x - e.x) < (p.b + bw) / 2 && Math.abs(p.y - y) < bh);
        if (!kollision) break;
        y = kollision.y - bh;
      }
      platziert.push({ x: e.x, y, b: bw });
      e.m.el.style.left = e.x + "px";
      e.m.el.style.top = y + "px";
    }
  }

  /* ---------------- Live-Zustand ---------------- */

  _zustandAnwenden() {
    if (!this._bereit) return;
    const a = this._a;
    // Rohrfarben
    for (const r of this._rohre) {
      if (r.stoff === this._schnecke?.material) continue;
      r.stoff.color.setRGB(...tempFarbe(r.temp()));
    }
    // Puffer-Schichtung aus oben / mitte / unten
    const o = this._z(a.puffer?.oben);
    const m = this._z(a.puffer?.mitte) ?? o;
    const u = this._z(a.puffer?.unten);
    const pm = this._pufferMasse;
    const pos = this._pufferGeo?.attributes.position;
    const col = this._pufferGeo?.attributes.color;
    for (let i = 0; pos && i < pos.count; i++) {
      const f = (pos.getY(i) + pm.h / 2) / pm.h; // 0 unten … 1 oben
      let t;
      if (o === null && u === null) t = null;
      else if (f > 0.5) t = (m ?? o) + ((o ?? m) - (m ?? o)) * ((f - 0.5) / 0.5);
      else t = (u ?? m) + ((m ?? u) - (u ?? m)) * (f / 0.5);
      const c = tempFarbe(t);
      col.setXYZ(i, c[0], c[1], c[2]);
    }
    if (col) col.needsUpdate = true;
    const ladung = this._z(a.puffer?.ladung);
    if (this._ladering) {
      this._ladering.visible = ladung !== null;
      if (ladung !== null) this._ladering.position.copy(this._p(pm.x, pm.y, pm.z + 0.05 + (pm.h - 0.08) * (ladung / 100)));
    }
    // Hackschnitzel-Höhe
    const lager = this._z(this._config.lagerstand);
    const max = this._config.lager_max_kg || 6000;
    const hoehe = lager === null ? 0.9 : Math.max(0.05, Math.min(2, (lager / max) * 2));
    if (this._haufen) {
      const [hx, hy, hz] = this._lagerMitte;
      this._haufen.scale.set(1, hoehe, 1);
      this._haufen.position.copy(this._p(hx, hy, hz - 0.06 + hoehe / 2));
      this._haufen.material.opacity = lager === null ? 0.3 : 0.65;
    }
    // Statuszeile und Marken
    this._statusZeichnen();
    for (const mk of this._marken) {
      mk.el.innerHTML = mk.text();
      mk.el.style.setProperty("--f", cssFarbe(mk.farbe()));
    }
    if (this._auswahl) this._panelZeichnen(false);
  }

  _statusZeichnen() {
    const a = this._a;
    const chips = [];
    const zustand = this._roh(a.kessel?.zustand);
    chips.push(["kessel", (this._z(a.kessel?.leistung) ?? 0) > 0 ? "an" : "", `Kessel: ${esc(zustand || "–")}`]);
    chips.push(["puffer", "", `Puffer ${this._fmt(a.puffer?.ladung, 0)}`]);
    (a.heizkreise || []).slice(0, 2).forEach((h, i) => chips.push(["hk" + (i + 1), this._an(h.pumpe) ? "an" : "", `${esc(h.titel || "HK " + (i + 1))}: ${this._fmt(h.vorlauf, 0)}`]));
    if (a.frischwasser?.[0]) chips.push(["fws", this._an(a.frischwasser[0].pumpe) ? "an" : "", `FWS ${this._fmt(a.frischwasser[0].auslauf_soll, 0)}`]);
    for (const s of a.signale?.zeilen || []) {
      if (!s.art || !this._an(s.entity)) continue;
      chips.push(["signal:" + s.entity, s.art === "fehler" ? "fehler" : "warn", esc(s.name)]);
    }
    this.shadowRoot.getElementById("status").innerHTML = chips.map(([id, k, t]) => `<div class="chip" data-teil="${esc(id)}"><i class="${k}"></i>${t}</div>`).join("");
  }

  /* ---------------- Animation ---------------- */

  _schleife() {
    this._lauf = requestAnimationFrame(() => this._schleife());
    if (!this._renderer) return;
    const dt = Math.min(0.05, this._uhr.getDelta());
    const zeit = this._uhr.elapsedTime;
    const a = this._a;
    if (this._flug) {
      const f = this._flug;
      f.t = Math.min(1, f.t + dt / 0.9);
      const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
      this._kamera.position.lerpVectors(f.von, f.nach, e);
      this._steuerung.target.lerpVectors(f.zVon, f.zNach, e);
      if (f.t >= 1) this._flug = null;
    }
    this._steuerung.update();
    // Strömung: Muster wandert, wenn die zuständige Pumpe läuft
    for (const r of this._rohre) {
      if (!r.textur) continue;
      const laeuft = this._optionen.stroemung && r.fliesst();
      r.textur.offset.x -= laeuft ? dt * 1.6 * r.richtung : 0;
      if (!this._optionen.stroemung) r.textur.offset.x = 0;
    }
    const leistung = this._z(a.kessel?.leistung) ?? 0;
    const brennt = leistung > 0;
    // Flamme
    const flacker = brennt ? 0.75 + 0.25 * Math.sin(zeit * 13) * Math.sin(zeit * 7.3) : 0;
    if (this._flamme) {
      this._flammLicht.intensity = brennt ? (1.5 + leistung / 40) * (0.8 + flacker * 0.4) : 0;
      this._flamme.material.color.setRGB(brennt ? 1 : 0.2, brennt ? 0.35 + flacker * 0.25 : 0.07, brennt ? 0.05 : 0.02);
    }
    // Rührwerk und Pumpen
    if (brennt && this._ruehrwerk) this._ruehrwerk.rotation.y += dt * 0.35;
    const pumpen = [
      [this._rad.rp, (this._z(a.kessel?.leistung) ?? 0) > 0 || this._an(this._config.ladepumpe)],
      [this._rad.fws, this._an(a.frischwasser?.[0]?.pumpe)],
      ...(a.heizkreise || []).map((h, i) => [this._rad.hk?.[i], this._an(h.pumpe)]),
    ];
    for (const [rad, an] of pumpen) if (rad && an) rad.rotation.y += dt * 14;
    if (!this._kaminPos) this._rauch = [];
    // Rauch aus dem Kamin
    for (const r of this._rauch) {
      const ph = (r.userData.phase + zeit * 0.18) % 1;
      r.material.opacity = brennt ? 0.5 * (1 - ph) : 0;
      r.position.set(this._kaminPos.x + Math.sin(ph * 6 + r.userData.phase * 20) * 0.15 + ph * 0.8, this._kaminPos.y + ph * 2.4, this._kaminPos.z - ph * 0.3);
      r.scale.setScalar(0.6 + ph * 2.2);
    }
    this._renderer.render(this._szeneObj, this._kamera);
    this._markenZeichnen();
  }

  _treffer(e) {
    const T = this.THREE;
    const box = this._renderer.domElement.getBoundingClientRect();
    const maus = new T.Vector2(((e.clientX - box.left) / box.width) * 2 - 1, -((e.clientY - box.top) / box.height) * 2 + 1);
    const strahl = new T.Raycaster();
    strahl.setFromCamera(maus, this._kamera);
    const ziele = Object.values(this._teile).flat();
    const hit = strahl.intersectObjects(ziele, false)[0];
    return hit?.object.userData.teil || null;
  }

  /* ---------------- Auswahl und Panel ---------------- */

  _waehlen(id) {
    if (id.startsWith("signal:")) {
      this._mehrInfo(id.slice(7));
      return;
    }
    this._auswahl = id;
    this._hervorheben(id);
    this._panelZeichnen(true);
  }

  _hervorheben(id) {
    for (const [tid, liste] of Object.entries(this._teile)) {
      for (const m of liste) {
        if (!m.material?.emissive) continue;
        m.material.emissive.setHex(tid === id ? 0x2b5c99 : 0x000000);
        m.material.emissiveIntensity = tid === id ? 0.35 : 0;
      }
    }
  }

  _zeile(label, id, { st = 1, soll, wert } = {}) {
    if (!id && wert === undefined) return "";
    const text = wert !== undefined ? wert : this._fmt(id, st);
    return `<div class="zeile"><span class="l" data-mehr="${esc(id || "")}">${esc(label)}</span><span class="w">${text}${soll ? ` <small>(Soll ${this._fmt(soll, st)})</small>` : ""}</span></div>`;
  }

  _auswahlFeld(label, id) {
    const s = this._s(id);
    if (!s) return "";
    const opts = (s.attributes.options || []).map((o) => `<option ${o === s.state ? "selected" : ""}>${esc(o)}</option>`).join("");
    return `<div class="zeile"><span class="l" data-mehr="${esc(id)}">${esc(label)}</span><select data-auswahl="${esc(id)}">${opts}</select></div>`;
  }

  _schrittFeld(label, id) {
    const s = this._s(id);
    if (!s) return "";
    const w = this._ausstehend[id]?.wert ?? zahl(s.state);
    const st = s.attributes.step || 0.5;
    return `<div class="zeile"><span class="l" data-mehr="${esc(id)}">${esc(label)}</span><span class="stepper">
      <button data-schritt="-1" data-entity="${esc(id)}">−</button><span class="${this._ausstehend[id] ? "wartet" : ""}">${komma(w, st < 0.1 ? 2 : st < 1 ? 1 : 0)}${s.attributes.unit_of_measurement ? " " + s.attributes.unit_of_measurement : ""}</span>
      <button data-schritt="1" data-entity="${esc(id)}">+</button></span></div>`;
  }

  _geraet(id) {
    return this._hass.entities?.[id]?.device_id || "";
  }

  _panelInhalt(id) {
    const a = this._a;
    const k = a.kessel || {};
    const p = a.puffer || {};
    const f = a.frischwasser?.[0] || {};
    const knopf = (cls, icon, text, data) => `<button class="${cls}" ${data}><ha-icon icon="${icon}"></ha-icon>${text}</button>`;
    const c = this._config;
    const tx = (teil, feld, ersatz) => esc(this._m.texte?.[teil]?.[feld] ?? ersatz);
    const info = (teil) => (this._m.texte?.[teil]?.info ? `<div class="info">${esc(this._m.texte[teil].info)}</div>` : "");
    if (id === "kessel" || id === "abgas") {
      return {
        titel: tx("kessel", "titel", "Kessel"),
        unter: tx("kessel", "unter", ""),
        knoepfe:
          knopf("b-trend", "mdi:chart-line", "Trends", 'data-trend="heater|"') +
          knopf("b-param", "mdi:wrench", "Parameter", `data-param="${esc(this._geraet(k.programm || k.zustand))}"`),
        inhalt:
          `<div class="abschnitt">Betrieb</div>` +
          this._zeile("Zustand", k.zustand) +
          this._auswahlFeld("Kesselprogramm", k.programm) +
          this._zeile("Leistung", k.leistung, { st: 0 }) +
          `<div class="abschnitt">Temperaturen</div>` +
          this._zeile("Kesseltemperatur", k.temperatur, { soll: this._roh(k.solltemperatur) !== null ? k.solltemperatur : null }) +
          this._zeile("Rücklauf", c.ruecklauf, { soll: c.ruecklauf_soll }) +
          this._zeile("Abgas", k.abgas) +
          this._zeile("Restsauerstoff", c.sauerstoff, { soll: c.sauerstoff_soll }) +
          this._zeile("Aussentemperatur", a.heizkurve?.aussen_aktuell) +
          `<div class="abschnitt">Überwachung</div>` +
          this._zeile("Systemdruck", c.systemdruck, { st: 2 }) +
          this._zeile("Abgasüberwachung", c.abgasueberwachung, { wert: this._an(c.abgasueberwachung) ? "Ausgelöst" : "In Ordnung" }) +
          this._zeile("Kesseltyp", k.typ) +
          info("kessel"),
      };
    }
    if (id === "puffer") {
      return {
        titel: tx("puffer", "titel", "Pufferspeicher"),
        unter: tx("puffer", "unter", ""),
        knoepfe:
          knopf("b-trend", "mdi:chart-line", "Trends", 'data-trend="buffer|"') +
          knopf("b-param", "mdi:wrench", "Parameter", `data-param="${esc(this._geraet(p.zustand || p.ladung))}"`) +
          (c.zwangsladung ? knopf("b-aktion", "mdi:fire-circle", "Zwangsladung", `data-druecken="${esc(c.zwangsladung)}"`) : ""),
        inhalt:
          this._zeile("Ladung", p.ladung, { st: 0 }) +
          this._zeile("Zustand", p.zustand) +
          this._zeile("Höchste Anforderung", p.anforderung, { st: 0 }) +
          `<div class="abschnitt">Schichtung</div>` +
          this._zeile("Oben (PF1)", p.oben) +
          this._zeile("Mitte (PF2)", p.mitte) +
          this._zeile("Unten (PF3)", p.unten) +
          this._zeile("Pufferpumpe", p.pumpe, { wert: this._an(p.pumpe) ? "Ein" : "Aus" }) +
          this._zeile("Zwangsladung", c.zwangsladung_aktiv, { wert: this._an(c.zwangsladung_aktiv) ? "Aktiv" : "Aus" }) +
          (info("puffer") || `<div class="info">Die Farbe des Speichers zeigt die Temperaturschichtung, der weisse Ring die Ladung.</div>`),
      };
    }
    if (id === "fws") {
      return {
        titel: tx("fws", "titel", "Frischwasserstation"),
        unter: tx("fws", "unter", "") || esc(f.name || ""),
        knoepfe:
          knopf("b-trend", "mdi:chart-line", "Trends", 'data-trend="fresh_water|1"') +
          knopf("b-param", "mdi:wrench", "Parameter", `data-param="${esc(this._geraet(f.auslauf_soll))}"`),
        inhalt:
          this._zeile("Warmwasser Soll", f.auslauf_soll, { st: 0 }) +
          this._zeile("Vorlauf primär", f.vorlauf) +
          this._zeile("Fühler FWS", f.fuehler) +
          this._zeile("Durchfluss", f.durchfluss) +
          this._zeile("Pumpe", f.pumpe, { wert: this._an(f.pumpe) ? "Ein" : "Aus" }) +
          this._zeile("Zapfmenge heute", f.heute, { st: 0 }) +
          this._zeile("Zapfmenge gesamt", f.gesamt, { st: 0 }),
      };
    }
    if (id === "hk1" || id === "hk2" || id === "verteiler") {
      if (id === "verteiler") {
        return {
          titel: "Heizgruppen-Verteiler",
          unter: "Vorlauf aus dem Puffer, Rücklauf zurück",
          knoepfe: "",
          inhalt: (a.heizkreise || []).map((h, i) => `<div class="zeile"><span class="l" data-teil="hk${i + 1}">${esc(h.titel)}</span><span class="w">${this._fmt(h.vorlauf)} <small>(Soll ${this._fmt(h.vorlauf_soll)})</small></span></div>`).join(""),
        };
      }
      const i = id === "hk1" ? 0 : 1;
      const h = a.heizkreise?.[i] || {};
      const nr = h.nummer ?? i + 1;
      return {
        titel: `Heizkreis ${nr} · ${esc(h.titel || "")}`,
        unter: `Pumpe P${nr}, Mischer M${nr}, Vorlauffühler VF${nr}`,
        knoepfe:
          knopf("b-trend", "mdi:chart-line", "Trends", `data-trend="heating_circuit|${nr}"`) +
          (a.heizkurve ? knopf("b-kurve", "mdi:chart-bell-curve-cumulative", "Heizkurve", "data-heizkurve") : "") +
          knopf("b-param", "mdi:wrench", "Parameter", `data-param="${esc(this._geraet(h.betriebsart || h.zustand))}"`) +
          (h.wochenuhr ? knopf("b-zp", "mdi:clock-outline", "Zeitprogramm", `data-zp="${esc(h.wochenuhr)}"`) : ""),
        inhalt:
          `<div class="abschnitt">Betrieb</div>` +
          this._zeile("Zustand", h.zustand) +
          this._auswahlFeld("Betriebsart", h.betriebsart) +
          this._zeile("Pumpe", h.pumpe, { wert: this._an(h.pumpe) ? "Ein" : "Aus" }) +
          this._zeile("Wochenuhr", h.wochenuhr) +
          `<div class="abschnitt">Temperaturen</div>` +
          this._zeile("Vorlauf", h.vorlauf, { soll: h.vorlauf_soll }) +
          this._zeile("Raum", h.raum, { soll: h.raum_soll }) +
          this._zeile("Aussen", h.aussen, { soll: null }) +
          this._zeile("Aussen gemittelt", h.aussen_gemittelt) +
          `<div class="abschnitt">Einstellungen</div>` +
          this._schrittFeld("Raumkorrektur", h.korrektur) +
          this._schrittFeld("Steilheit", h.steilheit) +
          this._auswahlFeld("Witterungsführung", h.witterung) +
          (a.heizkurve?.heizkreise?.[i]?.tagestemperatur ? this._schrittFeld("Tages-Raumtemperatur", a.heizkurve.heizkreise[i].tagestemperatur) : "") +
          (a.heizkurve?.heizkreise?.[i]?.absenktemperatur ? this._schrittFeld("Absenk-Raumtemperatur", a.heizkurve.heizkreise[i].absenktemperatur) : ""),
      };
    }
    if (id === "austragung") {
      return {
        titel: tx("austragung", "titel", "Raumaustragung"),
        unter: tx("austragung", "unter", ""),
        knoepfe: knopf("b-trend", "mdi:chart-line", "Trends", 'data-trend="heater|"'),
        inhalt:
          this._zeile("Lagerstand", c.lagerstand, { st: 0, wert: this._z(c.lagerstand) === null ? "unbekannt" : undefined }) +
          this._zeile("Kessel", a.kessel?.zustand) +
          this._zeile("Leistung", a.kessel?.leistung, { st: 0 }) +
          (info("austragung") || `<div class="info">Das Rührwerk dreht in der Ansicht, solange der Kessel Leistung abgibt.</div>`),
      };
    }
    if (id === "ae") {
      return {
        titel: tx("ae", "titel", "Ausdehnungsgefäss"),
        unter: tx("ae", "unter", ""),
        knoepfe: knopf("b-trend", "mdi:chart-line", "Trends", 'data-trend="heater|"'),
        inhalt: this._zeile("Systemdruck", c.systemdruck, { st: 2 }) + info("ae"),
      };
    }
    if (id === "aussen") {
      const w = a.wetter || {};
      return {
        titel: "Aussenfühler und Wetter",
        unter: "AF · Witterungsführung ECO/ECO+",
        knoepfe: "",
        inhalt:
          this._zeile("Aussen aktuell", a.heizkurve?.aussen_aktuell) +
          this._zeile("Aussen gemittelt", a.heizkurve?.aussen) +
          this._zeile("Prognose", a.heizkurve?.prognose) +
          this._zeile("Wetter", w.zustand) +
          this._zeile("Wind", w.wind) +
          this._zeile("Luftfeuchte", w.feuchte, { st: 0 }),
      };
    }
    return { titel: id, unter: "", knoepfe: "", inhalt: "" };
  }

  _panelZeichnen(neu) {
    const panel = this.shadowRoot.getElementById("panel");
    if (!this._auswahl) {
      panel.classList.add("zu");
      return;
    }
    const aktiv = this.shadowRoot.activeElement;
    if (!neu && aktiv && panel.contains(aktiv) && aktiv.tagName === "SELECT") return;
    const p = this._panelInhalt(this._auswahl);
    const scroll = panel.querySelector(".pinhalt")?.scrollTop || 0;
    panel.innerHTML = `<div class="pkopf"><div><h3>${p.titel}</h3><small>${p.unter}</small></div><button data-schliessen="panel" title="Schliessen">×</button></div>
      ${p.knoepfe ? `<div class="pknoepfe">${p.knoepfe}</div>` : ""}
      <div class="pinhalt">${p.inhalt}</div>`;
    panel.classList.remove("zu");
    if (!neu) panel.querySelector(".pinhalt").scrollTop = scroll;
  }

  /* ---------------- Bestehende Karten einbetten ---------------- */

  _ueberOeffnen(titel, element) {
    const u = this.shadowRoot.getElementById("ueber");
    this.shadowRoot.getElementById("utitel").textContent = titel;
    const inhalt = this.shadowRoot.getElementById("uinhalt");
    inhalt.innerHTML = "";
    inhalt.appendChild(element);
    u.classList.remove("zu");
  }

  _anlageKarte() {
    if (!customElements.get("hargassner-anlage-card")) return null;
    const el = document.createElement("hargassner-anlage-card");
    el.setAttribute("eingebettet", "");
    el.setConfig({ ...this._a, type: "custom:hargassner-anlage-card" });
    el.hass = this._hass;
    this._eingebettet = el;
    return el;
  }

  _oeffneAnlage(titel, opts) {
    const el = this._anlageKarte();
    if (!el) {
      alert("Die Anlagen-Karte ist nicht geladen.");
      return;
    }
    this._ueberOeffnen(titel, el);
    requestAnimationFrame(() => el.oeffne(opts));
  }

  _oeffneHeizkurve() {
    if (!customElements.get("hargassner-heizkurve-card") || !this._a.heizkurve) return;
    const el = document.createElement("hargassner-heizkurve-card");
    el.setConfig(this._a.heizkurve);
    el.hass = this._hass;
    this._kurve = el;
    const rahmen = document.createElement("div");
    rahmen.style.cssText = "padding:16px;max-width:1100px;margin:0 auto;--primary-text-color:#333;--secondary-text-color:#777;--divider-color:#d8d8d8;--card-background-color:#fff;--ha-card-background:#fff;--secondary-background-color:#f1f1f1";
    rahmen.appendChild(el);
    this._ueberOeffnen("Heizkurve", rahmen);
  }

  /* ---------------- Ereignisse ---------------- */

  _mehrInfo(id) {
    if (!id) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: id }, bubbles: true, composed: true }));
  }

  _klick(e) {
    const el = e.target.closest("[data-ansicht],[data-option],[data-teil],[data-schliessen],[data-trend],[data-param],[data-zp],[data-heizkurve],[data-mehr],[data-schritt],[data-druecken]");
    if (!el) return;
    const d = el.dataset;
    if (d.ansicht) this._ansicht(d.ansicht);
    else if (d.option) {
      this._optionen[d.option] = !this._optionen[d.option];
      this._optionenZeigen();
    } else if (d.teil) this._waehlen(d.teil);
    else if (d.schliessen === "panel") {
      this._auswahl = null;
      this._hervorheben(null);
      this._panelZeichnen();
    } else if (d.schliessen === "ueber") {
      this.shadowRoot.getElementById("ueber").classList.add("zu");
      this.shadowRoot.getElementById("uinhalt").innerHTML = "";
      this._eingebettet = null;
      this._kurve = null;
    } else if (d.trend !== undefined) this._oeffneAnlage("Trends", { trend: d.trend });
    else if (d.param !== undefined) this._oeffneAnlage("Parameter", { geraet: d.param });
    else if (d.zp) this._oeffneAnlage("Zeitprogramm", { reiter: "dashboard", zeitprogramm: d.zp });
    else if (d.heizkurve !== undefined) this._oeffneHeizkurve();
    else if (d.mehr) this._mehrInfo(d.mehr);
    else if (d.schritt) this._schritt(d.entity, parseFloat(d.schritt));
    else if (d.druecken) {
      if (confirm(`«${this._name(d.druecken)}» jetzt auslösen?`)) this._hass.callService("button", "press", { entity_id: d.druecken });
    }
  }

  _aenderung(e) {
    const el = e.target;
    if (el.dataset.auswahl) this._hass.callService("select", "select_option", { entity_id: el.dataset.auswahl, option: el.value });
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
        this._panelZeichnen(false);
      });
    }, 1200);
    this._ausstehend[id] = { wert: neu, timer };
    this._panelZeichnen(false);
  }

  _optionenZeigen() {
    this.shadowRoot.querySelectorAll("[data-option]").forEach((b) => b.classList.toggle("an", !!this._optionen[b.dataset.option]));
    if (!this._bereit) return;
    for (const w of this._waende) w.visible = this._optionen.waende;
    for (const d of this._dach) d.visible = this._optionen.dach;
  }

  static getStubConfig() {
    return { anlage: { titel: "Anlage" } };
  }
}

function karte3DAnmelden() {
  if (customElements.get(KARTE_3D)) return true;
  try {
    customElements.define(KARTE_3D, class extends HargassnerAnlage3DCard {});
  } catch (e) {
    return false;
  }
  return true;
}
karte3DAnmelden();
window.customCards = window.customCards || [];
if (!window.customCards.some((k) => k.type === KARTE_3D)) {
  window.customCards.push({ type: KARTE_3D, name: "Hargassner Anlage 3D", description: "Heizraum und Lager als 3D-Modell mit Live-Zuständen, Bedienung, Trends und Parametern" });
}
let versuche3d = 0;
const pruefer3d = setInterval(() => {
  karte3DAnmelden();
  if (++versuche3d >= 60) clearInterval(pruefer3d);
}, 500);
