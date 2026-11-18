#!/usr/bin/env python3
"""Elevation along the Jakim route (the official GPX has none): samples the track every 50 m (scaled km) and asks Open-Meteo's
elevation API (Copernicus 90 m DEM, whole metres). Output: tools/data/jakim-elev.json -> merged by tools/build_route.mjs.
Usage: python3 tools/fetch_elevation.py   (needs network access to api.open-meteo.com)"""
import json, math, re, time, urllib.request, pathlib
root = pathlib.Path(__file__).resolve().parent
txt = (root / 'data' / 'jakim-2026.gpx').read_text()
pts = [(float(a), float(b)) for a, b in re.findall(r'lat="([-\d.]+)" lon="([-\d.]+)"', txt)]
pts = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
R = 6371008.8
def hv(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0]); dl = math.radians(b[1] - a[1]); dp = p2 - p1
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2; return 2 * R * math.asin(math.sqrt(h))
cum = [0.0]
for i in range(1, len(pts)): cum.append(cum[i - 1] + hv(pts[i - 1], pts[i]))
total = cum[-1]; scale = 42195 / total; step = 50 / scale  # 50 m of official distance, in track metres
def at(m):
    i = next((i for i, c in enumerate(cum) if c >= m), len(cum) - 1); i = max(i, 1)
    f = (m - cum[i - 1]) / max(1e-9, cum[i] - cum[i - 1]); return (pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1]))
n = int(total // step) + 1
samples = [at(min(total, i * step)) for i in range(n)] + [pts[-1]]
ele = []
for i in range(0, len(samples), 100):
    b = samples[i:i + 100]
    url = 'https://api.open-meteo.com/v1/elevation?latitude=%s&longitude=%s' % (','.join('%.5f' % p[0] for p in b), ','.join('%.5f' % p[1] for p in b))
    for attempt in range(4):
        try:
            ele += json.load(urllib.request.urlopen(url, timeout=30))['elevation']; break
        except Exception as e:
            if attempt == 3: raise
            time.sleep(2)
    time.sleep(0.4)
assert len(ele) == len(samples)
out = {'source': 'Open-Meteo elevation API (Copernicus DEM, 90 m grid, whole metres)', 'stepKm': round(0.05, 4), 'trackKm': round(total / 1000, 3), 'n': len(ele), 'ele': ele}
(root / 'data' / 'jakim-elev.json').write_text(json.dumps(out))
print(len(ele), 'samples; min', min(ele), 'max', max(ele))
