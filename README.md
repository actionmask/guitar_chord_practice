# 吉他譜練習播放器（guitar_chord_practice）

邊看譜邊聽的吉他練習網頁。開啟 Guitar Pro 譜檔，可以用內建合成音色、自己的 MP3 或 YouTube 影片播放，游標和和弦面板會跟著音樂走。可以安裝成 App（PWA），在手機和平板上離線使用。

線上使用：<https://actionmask.github.io/guitar_chord_practice/>

## 功能

- **讀譜**：Guitar Pro（.gp / .gp3–.gp7 / .gpx）、MusicXML 等格式，用 [alphaTab](https://github.com/CoderLine/alphaTab) 顯示與播放。
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
| `app/font/Bravura.*` | [Bravura](https://github.com/steinbergmedia/bravura) 樂譜字型 | SIL OFL 1.1（見 `app/font/Bravura-OFL.txt`） |

`app/alphaTab.min.js` 改過兩處，換成官方版的話這兩個問題會再出現：

1. 簡譜遇到整小節休止時不會當掉（`beatOfLowestNote`／`beatOfHighestNote` 改回傳該小節第一拍）。
2. 單行排版時，最後一段譜的寬度算對，最後幾小節不會被切掉。

依 MPL-2.0，修改過的 alphaTab 檔案仍以 MPL-2.0 授權。

譜檔和錄音不包含在這個專案裡，請使用自己有權使用的檔案。

## 授權

本專案自己的程式碼採用 [MIT License](LICENSE)。
