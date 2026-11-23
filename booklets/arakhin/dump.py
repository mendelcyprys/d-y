import json, re, sys, os
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'raw')
def load(name):
    p = os.path.join(RAW, name + '.json')
    if not os.path.exists(p): return None
    d = json.load(open(p))
    return d['versions'][0]['text'] if d.get('versions') else None
def clean(s):
    s = re.sub(r'<br\s*/?>', ' ', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = s.replace('&nbsp;', ' ').replace('&quot;', '"')
    return re.sub(r'\s+', ' ', s).strip()
def strip_nikud(s):
    return re.sub(r'[֑-ׇ]', '', s)
if __name__ == '__main__':
    ch = int(sys.argv[1]); srcs = sys.argv[2].split(',')
    only = int(sys.argv[3]) if len(sys.argv) > 3 else None
    m = load(f'm{ch}')
    data = {s: load(f'{s}{ch}') for s in srcs}
    for i, mt in enumerate(m):
        if only and i + 1 != only: continue
        print(f'=== {ch}:{i+1} ===')
        print('M:', strip_nikud(clean(mt)))
        for s in srcs:
            t = data[s]
            if not t or i >= len(t) or not t[i]: continue
            items = t[i] if isinstance(t[i], list) else [t[i]]
            for j, c in enumerate(items):
                if c: print(f'[{s} {j+1}]', strip_nikud(clean(c)))
        print()
