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
      tittel: "Kommunens parkeringskart 2023",
      // Lag-ID må verifiseres: åpne Parkeringskart_bergenskart2023/MapServer?f=json og sjekk "layers".
      service: "Parkeringskart_bergenskart2023/MapServer/0",
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
      merknad: "Avgiftsplasser, automater, ekspress mv. Type='376 Boligsone' er IKKE et komplett boligsonelag."
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
    { kat: "ekspress",  re: /ekspress|maks\s*1\s*t|1\s*time|korttid/i },
    { kat: "boligsone", re: /boligsone|beboer|sonekort|sone\s*[123]\b/i },
    { kat: "hc",        re: /\bhc\b|forflytningshem/i },
    { kat: "lade",      re: /lad(e|ing)|el-?bil/i },
    { kat: "avgift",    re: /avgift|automat|parkometer|betal/i },
  ],

  farger: {
    sone1: "#7b2cbf", sone2: "#0077b6", sone3: "#2a9d8f",
    boligsone: "#7b2cbf", ekspress: "#d62828", avgift: "#6c757d",
    hc: "#f4a261", lade: "#43aa8b", annet: "#adb5bd",
    forbud: "#b00020", automat: "#1d3557"
  }
};
