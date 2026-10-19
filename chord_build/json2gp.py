#!/usr/bin/env python3
"""json2gp.py — 把 JSON 歌曲描述轉成 Guitar Pro 5 (.gp5)

用法:
    python3 json2gp.py song.json                 # 用 forms 裡的第一個（通常是 full）
    python3 json2gp.py song.json --form short    # 指定段落編排
    python3 json2gp.py song.json -o out.gp5

需要: pip install pyguitarpro
格式說明見 FORMAT.md
"""
import argparse
import json
import os
import sys

import guitarpro as gp
from guitarpro import models as m

QUARTER = 960  # Guitar Pro 一個四分音符的 tick 數

# 可以用單一音符表示的時值 (ticks -> (duration value, dotted))，由長到短
DURATIONS = [
    (3840, 1, False), (2880, 2, True), (1920, 2, False), (1440, 4, True),
    (960, 4, False), (720, 8, True), (480, 8, False), (360, 16, True),
    (240, 16, False), (120, 32, False),
]

STANDARD_TUNING = [64, 59, 55, 50, 45, 40]  # 1弦 E4 ... 6弦 E2


class SongError(Exception):
    pass


# ---------------------------------------------------------------- patterns
def parse_pattern(name, spec):
    """把 pattern 轉成 [(start_unit, len_units, token)]，token 為 None 表示休止。

    strum   : "steps": "UDUD-DDU"   每個字元一格
              D/U = 下刷/上刷, d/u = 輕刷, X = 悶音下刷, x = 悶音上刷
    arpeggio: "steps": ["B","3","2","3","-","3","2","3"]  每個元素一格
              B = 和弦最低音那條弦, 1~6 = 弦號, "23" = 2、3弦同時撥
    共通    : "-" = 延續前一格, "." = 休止
    """
    kind = spec.get('type', 'strum')
    steps = spec['steps']
    tokens = list(steps) if isinstance(steps, str) else list(steps)
    tokens = [t for t in tokens if t != ' ']  # 字串中的空白只當分隔
    events = []
    for i, t in enumerate(tokens):
        if t == '-':
            if not events:
                raise SongError(f'pattern "{name}" 不能以 "-" 開頭')
            s, ln, tok = events[-1]
            events[-1] = (s, ln + 1, tok)
        elif t == '.':
            events.append((i, 1, None))
        else:
            if kind == 'strum' and t not in 'DUduXx':
                raise SongError(f'pattern "{name}" 有不認得的刷法符號 "{t}"')
            events.append((i, 1, t))
    return {
        'kind': kind,
        'unit': spec.get('unit', 8),
        'events': events,
        'length': len(tokens),
        'up_strings': spec.get('upStrings', [1, 6]),      # 上刷彈哪幾條弦（含）
        'down_strings': spec.get('downStrings', [1, 6]),  # 下刷彈哪幾條弦（含）
        'let_ring': spec.get('letRing', False),
    }


# ---------------------------------------------------------------- song layout
def pick_pattern(rule, chord, bar_in_chord):
    """rule 可以是 "name"、{"Em":"low","*":"high"}、或每小節一個的 list。"""
    if isinstance(rule, list):
        rule = rule[bar_in_chord % len(rule)]
    if isinstance(rule, dict):
        if chord in rule:
            return rule[chord]
        if '*' in rule:
            return rule['*']
        raise SongError(f'pattern 對照表沒有 "{chord}"，也沒有 "*"')
    return rule


def expand_section(sec_name, sec):
    """回傳這個段落的 [(chord, pattern_name)]，每項一小節。"""
    bars = []
    for blk in sec['blocks']:
        chords = blk['chords']
        if isinstance(chords, str):
            chords = chords.split()
        for _ in range(blk.get('repeat', 1)):
            for c in chords:
                for b in range(blk.get('bars', 1)):
                    bars.append((c, pick_pattern(blk['pattern'], c, b)))
    if not bars:
        raise SongError(f'段落 "{sec_name}" 是空的')
    return bars


