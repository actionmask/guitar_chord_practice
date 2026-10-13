// Reads a Guitar Pro / alphaTex score with alphaTab and writes its notes (as played, repeats expanded) and bar start times as JSON.
import * as alphaTab from '@coderline/alphatab';
import fs from 'fs';
const [,, inFile, outFile] = process.argv;
const settings = new alphaTab.Settings();
const bytes = new Uint8Array(fs.readFileSync(inFile));
let score;
if (/\.(alphatex|txt|tex)$/i.test(inFile)) { const imp = new alphaTab.importer.AlphaTexImporter(); imp.initFromString(new TextDecoder().decode(bytes), settings); score = imp.readScore(); }
else score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
const mf = new alphaTab.midi.MidiFile();
const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(mf);
const gen = new alphaTab.midi.MidiFileGenerator(score, settings, handler);
gen.generate();
const evs = (mf.events || mf.tracks.flatMap(t => t.events)).slice().sort((a, b) => a.tick - b.tick);
// tempo map (ticks -> seconds)
const tempos = [{ tick: 0, bpm: score.tempo || 120 }];
for (const e of evs) if (e.type === 81 && e.beatsPerMinute) tempos.push({ tick: e.tick, bpm: e.beatsPerMinute });
tempos.sort((a, b) => a.tick - b.tick);
const PPQ = 960;
function sec(tick) { let s = 0, t0 = 0, bpm = tempos[0].bpm;
  for (const tp of tempos) { if (tp.tick >= tick) break; s += (tp.tick - t0) / PPQ * 60 / bpm; t0 = tp.tick; bpm = tp.bpm; }
  return s + (tick - t0) / PPQ * 60 / bpm; }
const on = new Map(), notes = [];
for (const e of evs) {
  // alphaTab's own event classes come first: in 1.8 their numeric 'type' values do not follow the MIDI status bytes
  // (NoteOnEvent reports 0x80, NoteOffEvent 0x90), so reading the number alone turned every note-off into a new note.
  const cn = e.constructor && e.constructor.name;
  const isOn = cn ? /NoteOn/.test(cn) : (e.type === 0x90 || e.command === 0x90);
  const isOff = cn ? /NoteOff/.test(cn) : (e.type === 0x80 || e.command === 0x80);
  if (e.noteKey === undefined && e.key === undefined) continue;
  const key = e.noteKey ?? e.key, vel = e.noteVelocity ?? e.velocity ?? 0, ch = e.channel;
  const id = ch + ':' + key;
  if (isOn && vel > 0) { if (on.has(id)) { const n = on.get(id); n.end = sec(e.tick); notes.push(n); } on.set(id, { start: sec(e.tick), pitch: key, velocity: vel, channel: ch }); }
  else if (isOff || (isOn && vel === 0)) { const n = on.get(id); if (n) { n.end = sec(e.tick); notes.push(n); on.delete(id); } }
}
const bars = score.masterBars.map(mb => { const b = { bar: mb.index + 1, tick: mb.start, time: sec(mb.start) };
  if (mb.section) b.section = mb.section.text || mb.section.marker; return b; });
const last = score.masterBars[score.masterBars.length - 1];
fs.writeFileSync(outFile, JSON.stringify({ title: score.title, artist: score.artist, tempo: score.tempo, bars, end: sec(last.start + last.calculateDuration()), notes: notes.sort((a, b) => a.start - b.start) }));
console.log('notes', notes.length, 'bars', bars.length, 'end', sec(last.start + last.calculateDuration()).toFixed(2), 'tempos', tempos.length);
