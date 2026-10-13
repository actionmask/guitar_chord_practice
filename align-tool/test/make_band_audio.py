# Builds a harder test "recording" than make_test_audio.py: the score's notes played with a plucked-string sound,
# plus a drum kit (kick/snare/hi-hat on the beat grid), a bass line, a wandering "voice" that is not in the score,
# small human timing jitter, an uneven tempo and a lead-in. The true bar times are written next to it.
# usage: python make_band_audio.py SONG.notes.json OUT.wav [lead_in_s] [hold_s] [seed] [STEM_FOLDER]
# With STEM_FOLDER the parts are also written separately (guitar/drums/bass/vocals.wav), like Demucs output.
import json, sys, numpy as np, soundfile as sf
d = json.load(open(sys.argv[1], encoding='utf-8')); out = sys.argv[2]; sr = 22050
lead = float(sys.argv[3]) if len(sys.argv) > 3 else 3.2
hold = float(sys.argv[4]) if len(sys.argv) > 4 else 0.6
rng = np.random.default_rng(int(sys.argv[5]) if len(sys.argv) > 5 else 1)
end = d['end']
ts = np.linspace(0, end, 4000); rate = 1 + 0.07 * np.sin(ts / end * 2 * np.pi * 2.3) + 0.03 * np.sin(ts / 7.0)
aud = lead + np.concatenate([[0], np.cumsum(np.diff(ts) / rate[1:])])
hold_at = d['bars'][31]['time'] if len(d['bars']) > 32 else end / 2
aud = aud + np.where(ts >= hold_at, hold, 0.0)
warp = lambda t: np.interp(t, ts, aud)
N = int((warp(end) + 2) * sr); y = np.zeros(N, np.float32)
parts = {k: np.zeros(N, np.float32) for k in ('guitar', 'drums', 'bass', 'vocals')}; part = ['guitar']

def add(sig, t0, gain):
    i0 = int(t0 * sr)
    if i0 < 0 or i0 >= N: return
    L = min(len(sig), N - i0); parts[part[0]][i0:i0 + L] += (gain * sig[:L]).astype(np.float32)

def pluck(f, dur):   # plucked string: harmonics that die away faster the higher they are, plus a short pick noise
    L = max(1, int(dur * sr)); t = np.arange(L) / sr; o = np.zeros(L)
    for k in range(1, 9):
        if f * k > sr / 2.2: break
        o += (0.7 ** (k - 1)) * np.sin(2 * np.pi * f * k * t * (1 + 0.0004 * k * k) + rng.uniform(0, 6.28)) * np.exp(-t * (2.5 + 1.5 * k))
    n = min(L, int(0.01 * sr)); o[:n] += rng.normal(0, 0.3, n) * np.linspace(1, 0, n)
    return o * np.minimum(1, t / 0.002)

cache = {}
for n in d['notes']:
    a = warp(n['start']) + rng.normal(0, 0.012)          # human timing jitter
    dur = min(warp(n['end']) - warp(n['start']) + 0.2, 1.6); key = (n['pitch'], round(dur, 1))
    if key not in cache: cache[key] = pluck(440 * 2 ** ((n['pitch'] - 69) / 12), key[1] or 0.1)
    add(cache[key], a, 0.10 * n['velocity'] / 127)

part[0] = 'drums'
t = np.arange(int(0.3 * sr)) / sr
kick = np.sin(2 * np.pi * (50 + 80 * np.exp(-t * 30)) * t) * np.exp(-t * 12)
snare = rng.normal(0, 1, len(t)) * np.exp(-t * 25) * 0.6 + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 20) * 0.4
hat = rng.normal(0, 1, int(0.05 * sr)) * np.exp(-np.arange(int(0.05 * sr)) / sr * 90)
hat = np.diff(hat, prepend=0)                            # brighter
first = min(n['start'] for n in d['notes']); q = 60 / d['tempo']
bt = first
while bt < end - 0.01:
    k = round((bt - first) / q)
    add(kick if k % 2 == 0 else snare, warp(bt) + rng.normal(0, 0.006), 0.35)
    add(hat, warp(bt) , 0.08); add(hat, warp(bt + q / 2), 0.05)
    bt += q
part[0] = 'bass'
# bass: lowest score note of each beat, an octave down, as a soft sine
for n in d['notes']:
    if abs(((n['start'] - first) / q) % 1) < 0.02:
        f = 440 * 2 ** ((n['pitch'] - 12 - 69) / 12); L = int(min(q, 0.6) * sr); tt = np.arange(L) / sr
        add(np.sin(2 * np.pi * f * tt) * np.exp(-tt * 4), warp(n['start']), 0.05)
# a "voice" that is not in the score: slow glides over the top
tt = np.arange(N) / sr; f = 330 * 2 ** (np.sin(tt / 3.1) * 0.4 + np.sin(tt / 1.3) * 0.15)
voice = np.sin(2 * np.pi * np.cumsum(f) / sr) * (0.5 + 0.5 * np.sin(tt / 2.2)) * (tt > lead + 8)
parts['vocals'] += (0.03 * voice).astype(np.float32)
for v in parts.values(): y += v
y += rng.normal(0, 0.004, N).astype(np.float32)
k = max(1e-6, np.abs(y).max()) * 1.1; y /= k
sf.write(out, y, sr)
if len(sys.argv) > 6:
    import os; os.makedirs(sys.argv[6], exist_ok=True)
    for name, v in parts.items(): sf.write(os.path.join(sys.argv[6], name + '.wav'), v / k, sr)
truth = [[b['bar'], float(warp(b['time']))] for b in d['bars']]
json.dump(truth, open(out + '.truth.json', 'w'))
print('wrote', out, round(N / sr, 1), 's; bar2 at', round(truth[1][1], 3))