def layout(song_json, form_name):
    forms = song_json['forms']
    if form_name is None:
        form_name = next(iter(forms))
    if form_name not in forms:
        raise SongError(f'找不到 form "{form_name}"，可用: {", ".join(forms)}')
    bars = []  # dict(chord, pattern, marker, text, rhythm)
    syllables = []
    for entry in forms[form_name]:
        if isinstance(entry, str):
            entry = {'section': entry}
        sec_name = entry['section']
        if sec_name not in song_json['sections']:
            raise SongError(f'form "{form_name}" 用到不存在的段落 "{sec_name}"')
        sec_bars = expand_section(sec_name, song_json['sections'][sec_name])
        texts = {}
        for key, t in (entry.get('text') or {}).items():
            b, _, slot = str(key).partition('.')
            b, slot = int(b), int(slot or 1)
            if not 1 <= b <= len(sec_bars):
                raise SongError(f'{sec_name} 的文字位置 "{key}" 超出段落長度 {len(sec_bars)} 小節')
            texts.setdefault(b - 1, {})[slot - 1] = t
        lyr = entry.get('lyrics')
        rhythm, unit = [], 8
        if lyr:
            rhythm, unit = lyr.get('rhythm', []), lyr.get('unit', 8)
            if isinstance(rhythm, str):
                rhythm = rhythm.split('|')
            rhythm = [r.strip() for r in rhythm]
            if len(rhythm) > len(sec_bars):
                raise SongError(f'{entry.get("label", sec_name)} 的歌詞節奏有 {len(rhythm)} 小節，'
                                f'超過段落長度 {len(sec_bars)} 小節')
            n_notes = sum(1 for r in rhythm for ch in r if ch not in '-. ')
            sylls = split_syllables(lyr.get('text', ''))
            if len(sylls) != n_notes:
                print(f'注意: {entry.get("label", sec_name)} 歌詞有 {len(sylls)} 個音節，'
                      f'節奏有 {n_notes} 個音符，數量不同時字會對錯位置', file=sys.stderr)
            syllables.extend(sylls)
        for i, (c, p) in enumerate(sec_bars):
            bars.append({
                'chord': c, 'pattern': p,
                'marker': entry.get('label', sec_name) if i == 0 else None,
                'text': texts.get(i, {}),
                'rhythm': (rhythm[i], unit) if i < len(rhythm) and rhythm[i] else None,
            })
    return form_name, bars, syllables


# ---------------------------------------------------------------- GP building
def split_ticks(ticks):
    out = []
    for t, v, dot in DURATIONS:
        while ticks >= t:
            out.append((t, v, dot))
            ticks -= t
    if ticks:
        raise SongError('出現無法表示的時值，請檢查 unit 與拍號')
    return out


def bass_string(frets):
    for s in range(len(frets) - 1, -1, -1):
        if frets[s] is not None:
            return s + 1
    return None


def notes_for(pat, token, frets):
    """回傳 [(string_no, fret, note_type, velocity)]。"""
    n_str = len(frets)
    if pat['kind'] == 'strum':
        lo, hi = pat['up_strings'] if token in 'Uux' else pat['down_strings']
        dead = token in 'Xx'
        # 上下刷同一個力度（譜上不會出現 mf/f 交替）；只有輕刷 d/u 會變弱
        vel = m.Velocities.piano if token in 'du' else m.Velocities.forte
        return [(s + 1, 0 if dead else frets[s], m.NoteType.dead if dead else m.NoteType.normal, vel)
                for s in range(lo - 1, min(hi, n_str)) if frets[s] is not None]
    # arpeggio
    out = []
    for ch in token:
        if ch == 'B':
            s = bass_string(frets)
        elif ch.isdigit():
            s = int(ch)
        else:
            raise SongError(f'分解和弦符號 "{token}" 不認得')
        if s and s <= n_str and frets[s - 1] is not None:
            out.append((s, frets[s - 1], m.NoteType.normal, m.Velocities.forte))
    return out


