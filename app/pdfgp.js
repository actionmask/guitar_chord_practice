// PDF guitar tab (the teacher's Guitar Pro exports) -> alphaTex, in the browser with pdf.js.
// A port of pdf-tool/tabpdf.py + pdf2gp.py; keep the two in step.
(function (root) {
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  // A path as MuPDF's fz_path would hold it (degenerate segments dropped the same way), walked like PyMuPDF's
  // get_drawings: rectangles from 're' become 're' items, 4-line closed strokes become 'qu'.
  function buildPath(OPS, ops, args, cont) {   // cont: the path so far (a path may be split over several constructPath ops)
    const cmds = cont ? cont.cmds : []; let i = 0, cx = cont ? cont.cx : 0, cy = cont ? cont.cy : 0, sx = cont ? cont.sx : 0, sy = cont ? cont.sy : 0;
    const last = () => cmds.length ? cmds[cmds.length - 1][0] : null;
    const moveto = (x, y) => { if (last() === 'M') cmds.pop(); cmds.push(['M', x, y]); cx = sx = x; cy = sy = y; };
    const lineto = (x, y) => { if (!cmds.length) return; if (last() !== 'M' && cx === x && cy === y) return; cmds.push(['L', x, y]); cx = x; cy = y; };
    const curveto = (x1, y1, x2, y2, x3, y3) => {
      if (!cmds.length) return;
      const x0 = cx, y0 = cy;
      if (x0 === x1 && y0 === y1) {
        if (x2 === x3 && y2 === y3) { if (x1 === x2 && y1 === y2 && last() !== 'M') return; lineto(x3, y3); return; }
        if (x1 === x2 && y1 === y2) { lineto(x3, y3); return; }
      } else if (x1 === x2 && y1 === y2 && x2 === x3 && y2 === y3) { lineto(x3, y3); return; }
      cmds.push(['C', x1, y1, x2, y2, x3, y3]); cx = x3; cy = y3;
    };
    const close = () => { if (!cmds.length || last() === 'Z') return; cmds.push(['Z']); cx = sx; cy = sy; };
    for (const op of ops) {
      switch (op) {
        case OPS.moveTo: moveto(args[i++], args[i++]); break;
        case OPS.lineTo: lineto(args[i++], args[i++]); break;
        case OPS.curveTo: curveto(args[i++], args[i++], args[i++], args[i++], args[i++], args[i++]); break;
        case OPS.curveTo2: { const x0 = cx, y0 = cy; curveto(x0, y0, args[i++], args[i++], args[i++], args[i++]); break; }   // 'v'
        case OPS.curveTo3: { const x1 = args[i++], y1 = args[i++], x3 = args[i++], y3 = args[i++]; curveto(x1, y1, x3, y3, x3, y3); break; } // 'y'
        case OPS.closePath: close(); break;
        case OPS.rectangle: { const x = args[i++], y = args[i++], w = args[i++], h = args[i++]; if (last() === 'M') cmds.pop(); cmds.push(['R', x, y, x + w, y + h]); cx = sx = x; cy = sy = y; break; }
      }
    }
    return { cmds, cx, cy, sx, sy };
  }
  function walk(cmds, ctm, isFill) {
    const items = []; let rect = null, last = [0, 0], first = [0, 0], have = false, lc = 0;
    const inc = p => { if (!rect) rect = [p[0], p[1], p[0], p[1]]; else { rect[0] = Math.min(rect[0], p[0]); rect[1] = Math.min(rect[1], p[1]); rect[2] = Math.max(rect[2], p[0]); rect[3] = Math.max(rect[3], p[1]); } };
    const moveto = (x, y) => { last = ap(ctm, x, y); if (!rect) rect = [last[0], last[1], last[0], last[1]]; first = last; have = true; lc = 0; };
    const lineto = (x, y) => {
      const p = ap(ctm, x, y); inc(p); items.push(['l', last, p]); last = p; lc++;
      if (lc === 4 && !isFill) {   // jm_checkquad
        const L = items.length, q = items.slice(L - 4);
        if (q[3][2][0] === q[0][1][0] && q[3][2][1] === q[0][1][1]) { lc = 0; items.splice(L - 4, 4, ['qu', q.map(t => t[1])]); }
      }
    };
    const closepath = () => {
      if (lc === 3) {   // jm_checkrect
        const L = items.length, ll = items[L - 3][1], lr = items[L - 3][2], ur = items[L - 1][1], ul = items[L - 1][2];
        lc = 0;
        if (ll[1] === lr[1] && ll[0] === ul[0] && ur[1] === ul[1] && ur[0] === lr[0]) {
          const r = ul[1] < lr[1] ? [ul[0], ul[1], lr[0], lr[1]] : [ll[0], ll[1], ur[0], ur[1]];
          items.splice(L - 3, 3, ['re', r]); return;
        }
      }
      lc = 0;
      if (have) { if (last[0] !== first[0] || last[1] !== first[1]) { items.push(['l', last, first]); last = first; } }
      have = false;
    };
    for (const c of cmds) {
      if (c[0] === 'M') moveto(c[1], c[2]);
      else if (c[0] === 'L') lineto(c[1], c[2]);
      else if (c[0] === 'C') {
        lc = 0; const p1 = ap(ctm, c[1], c[2]), p2 = ap(ctm, c[3], c[4]), p3 = ap(ctm, c[5], c[6]);
        inc(p1); inc(p2); inc(p3); items.push(['c', last, p1, p2, p3]); last = p3;
      } else if (c[0] === 'R') { moveto(c[1], c[2]); lineto(c[3], c[2]); lineto(c[3], c[4]); lineto(c[1], c[4]); closepath(); }
      else if (c[0] === 'Z') closepath();
    }
    return { items, rect };
  }

  async function pageModel(pdfjs, page) {
    const OPS = pdfjs.OPS, vp = page.getViewport({ scale: 1 }), vt = vp.transform;
    const ol = await page.getOperatorList();
    const drawings = [];
    let ctm = vt.slice(), lw = 1, stack = [], pending = null;
    const STROKE = new Set([OPS.stroke, OPS.closeStroke]), FILL = new Set([OPS.fill, OPS.eoFill]),
      BOTH = new Set([OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
    const factor = () => Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]));
    const emit = (cmds, type) => {
      const { items, rect } = walk(cmds, ctm, type === 'f');
      if (!items.length) return;
      const d = { type, items, rect, width: type === 'f' ? null : factor() * lw };
      const prev = drawings[drawings.length - 1];
      if (type === 's' && prev && prev.type === 'f' && JSON.stringify(prev.items) === JSON.stringify(items)) { prev.type = 'fs'; prev.width = d.width; return; }
      drawings.push(d);
    };
    for (let k = 0; k < ol.fnArray.length; k++) {
      const fn = ol.fnArray[k], a = ol.argsArray[k];
      if (fn === OPS.save) stack.push([ctm, lw]);
      else if (fn === OPS.restore) { if (stack.length) [ctm, lw] = stack.pop(); }
      else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (fn === OPS.setLineWidth) lw = a[0];
      else if (fn === OPS.setGState) { for (const [key, v] of a[0]) if (key === 'LW') lw = v; }
      else if (fn === OPS.paintFormXObjectBegin) { stack.push([ctm, lw]); if (a[0]) ctm = mul(ctm, a[0]); }
      else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) [ctm, lw] = stack.pop(); }
      else if (fn === OPS.constructPath) {
        pending = buildPath(OPS, a[0], a[1], pending && ol.fnArray[k - 1] === OPS.constructPath ? pending : null);
      } else if (pending) {
        let cmds = pending.cmds; pending = null;
        if (fn === OPS.closeStroke || fn === OPS.closeFillStroke || fn === OPS.closeEOFillStroke) cmds = cmds.concat([['Z']]);
        if (FILL.has(fn)) emit(cmds, 'f');
        else if (STROKE.has(fn)) emit(cmds, 's');
        else if (BOTH.has(fn)) { emit(cmds, 'f'); emit(cmds, 's'); }
        else if (fn === OPS.clip || fn === OPS.eoClip) pending = { cmds, cx: 0, cy: 0, sx: 0, sy: 0 };   // 'W n' / 'W f': the paint op follows
      }
    }
    // text: merge pdf.js runs back into spans like MuPDF's (same font and size, same baseline, close together)
    const tc = await page.getTextContent();
    const fontName = id => { let n = id; try { const f = page.commonObjs.get(id); n = (f && f.name) || id; } catch (e) { } return n.replace(/^[A-Z]{6}\+/, ''); };
    const runs = [];
    for (const it of tc.items) {
      if (!it.str && it.width === 0) continue;
      const t = it.transform, size = Math.sqrt(Math.abs(t[0] * t[3] - t[1] * t[2]));
      const o = ap(vt, t[4], t[5]); const st = tc.styles[it.fontName] || { ascent: 0.8, descent: -0.2 };
      runs.push({ str: it.str, font: fontName(it.fontName), id: it.fontName, size, x: o[0], y: o[1], w: it.width, asc: st.ascent, desc: st.descent });
    }
    const spans = []; let cur = null;
    for (const r of runs) {
      // only glyphs that touch (pdf.js splits some runs MuPDF keeps whole); a jump in position starts a new span
      const ok = cur && r.font === cur.font && Math.abs(r.size - cur.size) < 0.01 && Math.abs(r.y - cur.y) < 0.1 * r.size &&
        r.x - (cur.x + cur.w) > -1.0 * r.size && r.x - (cur.x + cur.w) < 0.15 * r.size;
      if (ok) {
        const gap = r.x - (cur.x + cur.w); if (gap > 0.15 * r.size && !/\s$/.test(cur.str) && !/^\s/.test(r.str)) cur.str += ' ';
        cur.str += r.str; cur.w = r.x + r.w - cur.x; if (r.str.trim()) cur.end = r.x + r.w;   // bbox ends at the last glyph, not a trailing space
      } else { if (cur) spans.push(cur); cur = Object.assign({}, r, { end: r.str.trim() ? r.x + r.w : r.x }); }
    }
    if (cur) spans.push(cur);
    const out = [];
    for (const s of spans) {
      if (!s.str.trim()) continue;
      out.push({ bbox: [s.x, s.y - s.asc * s.size, s.end, s.y - s.desc * s.size], text: s.str, font: s.font, size: s.size });
    }
    return { width: vp.width, height: vp.height, spans: out, drawings };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Tab converter: a line-by-line port of pdf-tool/tabpdf.py and pdf2gp.py (same rules, same thresholds).
  // ---------------------------------------------------------------------------------------------------------
  const gcd = (a, b) => b ? gcd(b, a % b) : Math.abs(a);
  const Fr = (n, d = 1) => { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d) || 1; return { n: n / g, d: d / g }; };
  const fmul = (a, b) => Fr(a.n * b.n, a.d * b.d), fadd = (a, b) => Fr(a.n * b.d + b.n * a.d, a.d * b.d);
  const fkey = a => a.d === 1 ? String(a.n) : a.n + '/' + a.d;
  const pyRound = (x, nd = 0) => { const k = Math.pow(10, nd), v = x * k, r = Math.round(v); return (Math.abs(v % 1) === 0.5 ? 2 * Math.round(v / 2) : r) / k; };
  const SECT = /^(Intro|Verse|Chorus|Bridge|Outro|Solo|Pre|Inter|Short|Ending|Break|Riff|Coda|前奏|主歌|副歌|尾奏|間奏|橋段|導歌)/i;
  const CHORD = /^[A-G][#b]?(m|maj|min|dim|aug|sus|add|M)*[0-9]*(sus[24])?(add[0-9]+)?(\/[A-G][#b]?)?$/;
  const kindsOf = d => [...new Set(d.items.map(i => i[0]))].sort().join('');
  const cmpTuple = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };

  function systemsOf(pm) {
    if (pm._sys) return pm._sys;
    const hl = [], vl = [], fills = [], hs = [];
    for (const g of pm.drawings) {
      const w = g.width || 0;
      if (g.type === 's') {
        for (const it of g.items) {
          if (it[0] !== 'l') continue;
          const a = it[1], b = it[2];
          if (Math.abs(a[1] - b[1]) < 0.3 && Math.abs(a[0] - b[0]) > 1) hs.push([a[1], Math.min(a[0], b[0]), Math.max(a[0], b[0]), w]);
          else if (Math.abs(a[0] - b[0]) > 2 && Math.abs(a[1] - b[1]) < 0.45 * Math.abs(a[0] - b[0]) && w > 0.6) hs.push([(a[1] + b[1]) / 2, Math.min(a[0], b[0]), Math.max(a[0], b[0]), w]);
          else if (Math.abs(a[0] - b[0]) < 0.3 && Math.abs(a[1] - b[1]) > 3) vl.push([a[0], Math.min(a[1], b[1]), Math.max(a[1], b[1]), w]);
        }
      } else {
        const r = g.rect; fills.push([r[0], r[1], r[2], r[3], kindsOf(g), g.items.length]);
      }
    }
    const seen = [];
    for (const f of fills.slice().sort((a, b) => a[1] - b[1]))
      if (f[4] === 're' && f[2] - f[0] < 4 && 25 < f[3] - f[1] && f[3] - f[1] < 45 && !seen.some(([a]) => Math.abs(f[1] - a) < 3)) seen.push([f[1], f[3]]);
    const out = [];
    for (const [a, b] of seen) {
      const xs = hs.filter(([y, , , w]) => a - 1 < y && y < b + 1 && w < 0.4);
      if (xs.length) out.push({ y: [0, 1, 2, 3, 4, 5].map(k => a + k * (b - a) / 5), x0: Math.min(...xs.map(h => h[1])), x1: Math.max(...xs.map(h => h[2])) });
    }
    return (pm._sys = [out, vl, fills, hs]);
  }
  function mergedText(spans) {
    const sp = spans.map(([bb, t, f, sz]) => [bb.slice(), t.replace(//g, 'b').replace(//g, '#'), f, sz]);
    const acc = sp.filter(x => x[2].includes('Bravura')); let rest = sp.filter(x => !x[2].includes('Bravura'));
    for (const a of acc) {
      const cy = (a[0][1] + a[0][3]) / 2;
      const L = rest.filter(x => -2 < a[0][0] - x[0][2] && a[0][0] - x[0][2] < 4 && x[0][1] - 6 < cy && cy < x[0][3] + 6);
      if (!L.length) continue;
      const l = L[0]; l[1] += a[1]; l[0][2] = a[0][2];
      const R = rest.filter(x => x !== l && -2 < x[0][0] - a[0][2] && x[0][0] - a[0][2] < 4 && Math.abs((x[0][1] + x[0][3]) / 2 - (l[0][1] + l[0][3]) / 2) < 5);
      if (R.length) { l[1] += R[0][1]; l[0][2] = R[0][0][2]; rest.splice(rest.indexOf(R[0]), 1); }
    }
    return rest;
  }
  function convert(pms, log) {
    const bars = [];
    for (const pm of pms) {
      const [systems, vl, fills, hs] = systemsOf(pm);
      const spans = pm.spans.map(s => [s.bbox, s.text.trim(), s.font, s.size]);
      systems.forEach((S, si) => {
        const y0 = S.y[0], y5 = S.y[5], gap = S.y[1] - y0;
        const top = Math.max(si ? systems[si - 1].y[5] + 16 : 0, y0 - 80), bot = y5 + 40;
        let bl = [];
        for (const f of fills.slice().sort(cmpTuple)) {
          if (f[4] === 're' && Math.abs(f[1] - y0) < 1.5 && Math.abs(f[3] - y5) < 1.5 && f[2] - f[0] < 4) {
            if (!bl.length || f[0] - bl[bl.length - 1][0] > 7) bl.push([f[0], f[2] - f[0]]);
            else { const L = bl[bl.length - 1]; L[1] = Math.max(L[1], f[2] - f[0], f[2] - L[0]); }
          }
        }
        if (!bl.length || bl[0][0] - S.x0 > 6) bl = [[S.x0, 0.5]].concat(bl);
        const ev = [];
        const at = (x, tol = 2.6) => { for (const e of ev) if (Math.abs(e.x - x) < tol) return e; const e = { x, notes: [], stem: null, rest: null, fx: new Set() }; ev.push(e); return e; };
        for (const [bb, t, f, sz] of spans) {
          const cy = (bb[1] + bb[3]) / 2, cx = (bb[0] + bb[2]) / 2;
          if (y0 - gap * 0.6 < cy && cy < y5 + gap * 0.6 && S.x0 + 8 < cx && cx < S.x1 + 2 && /^\(?(\d+|X|x)\)?$/.test(t) && sz < 9 && !f.startsWith('AAAAA') && !f.includes('wdth') && !f.includes('NeoI')) {
            let st = 0; for (let k = 1; k < 6; k++) if (Math.abs(S.y[k] - cy) < Math.abs(S.y[st] - cy)) st = k;
            if (Math.abs(S.y[st] - cy) > gap * 0.45) continue;
            at(cx).notes.push({ s: st + 1, f: t.replace(/^\(|\)$/g, ''), tie: t.startsWith('('), small: false, sz, x: cx });
          }
        }
        const szs = new Map(); for (const e of ev) for (const n of e.notes) { const k = pyRound(n.sz, 1); szs.set(k, (szs.get(k) || 0) + 1); }
        let msz = 7, best = -1; for (const [k, v] of szs) if (v > best) { best = v; msz = k; }
        for (const e of ev) for (const n of e.notes) n.small = n.sz < msz * 0.9;
        const sst = vl.filter(s => y5 + 10 < s[2] && s[2] < bot && s[1] >= y0 - 1.5 && S.x0 - 2 < s[0] && s[0] < S.x1 + 2 && s[3] < 0.7);
        for (const s of sst) at(s[0]).stem = [s[1], s[2]];
        const below = fills.filter(f => y5 + 1 < f[1] && f[3] < bot + 2);
        const beams = below.filter(f => f[4] === 'l' && f[2] - f[0] > 2.5 && f[3] - f[1] < 4);
        const flags = below.filter(f => f[4].includes('c') && f[5] >= 6 && f[3] - f[1] > 8);
        const dots = below.filter(f => f[2] - f[0] < 3.2 && f[3] - f[1] < 3.2 && f[4].includes('c'));
        for (const f of fills) {   // rests drawn on the staff
          const w = f[2] - f[0], h = f[3] - f[1], cy = (f[1] + f[3]) / 2;
          if (!(y0 - 2 < cy && cy < y5 + 2 && S.x0 + 14 < f[0]) || !f[4].includes('l') || !f[4].includes('c')) {
            if (!(y0 - 2 < cy && cy < y5 + 2 && S.x0 + 40 < f[0] && f[4] === 're' && 3 < w && w < 7 && h < 4)) continue;
          }
          let kind = null;
          if (f[5] === 19) kind = Fr(1, 2);
          else if (f[5] === 35) kind = Fr(1);
          else if (f[5] === 34) kind = Fr(1, 4);
          else if (f[5] === 8 && h < 4) kind = (f[1] - y0) / gap < 1.3 ? Fr(4) : Fr(2);
          else if (f[4] === 're') kind = (f[1] - y0) / gap < 1.3 ? Fr(4) : Fr(2);
          if (kind) at((f[0] + f[2]) / 2, 3.2).rest = kind;
        }
        const tup = [];
        for (const [bb, t, f] of spans) {
          if (t === '3' && f.includes('Italic') && y5 < bb[1] && bb[1] < bot + 6) {
            const segs = hs.filter(h => Math.abs(h[0] - (bb[1] + bb[3]) / 2) < 10 && h[3] > 0.6);
            const L = segs.filter(h => -1 <= bb[0] - h[2] && bb[0] - h[2] < 7), R = segs.filter(h => -1 <= h[1] - bb[2] && h[1] - bb[2] < 7);
            if (L.length && R.length) tup.push([Math.min(...L.map(h => h[1])), Math.max(...R.map(h => h[2]))]);
            else tup.push([bb[0] - 9, bb[2] + 9]);
          }
        }
        ev.sort((a, b) => a.x - b.x);
        for (const e of ev) {
          const x = e.x; let d = null;
          if (e.rest && !e.notes.length && !e.stem) d = e.rest;
          else if (e.stem) {
            const nb = new Set(beams.filter(b => b[0] - 1.2 <= x && x <= b[2] + 1.2).map(b => pyRound(b[1]))).size;
            const fl = flags.filter(f => Math.abs(f[0] - x) < 2);
            if (nb) d = Fr(1, Math.pow(2, nb));
            else if (fl.length) d = (fl[0][3] - fl[0][1] < 15.6 && fl.length === 1) ? Fr(1, 2) : Fr(1, 4);
            else d = e.stem[0] > y5 + 6 ? Fr(2) : Fr(1);
            if (dots.some(f => 1.5 < f[0] - x && f[0] - x < 8 && Math.abs(f[1] - e.stem[1]) < 9)) { e.fx.add('d'); d = fmul(d, Fr(3, 2)); }
          } else if (e.notes.length) d = e.notes.every(n => n.small) ? null : Fr(4);
          if (d !== null && tup.some(([a, b]) => a - 1.6 <= x && x <= b + 1.6)) { e.fx.add('tu'); d = fmul(d, Fr(2, 3)); }
          e.d = d;
        }
        const above = spans.filter(s => top <= (s[0][1] + s[0][3]) / 2 && (s[0][1] + s[0][3]) / 2 < y0 - 0.5 && !s[2].includes('wdth') && !s[2].includes('NeoI') && !s[2].includes('lback'));
        const labels = mergedText(above);
        const xs = bl.map(b => b[0]).concat([S.x1 + 5]);
        for (let i = 0; i < xs.length - 1; i++) {
          const a = xs[i], b = xs[i + 1];
          if (b - a < 12) continue;
          const evs = ev.filter(e => a + 1 < e.x && e.x < b - 0.5);
          const lab = labels.filter(l => a - 4 <= l[0][0] && l[0][0] < b - 4);
          const strip = t => t.replace(/\s*\(.*$/, '');
          const num = lab.filter(l => /^\d+$/.test(l[1]) && l[3] < 7.6 && l[0][0] < a + 6 && l[0][3] > y0 - 22).map(l => parseInt(l[1], 10));
          const chords = lab.filter(l => CHORD.test(strip(l[1])) && !SECT.test(l[1]) && l[3] > 7.5).map(l => [l[0][0], strip(l[1])]);
          const sect = lab.filter(l => SECT.test(l[1]) && l[3] > 7.5).map(l => l[1]);
          const misc = lab.filter(l => ['H', 'P', 'sl.', 'P.M.', 'full', '½', '1½', 'fullfull', '-1½', 'let ring'].includes(l[1])).map(l => [pyRound(l[0][0]), l[1]]);
          const keyl = lab.filter(l => /^[16]=[A-Ga-g][#b]?$/.test(l[1])).map(l => l[1]);
          bars.push({ key: keyl[0] || null, y0, pm, sys: si + 1, num: num.length ? num[0] : null, x: [a, b], ev: evs, chords, sect, misc });
        }
      });
    }
    return bars;
  }
  const DUR = { '4': '1', '2': '2', '1': '4', '1/2': '8', '1/4': '16', '1/8': '32' };
  const uniq = a => [...new Set(a)];
  function tok(e, prev) {
    let base = e.d;
    if (e.fx.has('tu')) base = fmul(base, Fr(3, 2));
    if (e.fx.has('d')) base = fmul(base, Fr(2, 3));
    const fx = [];
    if (e.fx.has('d')) fx.push('d');
    if (e.fx.has('tu')) fx.push('tu 3');
    fx.push(...[...e.fx].filter(x => x !== 'd' && x !== 'tu').sort());
    if (e.ch) fx.push('ch "' + e.ch + '"');
    if (e.label) fx.push('txt "' + e.label + '"');
    let ns;
    if (e.notes.length) {
      ns = e.notes.slice().sort((a, b) => a.s - b.s).map(n => {
        const v = n.tie ? '-' : ('Xx'.includes(n.f) ? 'x' : n.f);
        const nfx = n.fx || [], keep = n.tie ? nfx.filter(x => x === 'sod' || x === 'sou') : nfx;
        return v + '.' + n.s + (nfx.length && (!n.tie || keep.length) ? '{' + uniq(keep).join(' ') + '}' : '');
      });
    } else if (e.stem && prev) ns = prev.slice().sort((a, b) => a.s - b.s).map(n => '-.' + n.s);
    else ns = ['r'];
    const body = ns.length === 1 ? ns[0] : '(' + ns.join(' ') + ')';
    const k = fkey(base);
    return body + '.' + (k in DUR ? DUR[k] : '?' + k) + (fx.length ? '{' + fx.join(' ') + '}' : '');
  }
  const BEND = { 'full': 'b (0 4)', '½': 'b (0 2)', '1/2': 'b (0 2)', '1½': 'b (0 6)' };
  function pmExtent(pm, x, y) {
    const hs = systemsOf(pm)[3];
    const segs = hs.filter(h => Math.abs(h[0] - y) < 4 && h[1] > x - 2).map(h => [h[1], h[2]]).sort(cmpTuple);
    let end = x + 12;
    for (const [a, b] of segs) { if (a - end < 9) end = Math.max(end, b); else break; }
    return end;
  }
  const SP = 6.9;
  function slideLines(pm) {
    if (pm._sl) return pm._sl;
    const out = [];
    for (const d of pm.drawings) {
      const w = d.width || 0;
      if (!(0.5 < w && w < 0.9)) continue;
      for (const it of d.items) {
        if (it[0] !== 'l') continue;
        const a = it[1], b = it[2], dx = b[0] - a[0], dy = b[1] - a[1];
        if (2.5 < Math.abs(dx) && Math.abs(dx) < 7 && 2.5 < Math.abs(dy) && Math.abs(dy) < 7) out.push([Math.min(a[0], b[0]), a[1], Math.max(a[0], b[0]), b[1], dx * dy > 0]);
      }
    }
    return (pm._sl = out);
  }
  const addFx = (n, x) => { (n.fx = n.fx || []).push(x); };
  function track(pms, name, report) {
    const bars = convert(pms); const lines = []; let prev = null;
    bars.forEach((B, bi) => {
      const ev = B.ev.slice(), pm = B.pm;
      for (const [x, lab] of B.misc) {
        const real = ev.filter(e => e.d !== null);
        if (lab === 'H' || lab === 'P' || lab === 'sl.') {
          const cand = ev.filter(e => e.x < x + 1 && e.notes.length);
          if (cand.length) { cand[cand.length - 1].label = lab; for (const n of cand[cand.length - 1].notes) addFx(n, lab !== 'sl.' ? 'h' : 'sl'); }
        } else if (lab in BEND || lab === 'fullfull') {
          const cand = real.filter(e => e.x < x + (lab === 'fullfull' ? 9 : 3) && e.notes.length);
          if (lab === 'fullfull' && cand.length >= 2) {
            for (const n of cand[cand.length - 1].notes) addFx(n, 'b (4 0)');
            for (const n of cand[cand.length - 2].notes) addFx(n, 'b (0 4)');
          } else if (cand.length) for (const n of cand[cand.length - 1].notes) addFx(n, BEND[lab] || 'b (0 4)');
        } else if (lab === 'P.M.') {
          let y = null, xe = null;
          for (const s of pm.spans) {
            const bb = s.bbox;
            if (s.text.trim() === 'P.M.' && Math.abs(bb[0] - x) < 1.5 && B.y0 - 60 < bb[1] && bb[1] < B.y0) { y = (bb[1] + bb[3]) / 2; xe = bb[2]; }
          }
          if (y === null) continue;
          const end = pmExtent(pm, xe, y);
          for (const B2 of bars.slice(bi)) {
            if (B2.pm !== B.pm || B2.sys !== B.sys) break;
            for (const e of B2.ev) if (x - 3 <= e.x && e.x <= end + 2 && e.notes.length) for (const n of e.notes) addFx(n, 'pm');
          }
        }
      }
      for (const [lx0, ly0, lx1, ly1, down] of slideLines(pm)) {
        if (!(B.x[0] < lx0 && lx0 < B.x[1] && B.y0 - 3 < (ly0 + ly1) / 2 && (ly0 + ly1) / 2 < B.y0 + 40)) continue;
        const ym = (ly0 + ly1) / 2; let st = 1; for (let k = 2; k <= 6; k++) if (Math.abs(B.y0 + (k - 1) * SP - ym) < Math.abs(B.y0 + (st - 1) * SP - ym)) st = k;
        const near = e => e.notes.filter(m => m.s === st);
        const left = ev.filter(e => e.x < lx0 && near(e).length);
        const right = ev.filter(e => e.x > lx1 && near(e).length && !near(e).every(m => m.tie));
        if (right.length && right[0].x - lx1 < 10 && (!left.length || lx0 - left[left.length - 1].x > 16)) {
          const n = near(right[0])[0]; n.fx = n.fx || [];
          if (!n.fx.includes('sib') && !n.fx.includes('sia')) n.fx.push(down ? 'sia' : 'sib');
          continue;
        }
        const cand = ev.filter(e => e.x < lx0 && e.notes.length);
        if (!cand.length) continue;
        let n = null; for (const m of cand[cand.length - 1].notes) if (!n || Math.abs(B.y0 + (m.s - 1) * SP - ym) < Math.abs(B.y0 + (n.s - 1) * SP - ym)) n = m;
        n.fx = n.fx || [];
        if (['sl', 'ss', 'sod', 'sou'].some(x => n.fx.includes(x))) continue;
        const nxt = right.filter(e => e.x - lx1 < 40 && e.notes.some(m => m.s === n.s));
        n.fx.push(nxt.length ? 'ss' : (down ? 'sod' : 'sou'));
      }
      const real = ev.filter(e => e.d !== null); let toks;
      if (!real.length) {
        const cs = B.chords.map(c => c[1]);
        toks = cs.length >= 2 ? ['r.2{ch "' + cs[0] + '"}', 'r.2{ch "' + cs[1] + '"}'] : cs.length ? ['r.1{ch "' + cs[0] + '"}'] : ['r.1'];
      } else {
        for (const [cx, c] of B.chords) { const later = real.filter(e => e.x >= cx - 6); (later.length ? later[0] : real[0]).ch = c; }
        toks = [];
        ev.forEach((e, ei) => {
          if (e.d === null) {
            const nxt = ev.slice(ei + 1).find(x => x.d !== null);
            for (const n of e.notes) {
              if (nxt && nxt.notes.some(m => m.s === n.s && !m.tie)) {
                n.fx = n.fx || [];
                if (!['h', 'ss', 'sl', 'sib', 'sia'].some(x => n.fx.includes(x))) n.fx.push('h');
              }
            }
            const ns = e.notes.slice().sort((a, b) => a.s - b.s).map(n => n.f + '.' + n.s + (n.fx && n.fx.length ? '{' + uniq(n.fx).join(' ') + '}' : ''));
            toks.push((ns.length === 1 ? ns[0] : '(' + ns.join(' ') + ')') + (e.label ? '.16{gr txt "' + e.label + '"}' : '.16{gr}'));
            return;
          }
          const t = tok(e, prev);
          if (t.includes('?')) report.push(name + ' bar ' + (bi + 1) + ': odd duration ' + t);
          if (!e.notes.length && e.stem && !prev) report.push(name + ' bar ' + (bi + 1) + ': tie with nothing before it');
          toks.push(t);
          if (e.notes.length) prev = e.notes; else if (e.rest) prev = null;
        });
      }
      let s = toks.join(' ');
      if (B.sect.length) s = '\\section "' + B.sect[0] + '" ' + s;
      lines.push(s);
    });
    return [bars, lines];
  }
  function buildAlphaTex(title, artist, tempo, parts, report) {
    const tracks = parts.map(([name, short, pms]) => { const [bars, lines] = track(pms, name, report); return [name, short, bars, lines]; });
    const n = Math.max(...tracks.map(t => t[3].length));
    for (const [name, , bars, lines] of tracks) {
      if (lines.length !== n) {
        report.push(name + ': ' + lines.length + ' bars, the other part has ' + n + ' - padded with empty bars, check the end');
        while (lines.length < n) { lines.push('r.1'); bars.push({ key: null }); }
      }
    }
    const l1 = tracks[0][3];
    const sec1 = new Set(l1.map((l, i) => l.startsWith('\\section') ? i : -1).filter(i => i >= 0));
    for (const t of tracks.slice(1)) {
      const l2 = t[3];
      l2.forEach((l, i) => {
        if (l.startsWith('\\section')) {
          const m = l.match(/^(\\section "[^"]*" )([\s\S]*)$/); l2[i] = m[2];
          if (!sec1.has(i)) { l1[i] = m[1] + l1[i]; sec1.add(i); }
        }
      });
    }
    for (let i = 0; i < n; i++) {
      const t0 = tracks.find(t => t[2][i].key); const k = t0 ? t0[2][i].key : null;
      if (k) { const ks = k.slice(2).toLowerCase() + (k[0] === '6' ? 'minor' : ''); for (const t of tracks) t[3][i] = '\\ks ' + ks + ' ' + t[3][i]; }
    }
    const esc = s => s.replace(/"/g, "'");
    const tex = ['\\title "' + esc(title) + '"', '\\artist "' + esc(artist) + '"', '\\tempo ' + tempo, '.'];
    tracks.forEach(([name, short, , lines], ti) => {
      tex.push('\\track ("' + name + '" "' + short + '")', '\\staff {tabs}', '\\tuning (E4 B3 G3 D3 A2 E2)');
      if (ti === 0) tex.push('\\ts 4 4');
      lines.forEach((l, i) => tex.push(l + (i < n - 1 ? ' |' : '') + '  // ' + (i + 1)));
    });
    return [tex.join('\n') + '\n', n];
  }

  // ---- pdf2gp.py: find songs and parts, name the tracks ----
  const KEYLINE = /KEY\s*:\s*(.*?)\s+(\d{2,3})\s*b\s*\/?\s*pm/i;
  const readable = s => ![...s].some(ch => /\p{C}/u.test(ch) || (ch.codePointAt(0) >= 0x2C80 && ch.codePointAt(0) <= 0x2CFF) || (ch.codePointAt(0) >= 0x3400 && ch.codePointAt(0) <= 0x4DBF));
  function header(pm) {
    const sp = pm.spans.filter(s => s.text.trim() && !s.font.startsWith('.')).map(s => [s.bbox, s.text.trim(), s.size]);
    let key = null;
    const lines = [];   // MuPDF keeps 'KEY:Am     110 bpm' in one span; pdf.js splits it at the gap
    for (const s of pm.spans) {
      const L = lines.find(l => l.font === s.font && Math.abs(l.size - s.size) < 0.01 && Math.abs(l.bb[3] - s.bbox[3]) < 0.1 * s.size && s.bbox[0] >= l.bb[2] - 0.3 * s.size && s.bbox[0] - l.bb[2] < 1.5 * s.size);
      if (L) { L.t += ' ' + s.text.trim(); L.bb = [L.bb[0], Math.min(L.bb[1], s.bbox[1]), s.bbox[2], Math.max(L.bb[3], s.bbox[3])]; }
      else lines.push({ font: s.font, size: s.size, bb: s.bbox.slice(), t: s.text.trim() });
    }
    for (const l of lines) { const m = l.t.match(KEYLINE); if (m && l.bb[1] < pm.height * 0.3) { key = [m[1].trim(), parseInt(m[2], 10), l.bb[1]]; break; } }
    if (!key) return null;
    const above = sp.filter(([bb, t, sz]) => bb[1] < key[2] - 1 && sz >= 14 && !KEYLINE.test(t));
    if (!above.length) return null;
    const top = Math.max(...above.map(a => a[2]));
    const big = above.filter(a => a[2] >= top * 0.95).sort((a, b) => a[0][0] - b[0][0]);
    let raw = big.map(([, t], i) => (/^[A-Za-z0-9]/.test(t) && i) ? ' ' + t : t).join('').normalize('NFKC').trim().replace(/\s+/g, ' ');
    let title = raw, artist = '';
    let m = raw.match(/^(.*?)\s*[(（]\s*(.*?)\s*[)）]\s*$/);
    if (m) { title = m[1]; artist = m[2]; }
    else if (/\s?[-–—]\s?/.test(raw)) { const i = raw.search(/\s?[-–—]\s?/), mm = raw.slice(i).match(/^\s?[-–—]\s?/); title = raw.slice(0, i).trim(); artist = raw.slice(i + mm[0].length).trim(); }
    const ok = readable(raw) && title;
    return { title: ok ? title : null, artist: ok ? artist : '', key: key[0].replace(/\s+/g, ' '), tempo: key[1], raw };
  }
  function chordiness(pms) {
    const bars = convert(pms);
    const ev = bars.flatMap(B => B.ev.filter(e => e.notes.length));
    const lab = bars.reduce((s, B) => s + B.chords.length, 0) / Math.max(1, bars.length);
    const poly = ev.length ? ev.filter(e => e.notes.length >= 3).length / ev.length : 0;
    return [2 * lab + poly, bars.length];
  }
  const stemOf = n => n.replace(/\.[^.]*$/, '').replace(/^.*[\\/]/, '');
  const commonPrefix = a => { if (!a.length) return ''; let p = a[0]; for (const s of a) while (!s.startsWith(p)) p = p.slice(0, -1); return p; };

  // files: [{name, data: Uint8Array}]; opts.titles: names for songs whose title cannot be read (in order),
  // opts.progress(text). Returns [{title, artist, tempo, key, tex, bars, report, parts:[...], titleGuessed}]
  async function convertPdfs(pdfjs, files, opts = {}) {
    const say = opts.progress || (() => { });
    const parts = [];
    for (const f of files) {
      const doc = await pdfjs.getDocument({ data: f.data, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
      let cur = null;
      for (let i = 1; i <= doc.numPages; i++) {
        say(f.name + '：第 ' + i + '/' + doc.numPages + ' 頁');
        const pm = await pageModel(pdfjs, await doc.getPage(i));
        const h = header(pm);
        if (h) { if (cur) parts.push(cur); cur = { file: f.name, i0: i, i1: i, h, pms: [pm] }; }
        else if (cur) { cur.i1 = i; cur.pms.push(pm); }
      }
      if (cur) parts.push(cur);
    }
    if (!parts.length) throw new Error('找不到標題頁（有歌名和「KEY: … bpm」那一行的頁面）。這是老師那種 Guitar Pro 匯出的 PDF 嗎？');
    const songs = new Map();
    for (const p of parts) { const k = p.h.raw + '\u0000' + p.h.key + '\u0000' + p.h.tempo; if (!songs.has(k)) songs.set(k, []); songs.get(k).push(p); }
    const unnamed = (opts.titles || []).slice(); const out = []; let si = 0;
    for (const ps of songs.values()) {
      const h = Object.assign({}, ps[0].h); let title = h.title, guessed = false;
      if (!title) {
        guessed = true;
        const stems = ps.map(p => stemOf(p.file)), pre = commonPrefix(stems).replace(/[ _\-.]+$/, '');
        if (unnamed.length) { title = unnamed.shift(); if (title.includes(' - ')) { const i = title.indexOf(' - '); h.artist = title.slice(i + 3).trim(); title = title.slice(0, i).trim(); } guessed = false; }
        else if (new Set(stems).size > 1 && pre.length >= 2) title = pre;
        else if ([...songs.values()].filter(v => v[0].file === ps[0].file).length === 1) title = stems[0];
        else title = 'song' + (si + 1);
        if (guessed && opts.askTitle) {   // let the user name it (opts.askTitle(guess, file names) -> 'title' or 'title - artist')
          const t = (await opts.askTitle(title, [...new Set(ps.map(p => p.file))])) || title;
          if (t.includes(' - ')) { const i = t.indexOf(' - '); title = t.slice(0, i).trim(); h.artist = t.slice(i + 3).trim(); } else title = t.trim();
        }
      }
      const scored = ps.map(p => { const [c, nb] = chordiness(p.pms); return { c, nb, p }; });
      if (opts.swap) scored.reverse(); else scored.sort((a, b) => a.c - b.c);
      let names;
      if (scored.length === 1) {
        const fn = scored[0].p.file.toLowerCase();
        if (/solo|獨奏|主奏/.test(fn)) names = [['Solo', 'Solo']];
        else if (/chord|和弦|伴奏|節奏/.test(fn)) names = [['Chords', 'Chd']];
        else names = [scored[0].c > 1.0 ? ['Chords', 'Chd'] : ['Solo', 'Solo']];
      } else names = [['Solo', 'Solo'], ['Chords', 'Chd']].concat(scored.slice(2).map((_, j) => ['Part ' + (j + 3), 'P' + (j + 3)]));
      say('轉換 ' + title);
      const report = [];
      const [tex, n] = buildAlphaTex(title, h.artist, h.tempo, scored.map((x, j) => [names[j][0], names[j][1], x.p.pms]), report);
      out.push({ title, artist: h.artist, tempo: h.tempo, key: h.key, tex, bars: n, report, titleGuessed: guessed,
        parts: scored.map((x, j) => ({ track: names[j][0], file: x.p.file, pages: [x.p.i0, x.p.i1], bars: x.nb, score: x.c })) });
      si++;
    }
    return out;
  }

  const api = { pageModel, convertPdfs, header };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PdfGp = api;
})(typeof window !== 'undefined' ? window : globalThis);
