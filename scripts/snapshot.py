#!/usr/bin/env python3
"""
Last ned ArcGIS REST-lag fra Bergen kommune til data/*.geojson.

Hvorfor: GitHub Pages kan ikke proxy'e, og kommunens server kan avvise CORS eller
kutte ved maxRecordCount (typisk 1000–2000). Skriptet paginerer og lagrer komplett GeoJSON,
så kartet fungerer uten live-kall.

Bruk:
    python3 scripts/snapshot.py            # alle lag i LAG
    python3 scripts/snapshot.py --inspect  # list lag/felt i tjenestene (finn riktig lag-ID)

Kun standardbibliotek.
"""
import json, sys, urllib.parse, urllib.request
from pathlib import Path

BASE = "https://kart.bergen.kommune.no/arcgis/rest/services/Bymiljoetaten"
ROT = Path(__file__).resolve().parent.parent / "data"

# Hold i synk med config.js
LAG = {
    "sonegrenser":      ("Boligsoner/MapServer/1", "sone IN ('1','2','3')"),
    "parkeringskart":   ("Parkeringskart_bergenskart2023/MapServer/0", "1=1"),
    "parkeringsforbud": ("Parkeringsforbud_boligsone/MapServer/0", "1=1"),
    "automater":        ("Boligsoneautomater/MapServer/0", "1=1"),
}

TJENESTER = ["Boligsoner", "Parkeringskart_bergenskart2023", "Parkeringsforbud_boligsone", "Boligsoneautomater"]


def get_json(url, params=None):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "bergen-boligsone-kart/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def hent_lag(service, where):
    url = f"{BASE}/{service}/query"
    features, offset = [], 0
    while True:
        gj = get_json(url, {
            "where": where, "outFields": "*", "returnGeometry": "true", "outSR": "4326",
            "f": "geojson", "resultOffset": offset, "resultRecordCount": 1000,
        })
        if "error" in gj:
            raise RuntimeError(gj["error"])
        batch = gj.get("features", [])
        features.extend(batch)
        print(f"  {service}: {len(features)} objekter", file=sys.stderr)
        if not gj.get("exceededTransferLimit") and len(batch) < 1000:
            break
        offset += len(batch)
    return {"type": "FeatureCollection", "features": features}


def inspect():
    for t in TJENESTER:
        meta = get_json(f"{BASE}/{t}/MapServer", {"f": "json"})
        print(f"\n== {t} ==")
        for l in meta.get("layers", []):
            print(f"  [{l['id']}] {l['name']} ({l.get('geometryType', '?')})")
            try:
                lm = get_json(f"{BASE}/{t}/MapServer/{l['id']}", {"f": "json"})
                print("      felt:", ", ".join(f["name"] for f in lm.get("fields", [])))
                print("      maxRecordCount:", lm.get("maxRecordCount"))
                # Unike Type-verdier, nyttig for klassifisering
                if any(f["name"] == "Type" for f in lm.get("fields", [])):
                    st = get_json(f"{BASE}/{t}/MapServer/{l['id']}/query", {
                        "where": "1=1", "outFields": "Type", "returnDistinctValues": "true",
                        "returnGeometry": "false", "f": "json"})
                    print("      Type-verdier:", sorted({f["attributes"]["Type"] for f in st.get("features", []) if f["attributes"].get("Type")}))
            except Exception as e:
                print("      (kunne ikke lese lag:", e, ")")


def main():
    if "--inspect" in sys.argv:
        inspect(); return
    ROT.mkdir(exist_ok=True)
    for navn, (service, where) in LAG.items():
        print(f"Henter {navn} …", file=sys.stderr)
        try:
            gj = hent_lag(service, where)
        except Exception as e:
            print(f"  FEIL {navn}: {e}", file=sys.stderr); continue
        (ROT / f"{navn}.geojson").write_text(json.dumps(gj, ensure_ascii=False), encoding="utf-8")
        print(f"  -> data/{navn}.geojson ({len(gj['features'])} obj)", file=sys.stderr)


if __name__ == "__main__":
    main()
