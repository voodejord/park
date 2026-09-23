# Bergen boligsoneparkering – sone 1–3

Interaktivt kart over boligsoneparkering i Bergen sentrum (sone 1, 2, 3), med sonegrenser, kommunens parkeringskart, parkeringsforbud, boligsoneautomater og et manuelt kuratert lag med skiltede beboerstrekninger. Ekspress- og avgiftsparkering vises som egne kategorier, aldri blandet med beboerparkering.

Ren statisk side (Leaflet + fetch) – ingen byggesteg, kjører rett på GitHub Pages.

## Kom i gang

```bash
git clone <ditt-repo>
cd bergen-boligsone-kart
python3 scripts/snapshot.py --inspect   # finn riktige lag-ID-er og felt hos kommunen
python3 scripts/snapshot.py             # last ned lag til data/*.geojson
python3 -m http.server 8080             # åpne http://localhost:8080
```

Uten snapshots prøver kartet live ArcGIS-spørringer mot `kart.bergen.kommune.no`. Det kan feile på CORS eller kuttes ved `maxRecordCount`; snapshots er anbefalt for hosting.

## GitHub Pages

1. Push til `main`.
2. Settings → Pages → Source: *GitHub Actions* (workflow i `.github/workflows/pages.yml` publiserer rot-mappen), eller *Deploy from branch* → `main` / `/ (root)`.
3. Filen `.nojekyll` gjør at ingenting prosesseres.

## Struktur

| Fil | Innhold |
|---|---|
| `index.html`, `app.js`, `style.css` | Kartet |
| `config.js` | Datakilder, lag-ID-er, feltnavn, klassifiseringsregler, farger |
| `data/beboerparkering_manuell.geojson` | Håndkuratert lag – én feature per skiltet strekning |
| `data/*.geojson` (øvrige) | Snapshots fra kommunens ArcGIS, generert av `scripts/snapshot.py` |
| `NOTATER.md` | Kartleggingsnotater, kilder, kjente feil |

## Manuelt lag – datamodell

```json
{
  "gate": "Markeveien",
  "strekning": "Ved Torgallmenningen / utgang KlosterGarasjen",
  "side": "nord | sør | øst | vest | ukjent",
  "sone": "1",
  "type": "boligsone",
  "antall_plasser": 6,
  "vilkar": "Beboere med P-kort sone 1. Hele døgnet.",
  "status": "verifisert | indikert | usikker",
  "kilde": "Bymiljøetaten skiltplan 2025",
  "geometri_noyaktighet": "skiltplan | omtrentlig",
  "sist_sjekket": "2026-09-23"
}
```

Geometri som `LineString` (`[lon, lat]`) langs fortauskanten på riktig side. `verifisert` tegnes heltrukket, resten stiplet.

## Kjente forbehold

- Sonepolygonene er **søknadsområde**, ikke parkeringsstrekninger. Sone 1 er ikke ordinær boligsone; bare enkelte skiltede strekninger gjelder.
- `Type = '376 Boligsone'` i kommunens parkeringskart er **ikke** et komplett boligsonelag.
- Lag-ID `Parkeringskart_bergenskart2023/MapServer/0` er en antakelse – verifiser med `--inspect` og oppdater `config.js` + `scripts/snapshot.py`.
- Klassifiseringsregler (`config.js → klassifisering`) er regex mot `Type`/`PBetingelser`. Juster etter faktiske verdier fra `--inspect`.

## Lisens

Kode: MIT. Kommunens data følger Bergen kommunes vilkår; ParkMe/INRIX-data er ikke inkludert.
