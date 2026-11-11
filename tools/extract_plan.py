#!/usr/bin/env python3
"""Extract the day-by-day 2027 plan from the A1 calendar PDF (pdftotext -bbox output).
usage: extract_plan.py bbox.html out.json   — validates day counts and monthly km vs poster headers."""
import re, sys, json, calendar, html, datetime as dt
words = [(float(a),float(b),float(c),float(d),t) for a,b,c,d,t in
         re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', open(sys.argv[1]).read())]
words = [(a,b,c,d,t.replace('&amp;','&')) for a,b,c,d,t in words]
PX0, PDX, HY0, HDY, COLX, COLW = 23.4, 456.95, 278.6, 396.05, 38.6, 58.0
POSTER_KM = [144,133,198,286,348,216,270,346,332,240,146,213]
h = lambda w: w[3]-w[1]
def near(v, t, tol=0.6): return abs(v-t) <= tol
def kind(label):
    l = label.lower()
    if 'rest' in l and 'day' in l: return 'rest'
    if 'social' in l: return 'social'
    if 'long' in l or 'lr' in l.split(): return 'long'
    if 'jakim' in l or 'mjm' in l or 'jrf' in l or 'fm' in l.split() or 'half' in l: return 'race'
    if 'time trial' in l or ' tt' in l or l.endswith('tt'): return 'tt'
    if any(k in l for k in ('interval','tempo','mile','reps','@mp','steady','sub-t','threshold','progressive','broken','off ks','offks','repeats','over','under','m-reps','descending','pyramid','shakeout','x1 km','2×1')): return 'quality'
    if 'hills' in l or 'strides' in l or 'stride' in l: return 'speed'
    if 'easy' in l or 'walk' in l or 'jog' in l or 'return' in l: return 'easy'
    return 'other'
STRENGTH = re.compile(r'^(Upper|Lower|Unilateral|Full|body|light|maint\.|Plyo|FB|upper|\d+)$')
days, weeks, problems = [], {}, []
for m in range(12):
    px = PX0 + PDX*(m%4); hy = HY0 + HDY*(m//4)
    ws = [w for w in words if px-2 <= w[0] < px+440 and hy+8 <= w[1] < hy+385]
    dn = [w for w in ws if near(h(w),14.7,0.5) and re.fullmatch(r'\d{1,2}',w[4]) and w[0] >= px+COLX-6]
    rows = sorted({round(w[1]) for w in dn})
    # merge near-equal row ys
    rys = []
    for y in rows:
        if not rys or y-rys[-1] > 6: rys.append(y)
    def row_of(y): return max(i for i,r in enumerate(rys) if y >= r-6)
    for w in dn:
        col = round((w[0]-(px+COLX))/COLW)
        if not 0 <= col <= 6: continue
        r = row_of(w[1]); y0 = rys[r]; y1 = rys[r+1]-6 if r+1 < len(rys) else hy+385
        x0 = px+COLX+COLW*col-5; x1 = x0+COLW
        cell = [c for c in ws if x0 <= c[0] < x1 and y0-3 <= c[1] < y1 and c is not w and not (c in dn)]
        cell.sort(key=lambda c:(round(c[1]/3), c[0]))
        dist = [c for c in cell if near(h(c),15.5,0.6) and re.fullmatch(r'\d+(\.\d+)?',c[4])]
        lab  = [c for c in cell if near(h(c),11.9,0.6) or near(h(c),12.2,0.6)]
        small= [c for c in cell if c not in dist and c not in lab]
        label = ' '.join(c[4] for c in lab)
        smalltxt = [c[4] for c in small]
        txt = ' '.join(smalltxt)
        d = int(w[4])
        if d > calendar.monthrange(2027,m+1)[1]: continue
        date = dt.date(2027,m+1,d)
        days.append(dict(date=date.isoformat(), km=float(dist[0][4]) if dist else 0.0, label=label,
            kind='rest' if (not dist and 'REST' in txt) else ('gym' if 'GYM' in txt and not dist else kind(label)),
            tags=sorted(set(re.findall(r'(Upper|Lower light|Lower maint\.|Lower|Unilateral|Full body|FB upper|Plyo \d+|CP\d+|MP \d+|MP|Pre-TT)', txt))),
            note=txt, _y=round(w[1]), _m=m))
    # week labels
    wk = [w for w in ws if near(h(w),20.4,0.6) and re.fullmatch(r'W\d+',w[4]) and w[0] < px+30]
    for w in wk:
        wy = w[1]; r = row_of(wy+2)
        km = [c for c in ws if near(h(c),16.6,0.6) and c[0] < px+45 and abs(c[1]-wy) < 30]
        ph = ' '.join(c[4] for c in sorted([c for c in ws if near(h(c),8.3,0.4) and c[0] < px+45 and abs(c[1]-wy) < 30], key=lambda c:(c[1],c[0])))
        weeks[(m, r)] = dict(week=w[4], km=km[0][4] if km else None, phase=ph)
# attach week info
for d in days:
    r = None
for d in days: pass
out = []
by_m = {}
for d in days: by_m.setdefault(d['_m'],[]).append(d)
for m,ds in by_m.items():
    rys = sorted({d['_y'] for d in ds}); rr=[]
    for y in rys:
        if not rr or y-rr[-1] > 6: rr.append(y)
    for d in ds:
        r = max(i for i,y in enumerate(rr) if d['_y'] >= y-6)
        wi = weeks.get((m,r), {})
        d['week'] = wi.get('week'); d['phase'] = wi.get('phase')
for d in sorted(days, key=lambda d:d['date']):
    d.pop('_y'); d.pop('_m')
    fix = lambda t: re.sub(r'(?<=[-])\s+', '', html.unescape(t or '')).replace('OFF- SEASON','OFF-SEASON')
    d['label'] = fix(d['label']); d['note'] = fix(d['note'])
    ph = fix(d['phase'])
    d['phase'] = next((p for p in ('OFF-SEASON','RAMADAN','BASE','BUILD','C-RACE','RECOVERY','PEAK','TAPER','RACE WEEK') if ph.startswith(p)), ph)
    d['event'] = (re.search(r'♥\s*(.+)$', ph) or [None,None])[1]
    l = d['label'].lower()
    if d['kind'] == 'other':
        d['kind'] = 'quality' if 'into' in l else 'easy'
        d['special'] = bool(re.search(r'birthday|independence|new year|medical', l))
    out.append(d)
# validation
print('days:', len(out), '(expect 365)')
dates = {d['date'] for d in out}
miss = [(dt.date(2027,1,1)+dt.timedelta(i)).isoformat() for i in range(365) if (dt.date(2027,1,1)+dt.timedelta(i)).isoformat() not in dates]
print('missing:', miss[:10], len(miss))
tot = 0
for m in range(12):
    s = sum(d['km'] for d in out if int(d['date'][5:7]) == m+1); tot += s
    print(f'{calendar.month_abbr[m+1]} sum={s:.1f} poster={POSTER_KM[m]} diff={s-POSTER_KM[m]:+.1f}')
print('total', round(tot,1), 'poster 2873')
json.dump(out, open(sys.argv[2],'w'), ensure_ascii=False, indent=1)
