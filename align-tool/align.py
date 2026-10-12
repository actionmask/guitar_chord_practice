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

def score_notes(score, notes_json):
    if notes_json and os.path.exists(notes_json): return json.load(open(notes_json, encoding='utf-8'))
    out = notes_json or os.path.splitext(score)[0] + '.notes.json'
    subprocess.run(['node', os.path.join(HERE, 'score2notes.mjs'), score, out], check=True)
    return json.load(open(out, encoding='utf-8'))

def refine(pts, d, ca, oa, cs, os_, a0, s0, lam, span=1.2, step=0.02):
    """Second pass over the beats. DTW alone can slip by whole beats inside long stretches of identical strumming
    (every shift fits equally well). Here every beat may move up to `span` seconds from the DTW estimate; each
    candidate is scored by how well the score's features for that beat match the recording there, plus a penalty
    for changing the beat length away from the local tempo (a running median of the DTW beat lengths, which ignores
    the slips). Viterbi picks the steadiest path that still matches the music."""
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
    T = np.empty((n, K)); B = np.zeros((n, K), int); T[0] = E[0]
    for i in range(1, n):
        prev = dt[i - 1] + offs; cur = dt[i] + offs
        dev = (cur[:, None] - prev[None, :] - ref[i - 1]) / max(ref[i - 1], 0.05)   # [cur, prev]
        tot = T[i - 1][None, :] + lam * dev ** 2 + np.where(cur[:, None] <= prev[None, :], 1e6, 0)
        B[i] = np.argmin(tot, axis=1); T[i] = tot[np.arange(K), B[i]] + E[i]
    k = int(np.argmin(T[-1])); path = [k]
    for i in range(n - 1, 0, -1): k = B[i, k]; path.append(k)
    path = path[::-1]
    return [[p[0], p[1], round(float(dt[i] + offs[path[i]]), 3)] for i, p in enumerate(pts)]

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('score'); ap.add_argument('audio', nargs='?'); ap.add_argument('-o', '--out')
    ap.add_argument('--notes', help='cached note list from score2notes.mjs')
    ap.add_argument('--no-refine', action='store_true', help='skip the beat-level smoothing pass')
    ap.add_argument('--smooth', type=float, default=4.0, help='how strongly the second pass prefers a steady beat')
    ap.add_argument('--steps', default='1.5,1.5,2.0', help='DTW step weights vertical,horizontal,diagonal')
    ap.add_argument('--silence-db', type=float, default=40, help='how far below the peak counts as silence when trimming (dB)')
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

def run(a):
    d = score_notes(a.score, a.notes)
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
    rms = librosa.feature.rms(y=audio_full, frame_length=2048, hop_length=512)[0]
    loud = np.where(20 * np.log10(rms / (rms.max() + 1e-12) + 1e-12) > -a.silence_db)[0]
    a0 = max(0, loud[0] * 512 / FS - 0.05) if len(loud) else 0.0
    a1 = min(len(audio_full) / FS, (loud[-1] + 4) * 512 / FS) if len(loud) else len(audio_full) / FS
    audio = audio_full[int(a0 * FS):int(a1 * FS)]
    tuning = estimate_tuning(audio, FS)
    f_pitch_a = audio_to_pitch_features(f_audio=audio, Fs=FS, tuning_offset=tuning, feature_rate=RATE, verbose=False)
    f_onset_a = audio_to_pitch_onset_features(f_audio=audio, Fs=FS, tuning_offset=tuning, verbose=False)
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
    to_audio = lambda ts: np.interp(ts, t_score, t_audio)

    # one point per beat: bars carry their own length, so walk each bar in quarter-note steps
    bars = d['bars']; pts = []
    for i, b in enumerate(bars):
        t0 = b['time']; t1 = bars[i + 1]['time'] if i + 1 < len(bars) else d['end']
        steps = max(1, round((t1 - t0) / (60 / d['tempo'])))
        for k in range(steps):
            pts.append([b['bar'], round(k / steps, 4), round(float(to_audio(t0 + (t1 - t0) * k / steps)), 3)])
    if not a.no_refine:
        pts = refine(pts, d, chroma_a, dlnco_a, chroma_s, dlnco_s, a0, s0, a.smooth)
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
    out = {'start': start_bar, 'delay': round(-t_start, 3), 'bpm': d['tempo'], 'syncPoints': pts,
           'aligned': {'audio_from': round(a0, 3), 'method': 'synctoolbox MrMsDTW (chroma + DLNCO)', 'audio': os.path.basename(a.audio),
                       'transposition': sem, 'tuning_cents': round(float(tuning), 1)}}
    dst = a.out or os.path.splitext(a.audio)[0] + '.json'
    json.dump(out, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'wrote {dst}: {len(pts)} sync points, bar {start_bar} starts at {t_start:.2f}s'
          + (f', recording is {sem:+d} semitone(s) from the score' if sem else ''))

if __name__ == '__main__': main()
