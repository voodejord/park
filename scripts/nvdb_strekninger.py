#!/usr/bin/env python3
#!/usr/bin/env python3
"""
Utled boligsone-strekninger fra NVDB-skilt -> data/nvdb_strekninger.geojson

Forutsetter data/nvdb_skilt.geojson fra nvdb_skilt.py. For hvert beboerskilt (808 «beboere med p-kort sone N»):
  1. hent skiltpunktet (mor, type 95): stedfesting på veglenkesekvens (posisjon, side, retning) + alle plater på stolpen
  2. hent veglenkesekvensens geometri
  3. retning = platens «Ansiktsside, rettet mot» (skiltet gjelder framover i kjøreretningen det vender mot)
  4. strekningen går fra skiltet til neste skiltpunkt på samme veglenkesekvens i den retningen som har
     372/376/552-plate (ny regulering), ellers til enden av veglenkesekvensen, maks MAKS_M meter
  5. linja forskyves 3 m til siden skiltet står på (H/V)
Resultatet er UTLEDET, ikke vedtatt geometri. Marker 'status': 'utledet' i kartet.

API v4: https://nvdbapiles.atlas.vegvesen.no  Kun standardbibliotek.
"""
import json, math, re, sys, urllib.parse, urllib.request
from pathlib import Path

API = "https://nvdbapiles.atlas.vegvesen.no"
DATA = Path(__file__).resolve().parent.parent / "data"
INN = DATA / "nvdb_skilt.geojson"
UT = DATA / "nvdb_strekninger.geojson"
HEAD = {"Accept": "application/json", "X-Client": "bergen-boligsone-kart", "User-Agent": "bergen-boligsone-kart/1.0"}
MAKS_M = 180.0
OFFSET_M = 3.0
RE_BEBOER = re.compile(r"beboer|p-?\s*kort", re.I)
RE_REGULERING = re.compile(r"^(372|376|552)")

_cache = {}


def get(url, params=None):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params, doseq=True)
    if url in _cache:
        return _cache[url]
    req = urllib.request.Request(url, headers=HEAD)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} {url}: {e.read().decode('utf-8', 'replace')[:300]}")
    _cache[url] = d
    return d


# ---------- geometri ----------
def wkt_pts(wkt):
    m = re.search(r"\(([^()]*)\)", wkt or "")
    if not m:
        return []
    pts = [[float(v) for v in p.split()[:2]] for p in m.group(1).split(",")]
    return [[p[1], p[0]] if p[0] > p[1] else p for p in pts]  # -> [lon, lat]


def hav(a, b):
    R = 6371000.0
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dla, dlo = la2 - la1, math.radians(b[0] - a[0])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def veglenkesekvens_geom(vid):
    """Returnerer liste av (startpos, sluttpos, [pts]) for gjeldende HOVED-lenker, sortert."""
    d = get(f"{API}/vegnett/api/v4/veglenkesekvenser/{vid}", {"srid": 4326})
    obj = d.get("objekter", [d]) if isinstance(d, dict) else d
    if isinstance(obj, list) and obj and "veglenker" in obj[0]:
        d = obj[0]
    lenker = []
    for l in d.get("veglenker", []):
        if l.get("sluttdato") or l.get("metadata", {}).get("sluttdato"):
            continue
        if l.get("type", "HOVED") not in ("HOVED", "DETALJERT"):
            continue
        pts = wkt_pts((l.get("geometri") or {}).get("wkt"))
        if len(pts) >= 2:
            lenker.append((l["startposisjon"], l["sluttposisjon"], pts))
    lenker.sort()
    return lenker


def porter_for(vid):
    d = get(f"{API}/vegnett/api/v4/veglenkesekvenser/{vid}", {"srid": 4326})
    obj = d.get("objekter", [d]) if isinstance(d, dict) else d
    if isinstance(obj, list) and obj and "porter" in obj[0]:
        d = obj[0]
    return d.get("porter", [])


def naboer(vid, ende_pos):
    """Veglenkesekvenser koblet til noden i enden (ende_pos 0 eller 1) av vid."""
    ut = []
    for p in porter_for(vid):
        if abs((p.get("relativPosisjon") or 0) - ende_pos) > 1e-6:
            continue
        nid = (p.get("tilkobling") or {}).get("nodeid")
        if not nid:
            continue
        try:
            n = get(f"{API}/vegnett/api/v4/noder/{nid}", {"srid": 4326})
        except RuntimeError:
            continue
        for np_ in n.get("porter", []):
            tk = np_.get("tilkobling") or {}
            nvid, npos = tk.get("veglenkesekvensid"), tk.get("relativPosisjon")
            if nvid and nvid != vid and npos is not None:
                ut.append((nvid, npos))  # posisjon på nabo der den kobler til noden
    return ut


