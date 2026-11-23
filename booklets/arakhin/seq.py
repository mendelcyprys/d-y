import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sys, re
from dump import load, clean
def flat(t):
    if isinstance(t, str): yield t
    elif isinstance(t, list):
        for x in t: yield from flat(x)
ch = sys.argv[1]
for s in sys.argv[2].split(','):
    t = load(f'{s}{ch}')
    if t is None: continue
    print(f'##### {s} ch{ch}')
    for i, c in enumerate(flat(t)):
        if c and c.strip(): print(f'[{i+1}]', re.sub(r'[\u0591-\u05C7]', '', clean(c)))
