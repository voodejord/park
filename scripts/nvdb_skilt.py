#!/usr/bin/env python3
"""
Hent parkeringsskilt fra NVDB (Statens vegvesen) for Bergen -> data/nvdb_skilt.geojson

Objekttype 96 = Skiltplate (skiltnummer + tekst + geometri). Filtreres til skilt som
gjelder parkering/boligsone: hovedskilt 552 (parkering), 372/376 (forbud) og underskilt
806/807/808 med tekst som nevner sone/beboer/P-kort.

API v4: https://nvdbapiles.atlas.vegvesen.no/vegobjekter/api/v4  (åpent, ingen nøkkel)
Kun standardbibliotek.
"""
import json, re, sys, urllib.parse, urllib.request
from pathlib import Path

API = "https://nvdbapiles.atlas.vegvesen.no/vegobjekter/api/v4"
UT = Path(__file__).resolve().parent.parent / "data" / "nvdb_skilt.geojson"
# Bergen sentrum, WGS84: minlon,minlat,maxlon,maxlat
BBOX = "5.295,60.378,5.350,60.408"
HEAD = {"Accept": "application/json", "X-Client": "bergen-boligsone-kart",
        "User-Agent": "bergen-boligsone-kart/1.0"}

RE_TREFF = re.compile(r"sone\s*\d|boligsone|beboer|p-?kort|sonekort", re.I)
SKILT_RELEVANT = re.compile(r"\b(552|372|376|806|807|808)\b")


def get(url):
    req = urllib.request.Request(url, headers=HEAD)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"HTTP {e.code} for {url}\n{body}")


MINLON, MINLAT, MAXLON, MAXLAT = (float(v) for v in BBOX.split(","))


def i_bbox(geom):
    c = geom["coordinates"] if geom["type"] == "Point" else geom["coordinates"][0]
    return MINLON <= c[0] <= MAXLON and MINLAT <= c[1] <= MAXLAT


def hent(objekttype):
    felles = {"kommune": 4601, "srid": 4326, "antall": 1000, "sortering": "false", "inkluderAntall": "false",
              "inkluder": "egenskaper,geometri,lokasjon,relasjoner"}
    # Forsøk 1: kartutsnitt (lon,lat-rekkefølge i 4326). Forsøk 2: hele kommunen, filtrer lokalt.
    forsok = [dict(felles, kartutsnitt=BBOX), dict(felles)]
    for params in forsok:
        url = f"{API}/vegobjekter/{objekttype}?" + urllib.parse.urlencode(params)
        try:
            d = get(url)
        except RuntimeError as e:
            print("  feilet:", str(e).splitlines()[0], file=sys.stderr); continue
        alle = d.get("objekter", [])
        nxt = d.get("metadata", {}).get("neste", {}).get("href")
        print(f"  type {objekttype}: {len(alle)} (kartutsnitt={'kartutsnitt' in params})", file=sys.stderr)
        while nxt and nxt != url and alle and len(alle) < 300000:
            url = nxt
            d = get(url)
            obj = d.get("objekter", [])
            if not obj: break
            alle.extend(obj)
            nxt = d.get("metadata", {}).get("neste", {}).get("href")
            print(f"  type {objekttype}: {len(alle)}", file=sys.stderr)
        return alle
    raise RuntimeError("Begge forsøk mot NVDB feilet")


def _unused():
    while True:
        d = get(url)
        obj = d.get("objekter", [])
        alle.extend(obj)
        print(f"  type {objekttype}: {len(alle)}", file=sys.stderr)
        nxt = d.get("metadata", {}).get("neste", {}).get("href")
        if not obj or not nxt or nxt == url:
            break
        url = nxt
    return alle


def wkt_til_geom(wkt):
    m = re.match(r"\s*(POINT|LINESTRING)\s*Z?\s*\((.*)\)\s*$", wkt or "", re.I | re.S)
    if not m:
        return None
    typ, body = m.group(1).upper(), m.group(2)
    pts = [[float(v) for v in p.split()[:2]] for p in body.split(",")]
    # NVDB gir "lat lon" eller "x y"? srid=4326 gir x=lon? Sjekk størrelsesorden.
    fixed = [[p[1], p[0]] if p[0] > p[1] else p for p in pts]  # lon (~5) < lat (~60)
    return {"type": "Point", "coordinates": fixed[0]} if typ == "POINT" else {"type": "LineString", "coordinates": fixed}


def egenskaper(o):
    e = {}
    for p in o.get("egenskaper", []):
        navn = p.get("navn")
        verdi = p.get("verdi")
        if verdi is None and "enum_id" in p:
            verdi = p.get("verdi")
        e[navn] = verdi
    return e


def main():
    UT.parent.mkdir(exist_ok=True)
    plater = hent(96)
    feats = []
    for o in plater:
        e = egenskaper(o)
        tekst = " | ".join(f"{k}={v}" for k, v in e.items() if v is not None)
        skiltnr = str(e.get("Skiltnummer") or e.get("Skiltnummer hovedskilt") or "")
        relevant = SKILT_RELEVANT.search(skiltnr) or RE_TREFF.search(tekst)
        if not relevant:
            continue
        geom = wkt_til_geom((o.get("geometri") or {}).get("wkt"))
        if not geom or not i_bbox(geom):
            continue
        kat = "boligsone" if RE_TREFF.search(tekst) else ("forbud" if re.search(r"\b37[26]\b", skiltnr) else "parkering")
        feats.append({"type": "Feature", "properties": {
            "nvdb_id": o.get("id"), "skiltnummer": skiltnr, "tekst": e.get("Tekst") or e.get("Skilttekst"),
            "kategori": kat, "egenskaper": e,
            "vegsystem": (o.get("lokasjon", {}).get("vegsystemreferanser") or [{}])[0].get("kortform"),
            "mor": [r.get("vegobjekter", [None])[0] for r in o.get("relasjoner", {}).get("foreldre", [])][:1] or None
        }, "geometry": geom})
    UT.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False), encoding="utf-8")
    from collections import Counter
    print(f"{len(plater)} skiltplater hentet, {len(feats)} relevante ->", UT,
          Counter(f["properties"]["kategori"] for f in feats), file=sys.stderr)
    # dump distinkte skilttekster med sone-treff, til inspeksjon
    (UT.parent / "nvdb_tekster.txt").write_text("\n".join(sorted({
        f"{f['properties']['skiltnummer']}: {f['properties']['tekst']}" for f in feats if f["properties"]["tekst"]})), encoding="utf-8")


if __name__ == "__main__":
    main()
