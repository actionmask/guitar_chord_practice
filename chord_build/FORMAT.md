# 歌曲 JSON 格式（json2gp.py）

```
python3 json2gp.py song.json --form short   # 輸出 song_short.gp5
```

## 最上層

| key | 說明 |
|---|---|
| `meta` | 歌曲資訊，對應 GP 檔的 `title` `artist` `subtitle` `album` `words` `music` `tab` `notice`，另有 `tempo`、`timeSignature`（例 `[4,4]`、`[3,4]`）、`encoding`（預設 `cp1252`，要寫中文請改成 `big5` 之類） |
| `page` | 版面設定。`scoreSize`：整份譜的縮放比例（百分比，50～300，預設 100），樂譜、文字、歌詞會一起放大或縮小 |
| `tuning` | 1～6 弦的 MIDI 音高，預設標準調音 `[64,59,55,50,45,40]` |
| `shapes` | 指型組。`{"組名": {"和弦": [1弦,2弦,…,6弦]}}`，`null` 代表不彈 |
| `patterns` | 刷法和分解和弦 |
| `sections` | 段落（和弦進行加上每小節要用的 pattern） |
| `tracks` | 音軌，每軌指定要用哪組 `shapes` |
| `textTrack` | 文字標在第幾軌（從 0 開始），預設 0 |
| `forms` | 段落編排，可以有多個版本（full、short…），沒指定時用第一個 |

## patterns

每一格是一個 `unit` 分音符（8 = 八分音符、16 = 十六分音符），一個 pattern 剛好是一小節。

**刷弦** `"type": "strum"`，`steps` 寫成字串：

| 符號 | 意思 |
|---|---|
| `D` / `U` | 下刷 / 上刷 |
| `d` / `u` | 輕下刷 / 輕上刷 |
| `X` / `x` | 悶音下刷 / 悶音上刷 |
| `-` | 延續前一格 |
| `.` | 休止 |

選用參數：`upStrings`（預設 `[1,6]`，例如改成 `[1,4]` 就只刷 1～4 弦）、`downStrings`（預設 `[1,6]`）。

**分解和弦** `"type": "arpeggio"`，`steps` 寫成陣列：

| 符號 | 意思 |
|---|---|
| `"B"` | 這個和弦最低的那條弦（Em、G 是 6 弦，C 是 5 弦，D 是 4 弦） |
| `"1"`～`"6"` | 撥指定的弦 |
| `"23"` | 2、3 弦同時撥 |
| `"-"` / `"."` | 延續 / 休止 |

選用參數：`letRing: true` 讓音延續不斷。

## sections

```json
"Verse": { "blocks": [
  { "chords": "Em C G D", "repeat": 2, "pattern": { "Em": "low", "G": "low", "*": "high" } },
  { "chords": "Em C G D", "bars": 2, "pattern": ["low", "high"] }
]}
```

- `chords`：用空白分隔的字串，或陣列
- `repeat`：整組和弦重複幾次（預設 1）
- `bars`：每個和弦佔幾小節（預設 1）
- `pattern` 有三種寫法：
  - `"low"`：每小節都用同一個
  - `{"Em": "low", "*": "high"}`：依和弦決定，`*` 是其他和弦
  - `["low", "chorus"]`：一個和弦佔多小節時，依序指定每小節用哪個（陣列裡的元素也可以是上面那種對照表）

## forms

```json
"short": [
  "Intro",
  { "section": "Verse", "label": "Verse 1", "text": { "1": "…", "5.3": "…" } },
  "Chorus"
]
```

- 直接寫段落名稱，或寫成物件
- `label`：顯示在譜上的段落標記，預設就是段落名稱
- `text`：標在譜上的文字（歌詞、提示），key 是「段落內小節.格」，從 1 開始，以 pattern 的 unit 為單位。例如八分音符格：`.1` = 第 1 拍、`.2` = 1&、`.3` = 第 2 拍 … `.8` = 4&。文字落在延音中間時，程式會在那裡切開並用連結線接上，聽起來還是同一下。

## lyrics（一字一音的歌詞，顯示在吉他六線譜下方）

寫在 `forms` 的段落項目裡：

```json
{ "section": "Verse", "label": "Verse 1",
  "lyrics": {
    "unit": 8,
    "rhythm": ["..x-x-x-", "x-x---..", "..x-x-x-", "x---x-.."],
    "text": "1 2 3 4 5 6 7 8 9 10"
  } }
```

- `rhythm`：每小節一個字串，標出每個字從哪一格開始唱。格子跟 pattern 一樣（`unit` 8 就是一格八分音符）。也可以寫成一個字串，用 `|` 分小節。沒寫到的小節就是沒有歌詞。
  - `x`：這一格開始唱一個字
  - `-`、`.`：這一格沒有新的字
