#!/usr/bin/env python3
"""和弦進行 + 固定刷法 → Guitar Pro 5 (.gp5)，TuxGuitar 可直接開啟。

用法:
    python3 chords2gp.py song.txt [out.gp5] [--chords song.json] [--tempo 75] [--pattern "..."]

和弦按法、速度、刷法都寫在 json（預設找與 txt 同名的 .json，再找 chords.json）：
    {
      "title": "That Should Be Me",
      "tempo": 75,
      "pattern": "D4 D8 U8 D4 D8 U8",
      "chords": { "Em": "022000", "C": "x32010", "F": "133211" }
    }
txt 裡只認 json 定義過的和弦；寫了沒定義的和弦會直接報錯，告訴你要補哪個。

song.txt 可以直接貼一般的和弦譜（和弦在上、歌詞在下），也可用簡寫，兩者可混用：
    [Verse]
    Em          C              G    D
    everybody's laughin' in my mind
    [Chorus] G D Em C x2
    每個和弦 = 一小節，和弦正下方那段歌詞會掛在該小節第一拍上。
    行尾 xN 表示整行重複 N 次；同一小節放兩個和弦用 +，例如 G+D。
    # 開頭是註解，整行括號（例如 (repeat 4x)）會略過。

刷法 pattern：D=下刷 U=上刷 R=休止，數字=音符時值（4=四分、8=八分、16=十六分）。
"""
import argparse
import re

import guitarpro as gp

import json
import os

# 由 load_config() 從 json 載入；弦序：第 1 弦（高音 E）→ 第 6 弦（低音 E），-1 = 不彈
SHAPES = {}


def parse_shape(name, spec):
    """和弦按法，吉他譜常見寫法：由第 6 弦（低音 E）寫到第 1 弦，x = 不彈。
    例：C = "x32010"、F = "133211"；把位超過 9 用空白或逗號分開，例："x 10 12 12 12 10"。"""
    if isinstance(spec, list):
        toks = [str(t) for t in spec]
    elif re.search(r"[\s,]", spec.strip()):
        toks = re.split(r"[\s,]+", spec.strip())
    else:
        toks = list(spec.strip())
    if len(toks) != 6:
        raise SystemExit(f"json 裡 {name} 的按法要剛好 6 弦：{spec}")
    frets = [-1 if t.lower() == "x" else int(t) for t in toks]
    return list(reversed(frets))  # 轉成第 1 弦 → 第 6 弦


def load_config(path, shape_set=None):
    """讀和弦定義。支援兩種 json：
    1. chords2gp 格式：{"chords": {"C": "x32010", ...}, "tempo": ..., "pattern": ...}
    2. json2gp 格式：{"shapes": {"open": {"C": [0,1,0,2,3,null], ...}}, "meta": {...}}
       （和弦取 shapes 裡的第一組，或用 --shapes 指定；弦序已是第 1 弦 → 第 6 弦）
    """
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    SHAPES.clear()
    if cfg.get("chords"):
        for name, spec in cfg["chords"].items():
            SHAPES[name] = parse_shape(name, spec)
        return cfg
    if cfg.get("shapes"):
        sets = cfg["shapes"]
        key = shape_set or next(iter(sets))
        if key not in sets:
            raise SystemExit(f"{path} 的 shapes 裡沒有 \"{key}\"，可用：{', '.join(sets)}")
        for name, frets in sets[key].items():
            if len(frets) != 6:
                raise SystemExit(f"{path} 裡 {key}.{name} 的按法要剛好 6 弦：{frets}")
            SHAPES[name] = [-1 if f is None else int(f) for f in frets]
        meta = cfg.get("meta", {})
        cfg.setdefault("title", meta.get("title"))
        cfg.setdefault("tempo", meta.get("tempo"))
        print(f"（json2gp 格式，使用 shapes.{key} 的和弦）")
        return cfg
    raise SystemExit(f"{path} 裡沒有 \"chords\"，也沒有 \"shapes\"")


CHORD_RE = re.compile(r"[A-G][#b]?(m|maj|min|dim|aug|sus|add|\d)*(/[A-G][#b]?)?")
HEADER_RE = re.compile(r"^\s*\[(.+?)\]\s*(.*)$")


def _chord_tokens(line):
    toks = line.split()
    if toks and re.fullmatch(r"x\d+", toks[-1]):
        toks = toks[:-1]
    return [c for t in toks for c in t.split("+")]


