# Reads guitar tab pages exported from Guitar Pro as vector PDF (one teacher's layout: tab staff with rhythm stems
# below, chord names / section names / bar numbers above, numbered notation under it) and writes alphaTex.
import pymupdf as fitz, re, sys, json, collections
from fractions import Fraction as Fr
SECT=re.compile(r'^(Intro|Verse|Chorus|Bridge|Outro|Solo|Pre|Inter|Short|Ending|Break|Riff|Coda|前奏|主歌|副歌|尾奏|間奏|橋段|導歌)',re.I)
CHORD=re.compile(r'^[A-G][#b]?(m|maj|min|dim|aug|sus|add|M)*[0-9]*(sus[24])?(add[0-9]+)?(/[A-G][#b]?)?$')
def systems_of(p):
    hl=[];vl=[];fills=[];hs=[]
    for g in p.get_drawings():
        w=g.get('width') or 0
        if g['type']=='s':
            for it in g['items']:
                if it[0]!='l': continue
                a,b=it[1],it[2]
                if abs(a.y-b.y)<0.3 and abs(a.x-b.x)>1: hs.append((a.y,min(a.x,b.x),max(a.x,b.x),w))
                elif abs(a.x-b.x)>2 and abs(a.y-b.y)<0.45*abs(a.x-b.x) and w>0.6: hs.append(((a.y+b.y)/2,min(a.x,b.x),max(a.x,b.x),w))
                elif abs(a.x-b.x)<0.3 and abs(a.y-b.y)>3: vl.append((a.x,min(a.y,b.y),max(a.y,b.y),w))
        else:
            r=g['rect']; kinds=''.join(sorted(set(i[0] for i in g['items'])))
            fills.append((r.x0,r.y0,r.x1,r.y1,kinds,len(g['items'])))
    seen=[]
    for f in sorted(fills,key=lambda f:f[1]):
        if f[4]=='re' and f[2]-f[0]<4 and 25<f[3]-f[1]<45 and not any(abs(f[1]-a)<3 for a,b in seen): seen.append((f[1],f[3]))
    out=[]
    for a,b in seen:
        xs=[(x0,x1) for y,x0,x1,w in hs if a-1<y<b+1 and w<0.4]
        if xs: out.append({'y':[a+k*(b-a)/5 for k in range(6)],'x0':min(x for x,_ in xs),'x1':max(x for _,x in xs)})
    return out,vl,fills,hs
def merged_text(spans):
    # join a chord root with its accidental glyph and suffix (they are separate spans)
    sp=[[list(bb),t.replace('\ue260','b').replace('\ue262','#'),f,sz] for bb,t,f,sz in spans]
    acc=[x for x in sp if 'Bravura' in x[2]]; rest=[x for x in sp if 'Bravura' not in x[2]]
    for a in acc:
        cy=(a[0][1]+a[0][3])/2
        L=[x for x in rest if -2<a[0][0]-x[0][2]<4 and x[0][1]-6<cy<x[0][3]+6]
        if not L: continue
        l=L[0]; l[1]+=a[1]; l[0][2]=a[0][2]
        R=[x for x in rest if x is not l and -2<x[0][0]-a[0][2]<4 and abs((x[0][1]+x[0][3])/2-(l[0][1]+l[0][3])/2)<5]
        if R: l[1]+=R[0][1]; l[0][2]=R[0][0][2]; rest.remove(R[0])
    return [(tuple(x[0]),x[1],x[2],x[3]) for x in rest]
