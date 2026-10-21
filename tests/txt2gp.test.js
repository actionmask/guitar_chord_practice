// Regression tests for app/txt2gp.js. Run from the project root:  node --test
// Bars are checked with the same alphaTab build the app uses, so a bar that does not add up
// to its time signature fails here the same way texToGp() in index.html would flag it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const alphaTab = require(path.join(__dirname, '..', 'app', 'alphaTab.min.js'));
const T = require(path.join(__dirname, '..', 'app', 'txt2gp.js'));

// Same check as texToGp() in index.html: every bar's beats must fill the bar.
function readTex(tex) {
  const st = new alphaTab.Settings();
  const imp = new alphaTab.importer.AlphaTexImporter();
  imp.initFromString(tex, st);
  const sc = imp.readScore();
  const bad = [];
  sc.tracks[0].staves[0].bars.forEach((bar, i) => {
    let d = 0;
    for (const bt of bar.voices[0].beats) if (bt.graceType === 0) d += bt.playbackDuration;
    if (Math.abs(d - sc.masterBars[i].calculateDuration()) > 130) bad.push(i + 1);
  });
  return { sc, bad, ts: sc.masterBars.map(m => m.timeSignatureNumerator + '/' + m.timeSignatureDenominator) };
}
const build = (txt, opts) => T.buildAlphaTex(T.parseSongTxt(txt), opts || {});
const bars = txt => T.parseSongTxt(txt).sections.flatMap(s => s.bars);

// ---------- 1. lyrics under chords ----------
test('Chinese lyrics without spaces are split by display column', () => {
  const b = bars('[V]\nC       G       Am      F\n我想要帶你去游樂場坐我的摩托車');
  assert.deepEqual(b.map(x => [x.chords[0], x.text]),
    [['C', '我想要帶'], ['G', '你去游樂'], ['Am', '場坐我的'], ['F', '摩托車']]);
});

test('English lyrics still break at word boundaries', () => {
  const b = bars('[V]\nC       G\nHello my dear friend');
  assert.deepEqual(b.map(x => x.text), ['Hello my', 'dear friend']);
});

test('pickup lyric at the start of a section is kept', () => {
  const b = bars('[Chorus]\n      C           G\n我想要帶你去游樂場');
  assert.ok(b[0].text.includes('我想要'), 'pickup lost: ' + JSON.stringify(b.map(x => x.text)));
  assert.equal(b.map(x => x.text).join('').replace(/\s/g, ''), '我想要帶你去游樂場');
});

test('full-width spaces count as two columns', () => {
  const b = bars('[V]\nC   G\n我　你');
  assert.deepEqual(b.map(x => x.text), ['我', '你']);
});

// ---------- 2. chord names ----------
test('m7-5 / 7-9 are chord extensions, not voicing numbers', () => {
  for (const name of ['F#m7-5', 'Bm7-5', 'E7-9', 'G7-13']) {
    const s = T.parseChordVoicingSpec(name);
    assert.equal(s.baseName, name, name);
    assert.equal(s.voicingIdx, 0, name);
  }
});

test('voicing suffixes still work', () => {
  assert.deepEqual([T.parseChordVoicingSpec('C-2').voicingIdx, T.parseChordVoicingSpec('Am(3)').voicingIdx,
    T.parseChordVoicingSpec('G7(2)').voicingIdx, T.parseChordVoicingSpec('Am7-2').voicingIdx], [2, 3, 2, 2]);
  assert.equal(T.parseChordVoicingSpec('C@8').targetFret, 8);
  assert.equal(T.parseChordVoicingSpec('F:barre').prefMode, 'barre');
});

test('extended chords are recognised on a chord line', () => {
  const names = ['C', 'Bm7b5', 'F#m7-5', 'E7#9', 'Cmaj7#11', 'G7sus4', 'C6', 'Cadd9', 'Caug', 'C+', 'Cdim7', 'C°', 'Bø', 'CM7', 'Ab13', 'D/F#', 'Bm7b5/F'];
  const b = bars('[V]\n' + names.join(' ') + '\nla');
  assert.deepEqual(b.map(x => x.chords[0]), names);
});

test('ordinary lyric lines are not mistaken for chords', () => {
  for (const line of ['Go Go Go', 'Be my baby', 'A bad day', 'Do Re Mi']) {
    const b = bars('[V]\nC G\n' + line);
    assert.equal(b.length, 2, line);
    assert.ok(b.map(x => x.text).join(' ').length > 0, line + ' lost');
  }
});

// ---------- 4. time signatures and pattern length ----------
test('TS header sets the time signature and a matching default pattern', () => {
  const r = readTex(build('TS: 3/4\n[V]\nC G').tex);
  assert.deepEqual(r.ts, ['3/4', '3/4']);
  assert.deepEqual(r.bad, []);
});

