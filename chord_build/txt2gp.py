#!/usr/bin/env python3
"""txt2gp.py — 和弦譜 txt（段落、和弦、歌詞）+ JSON（和弦按法、刷法規則）→ Guitar Pro 5

用法:
    python3 txt2gp.py song.txt [out.gp5] [--json song.json] [--tempo 140] [--lyrics text|under|none]

JSON 預設找與 txt 同名的 .json。產生譜的部分用 json2gp.py（要放在同一個資料夾）。
txt 寫法與 JSON 的 "txt" 規則見 FORMAT.md 的「txt2gp」一節。
"""
import argparse
import json
import os
import re
import sys

import guitarpro as gp

import json2gp as J

HEADER_RE = re.compile(r'^\s*\[(.+?)\]\s*(.*)$')
CHORD_LIKE = re.compile(r'[A-G][#b]?(m|maj|min|dim|aug|sus|add|\d)*(/[A-G][#b]?)?')
REPEAT_RE = re.compile(r'x(\d+)')


# ---------------------------------------------------------------- txt parsing
CHORDISH = re.compile(r'[A-G][#b]?[A-Za-z0-9#]*(/[A-G][#b]?)?')


def parse_token(tok):
    """'Em' -> ('Em', None)；'Em:2' -> ('Em', 2)；結尾的點會去掉（'Bb.' -> 'Bb'）"""
    name, _, n = tok.partition(':')
    return name.rstrip('.'), (int(n) if n.isdigit() else None)


def chord_groups(line):
    """把和弦行切成 [(欄位, [和弦...], 小節數)]，一組 = 一小節。
    |Fm Dm| 或 G+D 代表同一小節兩個和弦；單獨的 '.' 會略過；行尾 xN 不在這裡處理。"""
    groups, in_bar = [], False
    for mt in re.finditer(r'\||[^\s|]+', line):
        t = mt.group()
        if t == '|':
            in_bar = not in_bar
            if in_bar:
                groups.append([mt.start() + 1, [], None, True])
            continue
        name, bars = parse_token(t)
        names = [n.rstrip('.') for n in name.split('+') if n.rstrip('.')]
        if not names:
            continue
        if in_bar and groups and groups[-1][3]:
            if not groups[-1][1]:
                groups[-1][0] = mt.start()
            groups[-1][1].extend(names)
        else:
            groups.append([mt.start(), names, bars, False])
    return [(c, names, bars) for c, names, bars, _ in groups if names]


def chord_tokens(line):
    toks = line.split()
    if toks and REPEAT_RE.fullmatch(toks[-1]):
        toks = toks[:-1]
    return toks


def is_chord_line(line, known, lineno):
    body = ' '.join(chord_tokens(line))
    groups = chord_groups(body)
    if not groups:
        return False
    names = [n for _, ns, _ in groups for n in ns]
    if all(n in known for n in names):
        return True
    # 看起來像和弦行（每個詞都像和弦，且至少一個是已知和弦）但有沒定義的 → 報錯，免得被當成歌詞
    if any(n in known for n in names) and all(CHORDISH.fullmatch(n) for n in names):
        missing = sorted({n for n in names if n not in known})
        raise J.SongError(f'第 {lineno} 行的和弦 {", ".join(missing)} 沒有在 JSON 的 shapes 裡定義'
                          f'（打錯字的話請改 txt）：{line.strip()}')
    return False


def split_lyric(lyric, cols):
    """依和弦所在欄位切歌詞；切點落在單字中間就往後移到下一個字開頭。"""
    cuts = []
    for c in cols:
        c = min(c, len(lyric))
        while 0 < c < len(lyric) and lyric[c - 1] != ' ' and lyric[c] != ' ':
            c += 1
        cuts.append(c)
    lead = lyric[:cuts[0]].strip()
    parts = [lyric[a:b].strip() for a, b in zip(cuts, cuts[1:] + [len(lyric)])]
    return lead, parts