def retning_grader(a, b):
    dx = (b[0] - a[0]) * math.cos(math.radians(a[1])); dy = b[1] - a[1]
    return math.degrees(math.atan2(dx, dy)) % 360


def vinkeldiff(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def punkt_ved(lenker, pos):
    for s, e, pts in lenker:
        if s - 1e-9 <= pos <= e + 1e-9:
            frac = 0 if e == s else (pos - s) / (e - s)
            tot = sum(hav(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
            mål = frac * tot
            acc = 0.0
            for i in range(len(pts) - 1):
                seg = hav(pts[i], pts[i + 1])
                if acc + seg >= mål or i == len(pts) - 2:
                    f = 0 if seg == 0 else (mål - acc) / seg
                    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]
                acc += seg
    return None


def utsnitt(lenker, p0, p1):
    """Polyline langs veglenkesekvensen fra pos p0 til p1 (p0<p1)."""
    ut = [punkt_ved(lenker, p0)]
    for s, e, pts in lenker:
        if e <= p0 or s >= p1:
            continue
        # innerpunkter: legg til geometri-punkter som ligger strengt mellom p0 og p1 i posisjon
        tot = sum(hav(pts[i], pts[i + 1]) for i in range(len(pts) - 1)) or 1
        if p0 < s < p1:
            ut.append(pts[0])
        acc = 0.0
        for i in range(1, len(pts) - 1):
            acc += hav(pts[i - 1], pts[i])
            pos = s + (e - s) * acc / tot
            if p0 < pos < p1:
                ut.append(pts[i])
        if p0 < e < p1:
            ut.append(pts[-1])
    ut.append(punkt_ved(lenker, p1))
    # fjern dupliserte nabopunkter
    ut = [p for p in ut if p]
    ut = [p for i, p in enumerate(ut) if i == 0 or p != ut[i - 1]]
    return [p for p in ut if p]


def forskyv(pts, side, meter):
    """Parallellforskyv linje til høyre (H) eller venstre (V) sett i retning økende posisjon."""
    if side not in ("H", "V") or len(pts) < 2:
        return pts
    sign = -1 if side == "H" else 1  # høyre for kjøreretning = negativ normal ved (dx,dy) -> (dy,-dx)
    ut = []
    for i, p in enumerate(pts):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        dx, dy = (b[0] - a[0]) * math.cos(math.radians(p[1])), (b[1] - a[1])
        n = math.hypot(dx, dy) or 1
        nx, ny = -dy / n, dx / n  # venstre-normal
        dlat = sign * ny * meter / 111320.0
        dlon = sign * nx * meter / (111320.0 * math.cos(math.radians(p[1])))
        ut.append([p[0] + dlon, p[1] + dlat])
    return ut


def linjelengde(pts):
    return sum(hav(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


# ---------- NVDB-oppslag ----------
def skiltpunkt(sid):
    d = get(f"{API}/vegobjekter/api/v4/vegobjekter/95/{sid}", {"srid": 4326, "inkluder": "lokasjon,relasjoner,egenskaper"})
    sted = ((d.get("lokasjon") or {}).get("stedfestinger") or [{}])[0]
    barn = []
    for r in (d.get("relasjoner") or {}).get("barn", []) or []:
        if (r.get("type") or {}).get("id") == 96:
            barn += [b if isinstance(b, int) else b.get("id") for b in r.get("vegobjekter", [])]
    return {"id": sid, "vid": sted.get("veglenkesekvensid"), "pos": sted.get("relativPosisjon"),
            "side": sted.get("sideposisjon"), "plater": barn,
            "geom": wkt_pts(((d.get("lokasjon") or {}).get("geometri") or d.get("geometri") or {}).get("wkt"))}


def plater(ids):
    ut = {}
    for i in range(0, len(ids), 50):
        d = get(f"{API}/vegobjekter/api/v4/vegobjekter/96", {"ider": ",".join(map(str, ids[i:i + 50])), "inkluder": "egenskaper", "antall": 100})
        for o in d.get("objekter", []):
            e = {p.get("navn"): p.get("verdi") for p in o.get("egenskaper", [])}
            ut[o["id"]] = {"nr": str(e.get("Skiltnummer") or ""), "tekst": e.get("Tekst"), "vender": e.get("Ansiktsside, rettet mot")}
    return ut


def skiltpunkter_paa_lenke(vid):
    d = get(f"{API}/vegobjekter/api/v4/vegobjekter/95", {"veglenkesekvens": f"0-1@{vid}", "srid": 4326,
                                                         "inkluder": "lokasjon,relasjoner", "antall": 500})
    ut = []
    for o in d.get("objekter", []):
        sted = ((o.get("lokasjon") or {}).get("stedfestinger") or [{}])[0]
        if sted.get("veglenkesekvensid") != vid:
            continue
        barn = []
        for r in (o.get("relasjoner") or {}).get("barn", []) or []:
            if (r.get("type") or {}).get("id") == 96:
                barn += [b if isinstance(b, int) else b.get("id") for b in r.get("vegobjekter", [])]
        ut.append({"id": o["id"], "pos": sted.get("relativPosisjon"), "side": sted.get("sideposisjon"), "plater": barn})
    return ut


# ---------- følg vegen fra skiltet ----------
def reguleringspunkt(vid, typer_cache):
    """Skiltpunkter med reguleringsplate på veglenkesekvens vid: [(pos, side)]."""
    andre = skiltpunkter_paa_lenke(vid)
    ids = [i for s_ in andre for i in s_["plater"]]
    nye = [i for i in ids if i not in typer_cache]
    if nye:
        typer_cache.update(plater(nye))
    ut = []
    for s_ in andre:
        if s_["pos"] is None:
            continue
        if any(RE_REGULERING.match(typer_cache.get(i, {}).get("nr", "")) for i in s_["plater"]):
            ut.append((s_["pos"], s_["side"], s_["id"]))
    return ut


def folg(vid, pos, fram, side, start_id, typer_cache, maks_m=MAKS_M, hopp=2):
    """Gå fra pos på vid i retning fram/ikke fram. Returnerer (punkter[lon,lat] i kjøreretning, stoppgrunn)."""
    linje, grunn, rest = [], "enden av vegnettet", maks_m
    cur_vid, cur_pos, cur_fram = vid, pos, fram
    for hopp_nr in range(hopp + 1):
        lenker = veglenkesekvens_geom(cur_vid)
        if not lenker:
            grunn = "mangler geometri"; break
        stopp = None
        for (p_, sd, sid) in sorted(reguleringspunkt(cur_vid, typer_cache), key=lambda x: x[0], reverse=not cur_fram):
            if sid == start_id:
                continue
            if (cur_fram and p_ <= cur_pos + 1e-6) or (not cur_fram and p_ >= cur_pos - 1e-6):
                continue
            if sd and side and sd != side:
                continue
            stopp = p_; break
        slutt = stopp if stopp is not None else (1.0 if cur_fram else 0.0)
        p0, p1 = (cur_pos, slutt) if cur_fram else (slutt, cur_pos)
        bit = utsnitt(lenker, p0, p1)
        if not cur_fram:
            bit = bit[::-1]
        if linje and bit and linje[-1] == bit[0]:
            bit = bit[1:]
        # kapp
        acc = 0.0
        for i in range(1, len(bit)):
            seg = hav(bit[i - 1], bit[i])
            if acc + seg > rest:
                fr = (rest - acc) / seg if seg else 0
                bit = bit[:i] + [[bit[i - 1][0] + (bit[i][0] - bit[i - 1][0]) * fr, bit[i - 1][1] + (bit[i][1] - bit[i - 1][1]) * fr]]
                linje += bit
                return linje, f"kappet ved {int(maks_m)} m"
            acc += seg
        rest -= acc
        linje += bit
        if stopp is not None:
            return linje, "neste reguleringsskilt"
        # nådde enden av veglenka: hopp videre langs mest rettfram nabo
        if hopp_nr == hopp or len(linje) < 2:
            grunn = "enden av veglenka"; break
        kandidater = naboer(cur_vid, 1.0 if cur_fram else 0.0)
        if not kandidater:
            grunn = "enden av veglenka"; break
        heading = retning_grader(linje[-2], linje[-1])
        beste = None
        for nvid, npos in kandidater:
            nl = veglenkesekvens_geom(nvid)
            if not nl:
                continue
            nfram = npos < 0.5  # kobler i starten -> går framover (økende pos)
            a = punkt_ved(nl, npos)
            b = punkt_ved(nl, min(npos + 0.05, 1.0) if nfram else max(npos - 0.05, 0.0))
            if not a or not b or a == b:
                continue
            diff = vinkeldiff(heading, retning_grader(a, b))
            if beste is None or diff < beste[0]:
                beste = (diff, nvid, npos, nfram)
        if not beste or beste[0] > 45:  # bare fortsett når vegen går noenlunde rett fram
            grunn = "veglenke slutter (kryss)"; break
        _, cur_vid, cur_pos, cur_fram = beste
        grunn = "fortsatte over kryss"
    return linje, grunn


# ---------- hoved ----------
def main():
    skilt = json.loads(INN.read_text(encoding="utf-8"))["features"]
    beboer = [f for f in skilt if f["properties"].get("kategori") == "boligsone"
              and str(f["properties"].get("skiltnummer", "")).startswith("808")
              and RE_BEBOER.search(f["properties"].get("tekst") or "")]
    print(f"{len(beboer)} beboerskilt", file=sys.stderr)
    feats = []
    for f in beboer:
        p = f["properties"]
        mor = (p.get("mor") or [None])[0]
        if not mor:
            continue
        try:
            sp = skiltpunkt(mor)
            if sp["vid"] is None or sp["pos"] is None:
                print("  mangler stedfesting", mor, file=sys.stderr); continue
            lenker = veglenkesekvens_geom(sp["vid"])
            if not lenker:
                print("  mangler geometri", sp["vid"], file=sys.stderr); continue
            egne = plater(sp["plater"]) if sp["plater"] else {}
            vender = next((v["vender"] for v in egne.values() if v.get("vender")), None) or (p.get("egenskaper") or {}).get("Ansiktsside, rettet mot") or ""
            fram = "mot metrering" not in vender.lower()  # skiltet vender mot trafikk MED metrering -> gjelder framover (økende pos)
            typer_cache = {}
            linje, stopp_grunn = folg(sp["vid"], sp["pos"], fram, sp["side"], sp["id"], typer_cache)
            if linjelengde(linje) < 10:
                alt, alt_grunn = folg(sp["vid"], sp["pos"], not fram, sp["side"], sp["id"], typer_cache)
                if linjelengde(alt) > linjelengde(linje):
                    linje, stopp_grunn, fram = alt, alt_grunn + " (snudd retning)", not fram
            side = sp["side"]
            # linje ligger i kjøreretning; H/V er relativt til metrering -> snu ved kjøring mot metrering
            side_kj = side if fram else {"H": "V", "V": "H"}.get(side, side)
            geom_pts = forskyv(linje, side_kj, OFFSET_M)
            if len(geom_pts) < 2:
                continue
            soner = re.findall(r"sone\s*(\d+)", (p.get("tekst") or "").lower())
            feats.append({"type": "Feature", "properties": {
                "gate": p.get("vegsystem"), "sone": "+".join(dict.fromkeys(soner)) or "?", "tekst": p.get("tekst"),
                "skilt_id": p.get("nvdb_id"), "skiltpunkt_id": sp["id"], "veglenkesekvens": sp["vid"],
                "side": {"H": "høyre (metreringsretning)", "V": "venstre (metreringsretning)"}.get(side, side),
                "retning": "med metrering" if fram else "mot metrering",
                "lengde_m": round(linjelengde(linje)), "stopp": stopp_grunn,
                "plater_paa_stolpen": [f"{v['nr']}: {v['tekst'] or ''}".strip(": ") for v in egne.values()],
                "status": "utledet"
            }, "geometry": {"type": "LineString", "coordinates": [[round(x, 7), round(y, 7)] for x, y in geom_pts]}})
            print(f"  ok {p.get('tekst')} @ {p.get('vegsystem')}: {round(linjelengde(linje))} m ({stopp_grunn})", file=sys.stderr)
        except Exception as e:
            print("  FEIL", p.get("nvdb_id"), e, file=sys.stderr)
    UT.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False), encoding="utf-8")
    print(f"{len(feats)} strekninger -> {UT}", file=sys.stderr)


if __name__ == "__main__":
    main()