def convert(doc,pages,log):
    bars=[]
    for pn in pages:
        p=doc[pn]; systems,vl,fills,hs=systems_of(p)
        spans=[]
        for b in p.get_text('dict')['blocks']:
            for l in b.get('lines',[]):
                for s in l['spans']:
                    if s['text'].strip(): spans.append((s['bbox'],s['text'].strip(),s['font'],s['size']))
        for si,S in enumerate(systems):
            y0,y5=S['y'][0],S['y'][5]; gap=S['y'][1]-y0
            top=max(systems[si-1]['y'][5]+16 if si else 0,y0-80); bot=y5+40
            bl=[]
            for f in sorted(fills):
                if f[4]=='re' and abs(f[1]-y0)<1.5 and abs(f[3]-y5)<1.5 and f[2]-f[0]<4:
                    if not bl or f[0]-bl[-1][0]>7: bl.append([f[0],f[2]-f[0]])
                    else: bl[-1][1]=max(bl[-1][1],f[2]-f[0],f[2]-bl[-1][0])
            if not bl or bl[0][0]-S['x0']>6: bl=[[S['x0'],0.5]]+bl
            ev=[]
            def at(x,tol=2.6):
                for e in ev:
                    if abs(e['x']-x)<tol: return e
                e={'x':x,'notes':[],'stem':None,'rest':None,'fx':set()}; ev.append(e); return e
            notespans=[]
            for bb,t,f,sz in spans:
                cy=(bb[1]+bb[3])/2; cx=(bb[0]+bb[2])/2
                if y0-gap*0.6<cy<y5+gap*0.6 and S['x0']+8<cx<S['x1']+2 and re.fullmatch(r'\(?(\d+|X|x)\)?',t) and sz<9 and not f.startswith('AAAAA') | False and 'wdth' not in f and 'NeoI' not in f:
                    st=min(range(6),key=lambda k:abs(S['y'][k]-cy))+1
                    if abs(S['y'][st-1]-cy)>gap*0.45: continue
                    at(cx)['notes'].append({'s':st,'f':t.strip('()'),'tie':t.startswith('('),'small':False,'sz':sz,'x':cx})
            szs=collections.Counter(round(n['sz'],1) for e in ev for n in e['notes']); msz=szs.most_common(1)[0][0] if szs else 7
            for e in ev:
                for n in e['notes']: n['small']=n['sz']<msz*0.9
            sst=[s for s in vl if y5+10<s[2]<bot and s[1]>=y0-1.5 and S['x0']-2<s[0]<S['x1']+2 and s[3]<0.7]
            bots=collections.Counter(round(s[2]) for s in sst); mode=bots.most_common(1)[0][0] if bots else 0
            for s in sst: at(s[0])['stem']=(s[1],s[2])
            below=[f for f in fills if y5+1<f[1] and f[3]<bot+2]
            beams=[f for f in below if f[4]=='l' and f[2]-f[0]>2.5 and f[3]-f[1]<4]
            flags=[f for f in below if 'c' in f[4] and f[5]>=6 and f[3]-f[1]>8]
            dots=[f for f in below if f[2]-f[0]<3.2 and f[3]-f[1]<3.2 and 'c' in f[4]]
            for f in fills:   # rests drawn on the staff
                w,h=f[2]-f[0],f[3]-f[1]; cy=(f[1]+f[3])/2
                if not (y0-2<cy<y5+2 and S['x0']+14<f[0]) or 'l' not in f[4] or 'c' not in f[4]: 
                    if not (y0-2<cy<y5+2 and S['x0']+40<f[0] and f[4]=='re' and 3<w<7 and h<4): continue
                kind=None
                if f[5]==19: kind=Fr(1,2)
                elif f[5]==35: kind=Fr(1)
                elif f[5]==34: kind=Fr(1,4)
                elif f[5]==8 and h<4: kind=Fr(4) if (f[1]-y0)/gap<1.3 else Fr(2)
                elif f[4]=='re': kind=Fr(4) if (f[1]-y0)/gap<1.3 else Fr(2)
                if kind: at((f[0]+f[2])/2,3.2)['rest']=kind
            # tuplets
            tup=[]
            for bb,t,f,sz in spans:
                if t=='3' and 'Italic' in f and y5<bb[1]<bot+6:
                    segs=[h for h in hs if abs(h[0]-(bb[1]+bb[3])/2)<10 and h[3]>0.6]
                    L=[h for h in segs if -1<=bb[0]-h[2]<7]; R=[h for h in segs if -1<=h[1]-bb[2]<7]
                    if L and R: tup.append((min(h[1] for h in L),max(h[2] for h in R)))
                    else: tup.append((bb[0]-9,bb[2]+9))
            ev.sort(key=lambda e:e['x'])
            for e in ev:
                x=e['x']; d=None
                if e['rest'] and not e['notes'] and not e['stem']: d=e['rest']
                elif e['stem']:
                    nb=len(set(round(b[1]) for b in beams if b[0]-1.2<=x<=b[2]+1.2))
                    fl=[f for f in flags if abs(f[0]-x)<2]
                    if nb: d=Fr(1,2**nb)
                    elif fl: d=Fr(1,2) if fl[0][3]-fl[0][1]<15.6 and len(fl)==1 else Fr(1,4)
                    else: d=Fr(2) if e['stem'][0]>y5+6 else Fr(1)
                    if any(1.5<f[0]-x<8 and abs(f[1]-e['stem'][1])<9 for f in dots): e['fx'].add('d'); d=d*Fr(3,2)
                elif e['notes']:
                    d=None if all(n['small'] for n in e['notes']) else Fr(4)
                if d is not None and any(a-1.6<=x<=b+1.6 for a,b in tup): e['fx'].add('tu'); d=d*Fr(2,3)
                e['d']=d
            # annotations
            above=[s for s in spans if top<=(s[0][1]+s[0][3])/2<y0-0.5 and 'wdth' not in s[2] and 'NeoI' not in s[2] and 'lback' not in s[2]]
            labels=merged_text(above)
            S2={'page':pn,'sys':si,'y0':y0,'bl':bl,'ev':ev,'labels':labels,'x1':S['x1']}
            # split into bars
            xs=[b[0] for b in bl]+[S['x1']+5]
            for i in range(len(xs)-1):
                a,b=xs[i],xs[i+1]
                if b-a<12: continue
                evs=[e for e in ev if a+1<e['x']<b-0.5]
                lab=[l for l in labels if a-4<=l[0][0]<b-4]
                num=[int(l[1]) for l in lab if l[1].isdigit() and l[3]<7.6 and l[0][0]<a+6 and l[0][3]>y0-22]
                chords=[(l[0][0],re.sub(r'\s*\(.*$','',l[1])) for l in lab if CHORD.match(re.sub(r'\s*\(.*$','',l[1])) and not SECT.match(l[1]) and l[3]>7.5]
                sect=[l[1] for l in lab if SECT.match(l[1]) and l[3]>7.5]
                misc=[(round(l[0][0]),l[1]) for l in lab if l[1] in('H','P','sl.','P.M.','full','½','1½','fullfull','-1½','let ring') ]
                keyl=[l[1] for l in lab if re.fullmatch(r'[16]=[A-Ga-g][#b]?',l[1])]
                bars.append({'key':keyl[0] if keyl else None,'y0':y0,'page':pn+1,'sys':si+1,'num':num[0] if num else None,'x':(a,b),'thick':bl[i][1]>1.2,'ev':evs,'chords':chords,'sect':sect,'misc':misc})
    return bars
