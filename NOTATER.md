# Kartleggingsnotater – boligsone 1–3

Sist oppdatert: 2026-09-23

## Hovedkonklusjoner

1. **Kommunens boligsonekart ≠ kart over parkeringsplasser.** Polygonene viser hvilke adresser som kan søke sonekort. Kommunen sier selv at kartet ikke nødvendigvis viser gater som er skiltet som boligsone.
2. **Sone 1 er spesiell.** Ikke regulert som ordinær boligsone. Kun enkelte strekninger har reserverte plasser for sonekort 1. Gjelder hele døgnet, alle dager. Sonekort gjelder ikke på automatplasser.
3. **Sone 2 og 3:** ikke anta at all gateparkering i polygonet er boligsone. Inneholder også ekspress, automat, HC, laste/losse, taxi, sykkel, forbud, privat.
4. **Ekspressparkering er ikke soneparkering.** Eget lag, egen farge.

Kilde: https://www.bergen.kommune.no/innbyggerhjelpen/vann-vei-og-trafikk/vei-transport-og-parkering/parkering/boligsoneparkering

## Offisielle kilder

| Kilde | URL | Bruk |
|---|---|---|
| Boligsonekart (webapp) | https://kart.bergen.kommune.no/portal/apps/webappviewer/index.html?id=504ddef40b8e425cb0e7fe4903d76140 | Referanse |
| Boligsoner REST | …/Bymiljoetaten/Boligsoner/MapServer/1 | Sonepolygoner (`sone IN ('1','2','3')`) |
| Parkeringskart 2023 REST | …/Bymiljoetaten/Parkeringskart_bergenskart2023/MapServer | Avgift, automat, ekspress, antall plasser. Felt: `publikum_Gate`, `publikum_PBetingelser`, `pubklikum_AntallPlasser`, `publikum_tilleggsinfo`, `Type` |
| Parkeringsforbud_boligsone | …/MapServer/0 | Ekskludering |
| Boligsoneautomater | …/MapServer/0 | Støtte (sone 8–30) |

Base: `https://kart.bergen.kommune.no/arcgis/rest/services/Bymiljoetaten`

## Kjente feil / ikke bygg videre på

- `Type = '376 Boligsone'` tolket som komplett boligsonelag → **feil**. Spørringen ga ingen relevante punkter i sone 1–3.
- Tidligere kart hadde kun få manuelle punkter → ikke bruk som full oversikt.

## Verifiserte / diskuterte steder

- **Markeveien** ved Torgallmenningen / Chr. Michelsens gate / utgang KlosterGarasjen: Sone 1-beboerparkering. Skiltplan Bymiljøetaten 2025: «Gjelder beboere med P-kort til sone 1». TODO: start/slutt, side, antall oppmerkede plasser.
- **Vestre Murallmenningen**: sone 1/5-problematikk, beboerparkering bak allmenningen. Ikke anta én sone for hele gaten. TODO: skiltplan/vedtak per delstrekning.
- **C. Sundts gate**: ParkMe indikerer Residential Permit Only på deler. TODO: strekning, sone, antall.
- Bør undersøkes: Strandgaten, Fortunen, Øvre Korskirkeallmenningen.

## Andre datakilder

- **ParkMe / INRIX** – segmentnivå, «Residential Permit Only» på flere sentrumsgater. Eks: https://api.parkme.com/meter/25000422. Sjekk aktualitet, sonenummer, dekning, om plasser kan telles.
- **P i Bergen-appen** – mest lovende spor. Inspiser nettverkstrafikk: parkeringssegmenter, sonenummer, betalingsvilkår, tillatelsestype, antall plasser. Se etter GeoJSON / ArcGIS FeatureServer-kall.
- NVDB, kommunale skilt-/trafikkvedtak, Vegvesenets trafikkreguleringsdata, kommunale skiltplaner.

## Det som mangler

Ett datasett med: gate, fra, til, side, sonenummer, parkeringstype, antall_plasser, vilkår, gyldighet, polyline. Dette er datamodellen i `data/beboerparkering_manuell.geojson`.

## Neste steg

1. `python3 scripts/snapshot.py --inspect` → bekreft lag-ID og `Type`-verdier i Parkeringskart_bergenskart2023, oppdater `config.js`.
2. Fang P i Bergen-trafikk (mitmproxy / Burp) → dokumentér endepunkter her.
3. Skiltplan Markeveien → tegn eksakt LineString, sett `status: verifisert`, `geometri_noyaktighet: skiltplan`.
4. Gå gjennom ParkMe-segmenter for sentrumsgater, legg inn som `status: indikert`.
