/* Bergen boligsoneparkering – kartlogikk. Ingen byggesteg; ren Leaflet + fetch. */
(function () {
  const C = window.KART_CONFIG;
  const F = C.farger;

  // ---------- Kart ----------
  const map = L.map("kart", { zoomControl: false }).setView(C.senter, C.zoom);
  L.control.zoom({ position: "topright" }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);

  const kartverket = L.tileLayer("https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png", {
    maxZoom: 20, attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a> · Parkeringsdata: Bergen kommune'
  }).addTo(map);
  const graatone = L.tileLayer("https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png", {
    maxZoom: 20, attribution: '&copy; <a href="https://www.kartverket.no/">Kartverket</a> · Parkeringsdata: Bergen kommune'
  });
  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Parkeringsdata: Bergen kommune'
  });
  L.control.layers({ "Kartverket topo": kartverket, "Kartverket gråtone": graatone, "OpenStreetMap": osm }, null, { position: "topright" }).addTo(map);

  const panel = document.getElementById("panel");
  document.getElementById("togglePanel").onclick = () => panel.classList.toggle("open");

  // ---------- Hjelpere ----------
  const statusEl = document.getElementById("status");
  function setStatus(id, tekst, klasse) {
    let li = document.getElementById("st-" + id);
    if (!li) {
      li = document.createElement("li"); li.id = "st-" + id;
      li.innerHTML = `<span class="k">${C.lag[id].tittel}</span><span class="v"></span>`;
      statusEl.appendChild(li);
    }
    const v = li.querySelector(".v"); v.textContent = tekst; v.className = "v " + (klasse || "");
  }

  function esc(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function popupTabell(tittel, rader, ekstra) {
    const tr = rader.filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");
    return `<div class="popup-tittel">${esc(tittel)}</div>${ekstra || ""}<table>${tr}</table>`;
  }

  async function hentLag(id) {
    const cfg = C.lag[id];
    setStatus(id, "laster…", "venter");
    if (cfg.snapshot && (C.foretrekkSnapshot || !cfg.service)) {
      try {
        const r = await fetch(cfg.snapshot, { cache: "no-cache" });
        if (r.ok) { const gj = await r.json(); setStatus(id, `${gj.features.length} obj (snapshot)`, "ok"); return gj; }
      } catch (e) { /* fall gjennom til live */ }
    }
    if (!cfg.service) { setStatus(id, "mangler snapshot", "feil"); return null; }
    const url = `${C.arcgisBase}/${cfg.service}/query?` + new URLSearchParams({
      where: cfg.where || "1=1", outFields: "*", returnGeometry: "true", outSR: "4326", f: "geojson"
    });
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const gj = await r.json();
      if (gj.error) throw new Error(gj.error.message || "ArcGIS-feil");
      setStatus(id, `${gj.features.length} obj (live)`, "ok");
      if (gj.exceededTransferLimit) setStatus(id, `${gj.features.length}+ obj (avkuttet – bruk snapshot.py)`, "feil");
      return gj;
    } catch (e) {
      setStatus(id, "feil: " + e.message, "feil");
      console.error(id, url, e);
      return null;
    }
  }

  // Klassifiser et parkeringsobjekt til kategori ut fra Type + betingelser
  function klassifiser(p, felt) {
    const tekst = [p[felt.type], p[felt.betingelser], p[felt.info]].filter(Boolean).join(" | ");
    for (const k of C.klassifisering) if (k.re.test(tekst)) return k.kat;
    return "annet";
  }

  // Sonepolygoner lagres for oppslag: hvilken sone ligger et punkt i?
  let sonePolys = [];
  function iPolygon(pt, ring) { // pt [lon,lat], ring [[lon,lat],...]
    let inne = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inne = !inne;
    }
    return inne;
  }
  function soneFor(geom) {
    let pt;
    if (geom.type === "Point") pt = geom.coordinates;
    else if (geom.type === "LineString") pt = geom.coordinates[Math.floor(geom.coordinates.length / 2)];
    else if (geom.type === "Polygon") pt = geom.coordinates[0][0];
    else return null;
    for (const s of sonePolys) if (iPolygon(pt, s.ring)) return s.sone;
    return "utenfor 1–3";
  }

  function soneFarge(sone) {
    const s = String(sone ?? "").trim();
    return F["sone" + s] || F.boligsone;
  }

  // ---------- Lag ----------
  const lag = {};        // id -> L.Layer
  const lagKontroll = document.getElementById("lagliste");

  function leggTilLagValg(id, layer) {
    const cfg = C.lag[id];
    const li = document.createElement("li");
    li.innerHTML = `<label><input type="checkbox" ${cfg.paa ? "checked" : ""}> ${esc(cfg.tittel)}</label>` +
      (cfg.merknad ? `<span class="merknad">${esc(cfg.merknad)}</span>` : "");
    li.querySelector("input").onchange = e => e.target.checked ? layer.addTo(map) : map.removeLayer(layer);
    lagKontroll.appendChild(li);
    if (cfg.paa) layer.addTo(map);
    lag[id] = layer;
  }

  // 1) Sonegrenser
  async function lastSonegrenser() {
    const gj = await hentLag("sonegrenser");
    if (!gj) return;
    sonePolys = gj.features.flatMap(f => {
      const g = f.geometry, rings = g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map(p => p[0]);
      return rings.map(ring => ({ sone: f.properties.sone, ring }));
    });
    const layer = L.geoJSON(gj, {
      style: f => ({ color: soneFarge(f.properties.sone), weight: 2, fillOpacity: 0.04, dashArray: "6 4" }),
      onEachFeature: (f, l) => {
        const p = f.properties;
        l.bindPopup(popupTabell(`Sone ${p.sone ?? "?"} – ${p.sone_navn ?? "søknadsområde"}`, [
          ["Status", p.Status], ["Sonekort", p.Sonekort], ["Elbil", p.Elbil], ["Besøkende", p["Besøkende"]], ["Pris", p.Pris]
        ],
          `<div class="fotnote">Polygonet viser hvor man kan søke sonekort, ikke hvor det er skiltet parkering.</div>`));
      }
    });
    leggTilLagValg("sonegrenser", layer);
  }

  // 2) Kommunens parkeringskart – punkter/linjer klassifisert
  let parkFeatures = [];
  let parkLayer = null;
  async function lastParkeringskart() {
    const gj = await hentLag("parkeringskart");
    const felt = C.lag.parkeringskart.felt;
    parkLayer = L.layerGroup();
    leggTilLagValg("parkeringskart", parkLayer);
    if (!gj) return;
    parkFeatures = gj.features.map(f => {
      f._kat = klassifiser(f.properties, felt);
      return f;
    });
    tegnParkering();
  }

  function tegnParkering() {
    if (!parkLayer) return;
    parkLayer.clearLayers();
    const felt = C.lag.parkeringskart.felt;
    const aktive = new Set([...document.querySelectorAll(".katfilter:checked")].map(i => i.value));
    const q = document.getElementById("gatesok").value.trim().toLowerCase();
    const filtrert = parkFeatures.filter(f =>
      aktive.has(f._kat) && (!q || String(f.properties[felt.gate] ?? "").toLowerCase().includes(q)));

    L.geoJSON({ type: "FeatureCollection", features: filtrert }, {
      pointToLayer: (f, ll) => L.circleMarker(ll, {
        radius: 5, color: "#fff", weight: 1, fillColor: F[f._kat] || F.annet, fillOpacity: 0.95
      }),
      style: f => ({ color: F[f._kat] || F.annet, weight: 5, opacity: 0.85 }),
      onEachFeature: (f, l) => {
        const p = f.properties;
        l.bindPopup(popupTabell(p[felt.gate] || "Parkering", [
          ["Kategori", f._kat],
          ["Ligger i", "sone " + soneFor(f.geometry)],
          ["Type", p[felt.type]],
          ["Betingelser", p[felt.betingelser]],
          ["Antall plasser", p[felt.antall]],
          ["Info", p[felt.info]],
          ["OBJECTID", p.OBJECTID]
        ]));
      }
    }).addTo(parkLayer);
  }
  document.querySelectorAll(".katfilter").forEach(i => i.onchange = tegnParkering);
  document.getElementById("gatesok").oninput = tegnParkering;

  // 2b) Enkle punktlag (lading, HC)
  async function lastPunktlag(id, farge, tittelFn) {
    const gj = await hentLag(id);
    const felt = C.lag[id].felt || {};
    const layer = L.geoJSON(gj || { type: "FeatureCollection", features: [] }, {
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 5, color: "#fff", weight: 1, fillColor: farge, fillOpacity: 0.95 }),
      onEachFeature: (f, l) => {
        const p = f.properties;
        l.bindPopup(popupTabell(p[felt.gate] || tittelFn, [
          ["Ligger i", "sone " + soneFor(f.geometry)], ["Betingelser", p[felt.betingelser]], ["Antall plasser", p[felt.antall]], ["Info", p[felt.info]],
          ["Bredde/lengde cm", p.bredde_cm ? `${p.bredde_cm} / ${p.lengde_cm}` : null], ["OBJECTID", p.OBJECTID]
        ]));
      }
    });
    leggTilLagValg(id, layer);
  }

  // 3) Parkeringsforbud
  async function lastForbud() {
    const gj = await hentLag("parkeringsforbud");
    const layer = L.geoJSON(gj || { type: "FeatureCollection", features: [] }, {
      style: () => ({ color: F.forbud, weight: 4, opacity: 0.8, dashArray: "2 6" }),
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 5, color: F.forbud, fillColor: F.forbud, fillOpacity: .9 }),
      onEachFeature: (f, l) => l.bindPopup(popupTabell("Parkeringsforbud", Object.entries(f.properties)))
    });
    leggTilLagValg("parkeringsforbud", layer);
  }

  // 4) Automater
  async function lastAutomater() {
    const gj = await hentLag("automater");
    const layer = L.geoJSON(gj || { type: "FeatureCollection", features: [] }, {
      pointToLayer: (f, ll) => L.marker(ll, {
        icon: L.divIcon({ className: "", html: `<div style="width:14px;height:14px;background:${F.automat};border:2px solid #fff;border-radius:2px"></div>`, iconSize: [14, 14] })
      }),
      onEachFeature: (f, l) => l.bindPopup(popupTabell("Boligsoneautomat", Object.entries(f.properties)))
    });
    leggTilLagValg("automater", layer);
  }

  // 4b) OSM gateparkering – klassifiseres her fra rå-tagger
  function osmKategori(t) {
    const s = Object.entries(t).map(([k, v]) => `${k}=${v}`).join(" ").toLowerCase();
    if (/underground|multi-storey|p-hus|anlegg|beboerparkinger/.test(s)) return "anlegg";
    if (/access=(permit|residents)|parking:[a-z:]*=(residents|permit)|soneparkering|sonekort|p-kort|beboere/.test(s)) return "beboer";
    if (/access=private/.test(s)) return "privat";
    if (/no_parking|no_stopping|no_standing/.test(s)) return "forbud";
    if (/maxstay=(1 ?h|1 ?hour|60|30|15|0\.5|pt1h)/.test(s)) return "ekspress";
    if (/fee=yes|fee=mo|ticket|paid/.test(s)) return "avgift";
    return "annet";
  }
  async function lastOsm() {
    const gj = await hentLag("osm");
    const farge = k => ({ beboer: F.boligsone, ekspress: F.ekspress, avgift: F.avgift, forbud: F.forbud, privat: "#c9c3b4", anlegg: F.automat }[k] || F.annet);
    const layer = L.geoJSON(gj || { type: "FeatureCollection", features: [] }, {
      filter: f => { f.properties.kategori = osmKategori(f.properties.alle_tags || {}); return true; },
      style: f => {
        const k = f.properties.kategori;
        if (k === "anlegg") return { color: F.automat, weight: 1.5, opacity: 0.7, fillColor: F.automat, fillOpacity: 0.2 };
        if (k === "privat") return { color: "#a39e91", weight: 1, opacity: 0.5, fillColor: "#c9c3b4", fillOpacity: 0.25 };
        if (k === "beboer") return { color: farge(k), weight: 6, opacity: 0.95, fillOpacity: 0.55 };
        return { color: farge(k), weight: 3, opacity: 0.7, fillOpacity: 0.3 };
      },
      pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 4, color: "#fff", weight: 1, fillColor: farge(f.properties.kategori), fillOpacity: .9 }),
      onEachFeature: (f, l) => {
        const p = f.properties, t = p.alle_tags || {};
        const park = Object.entries(t).filter(([k]) => k.startsWith("parking")).map(([k, v]) => `${k}=${v}`).join(" · ");
        l.bindPopup(popupTabell(p.name || t.name || "OSM " + p.osm_type + " " + p.osm_id, [
          ["Kategori", p.kategori], ["Ligger i", "sone " + soneFor(f.geometry)], ["Parking-tags", park || null],
          ["Access", t.access], ["Fee", t.fee], ["Maxstay", t.maxstay], ["Kapasitet", t.capacity],
          ["OSM", `${p.osm_type}/${p.osm_id}`]
        ]));
      }
    });
    leggTilLagValg("osm", layer);
  }

  // 5) Manuelt verifisert beboerparkering – hvit kant + farget strek
  async function lastManuell() {
    const gj = await hentLag("manuell") || { type: "FeatureCollection", features: [] };
    const kant = L.geoJSON(gj, { style: () => ({ color: "#ffffff", weight: 11, opacity: 0.9 }), interactive: false });
    const strek = L.geoJSON(gj, {
      style: f => {
        const p = f.properties;
        return { color: soneFarge(p.sone), weight: 7, opacity: 1, dashArray: p.status === "verifisert" ? null : "10 8" };
      },
      onEachFeature: (f, l) => {
        const p = f.properties;
        l.bindPopup(popupTabell(`${p.gate} – sone ${p.sone}`, [
          ["Strekning", p.strekning], ["Side", p.side], ["Ligger i", "sone " + soneFor(f.geometry)],
          ["Antall plasser", p.antall_plasser ?? "ikke registrert"],
          ["Vilkår", p.vilkar], ["Kilde", p.kilde], ["Geometri", p.geometri_noyaktighet], ["Sist sjekket", p.sist_sjekket]
        ], `<span class="status-chip ${esc(p.status)}">${esc(p.status)}</span>`));
      }
    });
    leggTilLagValg("manuell", L.layerGroup([kant, strek]));
  }

  // ---------- Tegnemodus: klikk punkter, få GeoJSON ----------
  function tegnemodus() {
    const knapp = document.getElementById("tegnKnapp"), ut = document.getElementById("tegnUt");
    let aktiv = false, pts = [], linje = null, prikker = [];
    function nullstill() { pts = []; if (linje) map.removeLayer(linje); linje = null; prikker.forEach(p => map.removeLayer(p)); prikker = []; }
    function oppdater() {
      if (linje) map.removeLayer(linje);
      if (pts.length > 1) linje = L.polyline(pts, { color: F.boligsone, weight: 6, dashArray: "4 6" }).addTo(map);
    }
    function ferdig() {
      if (pts.length < 2) { nullstill(); return; }
      const f = {
        type: "Feature",
        properties: {
          gate: document.getElementById("tegnGate").value || "", strekning: "", side: document.getElementById("tegnSide").value,
          sone: document.getElementById("tegnSone").value, type: "boligsone",
          antall_plasser: Number(document.getElementById("tegnAntall").value) || null, vilkar: "",
          status: document.getElementById("tegnStatus").value, kilde: "Tegnet i kart", geometri_noyaktighet: "kart",
          sist_sjekket: new Date().toISOString().slice(0, 10)
        },
        geometry: { type: "LineString", coordinates: pts.map(p => [+p.lng.toFixed(6), +p.lat.toFixed(6)]) }
      };
      ut.value = JSON.stringify(f, null, 2) + ",";
      ut.hidden = false; ut.select();
    }
    knapp.onclick = () => {
      aktiv = !aktiv;
      knapp.textContent = aktiv ? "Avslutt (dobbeltklikk = ferdig)" : "Tegn strekning";
      map.getContainer().style.cursor = aktiv ? "crosshair" : "";
      if (aktiv) { nullstill(); ut.hidden = true; map.doubleClickZoom.disable(); } else { ferdig(); map.doubleClickZoom.enable(); }
    };
    map.on("click", e => {
      if (!aktiv) return;
      pts.push(e.latlng);
      prikker.push(L.circleMarker(e.latlng, { radius: 4, color: "#fff", fillColor: F.boligsone, fillOpacity: 1 }).addTo(map));
      oppdater();
    });
    map.on("dblclick", () => { if (aktiv) knapp.click(); });
  }

  // ---------- Tegnforklaring ----------
  const legend = document.getElementById("legend");
  [
    ["fill", F.sone1, "Sone 1 – søknadsområde"], ["fill", F.sone2, "Sone 2 – søknadsområde"], ["fill", F.sone3, "Sone 3 – søknadsområde"],
    ["", F.boligsone, "Beboerparkering, verifisert (heltrukket) / usikker (stiplet)"],
    ["dot", F.ekspress, "Ekspress / korttid"], ["dot", F.avgift, "Vanlig avgiftsparkering"],
    ["dot", F.hc, "HC"], ["dot", F.lade, "Lading"], ["dot", F.annet, "Annet"], ["fill", "#c9c3b4", "Privat (OSM) – ikke boligsone"], ["fill", F.automat, "Beboeranlegg / P-hus (OSM)"],
    ["hatch", "", "Parkeringsforbud"], ["dot", F.automat, "Boligsoneautomat"]
  ].forEach(([kl, farge, tekst]) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="sw ${kl}" style="${farge ? "background:" + farge : ""}"></span><span>${tekst}</span>`;
    legend.appendChild(li);
  });

  // ---------- Start ----------
  lastSonegrenser().then(() => Promise.all([lastManuell(), lastParkeringskart(),
    lastPunktlag("lading", F.lade, "Ladeplass"), lastPunktlag("hc", F.hc, "HC-plass"),
    lastForbud(), lastAutomater(), lastOsm()]));
  tegnemodus();
})();
