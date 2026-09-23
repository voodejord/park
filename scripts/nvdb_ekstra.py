#!/usr/bin/env python3
"""
Flere NVDB-lag for Bergen sentrum -> data/nvdb_<navn>.geojson

  43  Parkeringsområde  – registrerte P-områder (antall plasser, eier, type)
  47  Trafikklomme      – lommer langs vegen (bruksområde: parkering/buss/varelevering)
  538 Adresse           – gatenavn per veglenke (brukes til å oversette KVxxxx -> gatenavn)

Skriver også data/nvdb_datakatalog_parkering.txt: alle vegobjekttyper med "parker" i navn/beskrivelse,
så vi ser om det finnes typer vi ikke har vurdert.
Kun standardbibliotek. Kjør i GitHub Actions.
"""
import json, re, sys, urllib.parse, urllib.request
from pathlib import Path

API = "https://nvdbapiles.atlas.vegvesen.no"
DATA = Path(__file__).resolve().parent.parent / "data"
BBOX = "5.295,60.378,5.350,60.408"
HEAD = {"Accept": "application/json", "X-Client": "bergen-boligsone-kart", "User-Agent": "bergen-boligsone-kart/1.0"}
TYPER = {43: "parkeringsomrader", 47: "trafikklommer", 538: "adresser"}


def get(url, params=None):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=HEAD)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} {url}: {e.read().decode('utf-8', 'replace')[:300]}")


def wkt_geom(wkt):
    m = re.match(r"\s*(POINT|LINESTRING|POLYGON|MULTIPOLYGON|MULTILINESTRING)\s*Z?\s*(\(.*\))\s*$", wkt or "", re.I | re.S)
    if not m:
        return None
    typ, body = m.group(1).upper(), m.group(2)

    def ring(s):
        pts = [[float(v) for v in p.split()[:2]] for p in s.split(",")]
        return [[p[1], p[0]] if p[0] > p[1] else p for p in pts]
    if typ == "POINT":
        return {"type": "Point", "coordinates": ring(body.strip("() "))[0]}
    if typ == "LINESTRING":
        return {"type": "LineString", "coordinates": ring(body.strip("() "))}
    rings = [ring(r) for r in re.findall(r"\(([^()]+)\)", body)]
    if typ == "POLYGON":
        return {"type": "Polygon", "coordinates": rings}
    if typ == "MULTILINESTRING":
        return {"type": "MultiLineString", "coordinates": rings}
    return {"type": "MultiPolygon", "coordinates": [[r] for r in rings]}


def hent(typeid):
    url = f"{API}/vegobjekter/api/v4/vegobjekter/{typeid}?" + urllib.parse.urlencode({
        "kommune": 4601, "kartutsnitt": BBOX, "srid": 4326, "antall": 1000, "inkluderAntall": "false",
        "inkluder": "egenskaper,geometri,lokasjon"})
    alle, nxt = [], url
    while nxt:
        d = get(nxt)
        obj = d.get("objekter", [])
        alle.extend(obj)
        nxt = d.get("metadata", {}).get("neste", {}).get("href")
        if not obj or nxt == url:
            break
        url = nxt
    return alle


def main():
    DATA.mkdir(exist_ok=True)
    for typeid, navn in TYPER.items():
        try:
            objs = hent(typeid)
        except Exception as e:
            print(f"FEIL type {typeid}: {e}", file=sys.stderr); continue
        feats = []
        for o in objs:
            e = {p.get("navn"): p.get("verdi") for p in o.get("egenskaper", []) if p.get("verdi") is not None}
            geom = wkt_geom((o.get("geometri") or {}).get("wkt"))
            if not geom:
                continue
            lok = o.get("lokasjon") or {}
            props = {"nvdb_id": o["id"], "type": typeid, **e,
                     "vegsystem": ((lok.get("vegsystemreferanser") or [{}])[0]).get("kortform"),
                     "veglenkesekvenser": sorted({s.get("veglenkesekvensid") for s in lok.get("stedfestinger", []) if s.get("veglenkesekvensid")})}
            feats.append({"type": "Feature", "properties": props, "geometry": geom})
        (DATA / f"nvdb_{navn}.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False), encoding="utf-8")
        print(f"type {typeid} {navn}: {len(feats)} obj", file=sys.stderr)
        if feats:
            print("  felt:", sorted({k for f in feats for k in f["properties"]})[:30], file=sys.stderr)

    # gatenavn-oppslag: veglenkesekvensid -> navn (for strekningsskriptet og kartet)
    try:
        adr = json.loads((DATA / "nvdb_adresser.geojson").read_text(encoding="utf-8"))["features"]
        kart = {}
        for f in adr:
            navn = f["properties"].get("Adressenavn") or f["properties"].get("Gatenavn") or f["properties"].get("Navn")
            for v in f["properties"].get("veglenkesekvenser", []):
                if navn:
                    kart.setdefault(str(v), navn)
        (DATA / "gatenavn.json").write_text(json.dumps(kart, ensure_ascii=False), encoding="utf-8")
        print(f"gatenavn.json: {len(kart)} veglenkesekvenser", file=sys.stderr)
    except Exception as e:
        print("gatenavn feilet:", e, file=sys.stderr)

    # datakatalog: hvilke typer nevner parkering?
    try:
        d = get(f"{API}/datakatalog/api/v1/vegobjekttyper")
        typer = d if isinstance(d, list) else d.get("vegobjekttyper", d.get("objekter", []))
        linjer = [f"{t.get('id')}: {t.get('navn')} – {(t.get('beskrivelse') or '')[:120]}"
                  for t in typer if re.search(r"parker", json.dumps(t, ensure_ascii=False), re.I)]
        (DATA / "nvdb_datakatalog_parkering.txt").write_text("\n".join(sorted(linjer, key=lambda x: int(x.split(':')[0]))), encoding="utf-8")
        print(f"datakatalog: {len(linjer)} typer nevner parkering", file=sys.stderr)
    except Exception as e:
        print("datakatalog feilet:", e, file=sys.stderr)


if __name__ == "__main__":
    main()