def parse_txt(path, known):
    """回傳段落清單 [{'name', 'segs': [{'chord','bars','text','alone'}]}]，一個 seg = 一個和弦。"""
    lines = [l.rstrip('\n').replace('\t', '    ') for l in open(path, encoding='utf-8')]
    sections = []

    def cur():
        if not sections:
            sections.append({'name': None, 'segs': []})
        return sections[-1]

    def last_seg():
        for sec in reversed(sections):
            if sec['segs']:
                return sec['segs'][-1]
        return None

    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        s = line.strip()
        if not s or s.startswith('#') or (s.startswith('(') and s.endswith(')')):
            continue
        m = HEADER_RE.match(line)
        if m:
            sections.append({'name': m.group(1).strip(), 'segs': []})
            if not m.group(2).strip():
                continue
            line = ' ' * (len(line) - len(m.group(2))) + m.group(2)
            if not is_chord_line(line, known, i):
                raise J.SongError(f'第 {i} 行：[{m.group(1)}] 後面不是和弦')
        if is_chord_line(line, known, i):
            rep = 1
            mrep = re.search(r'\s(x\d+)\s*$', line)
            if mrep:
                rep = int(mrep.group(1)[1:])
                line = line[:mrep.start()]
            toks = chord_groups(line)        # [(欄位, [和弦...], 小節數)]
            lyric = ''
            if i < len(lines):
                nxt = lines[i]
                ns = nxt.strip()
                if ns and not HEADER_RE.match(nxt) and not is_chord_line(nxt, known, i + 1) \
                        and not (ns.startswith('(') and ns.endswith(')')) and not ns.startswith('#'):
                    lyric = nxt.rstrip()
                    i += 1
            compact = len(toks) > 1 and bool(re.fullmatch(r'\s*\S+( \S+)+\s*', line))
            if not lyric:
                lead, parts = '', [''] * len(toks)
            elif compact:   # 「Em C G D」擠在一起：沒有對位意義，歌詞放第一個和弦
                lead, parts = '', [lyric.strip()] + [''] * (len(toks) - 1)
            else:
                lead, parts = split_lyric(lyric, [c for c, _, _ in toks])
            if lead:        # 和弦前面的字（弱起）接到前一個和弦
                prev = last_seg()
                if prev:
                    prev['text'] = (prev['text'] + ' ' + lead).strip()
                else:
                    parts[0] = (lead + ' ' + parts[0]).strip()
            alone = len(toks) == 1 and bool(lyric)
            for r in range(rep):
                for k, (_, names, bars) in enumerate(toks):
                    cur()['segs'].append({'chord': names[0], 'split': names if len(names) > 1 else None,
                                          'bars': bars, 'text': parts[k] if r == 0 else '',
                                          'alone': alone})
        else:               # 沒有和弦的歌詞行：接在最後一個和弦後面
            prev = last_seg()
            if prev:
                prev['text'] = (prev['text'] + ' ' + s).strip()
    return [sec for sec in sections if sec['segs']]


# ---------------------------------------------------------------- arrange
def rule_for(rules, name):
    secs = rules.get('sections', {})
    if name in secs:
        return secs[name]
    base = re.sub(r'\s*\d+$', '', name or '')   # "Verse 2" -> "Verse"
    return secs.get(base, rules.get('default', {}))


def spread_words(text, seg_bars, patterns):
    """譜下方歌詞：從換和弦那一拍開始，一個字放一拍往右排，字多於拍數時最後一拍放剩下的全部。
    回傳要加進歌詞列的音節，並在 bar['rhythm'] 標出哪些拍有字。"""
    words = [w.replace('-', '+') for w in text.split()]
    slots = []   # (bar, 格) 依序可以放字的拍
    for bar in seg_bars:
        pat = patterns[bar['pattern']]
        for start, ln, token in pat['events']:
            if token is not None:
                slots.append((bar, start))
    if not slots:
        return []
    if len(words) > len(slots):
        words = words[:len(slots) - 1] + ['+'.join(words[len(slots) - 1:])]
    used = {}
    for (bar, start), _ in zip(slots, words):
        used.setdefault(id(bar), (bar, set()))[1].add(start)
    for bar, starts in used.values():
        length = patterns[bar['pattern']]['length']
        unit = patterns[bar['pattern']]['unit']
        bar['rhythm'] = (''.join('x' if i in starts else '.' for i in range(length)), unit)
    return words


