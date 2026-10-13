#!/usr/bin/env python3
"""Align a guitar score (.gp/.gp5/.gpx/.alphatex) to a recording (.mp3/.wav/...) and write the sync JSON
the practice page reads (start bar, delay, bpm, and one sync point per beat).

Method (Müller et al., synctoolbox): the score's notes give pitch features directly; the recording gives
pitch features from a filter bank. Both become quantized chroma plus decaying onset features (DLNCO),
the best transposition is picked (detuned / capo / half-step-down recordings), then memory-restricted
multiscale DTW finds the warping path. Bar and beat times are read off that path.

usage: python3 align.py SCORE AUDIO [-o OUT.json]
       python3 align.py FOLDER     (every score with a same-named audio file next to it)
"""
import argparse, json, os, subprocess, sys, numpy as np, pandas as pd, librosa
from synctoolbox.dtw.mrmsdtw import sync_via_mrmsdtw
from synctoolbox.dtw.utils import compute_optimal_chroma_shift, shift_chroma_vectors, make_path_strictly_monotonic
from synctoolbox.feature.chroma import pitch_to_chroma, quantize_chroma, quantized_chroma_to_CENS
from synctoolbox.feature.dlnco import pitch_onset_features_to_DLNCO
from synctoolbox.feature.pitch import audio_to_pitch_features
from synctoolbox.feature.pitch_onset import audio_to_pitch_onset_features
from synctoolbox.feature.utils import estimate_tuning
from synctoolbox.feature.csv_tools import df_to_pitch_features, df_to_pitch_onset_features

HERE = os.path.dirname(os.path.abspath(__file__))
FS, RATE = 22050, 50

def score_notes(score, notes_json, need_sections=False):
    if notes_json and os.path.exists(notes_json):
        d = json.load(open(notes_json, encoding='utf-8'))
        if not need_sections or any('section' in b for b in d['bars']): return d   # older cache without section names: read the score again
    out = notes_json or os.path.splitext(score)[0] + '.notes.json'
    subprocess.run(['node', os.path.join(HERE, 'score2notes.mjs'), score, out], check=True)
    return json.load(open(out, encoding='utf-8'))

def refine(pts, d, ca, oa, cs, os_, a0, s0, lam, span=1.2, step=0.02, perc=None, flux=None, son=None, w_beat=0.0, w_onset=0.0, anchors=None):
    """Second pass over the beats. DTW alone can slip by whole beats inside long stretches of identical strumming
    (every shift fits equally well). Here every beat may move up to `span` seconds from the DTW estimate; each
    candidate is scored by how well the score's features for that beat match the recording there, plus a penalty
    for changing the beat length away from the local tempo (a running median of the DTW beat lengths, which ignores
    the slips). Viterbi picks the steadiest path that still matches the music.
    Extra evidence (optional): `perc` is the drum/percussive onset strength of the recording and `flux` the general
    onset strength, both 0..1 per feature frame. A beat candidate that lands on a drum hit gets a bonus (w_beat), and
    if the score has a note starting on that beat, landing on any onset gets a bonus too (w_onset). `anchors` maps
    beat index -> recording time the user is sure about; those beats may only move a few hundredths of a second."""
    Fa = np.vstack([ca, oa]); Fs = np.vstack([cs, os_])
    Fa = Fa / (np.linalg.norm(Fa, axis=0, keepdims=True) + 1e-9); Fs = Fs / (np.linalg.norm(Fs, axis=0, keepdims=True) + 1e-9)
    bars = {b['bar']: b for b in d['bars']}
    def score_time(p):
        b = bars[p[0]]; i = d['bars'].index(b); t1 = d['bars'][i + 1]['time'] if i + 1 < len(d['bars']) else d['end']
        return b['time'] + (t1 - b['time']) * p[1]
    st = np.array([score_time(p) for p in pts] + [d['end']]); dt = np.array([p[2] for p in pts], float)
    n = len(pts); iv = np.diff(np.append(dt, dt[-1] + (dt[-1] - dt[-2] if n > 1 else 0.5)))
    from scipy.ndimage import median_filter
    ref = median_filter(iv, size=17, mode='nearest')            # local beat length without the slips
    sdur = np.diff(st); ratio = ref / np.maximum(sdur, 1e-3)    # audio seconds per score second, locally
    offs = np.arange(-span, span + 1e-9, step); K = len(offs)
    E = np.zeros((n, K))
    for i in range(n):
        f0, f1 = int((st[i] - s0) * RATE), int((st[i + 1] - s0) * RATE)
        if f1 <= f0 or f0 < 0 or f1 > Fs.shape[1]: continue
        S = Fs[:, f0:f1]; L = f1 - f0
        if not S.any(): continue                                  # silent beat in the score: no evidence
        for k, o in enumerate(offs):
            ta = dt[i] + o; g0 = (ta - a0) * RATE; idx = (g0 + np.arange(L) * ratio[i]).astype(int)
            if idx[0] < 0 or idx[-1] >= Fa.shape[1]: E[i, k] = 1.0; continue
            E[i, k] = 1.0 - float(np.mean(np.sum(S * Fa[:, idx], axis=0)))
    Ec = E.copy()
    if perc is not None or flux is not None:
        def peak(env, ta):                                       # strongest onset within +-1 frame of each candidate
            f = np.round((ta - a0) * RATE).astype(int); v = np.zeros(len(f))
            for dd in (-1, 0, 1):
                g = np.clip(f + dd, 0, len(env) - 1); v = np.maximum(v, np.where((f + dd >= 0) & (f + dd < len(env)), env[g], 0))
            return v
        for i in range(n):
            ta = dt[i] + offs
            if perc is not None and w_beat: E[i] += w_beat * (1 - peak(perc, ta))
            if flux is not None and w_onset and son is not None and son[i]: E[i] += w_onset * (1 - peak(flux, ta))
    if anchors:
        for i, t in anchors.items():
            far = np.abs(dt[i] + offs - t) > 0.04
            if far.all(): far[np.argmin(np.abs(dt[i] + offs - t))] = False
            E[i, far] += 1e3
    T = np.empty((n, K)); B = np.zeros((n, K), int); T[0] = E[0]
    for i in range(1, n):
        prev = dt[i - 1] + offs; cur = dt[i] + offs
        dev = (cur[:, None] - prev[None, :] - ref[i - 1]) / max(ref[i - 1], 0.05)   # [cur, prev]
        tot = T[i - 1][None, :] + lam * dev ** 2 + np.where(cur[:, None] <= prev[None, :], 1e6, 0)
        B[i] = np.argmin(tot, axis=1); T[i] = tot[np.arange(K), B[i]] + E[i]
    k = int(np.argmin(T[-1])); path = [k]
    for i in range(n - 1, 0, -1): k = B[i, k]; path.append(k)
    path = path[::-1]
    conf = [None if not Fs[:, max(0,int((st[i]-s0)*RATE)):max(0,int((st[i+1]-s0)*RATE))].any() else round(1 - float(Ec[i, path[i]]), 3) for i in range(n)]
    return [[p[0], p[1], round(float(dt[i] + offs[path[i]]), 3)] for i, p in enumerate(pts)], conf

