# Bergen boligsoneparkering – sone 1–3

Interaktivt kart over beboerparkering i Bergen sentrum, bygd på **offisielle skiltdata fra Nasjonal vegdatabank (NVDB)** kombinert med Bergen kommunes egne parkeringslag. Målet er å vise *nøyaktig hvor* du kan stå med sonekort for sone 1, 2 og 3 – ikke bare hvor sonegrensene går.

Live: https://voodejord.github.io/park/

Ren statisk side (Leaflet, ingen byggesteg). Data hentes av GitHub Actions hver mandag og committes som GeoJSON i `data/`.

## Hva kartet viser

| Lag | Kilde | Innhold |
|---|---|---|
| Beboerskilt (lilla firkant m/ sonetall) | NVDB type 96 Skiltplate | 808-underskilt med tekst «beboere med p-kort sone N» |
| P-skilt m/ tekstløst underskilt (hul firkant «?») | NVDB | 552 + 808 på samme stolpe der kommunen ikke har registrert teksten – sannsynlig soneparkering, må verifiseres |
| Soneinnkjøringsskilt (blå ramme) | NVDB | 376.1/376.2 Parkeringssone – der sonen faktisk begynner |
| Beboerstrekninger (stiplet lilla) | Utledet | Fra skiltstolpen langs vegen til neste reguleringsskilt, styrt av 828-pilskilt der de finnes |
| Sonegrenser (transparent polygon) | Bergen kommune ArcGIS | Søknadsområde for sonekort – **ikke** parkeringsstrekninger |
| Avgiftsparkering (grå/rød punkt) | Bergen kommune ArcGIS | Automater/parkometer med antall plasser; rød = ekspress (maks 1 time) |
| EL-lading, HC, parkeringsforbud, boligsoneautomater | Bergen kommune ArcGIS | Av som standard |
| Parkeringsområder, trafikklommer | NVDB type 43 / 47 | Av som standard |
| OSM – boligsone/beboer | OpenStreetMap (Overpass) | De få objektene frivillige har tagget |

Alle popups har navigasjonsknapper (Google Maps / Apple Kart / geo:-lenke) og viser hvilken sonepolygon objektet ligger i.

## Viktigste innsikter

- **Sone 1 er ikke en ordinær boligsone.** Bare enkelte strekninger er reservert, og hver av dem er skiltet med 552 + underskilt «Gjelder beboere med P-kort sone 1». Disse finnes i NVDB.
- **Sone 2 og 3 er ordinære soner**: regulert med 376.1 «Parkeringssone – med p-kort eller ved parkometer» ved innkjøringen. Det finnes ingen egne beboerskilt per strekning – all lovlig gateparkering innenfor er soneparkering.
- **Kommunens eget kart viser ikke parkeringsstrekninger**, bare søknadsområde og automater. `Type = '376 Boligsone'` i ArcGIS er ikke et komplett lag.
- **Mange nyregistrerte skiltstolper i NVDB (id 1027…) mangler underskilttekst.** Kartet flagger dem med «?». Dette er en datamangel hos Bymiljøetaten, ikke i kartet.
- **828-pilskilt** («Utstrekning av stans- og parkeringsregulering») gir eksakt retning: 828.1 framover, 828.2 bakover, 828.3 begge veier.

## Struktur

```
index.html, app.js, style.css   kartet
config.js                       lag, kilder, farger, klassifiseringsregler
scripts/snapshot.py             Bergen kommune ArcGIS -> data/*.geojson (--inspect lister lag/felt)
scripts/nvdb_skilt.py           NVDB skiltplater -> data/nvdb_skilt.geojson, nvdb_stolper.json, nvdb_tekster.txt
scripts/nvdb_ekstra.py          NVDB parkeringsområder, trafikklommer, adresser -> gatenavn.json
scripts/nvdb_strekninger.py     utleder strekninger fra skilt -> data/nvdb_strekninger.geojson
scripts/osm_parking.py          Overpass -> data/osm_parking.geojson
data/                           snapshots (regenereres av workflow)
.github/workflows/snapshot.yml  ukentlig datainnhenting + commit
NOTATER.md                      kartleggingsnotater og kilder
```

## Kjøre selv

```bash
python3 -m http.server 8080     # åpne http://localhost:8080
```

Datainnhenting kjøres normalt i GitHub Actions (Actions → «Snapshot ArcGIS-data» → Run workflow).

## Datakilder

- NVDB API Les v4 – https://nvdbapiles.atlas.vegvesen.no (NLOD)
- Bergen kommune / Bymiljøetaten ArcGIS REST – https://kart.bergen.kommune.no/arcgis/rest/services/Bymiljoetaten
- Kartverket WMTS (bakgrunn), OpenStreetMap (bakgrunn + Overpass)
- Boligsoneregler: https://www.bergen.kommune.no/innbyggerhjelpen/vann-vei-og-trafikk/vei-transport-og-parkering/parkering/boligsoneparkering

## Forbehold

Strekningene er *utledet* fra skiltpunkt og vegnett, ikke vedtatt geometri. Skilt med «?» er ikke bekreftet. Bruk kartet som hjelp, ikke som fasit – skiltet på stedet gjelder.

## Lisens

Kode: MIT. Data følger kildenes vilkår (NLOD for NVDB, Bergen kommunes vilkår for ArcGIS-lagene, ODbL for OSM).