def is_chord_line(line, lineno=None):
    """整行都是 json 裡定義的和弦才算和弦行。
    看起來像和弦、但有 json 沒定義的名字 → 直接報錯，避免被當成歌詞默默吃掉。"""
    names = _chord_tokens(line)
    if not names:
        return False
    if all(n in SHAPES for n in names):
        return True
    if all(n in SHAPES or CHORD_RE.fullmatch(n) for n in names):
        missing = sorted({n for n in names if n not in SHAPES})
        where = f"第 {lineno} 行" if lineno else ""
        raise SystemExit(f"{where}和弦 {', '.join(missing)} 沒有在 json 的 \"chords\" 裡定義：{line.strip()}")
    return False


def split_lyric(lyric, cols):
    """依和弦所在的欄位切歌詞；切點落在單字中間時，往後移到下一個字開頭。"""
    cuts = []
    for c in cols:
        c = min(c, len(lyric))
        while 0 < c < len(lyric) and lyric[c - 1] != " " and lyric[c] != " ":
            c += 1
        cuts.append(c)
    lead = lyric[: cuts[0]].strip()
    parts = [lyric[a:b].strip() for a, b in zip(cuts, cuts[1:] + [len(lyric)])]
    return lead, parts


def parse_song(path):
    """支援兩種寫法，可混用：
    1. 簡寫：  [Verse] Em C G D x3
    2. 和弦在上、歌詞在下（一般和弦譜）：
           Em          C              G    D
           everybody's laughin' in my mind
    回傳 [(和弦, 歌詞, 段落名稱或 None), ...]，一個元素 = 一小節。
    """
    lines = [l.rstrip("\n").replace("\t", "    ") for l in open(path, encoding="utf-8")]
    bars = []
    marker = None

    def add_text(idx, text, front=False):
        if not text:
            return
        ch, old, mk = bars[idx]
        new = (text + " " + old if front else old + " " + text).strip()
        bars[idx] = (ch, new, mk)

    i = 0
    while i < len(lines):
        line = lines[i]
        i += 1
        s = line.strip()
        if not s or s.startswith("#") or (s.startswith("(") and s.endswith(")")):
            continue
        m = HEADER_RE.match(line)
        if m:
            marker = m.group(1)
            if not m.group(2).strip():
                continue
            line = m.group(2)
            s = line.strip()
            if not is_chord_line(line, i):
                raise SystemExit(f"[{m.group(1)}] 後面不是和弦：{line}")
        if is_chord_line(line, i):
            toks = [(mt.start(), mt.group()) for mt in re.finditer(r"\S+", line)]
            rep = 1
            if re.fullmatch(r"x\d+", toks[-1][1]):
                rep = int(toks[-1][1][1:])
                toks = toks[:-1]
            # 下一行若是歌詞就吃進來
            lyric = ""
            if i < len(lines):
                nxt = lines[i].replace("\t", "    ")
                ns = nxt.strip()
                if ns and not HEADER_RE.match(nxt) and not is_chord_line(nxt, i + 1) \
                        and not (ns.startswith("(") and ns.endswith(")")):
                    lyric = nxt.rstrip()
                    i += 1
            compact = len(toks) > 1 and all(
                toks[k + 1][0] - (toks[k][0] + len(toks[k][1])) == 1 for k in range(len(toks) - 1))
            if not lyric:
                lead, parts = "", [""] * len(toks)
            elif compact:
                # 「Em C G D」這種擠在一起的和弦沒有對位意義，歌詞整句放第一個和弦
                lead, parts = "", [lyric.strip()] + [""] * (len(toks) - 1)
            else:
                lead, parts = split_lyric(lyric, [c for c, _ in toks])
            first = len(bars)
            for r in range(rep):
                for k, (_, t) in enumerate(toks):
                    bars.append((t, parts[k] if r == 0 else "", marker))
                    marker = None
            if lead:  # 和弦前面的歌詞（弱起）放到前一小節
                if first > 0:
                    add_text(first - 1, lead)
                else:
                    add_text(first, lead, front=True)
        else:
            # 沒有和弦的歌詞行：沿用上一個和弦，接在最後一小節
            if bars:
                add_text(len(bars) - 1, s)
    return bars


def parse_pattern(s):
    out = []
    for tok in s.split():
        m = re.fullmatch(r"([DUR])(\d+)", tok.upper())
        if not m:
            raise SystemExit(f"刷法格式錯誤：{tok}")
        out.append((m.group(1), int(m.group(2))))
    return out


def scale_pattern(pattern, factor):
    """把刷法時值縮短 factor 倍（一小節兩個和弦時用）。"""
    return [(d, v * factor) for d, v in pattern]