STEM_NAMES = ('vocals', 'drums', 'bass', 'guitar', 'piano', 'other')

def get_stems(a):
    """Split the recording into instruments with Demucs (or read stems you made with another tool, e.g. UVR or Moises).
    Returns {name: mono signal at FS} or None. Demucs results are kept in a '<song>.stems' folder next to the recording,
    so a second run of the same song does not separate it again."""
    folder = a.stems or (os.path.splitext(a.audio)[0] + '.stems')
    def load(folder):
        out = {}
        if not os.path.isdir(folder): return out
        for f in os.listdir(folder):
            stem, ext = os.path.splitext(f)
            if ext.lower() in ('.wav', '.flac', '.mp3', '.ogg', '.m4a') and stem.lower() in STEM_NAMES + ('no_vocals',):
                out[stem.lower()] = librosa.load(os.path.join(folder, f), sr=FS, mono=True)[0]
        return out
    st = load(folder)
    if st or a.stems: return st or None
    if not a.separate: return None
    print(f'separating instruments with Demucs ({a.demucs_model}); the first run downloads the model, a 4-minute song takes a few minutes ...')
    import importlib.util
    if importlib.util.find_spec('demucs') is None: raise SystemExit('Demucs is not installed. In this environment run: pip install demucs')
    tmp = folder + '.tmp'
    cmd = [sys.executable, '-m', 'demucs', '-n', a.demucs_model, '-o', tmp, a.audio]
    try: subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        raise SystemExit(f'Demucs failed ({e}). If the error above mentions torchcodec or saving audio, run: pip install torchcodec\n'
                         'or separate the song with another tool (UVR, Moises ...) and pass the folder with --stems')
    src = os.path.join(tmp, a.demucs_model, os.path.splitext(os.path.basename(a.audio))[0])
    if not os.path.isdir(src):    # demucs may shorten / clean the track name
        subs = [os.path.join(tmp, a.demucs_model, d) for d in os.listdir(os.path.join(tmp, a.demucs_model))]
        src = subs[0] if subs else src
    os.makedirs(folder, exist_ok=True)
    for f in os.listdir(src): os.replace(os.path.join(src, f), os.path.join(folder, f))
    import shutil; shutil.rmtree(tmp, ignore_errors=True)
    print('stems saved in', folder)
    return load(folder) or None

