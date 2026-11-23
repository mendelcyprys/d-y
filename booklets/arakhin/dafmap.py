"""Builds raw/dafmap.json, which maps each mishnah ("1:1") to the first daf where the Gemara
takes it up ("Arakhin 2a:1-3"). It uses Sefaria's "mishnah in talmud" links in raw/links1-9.json.
A link that covers a range of mishnayos ("2:3-4") is filed under its first mishnah; build.py fills
the gaps from the mishnah before."""
import json
import os
import re

RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'raw')


def daf_key(ref):
    m = re.match(r'Arakhin (\d+)([ab])', ref)
    return int(m.group(1)), m.group(2)


found = {}
for c in range(1, 10):
    for link in json.load(open(os.path.join(RAW, f'links{c}.json'))):
        if link.get('type') != 'mishnah in talmud' or not re.match(r'Arakhin \d+[ab]', link['ref']):
            continue
        m = re.search(r'(\d+):(\d+)', link['anchorRef'])
        if m:
            found.setdefault(f'{m.group(1)}:{m.group(2)}', []).append(link['ref'])

dafmap = {k: sorted(v, key=daf_key)[0] for k, v in found.items()}
json.dump(dafmap, open(os.path.join(RAW, 'dafmap.json'), 'w'), indent=0)
print(f'dafmap: {len(dafmap)} mishnayos linked')
