// Konfigurasjon for datakilder. Endre lag-ID-er her når de er verifisert.
// Alle ArcGIS REST-lag kan inspiseres i nettleser ved å åpne base-URL + "?f=json".
window.KART_CONFIG = {
  // Startvisning: Bergen sentrum
  senter: [60.3925, 5.3240],
  zoom: 15,

  // Foretrekk lokale snapshots i data/ (lastet ned med scripts/snapshot.py).
  // Faller tilbake til live ArcGIS-spørring hvis fila mangler.
  foretrekkSnapshot: true,

  arcgisBase: "https://kart.bergen.kommune.no/arcgis/rest/services/Bymiljoetaten",

  lag: {
    sonegrenser: {
      tittel: "Sonegrenser (søknadsområde)",
      service: "Boligsoner/MapServer/1",
      where: "sone IN ('1','2','3')",
      snapshot: "data/sonegrenser.geojson",
      paa: true,
      merknad: "Polygonene viser hvem som kan søke om sonekort – IKKE hvor det faktisk er skiltet parkering. Gjelder særlig sone 1."
    },
    parkeringskart: {
      tittel: "Avgiftsparkering – automater/parkometer",
      // Verifisert 2026-09-23: lag 1 = Parkeringsautomater (Type '552 Automat' / '552 Parkometer'), lag 3 = Parkometer (delmengde)
      service: "Parkeringskart_bergenskart2023/MapServer/1",
      where: "1=1",
      snapshot: "data/parkeringskart.geojson",
      paa: true,
      felt: {
        gate: "publikum_Gate",
        betingelser: "publikum_PBetingelser",
        antall: "pubklikum_AntallPlasser",   // ja, skrivefeilen er kommunens
        info: "publikum_tilleggsinfo",
        type: "Type"
      },
      merknad: "Punkt per automat med registrert antall plasser. Ekspress/korttid utledes fra betingelsesteksten."
    },
    lading: {
      tittel: "EL-ladeplasser",
      service: "Parkeringskart_bergenskart2023/MapServer/4",
      where: "1=1",
      snapshot: "data/lading.geojson",
      paa: false,
      felt: { gate: "publikum_Gate", betingelser: "publikum_PBetingelser", antall: "pubklikum_AntallPlasser", info: "publikum_tilleggsinfo" }
    },
    hc: {
      tittel: "HC-parkering",
      service: "Parkeringskart_bergenskart2023/MapServer/2",
      where: "1=1",
      snapshot: "data/hc.geojson",
      paa: false,
      felt: { gate: "adressenavn", info: "informasjon" }
    },
    parkeringsforbud: {
      tittel: "Parkeringsforbud i boligsone",
      service: "Parkeringsforbud_boligsone/MapServer/0",
      where: "1=1",
      snapshot: "data/parkeringsforbud.geojson",
      paa: false
    },
    automater: {
      tittel: "Boligsoneautomater",
      service: "Boligsoneautomater/MapServer/0",
      where: "1=1",
      snapshot: "data/automater.geojson",
      paa: false
    },
    nvdb: {
      tittel: "NVDB – parkeringsskilt (Vegvesenet)",
      snapshot: "data/nvdb_skilt.geojson",
      paa: true,
      merknad: "Skiltplater fra Nasjonal vegdatabank. Lilla = tekst nevner sone/beboer/P-kort. Skiltet står ved starten av strekningen."
    },
    osm: {
      tittel: "OSM – boligsone/beboer",
      snapshot: "data/osm_parking.geojson",
      paa: true,
      merknad: "Frivillig kartlagt. Kun objekter tagget permit/Soneparkering/P-kort (8 stk) og beboeranlegg. Dekning tynn."
    },
    manuell: {
      tittel: "Beboerparkering – manuelt verifisert",
      snapshot: "data/beboerparkering_manuell.geojson",
      paa: true,
      merknad: "Strekninger dokumentert via skiltplan, feltobservasjon eller vedtak. Se status-felt per objekt."
    }
  },

  // Klassifisering av kommunens Type-/betingelsesfelt til kartkategorier.
  // Nøkkel = kategori, verdi = regex som matches mot Type + PBetingelser (case-insensitive).
  klassifisering: [
    { kat: "ekspress",  re: /ekspress|maks\.?\s*1\s*time|korttid/i },
    { kat: "boligsone", re: /boligsone|beboer|sonekort/i },
    { kat: "avgift",    re: /552|avgift|automat|parkometer|betal|kr/i },
  ],

  farger: {
    sone1: "#7b2cbf", sone2: "#0077b6", sone3: "#2a9d8f",
    boligsone: "#7b2cbf", ekspress: "#d62828", avgift: "#6c757d",
    hc: "#f4a261", lade: "#43aa8b", annet: "#adb5bd",
    forbud: "#b00020", automat: "#1d3557"
  }
};