def find_ends(y, notes, s0, s1, lo, hi, win=25.0):
    """Where does the score's first (and last) stretch of music sit in the recording? Coarse chroma at 10 frames/s is
    compared at every start time and a few tempo ratios. Keeps DTW from having to swallow intros, applause, count-ins
    or a long fade, which it handles badly because it must map start to start and end to end."""
    R = 10; hop = FS // R
    ca = librosa.feature.chroma_cqt(y=y, sr=FS, hop_length=hop); ca = ca / (np.linalg.norm(ca, axis=0, keepdims=True) + 1e-9)
    T = int((s1 - s0) * R) + 1; cs = np.zeros((12, T))
    for n in notes:
        cs[n['pitch'] % 12, int((n['start'] - s0) * R):max(int((n['start'] - s0) * R) + 1, int((min(n['end'], n['start'] + 2) - s0) * R))] += n['velocity'] / 127
    from scipy.ndimage import uniform_filter1d
    cs = uniform_filter1d(cs, 10, axis=1); ca = uniform_filter1d(ca, 10, axis=1)
    # transposed recordings (capo, half-step-down tuning): rotate the score's chroma to the key of the recording
    hs, ha = cs.sum(axis=1), ca.sum(axis=1)
    rot = int(np.argmax([np.dot(np.roll(hs, k), ha) / (np.linalg.norm(hs) * np.linalg.norm(ha) + 1e-9) for k in range(12)]))
    cs = np.roll(cs, rot, axis=0)
    cs = cs / (np.linalg.norm(cs, axis=0, keepdims=True) + 1e-9); ca = ca / (np.linalg.norm(ca, axis=0, keepdims=True) + 1e-9)
    W = min(int(win * R), T); dur = ca.shape[1] / R
    def best(seg, t_from, t_to, backwards):
        cand = []
        for sc in np.arange(0.85, 1.151, 0.05):
            idx_rel = np.arange(W) * sc
            for t0 in np.arange(t_from, t_to, 0.1):
                fr = (t0 * R + (-idx_rel[::-1] if backwards else idx_rel)).astype(int)
                if fr.min() < 0 or fr.max() >= ca.shape[1]: continue
                cand.append((float(np.mean(np.sum(seg * ca[:, fr], axis=0))), t0))
        if not cand: return (-1, None)
        top = max(v for v, _ in cand)
        # songs repeat their opening later on (often fuller, with the band in): if the music right where the sound
        # begins already matches reasonably, start there; only skip ahead when the beginning clearly is not the score
        near = [(v, t) for v, t in cand if abs(t - (t_to if backwards else t_from)) <= 4.0]
        if near and max(v for v, _ in near) >= top - 0.10:
            vn = max(v for v, _ in near); return (vn, min(t for v, t in near if v >= vn - 0.02))
        ok = [t for v, t in cand if v >= top - 0.03]
        return (top, max(ok) if backwards else min(ok))
    st = best(cs[:, :W], max(0, lo - 1), min(dur, lo + 30), False)
    en = best(cs[:, T - W:], max(0, hi - 60), min(dur, hi + 1), True)
    return st, en

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('score'); ap.add_argument('audio', nargs='?'); ap.add_argument('-o', '--out')
    ap.add_argument('--notes', help='cached note list from score2notes.mjs')
    ap.add_argument('--no-refine', action='store_true', help='skip the beat-level smoothing pass')
    ap.add_argument('--smooth', type=float, default=4.0, help='how strongly the second pass prefers a steady beat')
    ap.add_argument('--steps', default='1.5,1.5,2.0', help='DTW step weights vertical,horizontal,diagonal')
    ap.add_argument('--silence-db', type=float, default=35, help='how far below the loud parts counts as silence when trimming (dB)')
    ap.add_argument('--ref', metavar='BAR|SECTION', help="align from a clear spot instead of the very beginning, e.g. --ref Verse or --ref 22 (for songs that open with drums, noise or a free intro)")
    ap.add_argument('--separate', action='store_true', help='split the recording into instruments with Demucs first (pip install demucs); slower, more accurate on real songs')
    ap.add_argument('--demucs-model', default='htdemucs_6s', help='Demucs model: htdemucs_6s (has a guitar stem, default), htdemucs, htdemucs_ft')
    ap.add_argument('--stems', metavar='FOLDER', help='use stems you already have (vocals/drums/bass/guitar/piano/other .wav) instead of running Demucs')
    ap.add_argument('--save-backing', action='store_true', help='with stems: also write SONG-no-guitar.wav (everything except the guitar)')
    ap.add_argument('--no-find-start', action='store_true', help='do not search for where the music starts and ends; use the loudness trim only')
    ap.add_argument('--no-auto-start', action='store_true', help='do not pin the first note to the first onset of the music')
    ap.add_argument('--no-hpss', action='store_true', help='do not split drums from the rest before matching pitches')
    ap.add_argument('--beat-weight', type=float, default=0.6, help='how much drum hits pull the beats onto them (0 = ignore drums)')
    ap.add_argument('--onset-weight', type=float, default=0.4, help='how much note onsets in the recording pull beats that start a note')
    ap.add_argument('--anchor', action='append', default=[], metavar='BAR=SEC',
                    help='a bar whose start time in the recording you know, e.g. --anchor 2=0.5 --anchor 34=118.2 (repeatable)')
    ap.add_argument('--click', metavar='FILE', help='also write the recording with a click on every aligned beat (.wav), to check by ear')
    ap.add_argument('--channels', help='only use these MIDI channels from the score, e.g. 0,1 (default: all)')
    a = ap.parse_args()
    if os.path.isdir(a.score):
        SC = ('.gp', '.gp3', '.gp4', '.gp5', '.gpx', '.alphatex'); AU = ('.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac')
        files = os.listdir(a.score); done = 0
        for f in sorted(files):
            stem, ext = os.path.splitext(f)
            if ext.lower() not in SC: continue
            au = next((g for g in files if os.path.splitext(g)[0] == stem and os.path.splitext(g)[1].lower() in AU), None)
            if not au: print('skip', f, '(no audio with the same name)'); continue
            a2 = argparse.Namespace(**vars(a)); a2.score = os.path.join(a.score, f); a2.audio = os.path.join(a.score, au)
            a2.out = os.path.join(a.score, stem + '.json'); a2.notes = None; run(a2); done += 1
        print('aligned', done, 'song(s)'); return
    if not a.audio: ap.error('give an audio file, or a folder instead of the score')
    run(a)

