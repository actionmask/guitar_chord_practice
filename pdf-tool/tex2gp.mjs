// alphaTex -> Guitar Pro 7 (.gp), written next to each input file. Prints one JSON line with what was found:
// [{tracks:["Solo:142", ...], bad:[[track, bar, beats], ...]} | {error}] in the order of the inputs.
import * as alphaTab from '@coderline/alphatab';
import fs from 'fs';

const out = [];
for (const file of process.argv.slice(2)) {
  const settings = new alphaTab.Settings();
  const imp = new alphaTab.importer.AlphaTexImporter();
  let score;
  try {
    imp.initFromString(fs.readFileSync(file, 'utf8'), settings);
    score = imp.readScore();
  } catch (e) {
    const msgs = [];
    for (const k of ['lexerDiagnostics', 'parserDiagnostics', 'semanticDiagnostics']) {
      try { for (const d of (imp[k].items || imp[k])) if (d.severity >= 2) msgs.push(d.message.slice(0, 110) + ' @line ' + d.start.line); } catch (x) { }
    }
    out.push({ error: (msgs.slice(0, 3).join('; ') || String(e.message || e)).slice(0, 400) });
    continue;
  }
  const bad = [];
  score.tracks.forEach(t => t.staves[0].bars.forEach((bar, i) => {
    let d = 0;
    for (const bt of bar.voices[0].beats) if (bt.graceType === 0) d += bt.playbackDuration;
    if (Math.abs(d - 3840) > 130) bad.push([t.name, i + 1, Math.round(d / 96) / 10]);
  }));
  const gp = new alphaTab.exporter.Gp7Exporter().export(score, settings);
  fs.writeFileSync(file.replace(/\.alphatex$/i, '') + '.gp', gp);
  out.push({ tracks: score.tracks.map(t => t.name + ':' + t.staves[0].bars.length + ' bars'), bad });
}
console.log(JSON.stringify(out));
