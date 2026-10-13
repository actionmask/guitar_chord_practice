"""PDF 吉他譜 -> Guitar Pro (.gp)

Turns the teacher's tab PDFs (exported from Guitar Pro, vector PDF) into .gp files for the practice page.
One PDF may hold several songs; each song usually has two parts (a chord / rhythm part and a solo part), each
starting on a page with the big title and a 'KEY:..  NNN bpm' line. Parts of the same song become two tracks,
'Solo' and 'Chords', in one .gp file.

usage:
    python pdf2gp.py 譜.pdf                      -> one .gp per song, next to the PDF
    python pdf2gp.py 獨奏.pdf 和弦.pdf           -> parts in separate files are put together
    python pdf2gp.py 譜資料夾                     -> every PDF in the folder
    python pdf2gp.py 譜.pdf -o 輸出資料夾 --list  (--list only shows what was found)
"""
import argparse, os, re, sys, json, subprocess, unicodedata, collections
import pymupdf as fitz
import tabpdf

HERE = os.path.dirname(os.path.abspath(__file__))
KEYLINE = re.compile(r'KEY\s*:\s*(.*?)\s+(\d{2,3})\s*b\s*/?\s*pm', re.I)


def spans_of(page):
    """Printed text only: handwritten notes added on a tablet use system fonts whose names start with a dot."""
    out = []
    for b in page.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                t = s['text'].strip()
                if t and not s['font'].startswith('.'): out.append((s['bbox'], t, s['size']))
    return out


def readable(s):
    """False for text in a font without a usable character map (comes out as random symbols)."""
    bad = sum(1 for ch in s if unicodedata.category(ch)[0] == 'C' or 0x2C80 <= ord(ch) <= 0x2CFF or 0x3400 <= ord(ch) <= 0x4DBF)
    return bad == 0


def header(page):
    """Title, artist, key, tempo if this is the first page of a part, else None."""
    sp = spans_of(page); h = page.rect.height
    key = None
    for bb, t, sz in sp:
        m = KEYLINE.search(t)
        if m and bb[1] < h * 0.3: key = (m.group(1).strip(), int(m.group(2)), bb[1]); break
    if not key: return None
    above = [(bb, t, sz) for bb, t, sz in sp if bb[1] < key[2] - 1 and sz >= 14 and not KEYLINE.search(t)]
    if not above: return None
    top = max(sz for _, _, sz in above)
    big = sorted([(bb, t) for bb, t, sz in above if sz >= top * 0.95], key=lambda x: x[0][0])
    raw = unicodedata.normalize('NFKC', ''.join(t if not re.match(r'^[A-Za-z0-9]', t) or not i else ' ' + t for i, (_, t) in enumerate(big))).strip()
    raw = re.sub(r'\s+', ' ', raw)
    title, artist = raw, ''
    m = re.match(r'^(.*?)\s*[\(（]\s*(.*?)\s*[\)）]\s*$', raw)
    if m: title, artist = m.group(1), m.group(2)
    elif re.search(r'\s?[-–—]\s?', raw):
        title, artist = [x.strip() for x in re.split(r'\s?[-–—]\s?', raw, maxsplit=1)]
    ok = readable(raw) and title
    return {'title': title if ok else None, 'artist': artist if ok else '', 'key': re.sub(r'\s+', ' ', key[0]), 'tempo': key[1], 'raw': raw}


def find_parts(pdfs):
    """[(doc, path, first page, last page, header)] for every part in the given PDFs, in order."""
    parts = []
    for path in pdfs:
        doc = fitz.open(path); cur = None
        for i, p in enumerate(doc):
            h = header(p)
            if h:
                if cur: parts.append(cur)
                cur = [doc, path, i, i, h]
            elif cur: cur[3] = i
            else: print(f'  {os.path.basename(path)} page {i + 1}: before any title page, skipped')
        if cur: parts.append(cur)
    return parts


def chordiness(doc, a, b):
    """How much a part looks like the chord part: chord names per bar (the solo part mostly has none)
    plus the share of played beats with 3+ notes (strummed chords)."""
    bars = tabpdf.convert(doc, range(a, b + 1), None)
    ev = [e for B in bars for e in B['ev'] if e['notes']]
    lab = sum(len(B['chords']) for B in bars) / max(1, len(bars))
    poly = (sum(1 for e in ev if len(e['notes']) >= 3) / len(ev)) if ev else 0.0
    return 2 * lab + poly, len(bars)