def build(bars, tempo, pattern, title):
    song = gp.Song()
    song.title = title
    song.tempo = tempo
    track = song.tracks[0]
    track.name = "Guitar"
    track.channel.instrument = 25  # Acoustic Guitar (steel)

    # 預設 Song 已有一個 measure header，先清空重建
    song.measureHeaders = []
    track.measures = []

    for bar_no, (bar, lyric, sec_name) in enumerate(bars, start=1):
        header = gp.MeasureHeader(number=bar_no, start=gp.Duration.quarterTime * 4 * (bar_no - 1) + gp.Duration.quarterTime)
        if sec_name:
            header.marker = gp.Marker(title=sec_name)
        song.addMeasureHeader(header)
        measure = gp.Measure(track, header)
        track.measures.append(measure)
        voice = measure.voices[0]

        chords = bar.split("+")
        pat = pattern if len(chords) == 1 else scale_pattern(pattern, len(chords))
        for ci, cname in enumerate(chords):
            frets = SHAPES[cname]
            for pi, (direction, value) in enumerate(pat):
                beat = gp.Beat(voice)
                beat.duration = gp.Duration(value=value)
                if ci == 0 and pi == 0 and lyric:
                    beat.text = lyric  # 歌詞放在小節第一拍的文字（TuxGuitar: Insert → Text）
                if direction == "R":
                    beat.status = gp.BeatStatus.rest
                else:
                    beat.status = gp.BeatStatus.normal
                    if pi == 0:
                        ch = gp.Chord(6)
                        ch.name = cname
                        ch.strings = list(frets)
                        ch.newFormat = True
                        played = [f for f in frets if f > 0]
                        ch.firstFret = min(played) if played and max(played) > 4 else 1
                        ch.sharp = True
                        ch.root = None
                        ch.type = None
                        ch.extension = None
                        ch.bass = None
                        ch.tonality = None
                        ch.add = False
                        ch.fifth = ch.ninth = ch.eleventh = None
                        ch.barres = []
                        ch.omissions = [True] * 7
                        ch.fingerings = []
                        ch.show = True
                        beat.effect.chord = ch
                    beat.effect.stroke = gp.BeatStroke(
                        direction=gp.BeatStrokeDirection.down if direction == "D" else gp.BeatStrokeDirection.up,
                        value=gp.Duration.sixteenth,
                    )
                    for s, f in enumerate(frets, start=1):
                        if f < 0:
                            continue
                        n = gp.Note(beat)
                        n.string = s
                        n.value = f
                        n.type = gp.NoteType.normal
                        beat.notes.append(n)
                voice.beats.append(beat)
    return song


def main():
    ap = argparse.ArgumentParser(description="和弦譜 txt + 和弦定義 json → .gp5")
    ap.add_argument("song", help="和弦譜 txt")
    ap.add_argument("out", nargs="?", help="輸出 .gp5（預設與 txt 同名）")
    ap.add_argument("--chords", "-c", help="和弦定義 json（預設：與 txt 同名的 .json，找不到再用同資料夾的 chords.json）")
    ap.add_argument("--tempo", type=int, help="覆蓋 json 的 tempo")
    ap.add_argument("--pattern", help="覆蓋 json 的 pattern")
    ap.add_argument("--title", help="覆蓋 json 的 title")
    ap.add_argument("--shapes", help="json2gp 格式時要用 shapes 裡的哪一組（預設第一組，例如 open）")
    a = ap.parse_args()

    base = os.path.splitext(a.song)[0]
    cfg_path = a.chords
    if not cfg_path:
        for cand in (base + ".json", os.path.join(os.path.dirname(a.song) or ".", "chords.json")):
            if os.path.exists(cand):
                cfg_path = cand
                break
    if not cfg_path:
        raise SystemExit("找不到和弦定義 json，請用 --chords 指定")
    cfg = load_config(cfg_path, a.shapes)

    tempo = a.tempo or cfg.get("tempo") or 75
    pattern = a.pattern or cfg.get("pattern", "D4 D8 U8 D4 D8 U8")
    title = a.title or cfg.get("title") or os.path.basename(base)
    out = a.out or base + ".gp5"

    bars = parse_song(a.song)
    song = build(bars, tempo, parse_pattern(pattern), title)
    gp.write(song, out)
    used = sorted({c for b, _, _ in bars for c in b.split("+")})
    print(f"和弦定義：{cfg_path}")
    print(f"寫出 {out}：{len(bars)} 小節，tempo {tempo}，刷法 {pattern}")
    print(f"用到的和弦：{' '.join(used)}")


if __name__ == "__main__":
    main()
