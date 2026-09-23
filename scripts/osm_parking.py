#!/usr/bin/env python3
"""
Hent gateparkering fra OpenStreetMap (Overpass) for Bergen sentrum -> data/osm_parking.geojson

Plukker ut ways med parking:*-tagging (gatelangs) og amenity=parking-objekter, og klassifiserer:
  beboer  – permit/residents/private permit-holdere
  ekspress – maxstay <= 1 time
  avgift  – fee/ticket
  forbud  – no_parking/no_stopping
  annet
Kun standardbibliotek. Kjør i GitHub Actions eller utenfor TLS-inspeksjon.
"""
import json, re, sys, urllib.parse, urllib.request
from pathlib import Path

# bbox: sør,vest,nord,øst – Bergen sentrum inkl. sone 1–3 med margin
BBOX = "60.380,5.300,60.405,5.345"
OVERPASS = "https://overpass-api.de/api/interpreter"
UT = Path(__file__).resolve().parent.parent / "data" / "osm_parking.geojson"

QUERY = f"""
[out:json][timeout:90];
(
  way["highway"]["parking:both"]({BBOX});
  way["highway"]["parking:left"]({BBOX});
  way["highway"]["parking:right"]({BBOX});
  way["highway"]["parking:lane:both"]({BBOX});
  way["highway"]["parking:lane:left"]({BBOX});
  way["highway"]["parking:lane:right"]({BBOX});
  way["highway"]["parking:condition:both"]({BBOX});
  way["highway"]["parking:condition:left"]({BBOX});
  way["highway"]["parking:condition:right"]({BBOX});
  nwr["amenity"="parking"]["parking"="street_side"]({BBOX});
  nwr["amenity"="parking"]["parking"="lane"]({BBOX});
  nwr["amenity"="parking"]["access"~"permit|residents|private"]({BBOX});
);
out geom tags;
"""

def klassifiser(t):
    s = " ".join(f"{k}={v}" for k, v in t.items()).lower()
    if re.search(r"(access|parking:[a-z:]*)=(permit|residents|private)", s) or "residents" in s or "permit" in s:
        return "beboer"
    if re.search(r"no_parking|no_stopping|no_standing", s):
        return "forbud"
    if re.search(r"maxstay[a-z:]*=(1 ?h|1 ?hour|60 ?min|30 ?min|pt1h)", s):
        return "ekspress"
    if re.search(r"(fee|ticket|paid)", s):
        return "avgift"
    return "annet"

def sider(t):
    return {k: v for k, v in t.items() if k.startswith("parking")}

def main():
    data = urllib.parse.urlencode({"data": QUERY}).encode()
    req = urllib.request.Request(OVERPASS, data=data, headers={"User-Agent": "bergen-boligsone-kart/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        res = json.load(r)
    feats = []
    for el in res.get("elements", []):
        t = el.get("tags", {})
        props = {"osm_type": el["type"], "osm_id": el["id"], "name": t.get("name"), "kategori": klassifiser(t),
                 "capacity": t.get("capacity"), "access": t.get("access"), "fee": t.get("fee"), "maxstay": t.get("maxstay"),
                 "parking": sider(t) or None, "alle_tags": t}
        if el["type"] == "node":
            geom = {"type": "Point", "coordinates": [el["lon"], el["lat"]]}
        elif "geometry" in el:
            coords = [[p["lon"], p["lat"]] for p in el["geometry"]]
            closed = t.get("amenity") == "parking" and coords[0] == coords[-1] and len(coords) > 3
            geom = {"type": "Polygon", "coordinates": [coords]} if closed else {"type": "LineString", "coordinates": coords}
        else:
            continue
        feats.append({"type": "Feature", "properties": props, "geometry": geom})
    UT.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False), encoding="utf-8")
    from collections import Counter
    print(f"{len(feats)} objekter ->", UT, Counter(f["properties"]["kategori"] for f in feats), file=sys.stderr)

if __name__ == "__main__":
    main()