def safe_name(s):
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', s).strip(' .')
    return s or 'song'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf', nargs='+')
    ap.add_argument('-o', '--out', help='output folder (default: next to the first PDF)')
    ap.add_argument('--list', action='store_true', help='only list the songs and parts that were found')
    ap.add_argument('--title', action='append', default=[], help='name for a song whose title cannot be read, in order (repeatable); "歌名 - 歌手" also sets the artist')
    ap.add_argument('--swap', action='store_true', help='Solo / Chords were guessed the wrong way round: take the parts in page order, first = Solo')
    ap.add_argument('--keep-tex', action='store_true', help='also keep the intermediate .alphatex text')
    a = ap.parse_args()
    pdfs = []
    for x in a.pdf:   # a folder = every PDF in it, in name order
        if os.path.isdir(x): pdfs += sorted(os.path.join(x, f) for f in os.listdir(x) if f.lower().endswith('.pdf'))
        elif os.path.exists(x): pdfs.append(x)
        else: sys.exit(f'not found: {x}')
    if not pdfs: sys.exit('no PDF files given')
    a.pdf = pdfs

    parts = find_parts(a.pdf)
    if not parts: sys.exit('No title page found (a page with the song title and a "KEY: ... bpm" line). Is this one of the teacher\'s PDFs?')
    # parts of the same song: same title line and key (in one PDF they follow each other; across PDFs they match up)
    songs = collections.OrderedDict()
    for doc, path, i0, i1, h in parts:
        k = (h['raw'], h['key'], h['tempo'])
        songs.setdefault(k, []).append((doc, path, i0, i1, h))
    out_dir = a.out or os.path.dirname(os.path.abspath(a.pdf[0]))
    os.makedirs(out_dir, exist_ok=True)
    unnamed = list(a.title); jobs = []
    for si, (k, ps) in enumerate(songs.items()):
        h = ps[0][4]
        title = h['title']
        if not title:   # the title font has no usable character map
            stems = [os.path.splitext(os.path.basename(p[1]))[0] for p in ps]
            pre = os.path.commonprefix(stems).rstrip(' _-.')
            if unnamed:
                title = unnamed.pop(0)
                if ' - ' in title: title, h['artist'] = [x.strip() for x in title.split(' - ', 1)]
            elif len(set(stems)) > 1 and len(pre) >= 2: title = pre          # 嫁禍_solo.pdf + 嫁禍_chords.pdf -> 嫁禍
            elif sum(1 for v in songs.values() if v[0][1] == ps[0][1]) == 1: title = stems[0]   # one song in this PDF
            else: title = f'song{si + 1}'
            print(f'(title not readable from the PDF, using "{title}" - give a name with --title)')
        scored = []
        for doc, path, i0, i1, _ in ps:
            c, nb = chordiness(doc, i0, i1); scored.append((c, nb, doc, path, i0, i1))
        # the part that looks less like chords is the solo; a song with one part gets one track named after what it looks like
        if a.swap: scored.reverse()
        else: scored.sort(key=lambda x: x[0])
        if len(scored) == 1:
            names = [('Chords', 'Chd') if scored[0][0] > 1.0 else ('Solo', 'Solo')]
        else:
            names = [('Solo', 'Solo')] + [('Chords', 'Chd')] + [('Part %d' % (j + 3), 'P%d' % (j + 3)) for j in range(len(scored) - 2)]
        print(f'{title}' + (f' - {h["artist"]}' if h['artist'] else '') + f'  (KEY {h["key"]}, {h["tempo"]} bpm)')
        for (nm, _), (c, nb, doc, path, i0, i1) in zip(names, scored):
            print(f'    {nm:7s} {os.path.basename(path)} page {i0 + 1}-{i1 + 1}, {nb} bars, chord score {c:.2f}')
        jobs.append((title, h['artist'], h['tempo'], [(nm, sh, doc, list(range(i0, i1 + 1))) for (nm, sh), (c, nb, doc, path, i0, i1) in zip(names, scored)]))
    if a.list: return

    texs = []
    for title, artist, tempo, tparts in jobs:
        rep = []
        tex, n = tabpdf.build_alphatex(title, artist, tempo, tparts, rep)
        base = os.path.join(out_dir, safe_name(title))
        open(base + '.alphatex', 'w', encoding='utf-8').write(tex)
        texs.append((title, base, rep))
    # alphaTex -> .gp with alphaTab (Node.js); also checks every bar adds up to a full 4/4 bar
    r = subprocess.run(['node', os.path.join(HERE, 'tex2gp.mjs')] + [b + '.alphatex' for _, b, _ in texs], capture_output=True, text=True, encoding='utf-8')
    if r.returncode != 0:
        sys.exit('tex2gp.mjs failed:\n' + r.stderr + r.stdout + '\n(run "npm install" in this folder first)')
    res = json.loads(r.stdout.strip().splitlines()[-1])
    print()
    for (title, base, rep), info in zip(texs, res):
        if info.get('error'):
            print(f'{title}: could not read the converted text - {info["error"]}'); print('   kept', base + '.alphatex'); continue
        print(f'wrote {base}.gp  ({", ".join(info["tracks"])})')
        for t, bar, beats in info['bad'][:15]:
            print(f'    check {t} bar {bar}: adds up to {beats:g} beats, not 4')
        if len(info['bad']) > 15: print(f'    ... and {len(info["bad"]) - 15} more bars to check')
        for x in rep[:15]: print('    check', x)
        if not a.keep_tex: os.remove(base + '.alphatex')


if __name__ == '__main__':
    main()
