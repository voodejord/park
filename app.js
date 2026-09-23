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
    const layer = L.geoJSON(gj, {
      style: f => ({ color: soneFarge(f.properties.sone), weight: 1.5, fillOpacity: 0.07, dashArray: "6 4" }),
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
          ["Betingelser", p[felt.betingelser]], ["Antall plasser", p[felt.antall]], ["Info", p[felt.info]],
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

  // 5) Manuelt verifisert beboerparkering
  async function lastManuell() {
    const gj = await hentLag("manuell");
    const layer = L.geoJSON(gj || { type: "FeatureCollection", features: [] }, {
      style: f => {
        const p = f.properties;
        return {
          color: soneFarge(p.sone), weight: 7, opacity: p.status === "verifisert" ? 0.95 : 0.55,
          dashArray: p.status === "verifisert" ? null : "8 6"
        };
      },
      onEachFeature: (f, l) => {
        const p = f.properties;
        l.bindPopup(popupTabell(`${p.gate} – sone ${p.sone}`, [
          ["Strekning", p.strekning], ["Side", p.side], ["Antall plasser", p.antall_plasser ?? "ikke registrert"],
          ["Vilkår", p.vilkar], ["Kilde", p.kilde], ["Geometri", p.geometri_noyaktighet], ["Sist sjekket", p.sist_sjekket]
        ], `<span class="status-chip ${esc(p.status)}">${esc(p.status)}</span>`));
      }
    });
    leggTilLagValg("manuell", layer);
  }

  // ---------- Tegnforklaring ----------
  const legend = document.getElementById("legend");
  [
    ["fill", F.sone1, "Sone 1 – søknadsområde"], ["fill", F.sone2, "Sone 2 – søknadsområde"], ["fill", F.sone3, "Sone 3 – søknadsområde"],
    ["", F.boligsone, "Beboerparkering, verifisert (heltrukket) / usikker (stiplet)"],
    ["dot", F.ekspress, "Ekspress / korttid"], ["dot", F.avgift, "Vanlig avgiftsparkering"],
    ["dot", F.hc, "HC"], ["dot", F.lade, "Lading"], ["dot", F.annet, "Annet"],
    ["hatch", "", "Parkeringsforbud"], ["dot", F.automat, "Boligsoneautomat"]
  ].forEach(([kl, farge, tekst]) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="sw ${kl}" style="${farge ? "background:" + farge : ""}"></span><span>${tekst}</span>`;
    legend.appendChild(li);
  });

  // ---------- Start ----------
  Promise.all([lastSonegrenser(), lastManuell(), lastParkeringskart(),
    lastPunktlag("lading", F.lade, "Ladeplass"), lastPunktlag("hc", F.hc, "HC-plass"),
    lastForbud(), lastAutomater()]);
})();
