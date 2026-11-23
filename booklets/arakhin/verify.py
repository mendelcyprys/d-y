import json, re, glob, os
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'raw')
def letters(s):
    s = re.sub(r'<[^>]+>', '', s)
    s = re.sub(r'\{[^}]*\}', '', s)            # parashah markers {פ} {ס}
    s = re.sub(r'\[[^\]]*\]', '', s)           # bracketed ketiv
    s = s.replace('־', ' ').replace('׀', ' ')
    s = re.sub(r'[^א-ת ]', '', s)
    return re.sub(r'\s+', ' ', s).strip()
def text(p):
    t = json.load(open(p))['versions'][0]['text']
    return t if isinstance(t, list) else [t]
tot = 0; bad = []
for v in sorted(glob.glob(os.path.join(RAW, 'v_*_*.json'))):
    w = v.replace('/v_', '/w_')
    a, b = text(v), text(w)
    assert len(a) == len(b), v
    for i, (x, y) in enumerate(zip(a, b)):
        tot += 1
        if letters(x) != letters(y): bad.append((os.path.basename(v), i, letters(x), letters(y)))
print('verses compared:', tot, 'letter mismatches:', len(bad))
for b in bad: print(b)
# show any markup present in the Aleppo-based text
marks = set()
for v in glob.glob(os.path.join(RAW, 'v_*_*.json')):
    for x in text(v): marks.update(re.findall(r'<[^>]+>|\{[^}]*\}|\[[^\]]*\]', x))
print('markup seen:', marks)