def tok(e,prev):
    D={Fr(4):'1',Fr(2):'2',Fr(1):'4',Fr(1,2):'8',Fr(1,4):'16',Fr(1,8):'32'}
    d=e['d']; base=d
    if 'tu' in e['fx']: base=base*Fr(3,2)
    if 'd' in e['fx']: base=base*Fr(2,3)
    fx=[]
    if 'd' in e['fx']: fx.append('d')
    if 'tu' in e['fx']: fx.append('tu 3')
    fx+=sorted(x for x in e['fx'] if x not in('d','tu'))
    if e.get('ch'): fx.append('ch "%s"'%e['ch'])
    if e.get('label'): fx.append('txt "%s"'%e['label'])
    if e['notes']:
        ns=[('-' if n['tie'] else ('x' if n['f'] in 'Xx' else n['f']))+'.'+str(n['s'])+('{'+' '.join(dict.fromkeys(n['fx'] if not n['tie'] else [x for x in n['fx'] if x in ('sod','sou')]))+'}' if n.get('fx') and (not n['tie'] or any(x in ('sod','sou') for x in n['fx'])) else '') for n in sorted(e['notes'],key=lambda n:n['s'])]
    elif e['stem'] and prev: ns=['-.'+str(n['s']) for n in sorted(prev,key=lambda n:n['s'])]
    else: ns=['r']
    body=ns[0] if len(ns)==1 else '('+' '.join(ns)+')'
    return body+'.'+D.get(base,'?%s'%base)+('{'+' '.join(fx)+'}' if fx else '')

BEND={'full':'b (0 4)','½':'b (0 2)','1/2':'b (0 2)','1½':'b (0 6)'}
def pm_extent(page,x,y):
    hs=systems_of(page)[3]
    segs=sorted((h[1],h[2]) for h in hs if abs(h[0]-y)<4 and h[1]>x-2)
    end=x+12
    for a,b in segs:
        if a-end<9: end=max(end,b)
        else: break
    return end