- `text`：音節用空白分開，英文單字可以用 `-` 拆，例如 `ba-by`（算 2 個音節）。音節數和 `x` 的數量不一樣時程式會提醒。

歌詞會直接掛在 `textTrack`（預設第 1 軌）的六線譜下面，不會多出音軌。原理：

- Guitar Pro 會把音節依序一個一個放到那軌的每一拍上。
- 程式會在有字的拍放音節，沒字的拍多放一個空白（或連字號）讓它跳過。
- 字剛好落在延音中間時，程式會把那一拍用連結線切開，讓字有地方放，聲音不變。

如果想要以前那種另外一軌的歌詞軌，在最上層加 `"lyricsTrack": { "separate": true }`。可以再設定 `name`、`silent`（預設 `true`）、`instrument`、`display`（`"notation"` / `"tab"` / `"both"`）。這種方式下 `rhythm` 裡的 `x` 可以換成簡譜 `1`～`7` 寫音高。

## 錯誤檢查

pattern 長度不等於一小節、和弦在指型組裡找不到、文字位置超出段落長度、用到不存在的 pattern 或段落，都會直接報錯並指出位置。

---

# txt2gp：和弦譜 txt + JSON 規則

```
python3 txt2gp.py song.txt [out.gp5] [--json song.json] [--tempo 140] [--lyrics text|under]
```

- JSON 預設找跟 txt 同名的 .json，要和 json2gp.py 放在同一個資料夾。
- 和弦按法（`shapes`）、刷法（`patterns`）、音軌（`tracks`）、`meta` 都跟 json2gp 共用同一份 JSON。
- 段落、和弦進行、歌詞改從 txt 讀，所以用不到 `sections` 和 `forms`。

## txt 寫法

```
[Verse]
Em          C              G    D
(歌詞，和弦寫在哪個字上方，那段字就屬於那個和弦)
Em
(只有一個和弦的長句)
[Outro] G D Em C x4
```

- `[段落名]` 開始一個段落，可以接著直接寫和弦（簡寫）。
- 和弦行下一行是歌詞，依和弦的欄位切開，分給各個和弦。和弦前面的字（弱起）會接到前一個和弦。
- 沒有和弦的歌詞行，接在最後一個和弦後面。
- `x4`：整行重複 4 次。
- `Em:2`：這個和弦佔 2 小節（覆蓋 JSON 規則）。
- `|Fm Dm|` 或 `Fm+Dm`：同一小節兩個（或更多）和弦，刷法依位置平均分給各和弦。只有開頭的 `|` 沒有結尾也可以（例如 `|Fm Dm |Dm`，後面的 Dm 是下一小節）。
- 和弦後面的點會忽略（`Bb.` 等於 `Bb`），單獨的 `.` 也會略過。
- 一行裡如果有已知和弦、又有像和弦但沒定義的字（例如打錯的 `En`），會直接報錯並指出是第幾行。
- `#` 開頭是註解，整行括號（例如 `(repeat 4x)`）會略過。
- 同一段落名出現多次會自動編號（Verse 1、Verse 2）。

## JSON 的 "txt" 規則

```json
"txt": {
  "lyrics": "text",
  "default": { "bars": 1, "pattern": { "Em": "low", "G": "low", "*": "high" } },
  "sections": {
    "Verse":  { "pattern": { "Em": "low", "G": "low", "*": "high" },
                "whenAlone": { "bars": 2, "pattern": ["low", "high"] } },
    "Chorus": { "bars": 2, "pattern": ["low", "chorus"] },
    "Bridge": { "bars": 2, "pattern": ["low", "chorus"], "lastBar": "hold" }
  }
}
```

| key | 說明 |
|---|---|
| `lyrics` | `"none"` 不放歌詞；預設 `"text"`（沒寫就是 text，也可以用 `--lyrics` 臨時切換）。`"text"`：每段字標在該和弦第一拍上方，靠左對齊和弦。`"under"`：放在譜下方的歌詞列，從換和弦那一拍開始一拍放一個字往右排；字比拍子多時，剩下的字全部擠在最後一拍 |
| `default` | 沒列在 `sections` 裡的段落用這組 |
| `sections.<名稱>.bars` | 每個和弦佔幾小節 |
| `sections.<名稱>.pattern` | 刷法規則，寫法跟 json2gp 的 `pattern` 一樣（字串、依和弦對照表、依小節順序的陣列） |
| `whenAlone` | 和弦行只有一個和弦、下面接一整句歌詞時，改用這組 `bars` 和 `pattern` |
| `lastBar` | 段落最後一小節改用這個 pattern，例如 `"hold"` |

段落名稱比對時會忽略結尾數字，所以 `[Verse 2]` 也會套用 `Verse` 的規則。