def build(song_json, form_name, laid_out=None):
    """laid_out：已經排好的 (名稱, bars, syllables)，給 txt2gp 之類的前端用；沒給就照 forms 排。"""
    meta = song_json['meta']
    num, den = meta.get('timeSignature', [4, 4])
    bar_ticks = num * QUARTER * 4 // den

    patterns = {k: parse_pattern(k, v) for k, v in song_json['patterns'].items()}
    form_name, bars, syllables = laid_out or layout(song_json, form_name)

    song = gp.Song()
    song.title = meta.get('title', '')
    song.artist = meta.get('artist', '')
    song.subtitle = meta.get('subtitle', '')
    song.album = meta.get('album', '')
    song.words = meta.get('words', '')
    song.music = meta.get('music', '')
    song.tab = meta.get('tab', '')
    song.notice = meta.get('notice', [])
    song.tempo = meta.get('tempo', 120)
    song.measureHeaders = []

    # 版面：GP5 只能存整份譜的縮放比例（樂譜、文字、歌詞一起放大縮小）
    page = song_json.get('page', {})
    if 'scoreSize' in page:
        size = page['scoreSize']
        if not 50 <= size <= 300:
            raise SongError('page.scoreSize 請設在 50～300（百分比）')
        song.pageSetup.scoreSizeProportion = size / 100

    for i, bar in enumerate(bars):
        h = m.MeasureHeader()
        h.number = i + 1
        h.start = QUARTER + i * bar_ticks
        h.timeSignature = m.TimeSignature(numerator=num, denominator=m.Duration(value=den))
        h.tempo = song.tempo
        if bar['marker']:
            h.marker = m.Marker(title=bar['marker'], color=m.Color(200, 0, 0))
        song.measureHeaders.append(h)

    tracks_json = song_json['tracks']
    text_track = song_json.get('textTrack', 0)
    # 預設把歌詞直接掛在吉他軌（textTrack）下面；lyricsTrack.separate=true 才另外開一軌
    inline_lyrics = not song_json.get('lyricsTrack', {}).get('separate', False)
    lyric_beats = []  # [(小節, 這拍有沒有字)]，依序對應 Guitar Pro 分配音節的拍
    song.tracks = []
    for ti, tj in enumerate(tracks_json):
        shapes = song_json['shapes'][tj['shapes']]
        tuning = tj.get('tuning', song_json.get('tuning', STANDARD_TUNING))
        track = m.Track(song, number=ti + 1, name=tj.get('name', f'Track {ti + 1}'))
        track.strings = [m.GuitarString(s + 1, v) for s, v in enumerate(tuning)]
        track.channel = m.MidiChannel(channel=ti, effectChannel=ti,
                                      instrument=tj.get('instrument', 25))
        track.isMute = tj.get('mute', False)
        track.measures = []
        song.tracks.append(track)

        for bi, bar in enumerate(bars):
            split = bar.get('split') or [bar['chord']]   # 一小節多個和弦時平均分配
            for cname in split:
                if cname not in shapes:
                    raise SongError(f'指型組 "{tj["shapes"]}" 沒有和弦 "{cname}"（第 {bi + 1} 小節）')
            if bar['pattern'] not in patterns:
                raise SongError(f'第 {bi + 1} 小節用到不存在的 pattern "{bar["pattern"]}"')
            pat = patterns[bar['pattern']]
            unit_ticks = QUARTER * 4 // pat['unit']
            if pat['length'] * unit_ticks != bar_ticks:
                raise SongError(f'pattern "{bar["pattern"]}" 長度 {pat["length"]} 格，'
                                f'不等於一小節（{bar_ticks // unit_ticks} 格）')
            is_lyric_track = ti == text_track
            # 以 tick 表示的位置：小節上方文字、歌詞每個字開始的位置
            texts = {s * unit_ticks: t for s, t in bar['text'].items()} if is_lyric_track else {}
            onsets = set(onset_ticks(bar, bi)) if (is_lyric_track and inline_lyrics) else set()

            meas = m.Measure(track, song.measureHeaders[bi])
            voice = meas.voices[0]
            last_chord = None
            for start, ln, token in pat['events']:
                chord = split[start * len(split) // pat['length']]
                frets = shapes[chord]
                first = chord != last_chord      # 換和弦的那一拍標和弦圖
                last_chord = chord
                s_t, e_t = start * unit_ticks, (start + ln) * unit_ticks
                # 文字或歌詞落在延音中間，就在那裡切開（用連結線接上，聲音不變）
                inner = sorted(p for p in set(texts) | onsets if s_t < p < e_t)
                cuts = [s_t] + inner + [e_t]
                for j in range(len(cuts) - 1):
                    pos = cuts[j]
                    for k, (t, v, dot) in enumerate(split_ticks(cuts[j + 1] - cuts[j])):
                        tie = not (j == 0 and k == 0)
                        beat = m.Beat(voice)
                        beat.duration = m.Duration(value=v, isDotted=dot)
                        if k == 0 and pos in texts:
                            beat.text = texts[pos]
                        if is_lyric_track and inline_lyrics and token is not None:
                            # 有音的拍都會被 Guitar Pro 拿來放音節（休止符不算）
                            lyric_beats.append((bi, k == 0 and pos in onsets))
                        pos += t
                        if first:
                            c = m.Chord(len(frets))
                            c.name = chord
                            c.strings = [f if f is not None else -1 for f in frets]
                            pressed = [f for f in frets if f]
                            c.firstFret = min(pressed) if pressed and min(pressed) > 2 else 1
                            beat.effect.chord = c
                            first = False
                        if token is None:
                            beat.status = m.BeatStatus.rest
                        else:
                            beat.status = m.BeatStatus.normal
                            if pat['kind'] == 'strum' and not tie:
                                beat.effect.stroke = m.BeatStroke(
                                    m.BeatStrokeDirection.up if token in 'Uux'
                                    else m.BeatStrokeDirection.down, 32)
                            for s, f, ntype, vel in notes_for(pat, token, frets):
                                n = m.Note(beat)
                                n.string, n.value, n.velocity = s, f, vel
                                n.type = m.NoteType.tie if tie else ntype
                                if pat['let_ring']:
                                    n.effect.letRing = True
                                beat.notes.append(n)
                            if not beat.notes:
                                beat.status = m.BeatStatus.rest
                        voice.beats.append(beat)
            track.measures.append(meas)
    if syllables or any(b['rhythm'] for b in bars):
        if inline_lyrics:
            set_inline_lyrics(song, text_track, lyric_beats, syllables)
        else:
            build_lyrics_track(song, song_json, bars, syllables, bar_ticks)
    return song, form_name, len(bars)


def onset_ticks(bar, bi):
    """歌詞節奏裡每個字開始的位置（tick，小節內）。"""
    if not bar['rhythm']:
        return []
    steps, unit = bar['rhythm']
    steps = steps.replace(' ', '')
    unit_ticks = QUARTER * 4 // unit
    out = []
    for i, ch in enumerate(steps):
        if ch in JIANPU:
            out.append(i * unit_ticks)
        elif ch not in '-.':
            raise SongError(f'第 {bi + 1} 小節歌詞節奏有不認得的符號 "{ch}"')
    return out


def split_syllables(text):
    """'ba-by la' -> ['ba-', 'by', 'la']：空白和連字號都會分出音節，跟 Guitar Pro 一樣。"""
    import re
    return re.findall(r'[^\s-]+-?', text)


def set_inline_lyrics(song, track_idx, lyric_beats, syllables):
    """把歌詞掛在吉他軌上：有字的拍放音節，沒字的拍用多一個分隔符號留空。"""
    firsts = [bi for bi, has in lyric_beats if has]
    if not firsts:
        return
    first_bar = firsts[0]
    out, it, prev_hyphen = [], iter(syllables), False
    started = False
    for bi, has in lyric_beats:
        if bi < first_bar:
            continue
        if not has:                              # 空拍：多一個分隔符號
            out.append('-' if prev_hyphen else ' ')
            continue
        syl = next(it, None)
        if syl is None:
            break
        if started:
            out.append('-' if prev_hyphen else ' ')
        prev_hyphen = syl.endswith('-')
        out.append(syl[:-1] if prev_hyphen else syl)
        started = True
    text = ''.join(out).rstrip(' -')            # 最後一個字之後的空拍不用留
    song.lyrics = m.Lyrics(trackChoice=track_idx + 1,
                           lines=[m.LyricLine(startingMeasure=first_bar + 1, lyrics=text)]
                           + [m.LyricLine() for _ in range(4)])  # GP5 固定 5 行


# 簡譜（C 大調，中音）→ MIDI；x 代表不在意音高
JIANPU = {'1': 60, '2': 62, '3': 64, '4': 65, '5': 67, '6': 69, '7': 71, 'x': 67}


def place_on_guitar(midi, tuning):
    for s, open_note in enumerate(tuning):  # 從 1 弦（最高）往下找
        if 0 <= midi - open_note <= 24:
            return s + 1, midi - open_note
    raise SongError(f'音高 {midi} 在這個調音上找不到位置')


def build_lyrics_track(song, song_json, bars, syllables, bar_ticks):
    """加一軌靜音的歌詞軌：音符只用來讓歌詞一字一音對齊。"""
    cfg = song_json.get('lyricsTrack', {})
    tuning = song_json.get('tuning', STANDARD_TUNING)
    ti = len(song.tracks)
    track = m.Track(song, number=ti + 1, name=cfg.get('name', 'Lyrics'))
    track.strings = [m.GuitarString(s + 1, v) for s, v in enumerate(tuning)]
    silent = cfg.get('silent', True)
    track.channel = m.MidiChannel(channel=ti, effectChannel=ti,
                                  instrument=cfg.get('instrument', 53),  # 53 = Voice Oohs
                                  volume=0 if silent else 104)
    track.isMute = silent
    # 顯示方式：notation = 只有五線譜（預設，像一般歌詞譜）、tab = 只有六線譜、both = 兩者
    display = cfg.get('display', 'notation')
    if display not in ('notation', 'tab', 'both'):
        raise SongError('lyricsTrack.display 只能是 "notation"、"tab" 或 "both"')
    track.settings.notation = display in ('notation', 'both')
    track.settings.tablature = display in ('tab', 'both')
    track.measures = []
    song.tracks.append(track)

    for bi, bar in enumerate(bars):
        meas = m.Measure(track, song.measureHeaders[bi])
        voice = meas.voices[0]
        if bar['rhythm'] is None:
            beat = m.Beat(voice)
            beat.duration = m.Duration(value=1)
            beat.status = m.BeatStatus.rest
            voice.beats.append(beat)
        else:
            steps, unit = bar['rhythm']
            steps = steps.replace(' ', '')
            unit_ticks = QUARTER * 4 // unit
            if len(steps) * unit_ticks != bar_ticks:
                raise SongError(f'第 {bi + 1} 小節歌詞節奏 "{steps}" 有 {len(steps)} 格，'
                                f'不等於一小節（{bar_ticks // unit_ticks} 格）')
            events = []
            for ch in steps:
                if ch == '-':
                    if not events:
                        raise SongError(f'第 {bi + 1} 小節歌詞節奏不能以 "-" 開頭')
                    events[-1][1] += 1
                elif ch == '.' or ch in JIANPU:
                    events.append([ch, 1])
                else:
                    raise SongError(f'第 {bi + 1} 小節歌詞節奏有不認得的符號 "{ch}"')
            for ch, ln in events:
                for k, (t, v, dot) in enumerate(split_ticks(ln * unit_ticks)):
                    beat = m.Beat(voice)
                    beat.duration = m.Duration(value=v, isDotted=dot)
                    if ch == '.':
                        beat.status = m.BeatStatus.rest
                    else:
                        beat.status = m.BeatStatus.normal
                        s, f = place_on_guitar(JIANPU[ch], tuning)
                        n = m.Note(beat)
                        n.string, n.value = s, f
                        n.velocity = m.Velocities.forte
                        n.type = m.NoteType.tie if k > 0 else m.NoteType.normal
                        beat.notes.append(n)
                    voice.beats.append(beat)
        track.measures.append(meas)

    song.lyrics = m.Lyrics(trackChoice=ti + 1,
                           lines=[m.LyricLine(startingMeasure=1, lyrics=' '.join(syllables))]
                           + [m.LyricLine() for _ in range(4)])  # GP5 固定 5 行


def main():
    ap = argparse.ArgumentParser(description='JSON 歌曲描述 → Guitar Pro 5')
    ap.add_argument('json')
    ap.add_argument('--form', help='forms 裡的名稱（預設第一個）')
    ap.add_argument('-o', '--output')
    args = ap.parse_args()

    with open(args.json, encoding='utf-8') as f:
        song_json = json.load(f)
    try:
        song, form_name, n_bars = build(song_json, args.form)
        out = args.output or (os.path.splitext(args.json)[0] + f'_{form_name}.gp5')
        gp.write(song, out, encoding=song_json['meta'].get('encoding', 'cp1252'))
    except SongError as e:
        sys.exit(f'錯誤: {e}')
    except gp.GPException as e:
        if 'encode' in str(e):
            sys.exit('錯誤: 有文字無法用目前編碼寫入，請在 meta 加 "encoding"（例如 "big5"）')
        raise
    print(f'{out}  ({form_name}, {n_bars} 小節, {song.tempo} BPM)')


if __name__ == '__main__':
    main()
