# Builds a test "recording" from a score's notes with a known, uneven tempo and a lead-in,
# so the aligner can be checked against the true bar times.
import json, sys, numpy as np, soundfile as sf
d=json.load(open(sys.argv[1])); out=sys.argv[2]; sr=22050
lead=float(sys.argv[3]) if len(sys.argv)>3 else 3.2
end=d['end']
# warp: tempo drifts +-7% slowly, plus a sudden 0.6 s hold before bar 32 (a fermata-like breath)
ts=np.linspace(0,end,4000); rate=1+0.07*np.sin(ts/end*2*np.pi*2.3)+0.03*np.sin(ts/7.0)
aud=lead+np.concatenate([[0],np.cumsum(np.diff(ts)/rate[1:])])
hold_at=d['bars'][31]['time'] if len(d['bars'])>32 else end/2
aud=aud+np.where(ts>=hold_at,float(sys.argv[4]) if len(sys.argv)>4 else 0.6,0.0)
warp=lambda t:np.interp(t,ts,aud)
N=int((warp(end)+2)*sr); y=np.zeros(N,np.float32)
rng=np.random.default_rng(1)
for n in d['notes']:
    a,b=warp(n['start']),warp(n['end']); f=440*2**((n['pitch']-69)/12)
    L=int(min(b-a+0.25,2.5)*sr); t=np.arange(L)/sr; i0=int(a*sr)
    if i0+L>N: L=N-i0; t=t[:L]
    env=np.exp(-t*3.0)*np.minimum(1,t/0.004)
    sig=sum((0.6**k)*np.sin(2*np.pi*f*(k+1)*t+rng.uniform(0,6.28)) for k in range(5))
    y[i0:i0+L]+=(0.12*n['velocity']/127*env*sig).astype(np.float32)
y+=rng.normal(0,0.003,N).astype(np.float32)
y/=max(1e-6,np.abs(y).max())*1.1
sf.write(out,y,sr)
truth=[[b['bar'],float(warp(b['time']))] for b in d['bars']]
json.dump(truth,open(out+'.truth.json','w'))
print('wrote',out,round(N/sr,1),'s; bar2 at',round(truth[1][1],3),'bar32 at',round(truth[31][1],3))