SP=6.9   # tab string spacing in these PDFs (pt)
_sl={}
def slide_lines(page):
    k=(id(page.parent),page.number)
    if k not in _sl:
        out=[]
        for d in page.get_drawings():
            w=d.get('width') or 0
            if not (0.5<w<0.9): continue
            for it in d['items']:
                if it[0]!='l': continue
                a,b=it[1],it[2]; dx=b.x-a.x; dy=b.y-a.y
                if 2.5<abs(dx)<7 and 2.5<abs(dy)<7: out.append((min(a.x,b.x),a.y,max(a.x,b.x),b.y,dx*dy>0))   # last: falls to the right (pitch goes down)
        _sl[k]=out
    return _sl[k]
def track(doc,pages,name,short,report):
    bars=convert(doc,range(pages[0]-1,pages[1]),None); lines=[]; prev=None; nfx=0
    for bi,B in enumerate(bars):
        ev=[e for e in B['ev']]
        page=doc[B['page']-1]
        # labels that sit above the staff: need y, so re-read from misc via page text
        for x,lab in B['misc']:
            real=[e for e in ev if e['d'] is not None]
            if lab in('H','P','sl.'):
                cand=[e for e in ev if e['x']<x+1 and e['notes']]
                if cand:
                    cand[-1]['label']=lab   # the letter printed above the tab staff; written as beat text so it shows in the same place
                    for n in cand[-1]['notes']: n.setdefault('fx',[]).append('h' if lab!='sl.' else 'sl'); nfx+=1
            elif lab in BEND or lab=='fullfull':
                cand=[e for e in real if e['x']<x+(9 if lab=='fullfull' else 3) and e['notes']]
                if lab=='fullfull' and len(cand)>=2:
                    for n in cand[-1]['notes']: n.setdefault('fx',[]).append('b (4 0)')
                    for n in cand[-2]['notes']: n.setdefault('fx',[]).append('b (0 4)')
                elif cand:
                    for n in cand[-1]['notes']: n.setdefault('fx',[]).append(BEND.get(lab,'b (0 4)'))
            elif lab=='P.M.':
                ys=[s for s in page.get_text('dict')['blocks']]
                y=None
                for b in ys:
                    for l in b.get('lines',[]):
                        for s in l['spans']:
                            if s['text'].strip()=='P.M.' and abs(s['bbox'][0]-x)<1.5 and B['y0']-60<s['bbox'][1]<B['y0']: y=(s['bbox'][1]+s['bbox'][3])/2; xe=s['bbox'][2]
                if y is None: continue
                end=pm_extent(page,xe,y)
                # a P.M. line may run on into later bars of the same system
                for B2 in bars[bi:]:
                    if B2['page']!=B['page'] or B2['sys']!=B['sys']: break
                    for e in B2['ev']:
                        if x-3<=e['x']<=end+2 and e['notes']:
                            for n in e['notes']: n.setdefault('fx',[]).append('pm')
        # slides drawn as a short diagonal stroke between two fret numbers (no "sl." text): slide from the note on the left
        for (lx0,ly0,lx1,ly1,down) in slide_lines(page):
            if not (B['x'][0]<lx0<B['x'][1] and B['y0']-3<(ly0+ly1)/2<B['y0']+40): continue
            ym=(ly0+ly1)/2; st=min(range(1,7),key=lambda k:abs(B['y0']+(k-1)*SP-ym))
            near=lambda e:[m for m in e['notes'] if m['s']==st]
            left=[e for e in ev if e['x']<lx0 and near(e)]
            right=[e for e in ev if e['x']>lx1 and near(e) and not all(m['tie'] for m in near(e))]
            # a stroke right in front of a note with nothing just before it = slide into that note (from below / above)
            if right and right[0]['x']-lx1<10 and (not left or lx0-left[-1]['x']>16):
                n=near(right[0])[0]; fx=n.setdefault('fx',[])
                if not any(x in fx for x in ('sib','sia')): fx.append('sia' if down else 'sib'); nfx+=1
                continue
            cand=[e for e in ev if e['x']<lx0 and e['notes']]
            if not cand: continue
            n=min(cand[-1]['notes'],key=lambda n:abs(B['y0']+(n['s']-1)*SP-ym))
            fx=n.setdefault('fx',[])
            if 'sl' in fx or 'ss' in fx or 'sod' in fx or 'sou' in fx: continue
            # a stroke between two notes on the same string = slide from one to the other; a stroke with nothing
            # after it (before a rest, at the end of a phrase) = slide out, down or up the neck
            nxt=[e for e in right if e['x']-lx1<40 and any(m['s']==n['s'] for m in e['notes'])]
            fx.append('ss' if nxt else ('sod' if down else 'sou')); nfx+=1
        # chords -> events
        real=[e for e in ev if e['d'] is not None]
        if not real:
            cs=[c for _,c in B['chords']]
            if len(cs)>=2: toks=['r.2{ch "%s"}'%cs[0],'r.2{ch "%s"}'%cs[1]]
            elif cs: toks=['r.1{ch "%s"}'%cs[0]]
            else: toks=['r.1']
        else:
            for cx,c in B['chords']:
                later=[e for e in real if e['x']>=cx-6]
                (later[0] if later else real[0])['ch']=c
            toks=[]
            for ei,e in enumerate(ev):
                if e['d'] is None:
                    # a grace note is joined to the note after it on the same string by a slur (played legato, drawn
                    # as an arc; the page's alphaTab leaves the H/P letter off grace notes)
                    nxt=next((x for x in ev[ei+1:] if x['d'] is not None),None)
                    for n in e['notes']:
                        if nxt and any(m['s']==n['s'] and not m['tie'] for m in nxt['notes']):
                            fx=n.setdefault('fx',[])
                            if not any(x in fx for x in ('h','ss','sl','sib','sia')): fx.append('h')
                    ns=['%s.%d%s'%(n['f'],n['s'],('{%s}'%' '.join(dict.fromkeys(n['fx'])) if n.get('fx') else '')) for n in sorted(e['notes'],key=lambda n:n['s'])]
                    toks.append((ns[0] if len(ns)==1 else '('+' '.join(ns)+')')+('.16{gr txt "%s"}'%e['label'] if e.get('label') else '.16{gr}'))
                    continue
                t=tok(e,prev)
                if '?' in t: report.append('%s bar %d: odd duration %s'%(name,bi+1,t))
                if not e['notes'] and e['stem'] and not prev: report.append('%s bar %d: tie with nothing before it'%(name,bi+1))
                toks.append(t)
                if e['notes']: prev=e['notes']
                elif e['rest']: prev=None
        s=' '.join(toks)
        if B['sect']: s='\\section "%s" '%B['sect'][0]+s
        lines.append(s)
    return bars,lines

