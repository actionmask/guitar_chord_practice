// txt2gp.js — 和弦譜 txt（段落、和弦、歌詞）轉 alphaTex / Guitar Pro 7 (.gp)
// 支援網頁端直接貼上和弦譜、自訂刷法／分解和弦、預覽與即時載入練習
(function (root) {
  'use strict';

  // 支援和弦本體 + 把位後綴（如 C(2), C:2, C@8, C:barre, C(barre), C(封閉), C(開放)）
  const CHORD_REGEX = /^[A-G][#b♯♭]?(?:m|maj|min|dim|aug|sus|add|\d)*(?:\/[A-G][#b♯♭]?)?(?:(?:[:\(-](?:\d+|barre|open|封閉|開放)\)?)|(?:@\d+))?$/i;
  const CHORD_PURE = /^[A-G][#b♯♭]?(?:m|maj|min|dim|aug|sus|add|\d)*(?:\/[A-G][#b♯♭]?)?$/i;
  const HEADER_REGEX = /^\s*\[(.+?)\]\s*(.*)$/;
  const REPEAT_REGEX = /x(\d+)\s*$/i;

  // 預設常見吉他指型（當 chords-db 或 shapeFor 找不到時的保底字典，低音 E -> 高音 E）
  const DEFAULT_SHAPES = {
    'C': [-1, 3, 2, 0, 1, 0],
    'D': [-1, -1, 0, 2, 3, 2],
    'E': [0, 2, 2, 1, 0, 0],
    'F': [1, 3, 3, 2, 1, 1],
    'G': [3, 2, 0, 0, 0, 3],
    'A': [-1, 0, 2, 2, 2, 0],
    'B': [-1, 2, 4, 4, 4, 2],
    'Em': [0, 2, 2, 0, 0, 0],
    'Am': [-1, 0, 2, 2, 1, 0],
    'Dm': [-1, -1, 0, 2, 3, 1],
    'Bm': [-1, 2, 4, 4, 3, 2],
    'Fm': [1, 3, 3, 1, 1, 1],
    'Gm': [3, 5, 5, 3, 3, 3],
    'Cm': [-1, 3, 5, 5, 4, 3],
    'C7': [-1, 3, 2, 3, 1, 0],
    'D7': [-1, -1, 0, 2, 1, 2],
    'E7': [0, 2, 0, 1, 0, 0],
    'G7': [3, 2, 0, 0, 0, 1],
    'A7': [-1, 0, 2, 0, 2, 0],
    'B7': [-1, 2, 1, 2, 0, 2],
    'Em7': [0, 2, 2, 0, 3, 0],
    'Am7': [-1, 0, 2, 0, 1, 0],
    'Dm7': [-1, -1, 0, 2, 1, 1],
    'Cmaj7': [-1, 3, 2, 0, 0, 0],
    'Fmaj7': [-1, -1, 3, 2, 1, 0],
    'Gmaj7': [3, 2, 0, 0, 0, 2],
    'Amaj7': [-1, 0, 2, 1, 2, 0],
    'D/F#': [2, 0, 0, 2, 3, 2],
    'G/B': [-1, 2, 0, 0, 3, 3],
    'Cadd9': [-1, 3, 2, 0, 3, 3],
    'Asus4': [-1, 0, 2, 2, 3, 0],
    'Dsus4': [-1, -1, 0, 2, 3, 3],
    'Esus4': [0, 2, 2, 2, 0, 0],
    'Gsus4': [3, 2, 0, 0, 1, 3],
    'F#m': [2, 4, 4, 2, 2, 2],
    'F#m7': [2, 4, 2, 2, 2, 2],
    'C#m': [-1, 4, 6, 6, 5, 4],
    'C#m7': [-1, 4, 6, 4, 5, 4],
    'G#m': [4, 6, 6, 4, 4, 4],
    'Bb': [-1, 1, 3, 3, 3, 1],
    'Bbm': [-1, 1, 3, 3, 2, 1],
    'Eb': [-1, 6, 5, 3, 4, 3],
    'Ab': [4, 6, 6, 5, 4, 4]
  };

  // 從 Tokens 陣列解析成步驟物件清單（支援延音 - 合併時值，支援 4/8/16 分音符）
  function parsePatternTokens(tokens, mode, unit) {
    mode = mode || 'strum';
    unit = unit || 8;
    const events = [];
    tokens.forEach(tok => {
      if (tok === '-' && events.length) {
        events[events.length - 1].len++;
      } else {
        events.push({ tok: tok === '-' ? '.' : tok, len: 1 });
      }
    });

    const lenToDur8 = { 1: 8, 2: 4, 3: 4, 4: 2, 6: 2, 8: 1, 12: 1, 16: 1 };
    const lenToDur16 = { 1: 16, 2: 8, 3: 8, 4: 4, 6: 4, 8: 2, 12: 2, 16: 1 };
    const lenToDur4 = { 1: 4, 2: 2, 3: 2, 4: 1 };
    const lenToDur = unit === 16 ? lenToDur16 : (unit === 4 ? lenToDur4 : lenToDur8);

    return events.map(ev => {
      const t = ev.tok;
      const dur = lenToDur[ev.len] || unit;
      const dot = ev.len === 3 || ev.len === 6;
      if (t === 'D' || t === 'd') return { type: 'strum', dir: 'D', dur, dot };
      if (t === 'U' || t === 'u') return { type: 'strum', dir: 'U', dur, dot };
      if (t === 'X' || t === 'x') return { type: 'dead', dir: 'X', dur, dot };
      if (t === '.' || t === 'R' || t === 'r') return { type: 'rest', dur, dot };
      if (t === 'B' || t === 'b' || /^[1-6]$/.test(t)) return { type: 'arp', str: t.toUpperCase(), dur, dot };
      return { type: mode === 'arp' ? 'arp' : 'strum', dir: 'D', str: 'B', dur, dot };
    });
  }

  // 建立 pattern 物件
  function createPatternFromTokens(tokens, mode, ts, name, unit) {
    mode = mode || 'strum';
    ts = ts || [4, 4];
    name = name || '自訂刷法';
    unit = unit || (tokens.length === 16 ? 16 : (ts[0] === 3 && tokens.length === 3 ? 4 : 8));
    const steps = parsePatternTokens(tokens, mode, unit);
    const mid = Math.floor(tokens.length / 2);
    const halfSteps = parsePatternTokens(tokens.slice(0, mid), mode, unit);
    const strums = steps.map(st => {
      if (st.type === 'dead') return { stroke: 'mute' };
      if (st.type === 'rest') return { stroke: 'rest' };
      if (st.dir === 'D') return { stroke: 'down' };
      if (st.dir === 'U') return { stroke: 'up' };
      if (st.type === 'arp') return { stroke: st.str };
      return { stroke: 'down' };
    });
    return {
      id: 'custom',
      name,
      ts,
      unit,
      mode,
      rawTokens: tokens.slice(),
      steps,
      halfSteps,
      strums
    };
  }

  // 從字串（例如 "D-DU-UDU" 或 "B 3 2 3 1 3 2 3"）建立 pattern 物件
  function createPatternFromString(str, mode, ts, name, unit) {
    str = (str || '').trim();
    let tokens;
    if (str.includes(' ') || str.includes(',')) {
      tokens = str.split(/[\s,]+/).filter(Boolean);
    } else {
      tokens = str.split('').filter(Boolean);
    }
    return createPatternFromTokens(tokens, mode, ts, name, unit);
  }

  function definePattern(id, name, str, mode, ts, unit) {
    ts = ts || (str.length === 6 ? [3, 4] : [4, 4]);
    unit = unit || (str.length === 16 ? 16 : (ts[0] === 3 && str.length === 4 ? 4 : 8));
    mode = mode || (/^[1-6B]/i.test(str) ? 'arp' : 'strum');
    const pat = createPatternFromString(str, mode, ts, name, unit);
    pat.id = id;
    return pat;
  }

  // 預設伴奏風格 Patterns（完整吉他刷法與伴奏庫）
  const PATTERNS = {
    // 基礎與民謠流行
    folk: definePattern('folk', '經典民謠 (下 - 下上 - 上下上)', 'D-DU-UDU', 'strum', [4, 4], 8),
    pop8: definePattern('pop8', '流行八分 (下 - 下上 下 - 下上)', 'D-DUD-DU', 'strum', [4, 4], 8),
    pop8_basic: definePattern('pop8_basic', '入門八分 (下 下 下上下上)', 'D-D-DUDU', 'strum', [4, 4], 8),
    straight_8: definePattern('straight_8', '連續八分刷 (搖滾推進)', 'DUDUDUDU', 'strum', [4, 4], 8),
    strum4: definePattern('strum4', '抒情四分刷 (下 下 下 下)', 'D-D-D-D-', 'strum', [4, 4], 8),
    folk_16: definePattern('folk_16', '十六分精緻民謠 (輕快切分)', 'D--UD--UD-DU-UDU', 'strum', [4, 4], 16),
    syncopated_pop: definePattern('syncopated_pop', '強烈切分流行刷 (副歌推進)', 'D---D-UD-UD-DU-U', 'strum', [4, 4], 16),
    whole_note: definePattern('whole_note', '全音符長音 (結尾/靜態刷)', 'D-------', 'strum', [4, 4], 8),

    // 切音與擊板
    chop: definePattern('chop', '輕快切音 (慢搖滾切音)', 'DXUXDXUX', 'strum', [4, 4], 8),
    acoustic_slap: definePattern('acoustic_slap', '木吉他拍弦 (2/4拍小鼓擊弦)', 'D-XU-UXU', 'strum', [4, 4], 8),
    funk_strum: definePattern('funk_strum', 'Funk 悶音律動 (十六分)', 'D.XUD.XU.UX.D.XU', 'strum', [4, 4], 16),
    reggae_offbeat: definePattern('reggae_offbeat', '雷鬼後半拍切刷 (Offbeat)', '.X.X.X.X', 'strum', [4, 4], 8),

    // 特色風格
    country_boom_chick: definePattern('country_boom_chick', '鄉村交替低音 (Boom-Chick)', 'B-D-B-D-', 'strum', [4, 4], 8),
    country_boom_chicka: definePattern('country_boom_chicka', '鄉村奔馳刷法 (Boom-Chicka)', 'B-DUB-DU', 'strum', [4, 4], 8),

    // 三拍子與複拍子
    waltz: definePattern('waltz', '傳統華爾滋 3/4 拍 (澎 恰 恰)', 'B-D-D-', 'strum', [3, 4], 8),
    waltz_pop: definePattern('waltz_pop', '輕快 3/4 流行刷法', 'D-DUDU', 'strum', [3, 4], 8),
    waltz_folk: definePattern('waltz_folk', '民謠 3/4 抒情刷法', 'D-D-DU', 'strum', [3, 4], 8),
    slow_rock_68: definePattern('slow_rock_68', '慢搖滾三連音 6/8', 'D-D-D-D-D-D-', 'strum', [6, 8], 16),
    folk_68: definePattern('folk_68', '民謠 6/8 搖擺刷法', 'D-UD-UD-UD-U', 'strum', [6, 8], 16),

    // 分解和弦
    arp4: definePattern('arp4', '吉他分解和弦 (T 3 2 3 1 3 2 3)', 'B3231323', 'arp', [4, 4], 8),
    arp_folk_ballad: definePattern('arp_folk_ballad', '抒情民謠分解 (流水型)', 'B3213231', 'arp', [4, 4], 8),
    arp_travis: definePattern('arp_travis', 'Travis Picking (鄉村雙根音)', 'B3B1B3B1', 'arp', [4, 4], 8),
    arp_waltz_34: definePattern('arp_waltz_34', '華爾滋 3/4 分解', 'B32123', 'arp', [3, 4], 8),
    arp_slow_rock_68: definePattern('arp_slow_rock_68', '慢搖滾 6/8 指彈', 'B32123', 'arp', [6, 8], 8)
  };

  // 同名別名對齊
  PATTERNS['old_faithful'] = PATTERNS.folk;
  PATTERNS['chop_rock'] = PATTERNS.chop;
  PATTERNS['waltz_classic'] = PATTERNS.waltz;
  PATTERNS['arp_t123'] = PATTERNS.arp4;

  const PATTERNS_ALIAS = {
    '民謠': 'folk', '抒情': 'folk', 'old_faithful': 'folk',
    '流行': 'pop8', '八拍': 'pop8', 'pop': 'pop8',
    '四拍': 'strum4', '四分': 'strum4',
    '切音': 'chop', '慢搖滾切音': 'chop',
    '拍弦': 'acoustic_slap', '木吉他拍弦': 'acoustic_slap', '打弦': 'acoustic_slap',
    '指彈': 'arp4', '分解': 'arp4', 't123': 'arp4',
    '華爾茲': 'waltz', '三拍': 'waltz', '三拍子': 'waltz',
    '長音': 'whole_note', '全音符': 'whole_note',
    '放克': 'funk_strum', 'funk': 'funk_strum',
    '雷鬼': 'reggae_offbeat', 'reggae': 'reggae_offbeat',
    '鄉村': 'country_boom_chick', 'boom_chick': 'country_boom_chick',
    '鄉村奔馳': 'country_boom_chicka',
    '慢搖滾': 'slow_rock_68', '6/8': 'slow_rock_68', '六八拍': 'slow_rock_68',
    '搖擺': 'folk_68',
    'travis': 'arp_travis', '雙根音': 'arp_travis',
    '十六分': 'folk_16', '精緻民謠': 'folk_16',
    '切分': 'syncopated_pop', '流行切分': 'syncopated_pop'
  };

  function resolvePattern(p, fallback) {
    if (typeof p === 'object' && p !== null && p.steps) return p;
    if (typeof p === 'string') {
      const k = p.toLowerCase().trim();
      if (PATTERNS[k]) return PATTERNS[k];
      if (PATTERNS_ALIAS[k] && PATTERNS[PATTERNS_ALIAS[k]]) return PATTERNS[PATTERNS_ALIAS[k]];
      if (k.length >= 3 && /^[DUX.\-1-6B]+$/i.test(k)) {
        return createPatternFromString(k, /^[1-6B]/i.test(k) ? 'arp' : 'strum', [4, 4]);
      }
    }
    return fallback !== undefined ? fallback : PATTERNS.folk;
  };

  // 標準和弦名稱格式化（轉半形、升降號統一）
  function normalizeChord(name) {
    if (!name) return '';
    let s = name.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
    s = s.replace(/\.$/, ''); // 去除結尾句點如 "Bb."
    return s;
  }

  // 解析和弦的把位後綴（支援 C(2), C:barre, C(barre), C@8, Am(3), G(2) 等）
  function parseChordVoicingSpec(rawName) {
    if (!rawName) return { raw: '', baseName: '', voicingIdx: 0, targetFret: 0, prefMode: '' };
    let s = rawName.trim().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/\.$/, '');
    let voicingIdx = 0, targetFret = 0, prefMode = '';

    const atMatch = /@(\d+)$/.exec(s);
    if (atMatch) {
      targetFret = parseInt(atMatch[1], 10);
      s = s.slice(0, atMatch.index).trim();
    }

    const modeMatch = /[:\(](barre|open|封閉|開放)[\)]?$/i.exec(s);
    if (modeMatch) {
      prefMode = /barre|封閉/i.test(modeMatch[1]) ? 'barre' : 'open';
      s = s.slice(0, modeMatch.index).trim();
    }

    const idxMatch = /[\(-](\d+)[\)]?$/.exec(s);
    if (idxMatch) {
      voicingIdx = parseInt(idxMatch[1], 10);
      s = s.slice(0, idxMatch.index).trim();
    }

    return { raw: rawName, baseName: s, voicingIdx, targetFret, prefMode };
  }

  // 取得和弦的六弦按法（回傳 low E -> high E，-1 為不彈）
  function getChordFrets(chordName, customShapes) {
    const norm = normalizeChord(chordName);
    if (!norm) return [0, 2, 2, 0, 0, 0];
    if (customShapes && customShapes[norm]) {
      return customShapes[norm].slice();
    }
    // 優先使用播放器內建的 shapeFor (支援 chords-db 及把位指型)
    if (typeof root.shapeFor === 'function') {
      try {
        const sh = root.shapeFor({ name: norm }, 'file');
        if (sh && sh.frets && sh.frets.length === 6) {
          return sh.frets.slice();
        }
      } catch (e) { }
    }
    const spec = parseChordVoicingSpec(norm);
    if (customShapes && customShapes[spec.baseName] && !spec.voicingIdx && !spec.targetFret && !spec.prefMode) {
      return customShapes[spec.baseName].slice();
    }
    if (DEFAULT_SHAPES[norm]) {
      return DEFAULT_SHAPES[norm].slice();
    }
    if (DEFAULT_SHAPES[spec.baseName]) {
      return DEFAULT_SHAPES[spec.baseName].slice();
    }
    // 試著拆掉 slash 和弦，先查主和弦
    const slashIdx = spec.baseName.indexOf('/');
    if (slashIdx > 0) {
      const base = spec.baseName.slice(0, slashIdx);
      if (DEFAULT_SHAPES[base]) {
        return DEFAULT_SHAPES[base].slice();
      }
    }
    // 預設大三或小三和弦保底
    if (/m/i.test(spec.baseName) && !/maj/i.test(spec.baseName)) {
      return DEFAULT_SHAPES['Am'].slice();
    }
    return DEFAULT_SHAPES['C'].slice();
  }

  // 找出和弦的最低根音弦號 (alphaTab: 6 = low E, 5 = A, 4 = D, 3 = G, 2 = B, 1 = high E)
  function getBassString(frets) {
    for (let i = 0; i < 6; i++) {
      if (frets[i] >= 0) return 6 - i;
    }
    return 6;
  }

  // 切割歌詞（依據和弦所在欄位）
  function splitLyric(lyric, cols) {
    const cuts = [];
    for (let c of cols) {
      c = Math.min(c, lyric.length);
      while (c > 0 && c < lyric.length && lyric[c - 1] !== ' ' && lyric[c] !== ' ') {
        c++;
      }
      cuts.push(c);
    }
    const lead = lyric.slice(0, cuts[0]).trim();
    const parts = [];
    for (let j = 0; j < cuts.length; j++) {
      const nextC = j + 1 < cuts.length ? cuts[j + 1] : lyric.length;
      parts.push(lyric.slice(cuts[j], nextC).trim());
    }
    return { lead, parts };
  }

  // 檢查是否為和弦行
  function isChordLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return false;
    let s = trimmed;
    const repMatch = s.match(REPEAT_REGEX);
    if (repMatch) {
      s = s.slice(0, repMatch.index).trim();
    }
    const tokens = s.split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;

    let chordCount = 0;
    for (const tok of tokens) {
      // 處理 |G D| 或 G+D
      const parts = tok.replace(/^[|]+|[|]+$/g, '').split('+').filter(Boolean);
      for (const p of parts) {
        const clean = p.replace(/:\d+$/, '');
        if (CHORD_REGEX.test(clean) || DEFAULT_SHAPES[clean] || (root.CHORDS && root.CHORDS[clean + '|major'])) {
          chordCount++;
        } else {
          return false;
        }
      }
    }
    return chordCount > 0;
  }

  // 解析和弦行中的各組和弦 [(col, [chords], bars)]
  function parseChordLine(line) {
    const groups = [];
    let inBar = false;
    // 取出每個 token 與其所在的起始欄位 index
    const regex = /\||[^\s|]+/g;
    let match;
    while ((match = regex.exec(line)) !== null) {
      const tok = match[0];
      const col = match.index;
      if (tok === '|') {
        inBar = !inBar;
        if (inBar) {
          groups.push({ col: col + 1, chords: [], bars: 1, isBarGroup: true });
        }
        continue;
      }
      if (REPEAT_REGEX.test(tok)) continue;

      let name = tok;
      let bars = 1;
      const colonIdx = name.indexOf(':');
      if (colonIdx > 0) {
        const num = parseInt(name.slice(colonIdx + 1), 10);
        if (!isNaN(num) && num > 0) bars = num;
        name = name.slice(0, colonIdx);
      }
      const chords = name.split('+').map(normalizeChord).filter(Boolean);
      if (!chords.length) continue;

      if (inBar && groups.length && groups[groups.length - 1].isBarGroup) {
        if (!groups[groups.length - 1].chords.length) {
          groups[groups.length - 1].col = col;
        }
        groups[groups.length - 1].chords.push(...chords);
      } else {
        groups.push({ col, chords, bars, isBarGroup: false });
      }
    }
    return groups;
  }

  // 解析整個 txt 文字檔
  function parseSongTxt(txt) {
    const lines = txt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const meta = {
      title: '',
      artist: '',
      tempo: 100,
      ts: [4, 4]
    };

    const sections = [];
    let curSection = null;

    function getCurSection(name) {
      if (!curSection || (name && curSection.name !== name)) {
        curSection = { name: name || (sections.length ? 'Section ' + (sections.length + 1) : null), bars: [] };
        sections.push(curSection);
      }
      return curSection;
    }

    let i = 0;
    while (i < lines.length) {
      let rawLine = lines[i];
      i++;
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('#') || (trimmed.startsWith('(') && trimmed.endsWith(')'))) {
        continue;
      }

      // 解析前導資訊（Title, Artist, BPM, Tempo）
      const metaMatch = trimmed.match(/^(title|歌名|artist|歌手|原唱|bpm|tempo|速度|ts|拍號)\s*[:：]\s*(.+)$/i);
      if (metaMatch) {
        const key = metaMatch[1].toLowerCase();
        const val = metaMatch[2].trim();
        if (key === 'title' || key === '歌名') meta.title = val;
        else if (key === 'artist' || key === '歌手' || key === '原唱') meta.artist = val;
        else if (key === 'bpm' || key === 'tempo' || key === '速度') {
          const num = parseInt(val, 10);
          if (num > 30 && num < 300) meta.tempo = num;
        } else if (key === 'ts' || key === '拍號') {
          const p = val.split('/');
          if (p.length === 2) meta.ts = [parseInt(p[0], 10) || 4, parseInt(p[1], 10) || 4];
        }
        continue;
      }

      // 段落標籤 [Verse], [Chorus], 也支援 [Verse:folk], [Chorus:pop8], [主歌:民謠], [Chorus:D-DUD-DU]
      const headerMatch = rawLine.match(HEADER_REGEX);
      if (headerMatch) {
        let secRaw = headerMatch[1].trim();
        let secPattern = null;
        const colIdx = secRaw.indexOf(':');
        const eqIdx = secRaw.indexOf('=');
        if (colIdx > 0) {
          secPattern = secRaw.slice(colIdx + 1).trim();
          secRaw = secRaw.slice(0, colIdx).trim();
        } else if (eqIdx > 0) {
          secPattern = secRaw.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
          secRaw = secRaw.slice(0, eqIdx).replace(/pattern\s*$/i, '').trim();
        }
        curSection = { name: secRaw, pattern: secPattern, bars: [] };
        sections.push(curSection);
        const remain = headerMatch[2].trim();
        if (!remain) continue;
        // 同一行後面還有和弦
        rawLine = remain;
      }

      // 和弦行
      if (isChordLine(rawLine)) {
        const lineContent = rawLine;
        let rep = 1;
        const repMatch = lineContent.match(REPEAT_REGEX);
        let chordLineBody = lineContent;
        if (repMatch) {
          rep = parseInt(repMatch[1], 10) || 1;
          chordLineBody = lineContent.slice(0, repMatch.index).trim();
        }

        const groups = parseChordLine(chordLineBody);
        if (!groups.length) continue;

        // 檢查下一行是否為歌詞
        let lyricLine = '';
        if (i < lines.length) {
          const nextLine = lines[i];
          const nTrim = nextLine.trim();
          if (nTrim && !HEADER_REGEX.test(nextLine) && !isChordLine(nextLine) &&
            !nTrim.startsWith('#') && !(nTrim.startsWith('(') && nTrim.endsWith(')'))) {
            lyricLine = nextLine;
            i++;
          }
        }

        // 依據欄位將歌詞切給各和弦
        let lead = '';
        let parts = [];
        const isCompact = groups.length > 1 && groups.every((g, idx) => idx === 0 || g.col - groups[idx - 1].col <= 4);
        if (!lyricLine.trim()) {
          parts = new Array(groups.length).fill('');
        } else if (isCompact) {
          // 擠在一起的簡寫和弦：整句歌詞放在第一個和弦
          parts = [lyricLine.trim(), ...new Array(groups.length - 1).fill('')];
        } else {
          const res = splitLyric(lyricLine, groups.map(g => g.col));
          lead = res.lead;
          parts = res.parts;
        }

        const sec = getCurSection();
        // 弱起歌詞接在前一小節
        if (lead && sec.bars.length) {
          sec.bars[sec.bars.length - 1].text = (sec.bars[sec.bars.length - 1].text + ' ' + lead).trim();
        }

        // 依據重複次數展開小節
        for (let r = 0; r < rep; r++) {
          groups.forEach((g, idx) => {
            const lyricText = (r === 0 ? parts[idx] || '' : '');
            for (let b = 0; b < g.bars; b++) {
              sec.bars.push({
                chords: g.chords,
                text: b === 0 ? lyricText : ''
              });
            }
          });
        }
      } else {
        // 沒有和弦的獨立歌詞行：接到最後一小節後面
        if (curSection && curSection.bars.length) {
          const lastBar = curSection.bars[curSection.bars.length - 1];
          lastBar.text = (lastBar.text + ' ' + trimmed).trim();
        }
      }
    }

    // 移除空段落
    const validSections = sections.filter(s => s.bars.length > 0);
    return { meta, sections: validSections };
  }

  // 將步驟轉成 alphaTex 拍子字串
  function stepToAlphaTex(step, chordName, frets, isFirstBeat, barText) {
    const highFrets = [frets[5], frets[4], frets[3], frets[2], frets[1], frets[0]]; // 弦 1 到 6 的品格
    const dur = step.dur || 4;

    const fx = [];
    if (step.dot) {
      fx.push('d');
    }
    if (isFirstBeat && chordName) {
      const cleanChord = parseChordVoicingSpec(chordName).baseName || chordName;
      fx.push('ch "' + cleanChord + '"');
    }
    if (barText && isFirstBeat) {
      const cleanTxt = barText.replace(/\\/g, '/').replace(/"/g, "'");
      fx.push('txt "' + cleanTxt + '"');
    }

    if (step.type === 'rest') {
      return 'r.' + dur + (fx.length ? '{' + fx.join(' ') + '}' : '');
    }

    if (step.type === 'strum') {
      if (step.dir === 'D') fx.push('sd');
      else if (step.dir === 'U') fx.push('su');

      // 產生所有品格 >= 0 的音符
      const notes = [];
      const lo = step.highOnly ? 0 : 0;
      const hi = step.highOnly ? 4 : 6;
      for (let s = lo; s < hi; s++) {
        const fret = highFrets[s];
        if (fret >= 0) {
          notes.push(fret + '.' + (s + 1));
        }
      }
      if (!notes.length) return 'r.' + dur + (fx.length ? '{' + fx.join(' ') + '}' : '');
      const body = notes.length === 1 ? notes[0] : '(' + notes.join(' ') + ')';
      return body + '.' + dur + (fx.length ? '{' + fx.join(' ') + '}' : '');
    }

    if (step.type === 'dead') {
      const deadNotes = [];
      for (let s = 0; s < 6; s++) {
        if (highFrets[s] >= 0) {
          deadNotes.push('x.' + (s + 1));
        }
      }
      if (!deadNotes.length) return 'r.' + dur + (fx.length ? '{' + fx.join(' ') + '}' : '');
      const body = deadNotes.length === 1 ? deadNotes[0] : '(' + deadNotes.join(' ') + ')';
      return body + '.' + dur + (fx.length ? '{' + fx.join(' ') + '}' : '');
    }

    if (step.type === 'arp') {
      let sNum;
      if (step.str === 'B') {
        sNum = getBassString(frets); // 1~6
      } else {
        sNum = parseInt(step.str, 10) || 3;
      }
      const sIdx = sNum - 1; // 0-based: 0 = high E, 5 = low E
      let fret = highFrets[sIdx];
      if (fret < 0) {
        // 若該弦沒按，找最近有發聲的弦
        for (let k = 0; k < 6; k++) {
          if (highFrets[k] >= 0) {
            sNum = k + 1;
            fret = highFrets[k];
            break;
          }
        }
      }
      if (fret < 0) return 'r.' + dur + (fx.length ? '{' + fx.join(' ') + '}' : '');
      return fret + '.' + sNum + '.' + dur + (fx.length ? '{' + fx.join(' ') + '}' : '');
    }

    return 'r.' + dur + (fx.length ? '{' + fx.join(' ') + '}' : '');
  }

  function stepDurationInQuarters(st) {
    const base = 4 / (st.dur || 4);
    return st.dot ? base * 1.5 : base;
  }

  // 產生單一小節的 alphaTex（支援單一和弦或多和弦/各拍不同和弦）
  function renderBar(bar, pattern, customShapes, customBarChords) {
    const barText = bar.text || '';
    let chordItems = [];

    if (Array.isArray(customBarChords) && customBarChords.length > 0) {
      chordItems = customBarChords.map((c, i) => {
        if (typeof c === 'string') return { name: c, posFrac: i / customBarChords.length };
        return { name: c.name || 'C', posFrac: (c.posFrac !== undefined ? c.posFrac : (i / customBarChords.length)) };
      }).filter(c => !!c.name);
    } else if (bar.chords && bar.chords.length) {
      chordItems = bar.chords.map((c, i) => ({
        name: c,
        posFrac: i / bar.chords.length
      }));
    }

    if (!chordItems.length) chordItems = [{ name: 'C', posFrac: 0 }];

    // 只有一個和弦：套用完整小節 steps
    if (chordItems.length === 1) {
      const c = chordItems[0].name;
      const frets = getChordFrets(c, customShapes);
      const steps = pattern.steps;
      return steps.map((st, idx) => stepToAlphaTex(st, c, frets, idx === 0, barText)).join(' ');
    }

    // 小節內有多個和弦（如 2 個、3 個或 4 個和弦 C F G B）：
    // 依據時間位置（posFrac）精確分配小節 steps，確保小節時值絕對不超拍，且各和弦與品位正確切換！
    chordItems.sort((a, b) => a.posFrac - b.posFrac);

    const steps = pattern.steps;
    let totalQuarterBeats = 0;
    steps.forEach(st => { totalQuarterBeats += stepDurationInQuarters(st); });
    if (totalQuarterBeats <= 0) totalQuarterBeats = 4;

    let curQuarterBeat = 0;
    let lastChordName = null;
    const toks = [];

    steps.forEach((st, idx) => {
      const frac = curQuarterBeat / totalQuarterBeats;
      let matchedChord = chordItems[0].name;
      for (const item of chordItems) {
        if (item.posFrac <= frac + 0.001) {
          matchedChord = item.name;
        }
      }

      const isFirstOfThisChord = (matchedChord !== lastChordName);
      lastChordName = matchedChord;
      const frets = getChordFrets(matchedChord, customShapes);
      const txt = (idx === 0) ? barText : '';

      toks.push(stepToAlphaTex(st, matchedChord, frets, isFirstOfThisChord, txt));
      curQuarterBeat += stepDurationInQuarters(st);
    });

    return toks.join(' ');
  }

  // 建構完整的 alphaTex，支援主歌與副歌不同刷法
  function buildAlphaTex(song, opts) {
    opts = opts || {};
    const meta = song.meta;
    const title = opts.title || meta.title || '自訂和弦譜';
    const artist = opts.artist || meta.artist || '';
    const tempo = opts.tempo || meta.tempo || 100;

    // 支援傳入單一 pattern 或多段落 patterns: { default, verse, chorus }
    const patternsMap = (typeof opts.patterns === 'object' && opts.patterns !== null) ? opts.patterns : {};
    const defaultPatKey = opts.pattern || patternsMap.default || 'folk';
    const defaultPattern = (typeof defaultPatKey === 'object' && defaultPatKey !== null) ? defaultPatKey : (PATTERNS[defaultPatKey] || PATTERNS['folk']);
    const customShapes = opts.shapes || {};
    const ts = opts.ts || defaultPattern.ts || [4, 4];

    function resolveSectionPattern(p) {
      return resolvePattern(p, defaultPattern);
    }

    function resolvePatternForSection(sec) {
      if (!sec) return defaultPattern;
      const sName = (sec.name || '').toLowerCase();
      // 1. 優先採用指定段落名稱的刷法 (patternsMap 或 UI 自訂)
      if (sec.name && (patternsMap[sec.name] || patternsMap[sName])) {
        return resolvePattern(patternsMap[sec.name] || patternsMap[sName]);
      }
      // 2. 段落標籤文字中標註的刷法（如 [Intro:arp4]、[Verse:folk] 或 [Chorus:DXUXDXUX]）
      if (sec.pattern) {
        const rp = resolvePattern(sec.pattern);
        if (rp) return rp;
      }
      // 3. 依段落名稱自動配對主歌 vs 副歌
      if (/chorus|副歌|高潮/.test(sName)) {
        if (patternsMap.chorus) return resolvePattern(patternsMap.chorus);
        if (PATTERNS['pop8']) return PATTERNS['pop8'];
      }
      if (/verse|主歌|段落|a段|b段/.test(sName)) {
        if (patternsMap.verse) return resolvePattern(patternsMap.verse);
        if (PATTERNS['folk']) return PATTERNS['folk'];
      }
      if (patternsMap[sName]) return resolvePattern(patternsMap[sName]);
      return patternsMap.default ? resolvePattern(patternsMap.default) : defaultPattern;
    }

    // 收集所有出現過的和弦（包含文字譜原始和弦以及使用者自訂的小節和弦）
    const chordSet = new Set();
    song.sections.forEach(sec => {
      sec.bars.forEach(b => {
        (b.chords || []).forEach(c => chordSet.add(normalizeChord(c)));
      });
    });
    if (opts.customChords && typeof opts.customChords === 'object') {
      for (const bStr in opts.customChords) {
        const list = opts.customChords[bStr] || [];
        list.forEach(c => {
          const nm = typeof c === 'string' ? c : c.name;
          if (nm) chordSet.add(normalizeChord(nm));
        });
      }
    }

    // 產生 \chord ("C" 0 1 0 2 3 x)
    const chordDefs = [];
    const definedDefs = new Set();
    for (const c of chordSet) {
      if (!c) continue;
      const clean = parseChordVoicingSpec(c).baseName || c;
      const f = getChordFrets(c, customShapes);
      // high E (f[5]) 到 low E (f[0])
      const s = [f[5], f[4], f[3], f[2], f[1], f[0]].map(x => (x < 0 ? 'x' : x)).join(' ');
      if (!definedDefs.has(clean)) {
        chordDefs.push('\\chord ("' + clean + '" ' + s + ')');
        definedDefs.add(clean);
      }
      if (c !== clean && !definedDefs.has(c)) {
        chordDefs.push('\\chord ("' + c + '" ' + s + ')');
        definedDefs.add(c);
      }
    }

    const esc = s => (s || '').replace(/"/g, "'");
    const lines = [
      '\\title "' + esc(title) + '"',
      '\\artist "' + esc(artist) + '"',
      '\\tempo ' + tempo,
      '.',
      '\\track ("吉他伴奏" "Gtr")',
      '\\staff {tabs}',
      '\\tuning (E4 B3 G3 D3 A2 E2)',
      ...chordDefs,
      '\\ts ' + ts[0] + ' ' + ts[1]
    ];

    const lyricsMap = {};
    let totalBars = 0;
    song.sections.forEach(sec => {
      let isFirstInSec = true;
      const secPattern = resolvePatternForSection(sec);
      sec.bars.forEach(b => {
        totalBars++;
        const barIdx = totalBars - 1;
        if (b.text) lyricsMap[barIdx] = b.text;
        const customBarChords = (opts.customChords && opts.customChords[barIdx]) ? opts.customChords[barIdx] : null;
        let barTex = renderBar(b, secPattern, customShapes, customBarChords);
        if (isFirstInSec && sec.name) {
          barTex = '\\section "' + esc(sec.name) + '" ' + barTex;
          isFirstInSec = false;
        }
        lines.push(barTex + ' |  // ' + totalBars);
      });
    });

    // 移除最後一個小節結尾的 '|' 避免空小節
    if (lines.length > 0) {
      const last = lines[lines.length - 1];
      lines[lines.length - 1] = last.replace(/\|\s*\/\/\s*\d+$/, '');
    }

    return {
      tex: lines.join('\n') + '\n',
      title,
      artist,
      tempo,
      totalBars,
      chordCount: chordSet.size,
      lyrics: lyricsMap
    };
  }

  // 主入口：將 txt 轉為 alphaTex 與 .gp 檔案
  function convertTxtToGp(txt, opts) {
    opts = opts || {};
    const parsed = parseSongTxt(txt);
    if (!parsed.sections.length) {
      throw new Error('未在輸入文字中找到任何和弦或段落，請確認格式（例如 [Verse] 下一行寫和弦與歌詞）。');
    }

    const res = buildAlphaTex(parsed, opts);
    let gpBytes = null;
    let badBars = [];

    // 若有 texToGp 函式可用（如在 index.html 環境中）
    if (typeof root.texToGp === 'function') {
      try {
        const gpRes = root.texToGp(res.tex);
        gpBytes = gpRes.bytes;
        badBars = gpRes.bad || [];
      } catch (e) {
        console.warn('texToGp 轉檔警告:', e);
      }
    }

    return {
      title: res.title,
      artist: res.artist,
      tempo: res.tempo,
      totalBars: res.totalBars,
      chordCount: res.chordCount,
      tex: res.tex,
      bytes: gpBytes,
      badBars
    };
  }

  const api = {
    PATTERNS,
    PATTERNS_ALIAS,
    resolvePattern,
    DEFAULT_SHAPES,
    parseSongTxt,
    buildAlphaTex,
    convertTxtToGp,
    getChordFrets,
    normalizeChord,
    parseChordVoicingSpec,
    parsePatternTokens,
    createPatternFromTokens,
    createPatternFromString
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Txt2Gp = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
