// txt2gp.js — 和弦譜 txt（段落、和弦、歌詞）轉 alphaTex / Guitar Pro 7 (.gp)
// 支援網頁端直接貼上和弦譜、自訂刷法／分解和弦、預覽與即時載入練習
(function (root) {
  'use strict';

  // 和弦性質：maj7、m7b5、m7-5、7#9、7(b9)、maj7#11、sus4、add9、aug、+、dim7、°、ø、M7、13 …
  // -5／-9／-13 是延伸音（m7-5 = 半減七），不是把位編號；把位請寫 C(2) 或 C-2。
  const QUALITY = '(?:maj|min|dim|aug|sus|add|m|M|\\+|°|ø|\\d|[#b♯♭](?:5|9|11|13)|-(?:5|9|13)|\\([#b♯♭]\\d+\\))*';
  const ROOT = '[A-G][#b♯♭]?';
  // 支援和弦本體 + 把位後綴（如 C(2), C:2, C@8, C:barre, C(barre), C(封閉), C(開放)）
  const CHORD_REGEX = new RegExp('^' + ROOT + QUALITY + '(?:\\/' + ROOT + ')?(?:(?:[:\\(-](?:\\d+|barre|open|封閉|開放)\\)?)|(?:@\\d+))?$');
  const CHORD_PURE = new RegExp('^' + ROOT + QUALITY + '(?:\\/' + ROOT + ')?$');
  // N.C.（No Chord）：這段不彈，但歌詞照樣顯示。也接受 NC、N.C
  const NC_REGEX = /^N\.?C\.?$/;
  const NC = 'N.C.';
  const isNC = name => NC_REGEX.test(String(name || '').trim());
  // "C+G" = 一小節兩個和弦；"C+" 本身是增和弦，所以只在 + 後面接根音時才切開
  const splitPlus = tok => tok.split(/\+(?=[A-G])/).filter(Boolean);
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

    // 把「幾個 unit 長」拆成記得出來的音符（全、附點二分、二分、附點四分…），
    // 例如 8 分音符為單位時長度 5 = 二分 + 八分（第二段用延音線接上），不會再被截短。
    const pieces = [];
    for (let len = unit; len >= 1; len /= 2) {
      if (len >= 2 && Number.isInteger(len * 1.5) && len * 1.5 <= unit) pieces.push({ len: len * 1.5, dur: unit / len, dot: true });
      pieces.push({ len, dur: unit / len, dot: false });
    }
    pieces.sort((a, b) => b.len - a.len);
    const split = len => {
      const out = [];
      while (len > 0) {
        const p = pieces.find(x => x.len <= len) || pieces[pieces.length - 1];
        out.push(p);
        len -= p.len;
      }
      return out;
    };

    const steps = [];
    events.forEach(ev => {
      const t = ev.tok;
      let base;
      if (t === 'D' || t === 'd') base = { type: 'strum', dir: 'D' };
      else if (t === 'U' || t === 'u') base = { type: 'strum', dir: 'U' };
      else if (t === 'X' || t === 'x') base = { type: 'dead', dir: 'X' };
      else if (t === '.' || t === 'R' || t === 'r') base = { type: 'rest' };
      else if (t === 'B' || t === 'b' || /^[1-6]$/.test(t)) base = { type: 'arp', str: t.toUpperCase() };
      else base = { type: mode === 'arp' ? 'arp' : 'strum', dir: 'D', str: 'B' };
      split(ev.len).forEach((p, k) => {
        // 第二段以後：刷弦／分解的音用延音線接著響；切音和休止就是休止
        const cont = k > 0 && (base.type === 'strum' || base.type === 'arp');
        const st = Object.assign({}, k > 0 && !cont ? { type: 'rest' } : base, { dur: p.dur, dot: p.dot });
        if (cont) st.tie = true;
        steps.push(st);
      });
    });
    return steps;
  }

  // 拍號換算成「幾個四分音符」：4/4 = 4、3/4 = 3、6/8 = 3
  function tsQuarters(ts) {
    return ts && ts[0] && ts[1] ? ts[0] * 4 / ts[1] : 4;
  }

  // 刷法長度和小節長度不合時：短的從頭循環補滿、長的截掉，並回報給使用者
  function fitTokens(tokens, barUnits) {
    if (!tokens.length || tokens.length === barUnits) return tokens.slice();
    const out = [];
    for (let i = 0; i < barUnits; i++) out.push(tokens[i % tokens.length]);
    // 循環接回開頭時，開頭若是延音記號就變成重新刷一次，避免延音接到不相干的位置
    if (tokens.length < barUnits && out[tokens.length] === '-') out[tokens.length] = tokens.find(t => t !== '-' && t !== '.') || '.';
    return out;
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
    const strums = steps.filter(st => !st.tie).map(st => {
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
    strum4: definePattern('strum4', '四分音符下刷 (下 下 下 下)', 'D-D-D-D-', 'strum', [4, 4], 8),
    strum4_34: definePattern('strum4_34', '四分音符下刷 3/4 (下 下 下)', 'D-D-D-', 'strum', [3, 4], 8),
    strum4_68: definePattern('strum4_68', '附點四分下刷 6/8 (下 下)', 'D--D--', 'strum', [6, 8], 8),
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

  // 各拍號沒指定刷法時的預設：所有段落（主歌、副歌都一樣）都是四分音符下刷，6/8 是每個附點四分一下
  const TS_DEFAULT_PATTERNS = {
    '4/4': { strum: 'strum4', chorus: 'strum4' },
    '3/4': { strum: 'strum4_34', chorus: 'strum4_34' },
    '6/8': { strum: 'strum4_68', chorus: 'strum4_68' }
  };

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

    // C(2)、C-2 是把位；但 m7-5、7-9、7-13 這種「數字後面的 -5/-9/-13」是延伸音，不能吃掉
    const idxMatch = /[\(-](\d+)[\)]?$/.exec(s);
    const isExtension = idxMatch && idxMatch[0][0] === '-' && /^(5|9|13)$/.test(idxMatch[1]) && /\d$/.test(s.slice(0, idxMatch.index));
    if (idxMatch && !isExtension) {
      voicingIdx = parseInt(idxMatch[1], 10);
      s = s.slice(0, idxMatch.index).trim();
    }

    return { raw: rawName, baseName: s, voicingIdx, targetFret, prefMode };
  }

  // 取得和弦的六弦按法（回傳 low E -> high E，-1 為不彈）
  function getChordFrets(chordName, customShapes) {
    if (isNC(chordName)) return [-1, -1, -1, -1, -1, -1];   // N.C.：六條弦都不彈
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

  // 等寬字型裡的顯示寬度：中日韓文字、全形符號、全形空白佔兩格
  function charWidth(ch) {
    const c = ch.codePointAt(0);
    if (c < 0x1100) return 1;
    if ((c <= 0x115F) || (c >= 0x2E80 && c <= 0xA4CF && c !== 0x303F) || (c >= 0xAC00 && c <= 0xD7A3) ||
      (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFE30 && c <= 0xFE4F) || (c >= 0xFF00 && c <= 0xFF60) ||
      (c >= 0xFFE0 && c <= 0xFFE6) || c >= 0x1F300) return 2;
    return 1;
  }
  function displayWidth(s) {
    let w = 0;
    for (const ch of s) w += charWidth(ch);
    return w;
  }

  // 切割歌詞（依據和弦所在的「顯示欄位」）。
  // 中文歌詞通常沒有空白：和弦正下方那個字就是這個和弦的第一個字。
  // 英文歌詞：和弦標在某個單字上（落在單字中間）時，那個單字整個屬於這個和弦，切點往前移到單字開頭。
  function splitLyric(lyric, cols) {
    const chars = Array.from(lyric);
    const starts = [];
    let w = 0;
    for (const ch of chars) { starts.push(w); w += charWidth(ch); }
    const isWord = ch => /[A-Za-z0-9'’]/.test(ch || '');
    const cuts = [];
    for (const col of cols) {
      // 第一個「涵蓋或超過這個欄位」的字
      let c = chars.findIndex((ch, i) => starts[i] + charWidth(ch) > col);
      if (c < 0) c = chars.length;
      while (c > 0 && c < chars.length && isWord(chars[c - 1]) && isWord(chars[c])) c--;
      if (cuts.length && c < cuts[cuts.length - 1]) c = cuts[cuts.length - 1];
      cuts.push(c);
    }
    const slice = (a, b) => chars.slice(a, b).join('');
    const lead = slice(0, cuts[0]).trim();
    const parts = [];
    for (let j = 0; j < cuts.length; j++) {
      const nextC = j + 1 < cuts.length ? cuts[j + 1] : chars.length;
      parts.push(slice(cuts[j], nextC).trim());
    }
    return { lead, parts, cuts };
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
    const hasBar = s.includes('|');
    for (const tok of tokens) {
      // 處理 |G D| 或 G+D；|C . . G| 裡的 . 或 - 是「這一拍不換和弦」的佔位
      const parts = splitPlus(tok.replace(/^[|]+|[|]+$/g, ''));
      for (const p of parts) {
        if (hasBar && /^[.\-]$/.test(p)) continue;
        const clean = p.replace(/:\d+$/, '');
        if (isNC(clean)) { chordCount++; continue; }
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
  // start／end 是這組和弦在這一行裡的字元範圍，回寫和弦（setBarChords）時用來替換
  function parseChordLine(line) {
    const groups = [];
    let inBar = false;
    // 取出每個 token 與其所在的起始欄位 index
    const regex = /\||[^\s|]+/g;
    let match;
    while ((match = regex.exec(line)) !== null) {
      const tok = match[0];
      const col = displayWidth(line.slice(0, match.index));
      if (tok === '|') {
        inBar = !inBar;
        if (inBar) {
          groups.push({ col: col + 1, chords: [], pos: [], slots: 0, bars: 1, isBarGroup: true, start: match.index, end: line.length });
        } else if (groups.length && groups[groups.length - 1].isBarGroup) {
          groups[groups.length - 1].end = match.index + 1;
        }
        continue;
      }
      if (REPEAT_REGEX.test(tok)) continue;
      // |C . . G|：佔位符號只佔一拍，不是和弦
      if (inBar && /^[.\-]$/.test(tok) && groups.length && groups[groups.length - 1].isBarGroup) {
        groups[groups.length - 1].slots++;
        continue;
      }

      let name = tok;
      let bars = 1;
      // "C:2" = C 彈兩小節；"C:barre" 是把位偏好，要原樣留給 parseChordVoicingSpec
      const barsMatch = /:(\d+)$/.exec(name);
      if (barsMatch) {
        const num = parseInt(barsMatch[1], 10);
        if (num > 0) bars = num;
        name = name.slice(0, barsMatch.index);
      }
      const chords = splitPlus(name).map(c => isNC(c) ? NC : normalizeChord(c)).filter(Boolean);
      if (!chords.length) continue;

      if (inBar && groups.length && groups[groups.length - 1].isBarGroup) {
        const g = groups[groups.length - 1];
        if (!g.chords.length) {
          g.col = col;
        }
        chords.forEach(c => { g.chords.push(c); g.pos.push(g.slots); g.slots++; });
      } else {
        groups.push({ col, chords, bars, isBarGroup: false, start: match.index, end: match.index + tok.length });
      }
    }
    // 小節群組裡每個和弦在小節中的位置（0～1）；沒有佔位符號時就是平均分配
    groups.forEach(g => {
      if (g.isBarGroup && g.slots > 0) g.chordPos = g.pos.map(p => p / g.slots);
    });
    return groups.filter(g => g.chords.length);
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
    let pendingLyric = '';   // 還沒有任何小節時出現的歌詞，留給下一個小節
    // 到目前為止的最後一小節（可能在前面的段落）
    function lastBarSoFar() {
      for (let k = sections.length - 1; k >= 0; k--) {
        const bs = sections[k].bars;
        if (bs.length) return bs[bs.length - 1];
      }
      return null;
    }

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
      const lineIdx = i;      // 這一行在原文的行號（回寫和弦用）
      let lineOffset = 0;     // 和弦從這一行第幾個字元開始（[Intro] Am C 這種同一行的寫法不是 0）
      i++;
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('#') || (trimmed.startsWith('(') && trimmed.endsWith(')'))) {
        continue;
      }

      // 解析前導資訊（Title, Artist, BPM, Tempo）
      const metaMatch = trimmed.match(/^(title|歌名|artist|歌手|原唱|bpm|tempo|速度|ts|拍號|strum|刷法)\s*[:：]\s*(.+)$/i);
      if (metaMatch) {
        const key = metaMatch[1].toLowerCase();
        const val = metaMatch[2].trim();
        if (key === 'strum' || key === '刷法') meta.strum = val;   // 全曲預設刷法（沒標刷法的段落都用這個）
        else if (key === 'title' || key === '歌名') meta.title = val;
        else if (key === 'artist' || key === '歌手' || key === '原唱') meta.artist = val;
        else if (key === 'bpm' || key === 'tempo' || key === '速度') {
          const num = parseInt(val, 10);
          if (num > 30 && num < 300) meta.tempo = num;
        } else if (key === 'ts' || key === '拍號') {
          const p = val.split('/');
          if (p.length === 2) {
            meta.ts = [parseInt(p[0], 10) || 4, parseInt(p[1], 10) || 4];
            meta.tsExplicit = true;
          }
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
        lineOffset = rawLine.length - headerMatch[2].length;
        rawLine = headerMatch[2].replace(/\s+$/, '');
      }

      // 和弦行
      if (isChordLine(rawLine)) {
        const lineContent = rawLine;
        let rep = 1;
        const repMatch = lineContent.match(REPEAT_REGEX);
        let chordLineBody = lineContent;
        if (repMatch) {
          rep = parseInt(repMatch[1], 10) || 1;
          // 只去掉結尾空白：開頭的空白決定和弦對齊歌詞的欄位，不能刪
          chordLineBody = lineContent.slice(0, repMatch.index).replace(/\s+$/, '');
        }

        const groups = parseChordLine(chordLineBody);
        if (!groups.length) continue;

        // 檢查下一行是否為歌詞
        let lyricLine = '';
        let lyricIdx = -1;
        if (i < lines.length) {
          const nextLine = lines[i];
          const nTrim = nextLine.trim();
          if (nTrim && !HEADER_REGEX.test(nextLine) && !isChordLine(nextLine) &&
            !nTrim.startsWith('#') && !(nTrim.startsWith('(') && nTrim.endsWith(')'))) {
            lyricLine = nextLine;
            lyricIdx = i;
            i++;
          }
        }
        let lyricCuts = null;

        // 依據欄位將歌詞切給各和弦
        let lead = '';
        let parts = [];
        // 簡寫和弦（"Em C G D" 和弦之間只隔一個空白，下面整句歌詞）：沒有對齊歌詞的意思，整句給第一個和弦。
        // 用「和弦之間的空白」判斷，不用欄位距離：對齊歌詞的和弦行至少會隔兩格以上。
        const endCol = g => displayWidth(chordLineBody.slice(0, g.end));
        const isCompact = groups.length > 1 && groups.every((g, idx) => idx === 0 || g.col - endCol(groups[idx - 1]) <= 1);
        if (!lyricLine.trim()) {
          parts = new Array(groups.length).fill('');
        } else if (isCompact) {
          // 擠在一起的簡寫和弦：整句歌詞放在第一個和弦
          parts = [lyricLine.trim(), ...new Array(groups.length - 1).fill('')];
        } else {
          const res = splitLyric(lyricLine, groups.map(g => g.col));
          lead = res.lead;
          parts = res.parts;
          lyricCuts = res.cuts;
        }

        const sec = getCurSection();
        // 弱起歌詞（第一個和弦之前的字）接在前一小節後面——歌詞是延續的，就算前一小節在上一段也一樣；
        // 整首歌的第一句沒有前一小節，就併進這一行第一個和弦，不要丟掉
        const prevBar = lastBarSoFar();
        if (pendingLyric) { lead = (pendingLyric + ' ' + lead).trim(); pendingLyric = ''; }
        if (lead && prevBar) {
          prevBar.text = (prevBar.text + ' ' + lead).trim();
        } else if (lead) {
          parts[0] = (lead + ' ' + (parts[0] || '')).trim();
        }

        // 依據重複次數展開小節
        for (let r = 0; r < rep; r++) {
          groups.forEach((g, idx) => {
            const lyricText = (r === 0 ? parts[idx] || '' : '');
            for (let b = 0; b < g.bars; b++) {
              sec.bars.push({
                chords: g.chords,
                chordPos: g.chordPos || null,
                text: b === 0 ? lyricText : '',
                // 這個小節寫在原文哪裡：回寫和弦（setBarChords）時用
                src: {
                  line: lineIdx, offset: lineOffset, start: g.start, end: g.end, group: idx,
                  reps: rep, rep: r, subs: g.bars, sub: b,
                  lyricLine: lyricIdx, cuts: lyricCuts
                }
              });
            }
          });
        }
      } else {
        // 沒有和弦的獨立歌詞行：接到目前最後一小節後面（就算在上一段）；前面還沒有小節，就留給下一個小節，不要丟掉
        const lastBar = lastBarSoFar();
        if (lastBar) lastBar.text = (lastBar.text + ' ' + trimmed).trim();
        else pendingLyric = (pendingLyric + ' ' + trimmed).trim();
      }
    }

    // 移除空段落
    const validSections = sections.filter(s => s.bars.length > 0);
    return { meta, sections: validSections };
  }

  // 將步驟轉成 alphaTex 拍子字串
  function stepToAlphaTex(step, chordName, frets, isFirstBeat, barText) {
    // N.C.：這一下改成休止（時值不變，小節照樣填滿），但保留 N.C. 標記和歌詞
    if (isNC(chordName)) step = { type: 'rest', dur: step.dur, dot: step.dot };
    const highFrets = [frets[5], frets[4], frets[3], frets[2], frets[1], frets[0]]; // 弦 1 到 6 的品格
    const dur = step.dur || 4;

    const fx = [];
    if (step.dot) {
      fx.push('d');
    }
    if (isFirstBeat && chordName) {
      const cleanChord = isNC(chordName) ? NC : (parseChordVoicingSpec(chordName).baseName || chordName);
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
      // 延音接續（tie）只是讓前一下繼續響，不是新的一刷，所以不標上下刷方向
      if (!step.tie && step.dir === 'D') fx.push('sd');
      else if (!step.tie && step.dir === 'U') fx.push('su');

      // 產生所有品格 >= 0 的音符
      const notes = [];
      const lo = step.highOnly ? 0 : 0;
      const hi = step.highOnly ? 4 : 6;
      for (let s = lo; s < hi; s++) {
        const fret = highFrets[s];
        if (fret >= 0) {
          notes.push((step.tie ? '-' : fret) + '.' + (s + 1));
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
      return (step.tie ? '-' : fret) + '.' + sNum + '.' + dur + (fx.length ? '{' + fx.join(' ') + '}' : '');
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
        posFrac: bar.chordPos ? bar.chordPos[i] : i / bar.chords.length
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

    // 換和弦的那一格如果正好是延音（-），改成重新刷／彈一次，否則後面的和弦根本不會響
    let steps = pattern.steps;
    if (pattern.rawTokens && pattern.rawTokens.length) {
      const toks = pattern.rawTokens.slice();
      let changed = false;
      chordItems.forEach(item => {
        const k = Math.round(item.posFrac * toks.length);
        if (k <= 0 || k >= toks.length || toks[k] !== '-') return;
        let j = k - 1;
        while (j > 0 && toks[j] === '-') j--;
        const held = toks[j];
        if (held === '.' || held === 'X' || held === 'x') return;   // 休止、切音不用補
        toks[k] = /^[1-6Bb]$/.test(held) ? held : 'D';
        changed = true;
      });
      if (changed) steps = parsePatternTokens(toks, pattern.mode, pattern.unit || 8);
    }
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
      // 延音線不能接到另一個和弦：換和弦的那一拍改成重新刷／彈
      if (st.tie && isFirstOfThisChord) st = Object.assign({}, st, { tie: false });
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
    // 歌手可以留空：呼叫端明確傳入 artist（包含空字串）時就照用，不再拿 txt 裡的 Artist: 補回去
    const artist = typeof opts.artist === 'string' ? opts.artist : (meta.artist || '');
    const tempo = opts.tempo || meta.tempo || 100;

    // 支援傳入單一 pattern 或多段落 patterns: { default, verse, chorus }
    const patternsMap = (typeof opts.patterns === 'object' && opts.patterns !== null) ? opts.patterns : {};
    const customShapes = opts.shapes || {};
    const warnings = [];
    const warn = msg => { if (!warnings.includes(msg)) warnings.push(msg); };

    // txt 開頭寫了 TS: 3/4 之類的拍號時，沒指定刷法的段落改用該拍號的預設刷法
    const tsKey = t => t[0] + '/' + t[1];
    const headerTs = meta.tsExplicit ? meta.ts : null;
    const tsDefaults = TS_DEFAULT_PATTERNS[headerTs ? tsKey(headerTs) : '4/4'];
    if (headerTs && !tsDefaults) warn('拍號 ' + tsKey(headerTs) + ' 沒有內建刷法，請在段落標籤指定刷法，例如 [Verse:D-DU-UDU]。');
    const autoPattern = kind => {
      if (headerTs && !tsDefaults) return Object.assign({}, PATTERNS.folk, { ts: headerTs });
      return PATTERNS[(tsDefaults || TS_DEFAULT_PATTERNS['4/4'])[kind]];
    };
    // 全曲預設：呼叫端傳的 default 若和 TS: 拍號不合，視為沒指定（介面的預設值是 4/4 民謠）
    const weakDefault = resolvePattern(patternsMap.default || opts.pattern || null, null);
    // txt 開頭的 Strum: 是明確寫下的全曲預設，優先於其他預設
    const headerStrum = meta.strum ? resolvePattern(meta.strum, null) : null;
    if (meta.strum && !headerStrum) warn('看不懂開頭的刷法「' + meta.strum + '」，改用預設刷法。');
    const fallbackPattern = headerStrum ||
      ((weakDefault && !(headerTs && tsKey(weakDefault.ts) !== tsKey(headerTs))) ? weakDefault : autoPattern('strum'));

    function resolvePatternForSection(sec) {
      if (!sec) return fallbackPattern;
      const sName = (sec.name || '').toLowerCase();
      // 1. 優先採用指定段落名稱的刷法 (patternsMap 或 UI 自訂)
      if (sec.name && (patternsMap[sec.name] || patternsMap[sName])) {
        return resolvePattern(patternsMap[sec.name] || patternsMap[sName]);
      }
      // 2. 段落標籤文字中標註的刷法（如 [Intro:arp4]、[Verse:folk] 或 [Chorus:DXUXDXUX]）
      if (sec.pattern) {
        const rp = resolvePattern(sec.pattern, null);
        if (rp) return rp;
        warn('看不懂「' + sec.name + '」的刷法「' + sec.pattern + '」，改用預設刷法。');
      }
      // 3. 其他段落一律用全曲預設（txt 的 Strum:、介面的全曲預設，或依拍號的四分音符下刷）
      if (/chorus|副歌|高潮/.test(sName) && patternsMap.chorus) return resolvePattern(patternsMap.chorus);
      if (/verse|主歌|段落|a段|b段/.test(sName) && patternsMap.verse) return resolvePattern(patternsMap.verse);
      return fallbackPattern;
    }

    // 每個段落的拍號跟著它的刷法走；刷法長度和小節不合時自動補滿／截斷並提醒
    const fitCache = new Map();
    function fitPatternToBar(pat, secName) {
      if (fitCache.has(pat)) return fitCache.get(pat);
      const ts = pat.ts || [4, 4];
      const unit = pat.unit || 8;
      const barUnits = Math.round(tsQuarters(ts) * unit / 4);
      let fitted = pat;
      if (pat.rawTokens && pat.rawTokens.length && pat.rawTokens.length !== barUnits) {
        const toks = fitTokens(pat.rawTokens, barUnits);
        fitted = Object.assign({}, pat, { rawTokens: toks, steps: parsePatternTokens(toks, pat.mode, unit) });
        warn('「' + (secName || pat.name) + '」的刷法有 ' + pat.rawTokens.length + ' 格，' + tsKey(ts) + ' 一小節要 ' + barUnits + ' 格，已' +
          (pat.rawTokens.length < barUnits ? '從頭循環補滿' : '截掉多出來的部分') + '。');
      }
      fitCache.set(pat, fitted);
      return fitted;
    }
    const firstPat = song.sections.length ? resolvePatternForSection(song.sections[0]) : fallbackPattern;
    const ts = opts.ts || firstPat.ts || [4, 4];

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
      if (!c || isNC(c)) continue;   // N.C. 沒有指型
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
    let curTs = tsKey(ts);
    song.sections.forEach(sec => {
      let isFirstInSec = true;
      const rawPattern = resolvePatternForSection(sec);
      const secTs = rawPattern.ts || [4, 4];
      if (headerTs && tsKey(secTs) !== tsKey(headerTs)) {
        warn('「' + (sec.name || '未命名段落') + '」的刷法是 ' + tsKey(secTs) + '，和開頭的 TS: ' + tsKey(headerTs) + ' 不同，這段用 ' + tsKey(secTs) + '。');
      }
      const secPattern = fitPatternToBar(rawPattern, sec.name);
      sec.bars.forEach(b => {
        totalBars++;
        const barIdx = totalBars - 1;
        if (b.text) lyricsMap[barIdx] = b.text;
        const customBarChords = (opts.customChords && opts.customChords[barIdx]) ? opts.customChords[barIdx] : null;
        let barTex = renderBar(b, secPattern, customShapes, customBarChords);
        if (isFirstInSec && sec.name) {
          barTex = '\\section "' + esc(sec.name) + '" ' + barTex;
        }
        // 拍號在段落之間改變時（例如前奏 3/4、主歌 4/4），在這一段第一小節前面標上新拍號
        if (isFirstInSec && tsKey(secTs) !== curTs) {
          barTex = '\\ts ' + secTs[0] + ' ' + secTs[1] + ' ' + barTex;
          curTs = tsKey(secTs);
        }
        isFirstInSec = false;
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
      lyrics: lyricsMap,
      warnings
    };
  }

  // ---------- 把和弦編輯器的修改寫回 txt ----------
  // 和弦編輯器以前把改過的和弦另外記在「全曲第幾小節」，txt 一多一行就全部錯位，存下來的 txt 也不會變。
  // 現在直接改 txt 本身：txt 是唯一的資料來源，看得到、改得動、存得下來。

  function allBars(txt) {
    return parseSongTxt(txt).sections.reduce((a, s) => a.concat(s.bars), []);
  }

  // 讀出第 barIndex 小節（0 起算）目前的和弦：[{ name, posFrac }]
  function getBarChords(txt, barIndex) {
    const bar = allBars(txt)[barIndex];
    if (!bar) return null;
    return bar.chords.map((c, i) => ({ name: c, posFrac: bar.chordPos ? bar.chordPos[i] : i / bar.chords.length }));
  }

  // [{name, posFrac}] → txt 寫法：一個和弦 "C"、平均分配 "C+G"、其他位置用拍點 "|C . . G|"
  function formatBarChords(list) {
    const items = list.filter(c => c && c.name).map(c => ({ name: String(c.name).trim(), pos: +c.posFrac || 0 }))
      .sort((a, b) => a.pos - b.pos);
    if (!items.length) return '';
    const even = items.every((c, i) => Math.abs(c.pos - i / items.length) < 0.001);
    if (even) return items.map(c => c.name).join('+');
    const n = [2, 3, 4, 6, 8, 12, 16].find(k => items.every(c => Math.abs(c.pos * k - Math.round(c.pos * k)) < 0.001)) || 16;
    const slots = new Array(n).fill('.');
    items.forEach(c => { slots[Math.min(n - 1, Math.round(c.pos * n))] = c.name; });
    return '|' + slots.join(' ') + '|';
  }

  // 把 lines[s.line] 裡這個小節的那段文字換成 text。
  // 後面的和弦盡量留在原來的欄位（吃掉後面多的空白或補空白）；真的放不下時，
  // 在歌詞行對應的切點補同樣寬度的空白，讓後面的和弦和歌詞仍然對得齊。
  function replaceSpan(lines, s, text) {
    const line = lines[s.line];
    const a = s.offset + s.start, b = s.offset + s.end;
    const before = line.slice(0, a), after = line.slice(b);
    const delta = displayWidth(text) - displayWidth(line.slice(a, b));
    let rest = after;
    let shift = 0;
    if (delta > 0) {
      const spaces = /^ */.exec(after)[0].length;
      const atEnd = !after.trim();
      const canEat = atEnd ? spaces : Math.max(0, spaces - 1);   // 和下一個和弦之間至少留一格
      const eat = Math.min(canEat, delta);
      rest = after.slice(eat);
      shift = delta - eat;
      if (shift && !atEnd && !/^ /.test(rest)) rest = ' ' + rest, shift++;
    } else if (delta < 0 && after.trim()) {
      rest = ' '.repeat(-delta) + after;
    }
    lines[s.line] = (before + text + rest).replace(/\s+$/, '');
    // 後面的和弦被往右推了：歌詞行在下一個和弦的切點補空白
    if (shift > 0 && s.lyricLine >= 0 && s.cuts && s.cuts[s.group + 1] !== undefined) {
      const chars = Array.from(lines[s.lyricLine]);
      chars.splice(s.cuts[s.group + 1], 0, ' '.repeat(shift));
      lines[s.lyricLine] = chars.join('');
    }
  }

  // 和弦行有 x2 重複時，先展開成兩行，才能只改其中一次
  function unrollRepeat(lines, s) {
    const line = lines[s.line];
    const m = REPEAT_REGEX.exec(line);
    if (!m) return false;
    const first = line.slice(0, m.index).replace(/\s+$/, '');
    const body = first.slice(s.offset);
    const copies = [];
    for (let r = 1; r < s.reps; r++) copies.push(body);
    lines[s.line] = first;
    const insertAt = (s.lyricLine >= 0 ? s.lyricLine : s.line) + 1;
    lines.splice(insertAt, 0, ...copies);
    return true;
  }

  // "C:2"（一個和弦彈兩小節）先拆成 "C C"，才能只改其中一小節
  function splitMultiBar(lines, s) {
    const tok = lines[s.line].slice(s.offset + s.start, s.offset + s.end);
    const name = tok.replace(/:\d+$/, '');
    replaceSpan(lines, s, new Array(s.subs).fill(name).join(' '));
    return true;
  }

  // 把第 barIndex 小節（0 起算，和 buildAlphaTex 的小節編號相同）的和弦改成 list，回傳新的 txt。
  // 找不到這個小節或 list 是空的就回傳 null（不改）。
  function setBarChords(txt, barIndex, list) {
    const text = formatBarChords(list || []);
    if (!text) return null;
    const eol = /\r\n/.test(txt) ? '\r\n' : '\n';
    let lines = txt.replace(/\r\n?/g, '\n').split('\n');
    for (let guard = 0; guard < 4; guard++) {
      const bar = allBars(lines.join('\n'))[barIndex];
      if (!bar || !bar.src) return null;
      const s = bar.src;
      if (s.reps > 1) { if (!unrollRepeat(lines, s)) return null; continue; }
      if (s.subs > 1) { splitMultiBar(lines, s); continue; }
      replaceSpan(lines, s, text);
      return lines.join(eol);
    }
    return null;
  }

  // ---------- 把介面上改的刷法寫回 txt ----------
  // 段落標籤 [Name] / [Name:刷法] / [Name pattern=刷法] 的「名稱」部分
  function headerName(inner) {
    const colIdx = inner.indexOf(':'), eqIdx = inner.indexOf('=');
    if (colIdx > 0) return inner.slice(0, colIdx).trim();
    if (eqIdx > 0) return inner.slice(0, eqIdx).replace(/pattern\s*$/i, '').trim();
    return inner.trim();
  }
  function mapLines(txt, fn) {
    const eol = /\r\n/.test(txt) ? '\r\n' : '\n';
    return txt.replace(/\r\n?/g, '\n').split('\n').map(fn).join(eol);
  }
  // 設定某個段落的刷法：同名的段落標籤全部改成 [名稱:刷法]（value 為空就拿掉刷法，只留 [名稱]）
  function setSectionStrum(txt, sectionName, value) {
    const want = String(sectionName || '').trim().toLowerCase();
    return mapLines(txt, line => {
      const m = HEADER_REGEX.exec(line);
      if (!m) return line;
      const name = headerName(m[1]);
      if (name.toLowerCase() !== want) return line;
      return line.replace('[' + m[1] + ']', '[' + name + (value ? ':' + value : '') + ']');
    });
  }
  // 設定全曲預設刷法：開頭的 Strum: 行（沒有就加在 Title／BPM 等資訊後面），
  // 並拿掉所有段落標籤上的刷法——全曲預設會套用到所有段落，txt 也要一致
  function setSongStrum(txt, value) {
    const eol = /\r\n/.test(txt) ? '\r\n' : '\n';
    const lines = txt.replace(/\r\n?/g, '\n').split('\n');
    const metaRe = /^\s*(title|歌名|artist|歌手|原唱|bpm|tempo|速度|ts|拍號|strum|刷法)\s*[:：]/i;
    const strumRe = /^\s*(strum|刷法)\s*[:：]/i;
    let found = false, lastMeta = -1;
    for (let i = 0; i < lines.length; i++) {
      if (HEADER_REGEX.test(lines[i])) break;   // 第一個段落之後就不是開頭資訊了
      if (strumRe.test(lines[i])) { lines[i] = 'Strum: ' + value; found = true; }
      if (metaRe.test(lines[i])) lastMeta = i;
    }
    if (!found) lines.splice(lastMeta + 1, 0, 'Strum: ' + value);
    return lines.map(line => {
      const m = HEADER_REGEX.exec(line);
      if (!m) return line;
      const name = headerName(m[1]);
      return name === m[1].trim() ? line : line.replace('[' + m[1] + ']', '[' + name + ']');
    }).join(eol);
  }

  // ---------- 歌名／歌手／BPM 欄位 <-> txt 開頭資訊 ----------
  const META_KEYS = {
    title: { re: /^(\s*)(title|歌名)(\s*[:：]\s*)(.*)$/i, label: 'Title', rank: 0 },
    artist: { re: /^(\s*)(artist|歌手|原唱)(\s*[:：]\s*)(.*)$/i, label: 'Artist', rank: 1 },
    bpm: { re: /^(\s*)(bpm|tempo|速度)(\s*[:：]\s*)(.*)$/i, label: 'BPM', rank: 2 },
    ts: { re: /^(\s*)(ts|拍號)(\s*[:：]\s*)(.*)$/i, label: 'TS', rank: 3 },
    strum: { re: /^(\s*)(strum|刷法)(\s*[:：]\s*)(.*)$/i, label: 'Strum', rank: 4 }
  };
  // 第一個段落標籤之前的行數（開頭資訊只在這一段裡找）
  function headerEnd(lines) {
    const i = lines.findIndex(l => HEADER_REGEX.test(l));
    return i < 0 ? lines.length : i;
  }
  // 讀出開頭的 Title／Artist／BPM（沒寫就是 null）
  function getMeta(txt) {
    const lines = String(txt || '').replace(/\r\n?/g, '\n').split('\n');
    const end = headerEnd(lines);
    const out = { title: null, artist: null, bpm: null };
    for (const k of Object.keys(out)) {
      for (let i = 0; i < end; i++) {
        const m = META_KEYS[k].re.exec(lines[i]);
        if (m) { out[k] = m[4].trim(); break; }
      }
    }
    return out;
  }
  // 設定開頭資訊：有那一行就改（保留原本的寫法，例如「歌名:」），沒有就依 Title、Artist、BPM 的順序插入；值是空的就拿掉那一行
  function setMeta(txt, key, value) {
    const def = META_KEYS[key];
    if (!def) return txt;
    const eol = /\r\n/.test(txt) ? '\r\n' : '\n';
    const lines = String(txt).replace(/\r\n?/g, '\n').split('\n');
    const val = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
    const end = headerEnd(lines);
    const idx = lines.slice(0, end).findIndex(l => def.re.test(l));
    if (idx >= 0) {
      if (!val) lines.splice(idx, 1);
      else lines[idx] = lines[idx].replace(def.re, (all, sp, k, sep) => sp + k + sep + val);
    } else if (val) {
      // 插在排序比它前面的最後一個開頭資訊後面，沒有的話放第一行
      let at = 0;
      for (let i = 0; i < end; i++) {
        if (Object.values(META_KEYS).some(d => d.rank < def.rank && d.re.test(lines[i]))) at = i + 1;
      }
      lines.splice(at, 0, def.label + ': ' + val);
    }
    return lines.join(eol);
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
    createPatternFromString,
    TS_DEFAULT_PATTERNS,
    displayWidth,
    getBarChords,
    setBarChords,
    formatBarChords,
    setSectionStrum,
    setSongStrum,
    getMeta,
    setMeta
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Txt2Gp = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
