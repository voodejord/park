#!/usr/bin/env python3
"""
Hent parkeringsskilt fra NVDB (Statens vegvesen) for Bergen -> data/nvdb_skilt.geojson

Objekttype 96 = Skiltplate (skiltnummer + tekst + geometri). Filtreres til skilt som
gjelder parkering/boligsone: hovedskilt 552 (parkering), 372/376 (forbud) og underskilt
806/807/808 med tekst som nevner sone/beboer/P-kort.

API: https://nvdbapiles-v3.atlas.vegvesen.no  (åpent, ingen nøkkel)
Kun standardbibliotek.
"""
import json, re, sys, urllib.parse, urllib.request
from pathlib import Path

API = "https://nvdbapiles-v3.atlas.vegvesen.no"
UT = Path(__file__).resolve().parent.parent / "data" / "nvdb_skilt.geojson"
# Bergen sentrum, WGS84: minlon,minlat,maxlon,maxlat
BBOX = "5.295,60.378,5.350,60.408"
HEAD = {"Accept": "application/vnd.vegvesen.nvdb-v3-rev1+json", "X-Client": "bergen-boligsone-kart",
        "User-Agent": "bergen-boligsone-kart/1.0"}

RE_TREFF = re.compile(r"sone\s*\d|boligsone|beboer|p-?kort|sonekort", re.I)
SKILT_RELEVANT = re.compile(r"\b(552|372|376|806|807|808)\b")


def get(url):
    req = urllib.request.Request(url, headers=HEAD)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def hent(objekttype):
    url = f"{API}/vegobjekter/{objekttype}?" + urllib.parse.urlencode({
        "kommune": 4601, "kartutsnitt": BBOX, "srid": 4326, "antall": 1000,
        "inkluder": "egenskaper,geometri,lokasjon,relasjoner"})
    alle = []
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
        if not geom:
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
