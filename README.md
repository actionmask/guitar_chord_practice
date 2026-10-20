# 吉他譜練習播放器（guitar_chord_practice）

邊看譜邊聽的吉他練習網頁。開啟 Guitar Pro 譜檔，可以用內建合成音色、自己的 MP3 或 YouTube 影片播放，游標和和弦面板會跟著音樂走。可以安裝成 App（PWA），在手機和平板上離線使用。

線上使用：<https://actionmask.github.io/guitar_chord_practice/>

## 功能

- **讀譜**：Guitar Pro（.gp / .gp3–.gp7 / .gpx）、MusicXML 等格式，用 [alphaTab](https://github.com/CoderLine/alphaTab) 顯示與播放。
- **貼上和弦譜（txt）轉 GP & 刷法編輯器**：設定選單中「和弦譜編輯器」（或快捷鍵 E），直接貼上網路和弦歌詞譜或 txt 簡寫，在瀏覽器裡自動產生伴奏六線譜與 .gp 檔案。內建**視覺化刷法編輯器**（支援點擊自訂下刷、上刷、切音、延音或 T123 分解和弦）、**小節和弦編輯**（點方格鉛筆或快捷選盤）與**自訂指型按法**，可即時同步六線譜播放練習或存入歌單。
- **三種聲音來源**：合成音色、MP3（也可貼 base64）、YouTube 影片。
- **和弦面板**：目前的大和弦、下一個和弦、指型圖（常見按法／封閉和弦／強力和弦），節拍燈跟著拍子閃。
- **顯示方式**：只看六線譜、六線譜＋簡譜、和弦方格。
- **排版**：整頁換行，或單行連續滾動（譜一直往左滑，正在彈的位置固定在畫面左側約三分之一處）。
- **練習工具**：速度 50%–110%、指定小節循環、點段落名稱直接循環該段、節拍器、預備拍、只聽某一軌。
- **對齊錄音**：設定「音樂從第幾小節開始」和延遲，或載入 align-tool 產生的對齊檔，游標就照錄音的實際快慢走。
- **歌單**：把譜、MP3 和對齊設定存在這台裝置的瀏覽器裡。也能一次匯入整包 zip。
- **全螢幕**：收起設定，只留播放列和譜。

## 資料夾

```
app/          練習網頁本身（PWA），整個資料夾就是網站
align-tool/   譜 ↔ 錄音自動對齊工具（Python + Node.js），產生對齊檔 .json
pdf-tool/     老師的 PDF 吉他譜 → Guitar Pro (.gp) 轉檔工具（Python 版；網頁裡也能直接轉）
chord_build/  和弦文字譜 (txt) / JSON → Guitar Pro (.gp5) 轉檔工具（Python 版；網頁裡也能直接貼上轉檔）
.github/      GitHub Pages 自動部署設定
```

## 使用方式

### 直接用網頁

打開上面的網址即可。手機或平板想裝成 App：

- **Android（Chrome）**：選單 →「加到主畫面」或「安裝應用程式」。
- **iPad／iPhone（Safari）**：分享 →「加入主畫面」。

裝好後離線也能開。

### 在自己電腦上跑

`app/` 是純靜態網頁，用任何網頁伺服器開都可以（直接點兩下用 file:// 開啟通常不能播放）：

```bash
cd app
python -m http.server 8000
```

再用瀏覽器開 <http://localhost:8000>。YouTube 功能需要 https 網址，本機測試時無法使用。

### 播放列

| 按鈕 | 作用 |
| --- | --- |
| ▶／❚❚ | 播放／暫停 |
| ⏮ | 回到開頭（開著循環時回到循環起點），播放中按會直接從頭繼續播 |
| 速度 | 50%–110% |
| 聲音 | 合成／MP3／YouTube |
| 和弦 | 顯示或隱藏和弦面板（直向、橫向各自記住） |
| 全螢幕 | 收起設定，只留播放列和譜 |

### 配上 MP3 或 YouTube

1. 展開「配上音樂（MP3／YouTube）」，選 MP3 檔或貼上 YouTube 網址。
2. 設定「音樂從第幾小節開始」和「音樂延遲」（秒）。第 1 小節通常是預備拍。
3. 要更準的話，用 align-tool 產生對齊檔，按「載入對齊檔」。
4. 播放中某一段有偏差時，在該小節第一拍按「現在是這小節的第一拍」，只會修正那一小節之後。

### 歌曲包（zip）

用「匯入歌曲包 (zip)」一次加入多首歌。zip 裡每個譜檔是一首歌，同檔名的檔案會自動配在一起：

```
嫁禍進行式.gp      譜
嫁禍進行式.mp3     錄音（可省略）
嫁禍進行式.json    對齊設定（可省略）
```

對齊設定的格式：

```json
{ "start": 2, "delay": -0.2, "bpm": 110 }
```

加上 `"youtube": "影片網址"` 就會改用 YouTube。align-tool 產生的檔案還會多一個 `syncPoints`（逐拍對齊點）。

歌單存在各台裝置的瀏覽器裡（IndexedDB），不會同步。清除網站資料就會不見，原始檔請自己留著。

## align-tool（自動對齊）

把譜和錄音用 chroma 特徵加 DTW（[synctoolbox](https://github.com/meinardmueller/synctoolbox)）對齊，產生網頁讀得懂的 .json。

```bash
cd align-tool
conda create -n align python=3.11 -y      # 或 python -m venv .venv
conda activate align
pip install -r requirements.txt
npm install                                # 需要 Node.js 18 以上
python align.py 歌名.gp 歌名.mp3           # 產生 歌名.json
```

詳細說明、Windows 安裝的注意事項和準確度測試，見 [align-tool/README.md](align-tool/README.md)。

## PDF 轉 .gp

**在網頁裡**：按「開啟譜檔 / PDF」選老師的 PDF。

- 一個 PDF 有好幾首歌時，全部存進歌單，並打開第一首。
- 只有一首時直接打開，要留著再按「存入歌單」。
- 歌單裡已經有同名的歌（例如之前匯入的 `嫁禍進行式.gp`），會換成新轉的譜，MP3 和對齊設定保留。
- 歌名讀不出來時會請你輸入，可以寫「歌名 - 歌手」。
- 譜上畫的和弦指法圖也會讀進來，和弦面板會顯示老師的按法（標「譜檔」）。
- 轉好後可以按「下載 .gp」存檔。

轉檔程式是 `app/pdfgp.js`（用 [pdf.js](https://github.com/mozilla/pdf.js) 讀 PDF），規則和 `pdf-tool/` 的 Python 版一樣，兩邊轉出來的譜相同。改其中一邊時，另一邊也要跟著改。

**Python 版（pdf-tool）**：

把老師給的 PDF 吉他譜（Guitar Pro 匯出的向量 PDF）轉成 .gp，和弦和 Solo 兩部分變成同一個檔案的兩軌。

```bash
cd pdf-tool
pip install -r requirements.txt
npm install
python pdf2gp.py 老師的譜.pdf        # 每首歌一個 .gp
```

詳見 [pdf-tool/README.md](pdf-tool/README.md)。

## 換音色

1. 把 General MIDI 的 .sf2 或 .sf3 檔放進 `app/`。
2. 編輯 `app/index.html`，找到 `const SOUNDFONT_FILE='';`，填入檔名。

檔案越大音色越好，但手機載入越慢。

## 更新網站後

修改 `app/` 任何檔案後，記得把 `app/sw.js` 裡的 `VERSION` 改成新的名字（例如 `gp-practice-v37`），否則已安裝的裝置會一直用舊版。裝置上要完全關掉再開一次 App，才會換成新版。

## 第三方元件

| 檔案 | 來源 | 授權 |
| --- | --- | --- |
| `app/alphaTab.min.js` | [alphaTab](https://github.com/CoderLine/alphaTab) 1.8.4 | MPL-2.0 |
| `app/soundfont.js` | Sonivox EAS GM Wavetable（轉成 base64） | Apache-2.0 |
| `app/chords.js` | [chords-db](https://github.com/tombatossals/chords-db) 0.5.1 | MIT |
| `app/pdfjs/` | [pdf.js](https://github.com/mozilla/pdf.js) 4.10.38（legacy build） | Apache-2.0（見 `app/pdfjs/LICENSE`） |
| `app/font/Bravura.*` | [Bravura](https://github.com/steinbergmedia/bravura) 樂譜字型 | SIL OFL 1.1（見 `app/font/Bravura-OFL.txt`） |

`app/alphaTab.min.js` 改過八處，換成官方版的話這些問題會再出現：

1. 簡譜遇到整小節休止時不會當掉（`beatOfLowestNote`／`beatOfHighestNote` 改回傳該小節第一拍）。
2. 單行排版時，最後一段譜的寬度算對，最後幾小節不會被切掉。
3. 簡譜也畫出滑音的斜線（滑到下一個音、滑入、滑出），原版只在六線譜和五線譜上畫。
4. 六線譜的搥勾弧線上不標 H／P 字樣；pdf-tool 把原譜印的 H／P／sl. 寫成文字，網頁把它畫在六線譜正上方（跟原譜一樣）。
5. 簡譜裡被延音線連過去的音不再重寫一次數字，只留延音線（跟 Guitar Pro 原譜一樣；帶滑音的除外）。
6. 六線譜的延音線畫成音符右邊的短弧，被延長的那一拍不寫數字，符桿從譜線下方開始（跟 Guitar Pro 原譜一樣）。
7. 段落名稱（Intro、主歌…）自己佔一行，不再跟和弦名稱擠在同一行互相蓋住。
8. 和弦指法圖上方只畫 x／o，不再列出每條弦的格數（跟老師的 PDF 一樣）。

依 MPL-2.0，修改過的 alphaTab 檔案仍以 MPL-2.0 授權。

譜檔和錄音不包含在這個專案裡，請使用自己有權使用的檔案。

## 授權

本專案自己的程式碼採用 [MIT License](LICENSE)。