def build_alphatex(title, artist, tempo, parts, report):
    """parts: list of (track name, short name, doc, page indexes 0-based). Returns alphaTex text and bar count."""
    tracks = []
    for name, short, doc, pages in parts:
        bars, lines = track(doc, (pages[0] + 1, pages[-1] + 1), name, short, report)
        tracks.append((name, short, bars, lines))
    n = max(len(t[3]) for t in tracks)
    for name, short, bars, lines in tracks:
        if len(lines) != n:
            report.append('%s: %d bars, the other part has %d - padded with empty bars, check the end' % (name, len(lines), n))
            lines += ['r.1'] * (n - len(lines)); bars += [{'key': None}] * (n - len(bars))
    l1 = tracks[0][3]
    # sections belong to the bar, not the track: keep them on the first track, taking the other tracks' when it has none
    sec1 = {i for i, l in enumerate(l1) if l.startswith('\\section')}
    for t in tracks[1:]:
        l2 = t[3]
        for i, l in enumerate(l2):
            if l.startswith('\\section'):
                m = re.match(r'(\\section "[^"]*" )(.*)', l); l2[i] = m.group(2)
                if i not in sec1: l1[i] = m.group(1) + l1[i]; sec1.add(i)
    # key labels from the numbered-notation line (1=A, 6=d ...) -> key signatures on every track
    for i in range(n):
        k = next((t[2][i].get('key') for t in tracks if t[2][i].get('key')), None)
        if k:
            ks = k[2:].lower() + ('minor' if k[0] == '6' else '')
            for t in tracks: t[3][i] = '\\ks %s ' % ks + t[3][i]
    esc = lambda s: s.replace('"', "'")
    tex = ['\\title "%s"' % esc(title), '\\artist "%s"' % esc(artist), '\\tempo %d' % tempo, '.']
    for ti, (name, short, bars, lines) in enumerate(tracks):
        tex += ['\\track ("%s" "%s")' % (name, short), '\\staff {tabs}', '\\tuning (E4 B3 G3 D3 A2 E2)'] + (['\\ts 4 4'] if ti == 0 else [])
        tex += [l + (' |' if i < n - 1 else '') + '  // %d' % (i + 1) for i, l in enumerate(lines)]
    return '\n'.join(tex) + '\n', n