test('each section uses its own pattern time signature', () => {
  const r = readTex(build('[Intro:waltz]\nC G\n[Verse:folk]\nAm F\n[Outro:slow_rock_68]\nC').tex);
  assert.deepEqual(r.ts, ['3/4', '3/4', '4/4', '4/4', '6/8']);
  assert.deepEqual(r.bad, []);
});

test('every built-in pattern fills its bar', () => {
  for (const id of Object.keys(T.PATTERNS)) {
    const r = readTex(build('[V:' + id + ']\nC G\nAm F').tex);
    assert.deepEqual(r.bad, [], id);
  }
});

test('custom patterns of odd length are fitted to the bar and reported', () => {
  for (const code of ['D----UD', 'D-DU-U', 'D-DU-UDUDU', 'DUDUDUDUDUDUDUDUDU', 'D-----DU']) {
    const pat = T.createPatternFromTokens(code.split(''), 'strum', [4, 4]);
    const res = T.buildAlphaTex(T.parseSongTxt('[V]\nC G'), { patterns: { default: pat }, pattern: pat });
    const r = readTex(res.tex);
    assert.deepEqual(r.bad, [], code);
    if (code.length !== 8 && code.length !== 16) assert.ok(res.warnings && res.warnings.length, code + ' not reported');
  }
});

test('a held strum is tied, not cut short', () => {
  const pat = T.createPatternFromTokens('D----UD-'.split(''), 'strum', [4, 4]);
  const r = readTex(T.buildAlphaTex(T.parseSongTxt('[V]\nC'), { patterns: { default: pat }, pattern: pat }).tex);
  const beats = r.sc.tracks[0].staves[0].bars[0].voices[0].beats;
  assert.ok(beats.some(b => b.notes.length && b.notes[0].isTieDestination), 'expected a tied note');
  assert.ok(!beats.some(b => b.isRest), 'held strum should not leave rests');
});

// ---------- artist may be blank ----------
test('a blank artist stays blank even if the txt has an Artist: line', () => {
  const res = build('Artist: Someone\n[V]\nC', { artist: '' });
  assert.equal(res.artist, '');
  assert.match(res.tex, /\\artist ""/);
  assert.equal(build('Artist: Someone\n[V]\nC').artist, 'Someone');   // no field given: header still used
});

test('a tie never carries over into the next chord in the same bar', () => {
  const pat = T.createPatternFromTokens('D-------'.split(''), 'strum', [4, 4]);   // one whole-bar strum
  const res = T.buildAlphaTex(T.parseSongTxt('[V]\nC+G'), { patterns: { default: pat }, pattern: pat });
  const r = readTex(res.tex);
  assert.deepEqual(r.bad, []);
  const beats = r.sc.tracks[0].staves[0].bars[0].voices[0].beats;
  const gStart = beats.find(b => b.chord && b.chord.name === 'G');
  assert.ok(gStart, 'G should start its own beat');
  assert.ok(!gStart.notes.some(n => n.isTieDestination), 'G must be struck, not tied from C');
});

test('the in-app demo song builds with every bar complete', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
  const m = /const txtDemoSong = `([\s\S]*?)`;/.exec(html);
  assert.ok(m, 'demo song not found');
  const demo = m[1].replace('${DEMO_TITLE}', 'demo');
  assert.ok(!/周杰倫|晴天/.test(html), 'demo must not mention the original song');
  const r = readTex(build(demo).tex);
  assert.deepEqual(r.bad, []);
});

// ---------- 5. chord edits are written back into the txt ----------
const chordsOf = txt => bars(txt).map(b => b.chords.join('+'));
const textsOf = txt => bars(txt).map(b => b.text);

test('replacing a chord edits the chord line in place', () => {
  const txt = '[V]\nC       G\n我想要帶你去游樂';
  const out = T.setBarChords(txt, 1, [{ name: 'Am7', posFrac: 0 }]);
  assert.equal(out, '[V]\nC       Am7\n我想要帶你去游樂');
  assert.deepEqual(textsOf(out), textsOf(txt));
});

test('a longer chord keeps later chords and lyrics aligned', () => {
  const txt = '[V]\nC   G   Am  F\n我想要帶你去游樂場坐我';
  const before = textsOf(txt);
  for (const name of ['Gsus4', 'G7sus4/B', 'Bm7b5/F#']) {
    const out = T.setBarChords(txt, 1, [{ name, posFrac: 0 }]);
    assert.deepEqual(chordsOf(out), ['C', name, 'Am', 'F'], name);
    assert.deepEqual(textsOf(out), before, name + ' moved the lyrics');
  }
});

test('a shorter chord keeps later chords in their columns', () => {
  const txt = '[V]\nCmaj7   G\n我想要帶你去';
  const out = T.setBarChords(txt, 0, [{ name: 'C', posFrac: 0 }]);
  assert.equal(out.split('\n')[1], 'C       G');
  assert.deepEqual(textsOf(out), textsOf(txt));
});

