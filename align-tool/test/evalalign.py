import json,sys,numpy as np
a=json.load(open(sys.argv[1]));tr=dict((b,t) for b,t in json.load(open(sys.argv[2])))
est={p[0]:p[2] for p in a['syncPoints'] if p[1]==0}
err=np.array([est[b]-tr[b] for b in tr if b in est and b>=a['start']])
print('mean abs %.3f s, median %.3f, 95%% %.3f, max %.3f, within 0.1s: %d%%'%(np.abs(err).mean(),np.median(np.abs(err)),np.percentile(np.abs(err),95),np.abs(err).max(),100*np.mean(np.abs(err)<0.1)))
print('start bar',a['start'],'est %.3f truth %.3f'%(est[a['start']],tr[a['start']]))
if '-v' in sys.argv: print(' '.join('%d:%+.2f'%(b,est[b]-tr[b]) for b in sorted(tr) if b in est and abs(est[b]-tr[b])>0.1))
