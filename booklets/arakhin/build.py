#!/usr/bin/env python3
"""Builds build/arakhin.html from the Sefaria texts in raw/ (see fetch-all.sh) and the notes in notes/.
Render it with: node render.cjs build/arakhin.html Mishnah-Arakhin.pdf"""
import datetime, html, json, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(ROOT, 'raw')
NOTES = os.path.join(ROOT, 'notes')
OUT = os.path.join(ROOT, 'build', 'arakhin.html')


def load_text(name):
    d = json.load(open(os.path.join(RAW, name + '.json')))
    t = d['versions'][0]['text']
    return t if isinstance(t, list) else [t]


# ---------------------------------------------------------------- Hebrew bits
ONES = 'אבגדהוזחט'
TENS = 'יכלמנסעפצ'


def gematria(n):
    s = ''
    if n >= 100:
        s += 'קרשת'[n // 100 - 1]
        n %= 100
    if n == 15:
        s += 'טו'
    elif n == 16:
        s += 'טז'
    else:
        if n >= 10:
            s += TENS[n // 10 - 1]
        if n % 10:
            s += ONES[n % 10 - 1]
    return s


def heb_num(n):
    s = gematria(n)
    return s + '׳' if len(s) == 1 else s[:-1] + '״' + s[-1]


PEREK_ORD = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני', 'תשיעי']
PEREK_NAME = ['הכל מעריכין', 'אין נערכין', 'יש בערכין', 'השג יד', 'האומר משקלי',
              'שום היתומים', 'אין מקדישין', 'המקדיש את שדהו', 'המוכר את שדהו']
PEREK_EN = ['Who may value and be valued', 'Minimums and maximums; the Temple music',
            'Fixed sums: lenient and strict', 'Ability to pay; counting ages',
            'Vows of weight, limbs and halves; pledges', 'Collection; what the debtor keeps',
            'Consecrating and redeeming fields', 'Fields without Yovel; cherem',
            'Sales of fields and houses; Levite cities']


# ---------------------------------------------------------------- sanitising
def clean_sefaria(s):
    """Keep only <b>/<i>/<br>; drop commentary anchors and anything else."""
    s = re.sub(r'<i[^>]*data-commentator[^>]*>.*?</i>', '', s)
    s = re.sub(r'<sup[^>]*>.*?</sup>', '', s)
    s = s.replace('&nbsp;', ' ').replace('&thinsp;', ' ')
    s = re.sub(r'<br\s*/?>', ' ', s)
    s = re.sub(r'<(?!/?(?:b|i)>)[^>]+>', '', s)
    s = html.unescape(s)
    s = html.escape(s, quote=False)
    s = re.sub(r'&lt;(/?(?:b|i))&gt;', r'<\1>', s)
    s = re.sub(r'\(([^()]{1,40})\)', r'<span class="src">(\1)</span>', s)  # verse refs
    return re.sub(r'\s+', ' ', s).strip()


def verse_html(s):
    """Masoretic text: ketiv/kri, parashah markers, paseq."""
    s = s.replace('&nbsp;', ' ').replace('&thinsp;', ' ')
    s = re.sub(r'<b>\s*׀\s*</b>', '׀', s)
    kq = re.compile(r'<span class="mam-kq">(.*?)</span></span>')

    def kq_sub(m):
        inner = m.group(1) + '</span>'
        q = re.search(r'mam-kq-q">\[(.*?)\]</span>', inner)
        k = re.search(r'mam-kq-k">\((.*?)\)</span>', inner)
        return '%s <span class="ketiv" title="ketiv">(%s)</span>' % (q.group(1), k.group(1))
    s = kq.sub(kq_sub, s)
    s = re.sub(r'<span class="mam-spi-(?:samekh|pe)">\{(.)\}</span>', r'<span class="ps">\1</span>', s)
    s = re.sub(r'\{(.)\}', r'<span class="ps">\1</span>', s)
    s = re.sub(r'<(?!/?span|/?b)[^>]+>', '', s)
    return re.sub(r'\s+', ' ', s).strip()


# ---------------------------------------------------------------- my notes
TAG = r'</?(?:strong|em|b)>'
LET = r'[א-ת]'
NEXT_HEB = r'(?=\s?(?:%s)*%s)' % (TAG, LET)
HEB_RUN = re.compile(
    r'(?P<lead>(?:<(?:strong|em|b)>)*)'
    r'(?P<core>%s(?:[֑-ׇא-ת׳״־]|\s(?=(?:%s)*%s)|["\'\-]%s|%s%s)*)'
    r'(?P<trail>(?:</(?:strong|em|b)>)*)' % (LET, TAG, LET, NEXT_HEB, TAG, NEXT_HEB))


def _wrap_run(m):
    """Wrap a Hebrew run (which may contain bold/italic tags) in one RTL isolate,
    pulling in neighbouring tags so the markup stays well nested."""
    lead = re.findall(TAG, m.group('lead'))
    core, trail = m.group('core'), re.findall(TAG, m.group('trail'))
    stack, unmatched_close = [], []
    for t in re.findall(TAG, core):
        name = t.strip('</>')
        if t.startswith('</'):
            if stack and stack[-1] == name:
                stack.pop()
            else:
                unmatched_close.append(name)
        else:
            stack.append(name)
    need_lead = ['<%s>' % n for n in reversed(unmatched_close)]
    need_trail = ['</%s>' % n for n in reversed(stack)]
    if (need_lead and lead[-len(need_lead):] != need_lead) or (need_trail and trail[:len(need_trail)] != need_trail):
        # cannot balance: isolate each tag-free piece separately
        pieces = re.split('(%s)' % TAG, core)
        core_html = ''.join(p if re.fullmatch(TAG, p) or not re.search(LET, p)
                            else '<span class="hei" dir="rtl">%s</span>' % p for p in pieces)
        return m.group('lead') + core_html + m.group('trail')
    lead_out = ''.join(lead[:len(lead) - len(need_lead)])
    trail_out = ''.join(trail[len(need_trail):])
    return '%s<span class="hei" dir="rtl">%s%s%s</span>%s' % (
        lead_out, ''.join(need_lead), core, ''.join(need_trail), trail_out)


def wrap_heb(s):
    return HEB_RUN.sub(_wrap_run, s)


def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'<em>\1</em>', s)
    return wrap_heb(s)


def md_paras(text):
    paras = [p.strip() for p in re.split(r'\n\s*\n', text.strip()) if p.strip()]
    out = []
    for p in paras:
        p = ' '.join(p.split('\n'))
        if not re.search('[A-Za-z]', p.replace('**', '')):   # an all-Hebrew line
            out.append('<p class="he-para" dir="rtl">%s</p>' % inline(p))
        else:
            out.append('<p>%s</p>' % inline(p))
    return ''.join(out)


def read_sections(path):
    secs, cur, buf = {}, None, []
    for line in open(path, encoding='utf-8'):
        if line.startswith('# '):
            if cur: secs[cur] = ''.join(buf)
            cur, buf = line[2:].strip(), []
        else:
            buf.append(line)
    if cur: secs[cur] = ''.join(buf)
    return secs


# ---------------------------------------------------------------- daf data
dafmap_raw = json.load(open(os.path.join(RAW, 'dafmap.json')))
dafdates = {int(k): v for k, v in json.load(open(os.path.join(RAW, 'dafdates.json'))).items()}


def daf_of(c, m):
    # Sefaria links can anchor a range ("2:3-4"); fill gaps from the previous mishnah.
    key = f'{c}:{m}'
    if key in dafmap_raw:
        return re.match(r'Arakhin (\d+[ab])', dafmap_raw[key]).group(1)
    return daf_of(c, m - 1) if m > 1 else None


def fmt_date(iso, year=False):
    d = datetime.date.fromisoformat(iso)
    return d.strftime('%a %-d %b' + (' %Y' if year else ''))


def heb_daf(d):
    n, side = int(d[:-1]), d[-1]
    return '<span class="hei" dir="rtl">דף %s %s</span>' % (heb_num(n), 'ע״א' if side == 'a' else 'ע״ב')


# ---------------------------------------------------------------- passages
PASSAGES = [
    ('v_Leviticus_27', 'ויקרא כ״ז', 'Vayikra 27', 1, 'Valuations, consecrated animals, houses and fields, cherem, ma\'aser'),
    ('v_Leviticus_25_8_34', 'ויקרא כ״ה, ח–לד', 'Vayikra 25:8–34', 8, 'Yovel; sale and redemption of fields, houses and Levite cities'),
    ('v_Exodus_21_28_32', 'שמות כ״א, כח–לב', 'Shemos 21:28–32', 28, 'The goring ox (Mishnah 3:3)'),
    ('v_Exodus_22_15_16', 'שמות כ״ב, טו–טז', 'Shemos 22:15–16', 15, 'The seducer (3:4)'),
    ('v_Deuteronomy_22_13_19', 'דברים כ״ב, יג–יט', 'Devarim 22:13–19', 13, 'Motzi shem ra (3:5)'),
    ('v_Deuteronomy_22_28_29', 'דברים כ״ב, כח–כט', 'Devarim 22:28–29', 28, 'The rapist (3:4)'),
    ('v_Numbers_13_32', 'במדבר י״ג, לב', 'Bamidbar 13:32', 32, 'The spies\' report (3:5)'),
    ('v_Numbers_14_22', 'במדבר י״ד, כב', 'Bamidbar 14:22', 22, '"Ten times" (3:5)'),
    ('v_Numbers_14_36_37', 'במדבר י״ד, לו–לז', 'Bamidbar 14:36–37', 36, 'The spies\' punishment (3:5)'),
    ('v_Numbers_18_14', 'במדבר י״ח, יד', 'Bamidbar 18:14', 14, 'Cherem belongs to the kohanim (8:5–6)'),
    ('v_Leviticus_1_3', 'ויקרא א׳, ג', 'Vayikra 1:3', 3, 'לרצנו (5:6)'),
    ('v_Deuteronomy_15_19', 'דברים ט״ו, יט', 'Devarim 15:19', 19, 'The bechor: תקדיש (8:7)'),
]
VNOTE_FILE = {'v_Leviticus_27': 'v_Leviticus_27', 'v_Leviticus_25_8_34': 'v_Leviticus_25',
              'v_Exodus_21_28_32': 'v_Exodus_21', 'v_Exodus_22_15_16': 'v_Exodus_22',
              'v_Deuteronomy_22_13_19': 'v_Deuteronomy_22', 'v_Deuteronomy_22_28_29': 'v_Deuteronomy_22',
              'v_Numbers_13_32': 'v_Numbers_13', 'v_Numbers_14_22': 'v_Numbers_14',
              'v_Numbers_14_36_37': 'v_Numbers_14', 'v_Numbers_18_14': 'v_Numbers_18',
              'v_Leviticus_1_3': 'v_Leviticus_1', 'v_Deuteronomy_15_19': 'v_Deuteronomy_15'}


def verses_section():
    vnotes = {}
    for k, v in read_sections(os.path.join(NOTES, 'verses.md')).items():
        f, rng = k.split()
        a, _, b = rng.partition('-')
        vnotes.setdefault(f, []).append((int(a), int(b or a), v))
    out = ['<section class="part" id="verses"><div class="part-title">'
           '<div class="he-title">פסוקי התורה</div><div class="en-sub">The verses</div></div>',
           '<p class="lede">The Hebrew text is Sefaria\'s <em>Miqra according to the Masorah</em>, '
           'which follows the Aleppo Codex, with vowels and ta\'amim. Each verse was checked letter by letter against a second, '
           'Leningrad-based edition (see the note on sources). Where a word is read differently from how it is written, '
           'the reading (<em>kri</em>) is printed and the written form (<em>ketiv</em>) follows in small type in parentheses. '
           'The small ס / פ mark the Masoretic paragraph breaks.</p>']
    for fname, he, en, first, desc in PASSAGES:
        verses = load_text(fname)
        nf = VNOTE_FILE[fname]
        groups = sorted(g for g in vnotes.get(nf, []) if first <= g[0] <= first + len(verses) - 1)
        out.append('<div class="passage"><h3 class="passage-head"><span class="ph-he">%s</span>'
                   '<span class="ph-en">%s · %s</span></h3>' % (he, en, inline(desc)))
        covered = set()
        for a, b, note in groups:
            nums = range(a, b + 1)
            covered.update(nums)
            out.append('<div class="vgroup"><p class="pasuk">%s</p><div class="note vnote">%s</div></div>' % (
                ' '.join('<span class="vn">%s</span>%s' % (gematria(n), verse_html(verses[n - first])) for n in nums),
                md_paras(note)))
        rest = [n for n in range(first, first + len(verses)) if n not in covered]
        if rest:
            out.append('<p class="pasuk">%s</p>' % ' '.join(
                '<span class="vn">%s</span>%s' % (gematria(n), verse_html(verses[n - first])) for n in rest))
        out.append('</div>')
    out.append('</section>')
    return '\n'.join(out)


# ---------------------------------------------------------------- chapters
def chapter_section(c):
    mish = load_text(f'm{c}')
    bart = load_text(f'bart{c}')
    notes = read_sections(os.path.join(NOTES, f'ch{c}.md'))
    first = daf_of(c, 1)
    last = daf_of(c + 1, 1) if c < 9 else '34a'
    d0, d1 = dafdates[int(first[:-1])], dafdates[int(last[:-1])]
    out = ['<section class="perek">',
           '<div class="perek-head"><div class="ph-ord">פרק %s</div><div class="ph-name">%s</div>'
           '<div class="ph-meta">Chapter %d · %s · %d mishnayos · Gemara %s–%s · Daf Yomi %s – %s</div></div>' % (
               PEREK_ORD[c - 1], PEREK_NAME[c - 1], c, PEREK_EN[c - 1], len(mish), first, last,
               fmt_date(d0), fmt_date(d1, True))]
    if 'intro' in notes:
        out.append('<div class="note intro-note">%s</div>' % md_paras(notes['intro']))
    for i, mt in enumerate(mish, 1):
        daf = daf_of(c, i)
        out.append('<article class="mishnah-block">')
        out.append('<h4 class="m-head"><span class="mh-he">משנה %s</span><span class="mh-en">%d:%d · %s · %s</span></h4>' % (
            gematria(i), c, i, heb_daf(daf), 'Gemara ' + daf))
        out.append('<p class="mishnah">%s</p>' % clean_sefaria(mt))
        comments = bart[i - 1] if i - 1 < len(bart) else []
        if comments:
            out.append('<div class="bart"><span class="bart-label">ברטנורא</span> %s</div>' % ' '.join(
                '<span class="dh">%s</span>' % re.sub(r'[\u0591-\u05BD\u05BF-\u05C7]', '', clean_sefaria(x)) for x in comments if x))
        key = f'{c}:{i}'
        if key in notes:
            out.append('<div class="note">%s</div>' % md_paras(notes[key]))
        out.append('</article>')
    out.append('</section>')
    return '\n'.join(out)


# ---------------------------------------------------------------- front matter
def front_matter():
    rows = []
    for c in range(1, 10):
        first = daf_of(c, 1)
        last = daf_of(c + 1, 1) if c < 9 else '34a'
        n = len(load_text(f'm{c}'))
        rows.append('<tr><td class="he-cell">%s</td><td>%d</td><td>%s</td><td>%d</td><td>%s–%s</td><td>%s – %s</td></tr>' % (
            PEREK_NAME[c - 1], c, inline(PEREK_EN[c - 1]), n, first, last,
            fmt_date(dafdates[int(first[:-1])]), fmt_date(dafdates[int(last[:-1])])))
    front = open(os.path.join(ROOT, 'front.html'), encoding='utf-8').read().replace('{{CHAPTER_ROWS}}', '\n'.join(rows))
    return re.sub(r'(<(p|li|dd)(?: [^>]*)?>)(.*?)(</\2>)', lambda m: m.group(1) + wrap_heb(m.group(3)) + m.group(4),
                  front, flags=re.S)


def main():
    tpl = open(os.path.join(ROOT, 'template.html'), encoding='utf-8').read()
    body = [front_matter(), verses_section(),
            '<section class="part" id="mishnah"><div class="part-title"><div class="he-title">משנה מסכת ערכין</div>'
            '<div class="en-sub">The Mishnah, with Bartenura and notes</div></div>'
            '<p class="lede">Each mishnah is printed with its vowels, followed by the full commentary of '
            'R\' Ovadiah of Bartenura in Rashi script, and then my notes. The notes add what Bartenura does not '
            'say, drawing on Tosafos Yom Tov, Tiferes Yisroel (Yachin and Boaz), Rambam\'s Peirush HaMishnayos '
            'and, now and then, Melechet Shlomo. Each heading gives the daf on which the Gemara takes up that mishnah.</p></section>']
    body += [chapter_section(c) for c in range(1, 10)]
    html_out = tpl.replace('{{BODY}}', '\n'.join(body))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, 'w', encoding='utf-8').write(html_out)
    print('wrote', OUT, len(html_out))


if __name__ == '__main__':
    main()