test('editing one pass of an x2 line unrolls the repeat', () => {
  const txt = '[V]\nAm C G D x2\n[C]\nF G';
  const out = T.setBarChords(txt, 6, [{ name: 'Em', posFrac: 0 }]);
  assert.deepEqual(chordsOf(out), ['Am', 'C', 'G', 'D', 'Am', 'C', 'Em', 'D', 'F', 'G']);
  assert.ok(!/x2/.test(out));
});

test('the repeat copy goes after the lyric line', () => {
  const txt = '[V]\nAm      C x2\n我想要帶你去';
  const out = T.setBarChords(txt, 3, [{ name: 'G', posFrac: 0 }]);
  assert.deepEqual(chordsOf(out), ['Am', 'C', 'Am', 'G']);
  assert.deepEqual(textsOf(out).slice(0, 2), textsOf(txt).slice(0, 2));
});

test('editing one bar of C:2 splits it', () => {
  const out = T.setBarChords('[V]\nC:2 G', 1, [{ name: 'F', posFrac: 0 }]);
  assert.deepEqual(chordsOf(out), ['C', 'F', 'G']);
});

test('chords on beats other than 1 and 3 use beat slots and play on that beat', () => {
  const out = T.setBarChords('[V]\nC G', 0, [{ name: 'C', posFrac: 0 }, { name: 'G', posFrac: 0.75 }]);
  assert.match(out, /\|C \. \. G\|/);
  assert.deepEqual(T.getBarChords(out, 0), [{ name: 'C', posFrac: 0 }, { name: 'G', posFrac: 0.75 }]);
  const r = readTex(build(out).tex);
  assert.deepEqual(r.bad, []);
  const beats = r.sc.tracks[0].staves[0].bars[0].voices[0].beats;
  const g = beats.find(b => b.chord && b.chord.name === 'G');
  assert.equal(g.playbackStart, 2880, 'G should start on beat 4');
});

test('two evenly spaced chords are written as C+G', () => {
  assert.equal(T.setBarChords('[V]\nC', 0, [{ name: 'C', posFrac: 0 }, { name: 'G', posFrac: 0.5 }]), '[V]\nC+G');
});

test('chords on the section-tag line can be edited', () => {
  assert.equal(T.setBarChords('[Intro:arp4] Am C\n[V]\nF', 1, [{ name: 'G', posFrac: 0 }]), '[Intro:arp4] Am G\n[V]\nF');
});

test('CRLF line endings and other bars are preserved', () => {
  const txt = 'Title: t\r\n[V]\r\nC G\r\nla la\r\n[C]\r\nAm F';
  const out = T.setBarChords(txt, 3, [{ name: 'Dm', posFrac: 0 }]);
  assert.equal(out, 'Title: t\r\n[V]\r\nC G\r\nla la\r\n[C]\r\nAm Dm');
});

test('an empty chord list or a missing bar changes nothing', () => {
  assert.equal(T.setBarChords('[V]\nC G', 1, []), null);
  assert.equal(T.setBarChords('[V]\nC G', 9, [{ name: 'F', posFrac: 0 }]), null);
});

// ---------- N.C.: a bar with lyrics but no music ----------
test('N.C. makes a silent bar that keeps its lyric', () => {
  const txt = '[V]\nC       N.C.    G\n我想要  （清唱）帶你去';
  const b = bars(txt);
  assert.deepEqual(b.map(x => x.chords[0]), ['C', 'N.C.', 'G']);
  assert.deepEqual(b.map(x => x.text), ['我想要', '（清唱）', '帶你去']);
  const res = build(txt);
  assert.ok(!/\\chord \("N\.C/.test(res.tex), 'N.C. must not get a chord diagram');
  const r = readTex(res.tex);
  assert.deepEqual(r.bad, []);
  const nc = r.sc.tracks[0].staves[0].bars[1].voices[0].beats;
  assert.ok(nc.every(bt => bt.isRest), 'the N.C. bar should only have rests');
  assert.equal(nc[0].chord && nc[0].chord.name, 'N.C.');
  assert.ok(nc[0].text && nc[0].text.includes('清唱'), 'lyric should stay on the silent bar');
});

test('NC and N.C are accepted too', () => {
  assert.deepEqual(chordsOf('[V]\nC NC G N.C'), ['C', 'N.C.', 'G', 'N.C.']);
});

test('N.C. inside a bar stops the music from that beat', () => {
  const r = readTex(build('[V]\n|C . N.C. .|').tex);
  assert.deepEqual(r.bad, []);
  const beats = r.sc.tracks[0].staves[0].bars[0].voices[0].beats;
  const half = beats.filter(bt => bt.playbackStart >= 1920);
  assert.ok(half.length && half.every(bt => bt.isRest), 'beats 3-4 should be silent');
  assert.ok(beats.some(bt => bt.playbackStart < 1920 && !bt.isRest), 'beats 1-2 still play C');
});