def arrange(song_json, sections, lyrics_mode):
    rules = song_json.get('txt', {})
    patterns = {k: J.parse_pattern(k, v) for k, v in song_json['patterns'].items()}
    default = rules.get('default', {'bars': 1, 'pattern': 'low'})
    counts = {}
    for sec in sections:
        counts[sec['name']] = counts.get(sec['name'], 0) + 1
    seen = {}
    bars = []
    syllables = []
    for sec in sections:
        name = sec['name']
        label = name
        if name and counts[name] > 1:
            seen[name] = seen.get(name, 0) + 1
            label = f'{name} {seen[name]}'
        rule = {**default, **rule_for(rules, name)} if name else default
        sec_start = len(bars)
        for seg in sec['segs']:
            r = rule
            if seg['alone'] and 'whenAlone' in rule:
                r = {**rule, **rule['whenAlone']}
            n = 1 if seg['split'] else (seg['bars'] or r.get('bars', 1))   # 一小節多和弦固定 1 小節
            seg_bars = []
            for b in range(n):
                bar = {
                    'chord': seg['chord'],
                    'pattern': J.pick_pattern(r.get('pattern', 'low'), seg['chord'], b),
                    'marker': label if len(bars) == sec_start else None,
                    'text': {}, 'rhythm': None, 'split': seg['split'],
                }
                bars.append(bar)
                seg_bars.append(bar)
            if seg is sec['segs'][-1] and 'lastBar' in rule:
                seg_bars[-1]['pattern'] = rule['lastBar']
            if seg['text'] and lyrics_mode != 'none':
                if lyrics_mode == 'under':
                    syllables.extend(spread_words(seg['text'], seg_bars, patterns))
                else:
                    seg_bars[0]['text'] = {0: seg['text']}
    return bars, syllables


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description='和弦譜 txt + JSON 規則 → .gp5')
    ap.add_argument('txt')
    ap.add_argument('out', nargs='?')
    ap.add_argument('--json', '-j', help='JSON（預設與 txt 同名）')
    ap.add_argument('--tempo', type=int, help='覆蓋 JSON 的 tempo')
    ap.add_argument('--lyrics', choices=['text', 'under', 'none'],
                    help='歌詞放法：text = 和弦那一拍上方、靠左對齊；under = 譜下方歌詞列，從和弦那一拍開始一拍一個字；none = 不放歌詞（預設看 JSON 的 txt.lyrics）')
    a = ap.parse_args()

    base = os.path.splitext(a.txt)[0]
    jpath = a.json or base + '.json'
    if not os.path.exists(jpath):
        sys.exit(f'找不到 {jpath}，請用 --json 指定')
    with open(jpath, encoding='utf-8') as f:
        song_json = json.load(f)
    if a.tempo:
        song_json['meta']['tempo'] = a.tempo
    out = a.out or base + '.gp5'
    lyrics_mode = a.lyrics or song_json.get('txt', {}).get('lyrics', 'text')

    try:
        known = {c for sh in song_json['shapes'].values() for c in sh}
        sections = parse_txt(a.txt, known)
        bars, syllables = arrange(song_json, sections, lyrics_mode)
        song, _, n_bars = J.build(song_json, None, ('txt', bars, syllables))
        gp.write(song, out, encoding=song_json['meta'].get('encoding', 'cp1252'))
    except J.SongError as e:
        sys.exit(f'錯誤: {e}')
    except gp.GPException as e:
        if 'encode' in str(e):
            sys.exit('錯誤: 有文字無法用目前編碼寫入（GP5 不支援中文，請改用英文或拿掉）')
        raise
    print(f'{out}  ({n_bars} 小節, {song.tempo} BPM, 歌詞: {lyrics_mode})')
    for sec in sections:
        print(f'  {sec["name"] or "(無段落名)"}: '
              f'{" ".join("|" + " ".join(s["split"]) + "|" if s["split"] else s["chord"] for s in sec["segs"])}')


if __name__ == '__main__':
    main()