SECTION_WORDS = {'主歌': 'verse', '副歌': 'chorus', '前奏': 'intro', '間奏': 'interlude', '尾奏': 'outro', '橋段': 'bridge', '獨奏': 'solo', 'solo': 'solo'}

def ref_bar(ref, bars):
    """--ref: a bar number, or a section name from the score ('Verse', 'Chorus 2', '主歌' ...); the first match wins."""
    if ref is None: return None
    if str(ref).isdigit(): return int(ref)
    want = str(ref).strip().lower(); n = 1
    import re
    m = re.match(r'^(.*?)\s*(\d+)$', want)
    if m and not any((b.get('section') or '').lower() == want for b in bars): want, n = m.group(1), int(m.group(2))
    for zh, en in SECTION_WORDS.items(): want = want.replace(zh, en)
    hits = [b['bar'] for b in bars if want and want in (b.get('section') or '').lower()]
    if len(hits) < n:
        names = ', '.join(f"{b['section']} (bar {b['bar']})" for b in bars if b.get('section'))
        raise SystemExit(f'--ref {ref}: no such section in the score. Sections: {names or "none - use a bar number"}')
    return hits[n - 1]

def run(a):
    d = score_notes(a.score, a.notes, need_sections=bool(a.ref) and not str(a.ref).isdigit())
    notes = d['notes']
    if a.channels:
        keep = {int(c) for c in a.channels.split(',')}; notes = [n for n in notes if n['channel'] in keep]
    # crop silence: score from its first note to its last note, recording from first to last sound.
    # Leading/trailing silence (count-in bars, intros without guitar, fade-outs) otherwise lets DTW slide.
    s0 = min(n['start'] for n in notes); s1 = max(n['end'] for n in notes)
    df = pd.DataFrame({'start': [n['start'] - s0 for n in notes], 'duration': [max(0.05, n['end'] - n['start']) for n in notes],
                       'pitch': [n['pitch'] for n in notes], 'velocity': [n['velocity'] / 127 for n in notes],
                       'instrument': ['guitar'] * len(notes)})

    audio_full, _ = librosa.load(a.audio, sr=FS, mono=True)
    stems = get_stems(a)
    if stems:
        n_ = len(audio_full); fit = lambda y: np.pad(y, (0, max(0, n_ - len(y))))[:n_]
        stems = {k: fit(v) for k, v in stems.items()}
        # what the score describes: guitar(s) plus the other pitched instruments; never the singer, never the drums
        pitched = [k for k in ('guitar', 'piano', 'other', 'bass') if k in stems] or (['no_vocals'] if 'no_vocals' in stems else [])
        music_full = sum(stems[k] for k in pitched) if pitched else audio_full
        drums_full = stems.get('drums')
        print('using stems:', ', '.join(sorted(stems)), '-> pitch from', '+'.join(pitched) or 'full mix', '| beats from', 'drums' if drums_full is not None else 'full mix')
        if a.save_backing and 'guitar' in stems:
            import soundfile as sf
            back = sum(v for k, v in stems.items() if k not in ('guitar', 'no_vocals'))
            dst_b = os.path.splitext(a.audio)[0] + '-no-guitar.wav'
            sf.write(dst_b, np.clip(back, -1, 1), FS); print('wrote', dst_b, '(the song without the guitar, to play along with)')
    else:
        music_full, drums_full = audio_full, None
    rms = librosa.feature.rms(y=audio_full, frame_length=2048, hop_length=512)[0]
    ref = np.percentile(rms, 95) + 1e-12                           # 'loud' = the loud parts of the song, not one peak
    loud = np.where(20 * np.log10(rms / ref + 1e-12) > -a.silence_db)[0]
    a0 = max(0, loud[0] * 512 / FS - 0.05) if len(loud) else 0.0
    a1 = min(len(audio_full) / FS, (loud[-1] + 4) * 512 / FS) if len(loud) else len(audio_full) / FS
    (vs, ts_), (ve, te_) = find_ends(music_full, notes, s0, s1, a0, a1) if not a.no_find_start else ((0, None), (0, None))
    # only trust a clear match, and only cut away what the loudness trim already called a lead-in / tail
    if ts_ is not None and vs > 0.5 and ts_ - 1.0 > a0: a0 = ts_ - 1.0
    # (the end is left to the loudness trim: outros repeat, so a match near the end is often an earlier repeat)
    # tighten the start onto the first real onset after it (DTW maps the first note to the first frame it is given)
    if not a.no_auto_start:
        hop0 = FS // RATE; seg = audio_full[int(a0 * FS):int(min(a1, a0 + 12) * FS)]
        if len(seg) > FS:
            e0 = librosa.onset.onset_strength(y=seg, sr=FS, hop_length=hop0)
            pk0 = librosa.util.peak_pick(e0, pre_max=3, post_max=3, pre_avg=10, post_avg=10, delta=0.3 * float(np.percentile(e0, 99)), wait=5)
            r0 = librosa.feature.rms(y=audio_full, frame_length=2048, hop_length=hop0)[0]; thr = np.percentile(r0, 95) * 10 ** (-25 / 20)
            off = int(a0 * FS / hop0)
            pk0 = [p for p in pk0 if (r0[off + p + 2:off + p + 12] > thr).any()]
            if pk0 and pk0[0] * hop0 / FS > 0.8: a0 = a0 + pk0[0] * hop0 / FS - 0.5
    if ts_ is not None: print(f'music found from {a0:.2f}s to {a1:.2f}s of the recording (start match {vs:.2f})')
    audio = audio_full[int(a0 * FS):int(a1 * FS)]
    # drums vs. the rest: pitches are matched on the harmonic part (drums only blur chroma); the drum part and the
    # overall onset strength are kept as timing evidence for the beat pass
    seg = lambda y: y[int(a0 * FS):int(a1 * FS)]
    if stems:
        harm = seg(music_full); perc_y = seg(drums_full) if drums_full is not None else librosa.effects.hpss(audio, margin=2.0)[1]
    else:
        harm, perc_y = (audio, None) if a.no_hpss else librosa.effects.hpss(audio, margin=2.0)
    hop = FS // RATE
    def onset_env(y):
        if y is None: return None
        e = librosa.onset.onset_strength(y=y, sr=FS, hop_length=hop)
        from scipy.ndimage import maximum_filter1d
        loc = maximum_filter1d(e, size=int(3 * RATE)) + 1e-9          # 0..1 relative to the strongest hit nearby
        return np.clip(e / loc, 0, 1)
    perc = onset_env(perc_y) if a.beat_weight > 0 else None
    flux = onset_env(harm if stems else audio) if a.onset_weight > 0 else None
    tuning = estimate_tuning(harm, FS)
    f_pitch_a = audio_to_pitch_features(f_audio=harm, Fs=FS, tuning_offset=tuning, feature_rate=RATE, verbose=False)
    f_onset_a = audio_to_pitch_onset_features(f_audio=harm, Fs=FS, tuning_offset=tuning, verbose=False)
    f_pitch_s = df_to_pitch_features(df, feature_rate=RATE)
    f_onset_s = df_to_pitch_onset_features(df)

    chroma_a = quantize_chroma(pitch_to_chroma(f_pitch_a))
    chroma_s = quantize_chroma(pitch_to_chroma(f_pitch_s))
    dlnco_a = pitch_onset_features_to_DLNCO(f_peaks=f_onset_a, feature_rate=RATE, feature_sequence_length=chroma_a.shape[1], visualize=False)
    dlnco_s = pitch_onset_features_to_DLNCO(f_peaks=f_onset_s, feature_rate=RATE, feature_sequence_length=chroma_s.shape[1], visualize=False)
    shift = compute_optimal_chroma_shift(quantized_chroma_to_CENS(chroma_a, 201, 50, RATE)[0], quantized_chroma_to_CENS(chroma_s, 201, 50, RATE)[0])
    chroma_s = shift_chroma_vectors(chroma_s, shift); dlnco_s = shift_chroma_vectors(dlnco_s, shift)

    wp = sync_via_mrmsdtw(f_chroma1=chroma_a, f_onset1=dlnco_a, f_chroma2=chroma_s, f_onset2=dlnco_s,
                          input_feature_rate=RATE, step_weights=np.array([float(x) for x in a.steps.split(',')]), threshold_rec=10 ** 6, verbose=False)
    wp = make_path_strictly_monotonic(wp)
    t_audio, t_score = wp[0] / RATE + a0, wp[1] / RATE + s0
    dtw_audio = lambda ts: np.interp(ts, t_score, t_audio)
    # anchors the user knows (bar -> seconds): shift the DTW result so it passes through them, linearly in between
    bars = d['bars']; btime = {b['bar']: b['time'] for b in bars}; anchors = {}
    for s_ in a.anchor:
        k, v = s_.split('='); anchors[int(k)] = float(v)
    # the first note of the score = the first clear onset of the music (DTW and the beat pass can both settle one
    # beat off in repetitive patterns; the very start is the one place where there is no ambiguity)
    sb = max([b['bar'] for b in bars if b['time'] <= s0 + 1e-6] or [1])
    rb = ref_bar(a.ref, bars)
    if rb is not None:
        # the user's reference point (e.g. the first bar of the verse) is somewhere the music is clear, so DTW is
        # trusted there. The part before it is aligned again backwards from it with a free end, which tells where the
        # score's first note really is (a drum intro, count-in or noise before the music is simply left over). Then
        # the whole song is aligned again from there, so the first bars are not stretched over the drums.
        if rb not in btime: raise SystemExit(f'--ref: the score has no bar {rb}')
        tr = btime[rb]; t_ref = float(dtw_audio(tr))
        steps_w = np.array([float(x) for x in a.steps.split(',')])
        def dtw_from(cut):
            w_ = make_path_strictly_monotonic(sync_via_mrmsdtw(f_chroma1=chroma_a[:, cut:], f_onset1=dlnco_a[:, cut:], f_chroma2=chroma_s,
                         f_onset2=dlnco_s, input_feature_rate=RATE, step_weights=steps_w, threshold_rec=10 ** 6, verbose=False))
            ta, ts2 = w_[0] / RATE + a0 + cut / RATE, w_[1] / RATE + s0
            return lambda ts: np.interp(ts, ts2, ta)
        # bars from the first note up to the reference, and a few after it for the local tempo
        ib = [b['bar'] for b in bars if sb <= b['bar'] <= rb + 8 and b['bar'] in btime]
        def uneven(f):
            st_ = np.array([float(f(btime[b])) for b in ib]); sc_ = np.array([btime[b] for b in ib])
            r_ = np.diff(st_) / np.maximum(np.diff(sc_), 1e-6); nb = [b for b in ib[:-1]]
            after = [r_[i] for i, b in enumerate(nb) if b >= rb]; before = [r_[i] for i, b in enumerate(nb) if b < rb]
            if not after or not before: return 0.0
            ref_r = float(np.median(after))
            lb = np.abs(np.log(np.maximum(before, 1e-3) / ref_r))
            return float(np.mean(lb) + 0.5 * np.mean(lb[:8])) + abs(float(f(tr)) - t_ref)
        # where does the score's first note go? try the clear onsets before the reference and keep the start that
        # gives the most even first bars (a start on a drum fill or noise stretches the opening bars)
        ja = int((t_ref - a0) * RATE); dur_s = tr - s0
        pk = librosa.util.peak_pick(flux[:ja], pre_max=3, post_max=3, pre_avg=10, post_avg=10, delta=0.2, wait=int(0.15 * RATE)) if flux is not None else []
        pk = [p for p in pk if 0.75 * dur_s <= (ja - p) / RATE <= 1.35 * dur_s]
        pk = sorted(sorted(pk, key=lambda p: -flux[p])[:12])
        best = (uneven(dtw_audio), 0, dtw_audio)
        for p in pk:
            cut = max(0, p - 2)
            f = dtw_from(cut); u = uneven(f)
            if u < best[0] - 0.01: best = (u, cut, f)
        cut, dtw_audio = best[1], best[2]
        if cut:
            chroma_a, dlnco_a = chroma_a[:, cut:], dlnco_a[:, cut:]
            perc = perc[cut:] if perc is not None else None; flux = flux[cut:] if flux is not None else None
            a0 = a0 + cut / RATE
        t_ref = float(dtw_audio(tr))
        if flux is not None:      # tighten the reference onto the nearest onset
            i0 = int((t_ref - a0) * RATE); w = int(0.25 * RATE)
            lo_, hi_ = max(0, i0 - w), min(len(flux), i0 + w + 1)
            if hi_ > lo_:
                j = lo_ + int(np.argmax(flux[lo_:hi_]))
                if flux[j] > 0.5: t_ref = a0 + j / RATE
        if rb not in anchors: anchors[rb] = round(t_ref, 3)
        name = next((b.get('section') for b in bars if b['bar'] == rb and b.get('section')), None)
        print(f'reference: bar {rb}' + (f' ({name})' if name else '') + f' at {anchors[rb]:.2f}s; first note of the score at {float(dtw_audio(s0)):.2f}s')
    if rb is None and not a.no_auto_start and sb not in anchors and abs(btime[sb] - s0) < 0.02 and flux is not None:
        env = librosa.onset.onset_strength(y=audio, sr=FS, hop_length=hop)
        pk = librosa.util.peak_pick(env, pre_max=3, post_max=3, pre_avg=10, post_avg=10, delta=0.3 * float(np.percentile(env, 99)), wait=5)
        r2 = librosa.feature.rms(y=audio, frame_length=2048, hop_length=hop)[0]; loud2 = r2 > np.percentile(r2, 95) * 10 ** (-25 / 20)
        pk = [p for p in pk if loud2[min(len(loud2) - 1, p + 2):min(len(loud2), p + 12)].any()]   # an onset that is followed by real sound, not noise
        if len(pk):
            t_on = a0 + pk[0] * hop / FS
            if abs(t_on - dtw_audio(s0)) < 2.0 or (ts_ is not None and vs > 0.5 and abs(t_on - ts_) < 2.0):
                anchors[sb] = round(float(t_on), 3); print(f'music starts at {t_on:.2f}s -> bar {sb}')
    if anchors:
        ak = sorted(k for k in anchors if k in btime); ax = [btime[k] for k in ak]; ad = [anchors[k] - dtw_audio(btime[k]) for k in ak]
        # outside the anchors the correction fades out over ~10 s of score: one anchor fixes its neighbourhood, not the whole song
        ax = [ax[0] - 10] + ax + [ax[-1] + 10]; ad = [0.0] + ad + [0.0]; ax = np.array(ax); ad = np.array(ad)
        to_audio = lambda ts: dtw_audio(ts) + np.interp(ts, ax, ad)
        print('anchors:', ', '.join(f'bar {k} at {anchors[k]:.2f}s (DTW said {dtw_audio(btime[k]):.2f}s)' for k in ak))
    else:
        to_audio = dtw_audio

    # one point per beat: bars carry their own length, so walk each bar in quarter-note steps
    pts = []
    for i, b in enumerate(bars):
        t0 = b['time']; t1 = bars[i + 1]['time'] if i + 1 < len(bars) else d['end']
        steps = max(1, round((t1 - t0) / (60 / d['tempo'])))
        for k in range(steps):
            pts.append([b['bar'], round(k / steps, 4), round(float(to_audio(t0 + (t1 - t0) * k / steps)), 3)])
    conf = None
    if not a.no_refine:
        on = np.sort(np.array([n['start'] for n in notes]))
        def st_of(p):
            i = [b['bar'] for b in bars].index(p[0]); t1 = bars[i + 1]['time'] if i + 1 < len(bars) else d['end']
            return bars[i]['time'] + (t1 - bars[i]['time']) * p[1]
        sts = np.array([st_of(p) for p in pts]); j = np.searchsorted(on, sts)
        son = [any(0 <= jj < len(on) and abs(on[jj] - t) < 0.03 for jj in (j[i] - 1, j[i])) for i, t in enumerate(sts)]
        aidx = {i: anchors[p[0]] for i, p in enumerate(pts) if p[1] == 0 and p[0] in anchors}
        pts, conf = refine(pts, d, chroma_a, dlnco_a, chroma_s, dlnco_s, a0, s0, a.smooth, perc=perc, flux=flux, son=son,
                           w_beat=a.beat_weight, w_onset=a.onset_weight, anchors=aidx)
    # after the score's last note (a final ringing chord, empty closing bars) there is nothing to align to and the
    # recording often stops early: carry on at the tempo of the bars before instead of squeezing them into the fade
    blist = [b['bar'] for b in bars]
    def st_pt(p):
        i = blist.index(p[0]); t1 = bars[i + 1]['time'] if i + 1 < len(bars) else d['end']
        return bars[i]['time'] + (t1 - bars[i]['time']) * p[1]
    last_on = max(n['start'] for n in notes); sp = [st_pt(p) for p in pts]
    k = max([i for i, t in enumerate(sp) if t <= last_on + 1e-6] or [0])
    k0 = max([i for i, t in enumerate(sp) if t <= sp[k] - 16 * 60 / d['tempo']] or [0])
    if k < len(pts) - 1 and k - k0 >= 4 and sp[k] > sp[k0]:
        r = (pts[k][2] - pts[k0][2]) / (sp[k] - sp[k0])
        for i in range(k + 1, len(pts)): pts[i][2] = round(pts[k][2] + (sp[i] - sp[k]) * r, 3)
    # bars squeezed to almost nothing: the recording probably does not have them (a repeat or intro left out),
    # or the start was found in the wrong place. Say so, and list them for checking.
    squeezed = []
    if len(pts) > 8:
        rate = np.array([(pts[i + 1][2] - pts[i][2]) for i in range(len(pts) - 1)])
        med = float(np.median(rate[rate > 0])) if (rate > 0).any() else 0
        for i, r in enumerate(rate):
            if med and r < 0.25 * med and pts[i][0] >= sb and pts[i][0] not in squeezed: squeezed.append(pts[i][0])
    # an uneven opening (bars much longer/shorter than the bars after them) usually means the start was put on a
    # drum fill or noise before the music: suggest starting from a clear section instead
    if rb is None:
        bstart = {p[0]: p[2] for p in pts if p[1] == 0}; bl = [bstart[b + 1] - bstart[b] for b in sorted(bstart) if b + 1 in bstart]
        bs = sorted(bstart); head = [bstart[b + 1] - bstart[b] for b in bs[:-1] if sb <= b < sb + 8 and b + 1 in bstart]
        medl = float(np.median(bl)) if bl else 0
        if medl and head and max(abs(x / medl - 1) for x in head) > 0.2:
            secs = [b.get('section') for b in bars if b.get('section') and b['bar'] > sb + 4]
            print(f'WARNING: the first bars come out uneven - the start may sit on a drum fill or noise. Try --ref {secs[0] if secs else "BAR"}'
                  ' (a bar number or section name where the music is clear), or --anchor %d=SEC' % sb)
    if squeezed:
        print('WARNING: bars squeezed almost to nothing:', ', '.join(map(str, squeezed)),
              '- the recording may leave these out, or the start was found in the wrong place (try --anchor BAR=SEC)')
    # keep the points strictly increasing in time (DTW can flatten through silences)
    for i in range(1, len(pts)):
        if pts[i][2] <= pts[i - 1][2]: pts[i][2] = round(pts[i - 1][2] + 0.001, 3)

    first = next((n['start'] for n in notes), 0.0)
    start_bar = max([b['bar'] for b in bars if b['time'] <= first + 1e-6] or [1])
    t_start = next(p[2] for p in pts if p[0] == start_bar and p[1] == 0)
    # bars before the first note (count-in bars) carry no evidence: extend them backwards at the tempo of the first played bar
    bt = {b['bar']: b['time'] for b in bars}
    nxt = next((p[2] for p in pts if p[0] == start_bar + 1 and p[1] == 0), None)
    if nxt and start_bar + 1 in bt:
        r = (nxt - t_start) / max(1e-3, bt[start_bar + 1] - bt[start_bar])
        for p in pts:
            if p[0] < start_bar:
                i = [b['bar'] for b in bars].index(p[0]); t1 = bars[i + 1]['time']
                p[2] = round(t_start - (bt[start_bar] - (bt[p[0]] + (t1 - bt[p[0]]) * p[1])) * r, 3)
    sem = int((12 - shift) % 12); sem = sem - 12 if sem > 6 else sem
    # bars where the recording does not look like the score: worth a listen (different arrangement, a wrong slip ...)
    weak = sorted(squeezed)
    if conf:
        per = {}
        for p, c in zip(pts, conf):
            if c is not None: per.setdefault(p[0], []).append(c)
        bm = {b: float(np.mean(v)) for b, v in per.items()}
        if bm:
            lim = min(0.5, np.percentile(list(bm.values()), 10))
            weak = sorted(set(b for b, v in bm.items() if v < lim) | set(squeezed))
    if a.click:
        import soundfile as sf
        y = audio_full.copy(); tt = np.arange(int(0.04 * FS)) / FS
        for p in pts:
            if p[2] < 0: continue
            c = 0.5 * np.sin(2 * np.pi * (2000 if p[1] == 0 else 1000) * tt) * np.exp(-tt * 60) * (1 if p[1] == 0 else 0.6)
            i0 = int(p[2] * FS); L = min(len(c), len(y) - i0)
            if L > 0: y[i0:i0 + L] += c[:L]
        sf.write(a.click, np.clip(0.8 * y, -1, 1), FS); print('wrote', a.click, '(high click = bar start, low = beat)')
    out = {'start': start_bar, 'delay': round(-t_start, 3), 'bpm': d['tempo'], 'syncPoints': pts,
           'aligned': {'audio_from': round(a0, 3), 'audio': os.path.basename(a.audio),
                       'method': 'synctoolbox MrMsDTW (chroma + DLNCO)' + (' on separated stems' if stems else '' if a.no_hpss else ' on the harmonic part')
                                 + ('' if a.no_refine else ', beat pass with drum/onset evidence'),
                       'transposition': sem, 'tuning_cents': round(float(tuning), 1),
                       'anchors': {str(k): v for k, v in anchors.items()} or None, 'check_bars': weak}}
    dst = a.out or os.path.splitext(a.audio)[0] + '.json'
    json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'wrote {dst}: {len(pts)} sync points, bar {start_bar} starts at {t_start:.2f}s'
          + (f', recording is {sem:+d} semitone(s) from the score' if sem else ''))
    if weak: print('worth a listen (recording differs most from the score):', ', '.join(map(str, weak)))

if __name__ == '__main__': main()
