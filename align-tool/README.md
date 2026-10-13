# 譜 ↔ 錄音 自動對齊（DTW）

把吉他譜（.gp / .gp5 / .gpx / .alphatex）跟歌曲錄音（.mp3 / .wav / .m4a …）對齊，產生練習頁讀得懂的對齊檔（.json），
游標就能跟著錄音實際的快慢走，不再只靠一個起點加 BPM。

## 安裝（一次）

需要 Python 3.9 以上、Node.js 18 以上、ffmpeg（讀 mp3 用）。

請裝在獨立的環境裡，不要裝進 Anaconda 的 base：這些套件會把 NumPy 升到 2.x，
base 裡原本的 pandas、pyarrow 是對 NumPy 1.x 編譯的，會出現「compiled using NumPy 1.x cannot be run in NumPy 2.x」。

Anaconda（Windows 用 Anaconda Prompt 或 PowerShell）：

    conda create -n align python=3.11 -y
    conda activate align
    pip install -r requirements.txt
    conda install -c conda-forge ffmpeg -y
    npm install

一般 Python：

    python -m venv .venv
    .venv\Scripts\activate            # macOS / Linux：source .venv/bin/activate
    pip install -r requirements.txt
    npm install

之後每次使用前先 `conda activate align`（或啟用 .venv）。

## 用法

一首歌：

    python3 align.py 嫁禍進行式.gp 嫁禍進行式.mp3          # 產生 嫁禍進行式.json
    python3 align.py 嫁禍進行式.gp 某版本.mp3 -o 嫁禍進行式.json

整個資料夾（每個譜檔配同檔名的音檔）：

    python3 align.py 我的歌/

一首 4 分鐘的歌大約要 1 分鐘。

## 先分離樂器（Demucs，選用）

真實錄音裡人聲、鼓、鍵盤都混在一起，會干擾音高特徵。加上 `--separate`，會先用 [Demucs](https://github.com/adefossez/demucs)
把錄音拆成人聲／鼓／貝斯／吉他／鋼琴／其他，再拿來對齊：

- 音高特徵只用吉他＋貝斯＋鋼琴＋其他（不含人聲和鼓），
- 拍子位置看拆出來的鼓，
- 加 `--save-backing` 還會寫出「去掉吉他的伴奏」`歌-no-guitar.wav`，可以拿來跟著彈。

安裝（一次，在同一個 align 環境裡）：

    conda activate align
    pip install demucs

用法：

    python align.py 歌.gp 歌.mp3 --separate --save-backing --click 檢查.wav

- 第一次會下載模型（約 100 MB）。
- 沒有顯示卡時，一首 4 分鐘的歌要分離幾分鐘。
- 拆好的音軌存在錄音旁邊的 `歌.stems/` 資料夾，同一首歌再跑就直接用，不會再拆一次。
- 已經用別的工具（UVR、Moises…）拆好了，把檔案改名成 `vocals.wav`、`drums.wav`、`bass.wav`、`guitar.wav`、`piano.wav`、`other.wav`
  （有幾個放幾個，也可以只有 `no_vocals.wav`），放進一個資料夾，用 `--stems 資料夾` 指定，就不需要裝 Demucs。

分離不是萬靈丹：合成測試錄音本來就對得很準，有沒有分離結果一樣。它主要幫在人聲很大、鍵盤或弦樂很多、
或鼓很吵的真實錄音。對齊結果不理想時再加上試試。

## 放進練習頁

- 單首：開好譜和 MP3（或 YouTube）後，在「配上音樂」按「載入對齊檔」選這個 .json。
- 多首：把 .gp、.mp3、.json 用同樣的檔名放進 zip，用「匯入歌曲包 (zip)」匯入。

套用後會顯示「精細對齊：N 個對齊點」。若某一段還是有偏，播放中在那小節第一拍按「現在是這小節的第一拍」（或 S），
只會修正那一小節之後的部分，前面對好的不受影響。「改回單點對齊」可以回到只用起點＋BPM。

## 檢查結果

加上 `--click 檢查.wav`，會另外寫出一份「原曲＋嗒聲」：高音嗒＝每小節第一拍，低音嗒＝其他拍。聽一遍就知道哪裡準、哪裡偏。

執行完會列出「worth a listen」的小節：錄音跟譜最不像的地方（編曲不同、段落多一次或少一次、或對歪了），先聽這幾段。

## 開頭有鼓聲、前奏不清楚：用主歌當對齊點

有些錄音在譜的第一個音之前先有一段鼓（過門、數拍），或開頭很安靜、很亂。自動找起點時可能把第一小節放在鼓聲上，
前面幾小節就會被拉長。這時用 `--ref` 指定一個音樂清楚的地方當對齊點，例如主歌：

    python align.py 歌.gp 歌.mp3 --ref 主歌
    python align.py 歌.gp 歌.mp3 --ref Verse          # 譜上的段落名稱（不分大小寫）
    python align.py 歌.gp 歌.mp3 --ref "Chorus 2"     # 第二次副歌
    python align.py 歌.gp 歌.mp3 --ref 22             # 直接給小節

中文的 主歌／副歌／前奏／間奏／尾奏／橋段 會對到譜上的 Verse／Chorus／Intro／Interlude／Outro／Bridge。
譜上沒有段落名稱時用小節數。

它會先在對齊點把譜和錄音對上，再試錄音前段每個明顯的起音當作譜的第一個音，挑「前面各小節長度跟主歌速度最一致」的那個，
所以開頭多出來的鼓聲會被留在外面。

開頭的小節長短不一時，執行結果會出現「the first bars come out uneven」的提醒，並建議 `--ref` 要用哪一段。

## 手動釘住（錨點）

知道某幾個小節在錄音的第幾秒，就用 `--anchor` 告訴它，其他地方仍然自動對：

    python align.py 歌.gp 歌.mp3 --anchor 2=0.5 --anchor 34=118.2

錨點附近會照你給的時間，往外約 10 秒漸漸回到自動結果。兩個錨點之間則兩邊一起修正。
最常見的用法：聽 `--click` 的檔案找到偏掉的那段，在那段的開頭和結尾各釘一個錨點，再跑一次。

## 做法

1. `score2notes.mjs` 用 alphaTab 讀譜，展開成實際演奏的音符清單（時間、音高、力度）和每小節的起點時間。
2. 找出音樂真正開始的地方：用粗略的 chroma 在錄音前 30 秒內找「譜的開頭那 25 秒」最像的位置（會自動試移調和 ±15% 速度），
   把前面的空白、觀眾聲、只有鼓的前奏切掉；再把譜的第一個音釘在那附近第一個明確的起音上。
3. 把錄音拆成「鼓」和「其他」兩部分（HPSS）。音高特徵只用「其他」那部分算，鼓不會把和弦特徵弄糊。
   用了 `--separate`／`--stems` 時改用分離好的音軌：音高看吉他＋貝斯＋鋼琴＋其他，拍子看鼓，人聲不用。
4. 譜的音符直接換成音高特徵；兩邊都轉成量化的 chroma（12 個音級）和音符起音特徵（DLNCO），並自動找最佳移調。
5. 用 synctoolbox 的多尺度 DTW（MrMsDTW）算出整首的時間對應。
6. 第二輪逐拍修正（Viterbi）：每一拍可以在 DTW 結果附近 ±1.2 秒內移動，同時看
   - 這一拍的譜跟錄音的音高像不像，
   - 這一拍有沒有落在鼓點上（`--beat-weight`），
   - 譜上這一拍有音開始的話，錄音這裡有沒有起音（`--onset-weight`），
   - 拍長有沒有突然變（`--smooth`），以及錨點。

輸出的對齊點是每一拍一個：`[小節, 小節內位置(0–1), 錄音秒數]`。

## 準確度（實測）

用譜合成測試錄音再跟真實時間比較：速度忽快忽慢（±7%）、中間有 0.6 秒的停頓、每個音有隨機的手感誤差。
「樂團版」再加上鼓、貝斯、一條不在譜上的人聲旋律和雜訊。

| 測試 | 舊版 | 新版 |
| --- | --- | --- |
| 嫁禍進行式，純吉他 | 73% 的小節誤差在 0.1 秒內，最差 0.6 秒 | 100%，平均 0.01 秒 |
| 嫁禍進行式，樂團版 | 45%，最差 4 秒 | 100%，最差 0.05 秒 |
| 心愛的再會啦，樂團版 | 39%，最差 4 秒 | 100%，最差 0.05 秒 |
| 樂團版降半音 | — | 100% |
| 前面多 8 秒只有鼓的前奏 | 舊版開頭錯 12 秒 | 100% |

舊版最大的問題其實是讀譜：alphaTab 1.8 的 NoteOn／NoteOff 事件編號跟一般 MIDI 相反，
舊版的 `score2notes.mjs` 把每個「放開」都當成一個新的長音，譜的和弦特徵整個糊掉。這一版已經修正。

合成錄音再像也不是真的錄音；真實錄音裡編曲跟譜不同（多一段間奏、少一次反覆、即興）的地方，
自動對齊還是可能偏掉，請用 `--click` 檢查，必要時加錨點。

`test/` 裡有產生測試錄音和計算誤差的程式：

    node score2notes.mjs 歌.gp 歌.notes.json
    python test/make_band_audio.py 歌.notes.json 測試.wav 3.2 0.6      # 樂團版（make_test_audio.py 是純吉他版）
    python test/make_band_audio.py 歌.notes.json 測試.wav 3.2 0.6 1 測試.stems   # 同時寫出各樂器的音軌，測 --stems
    python align.py 歌.gp 測試.wav --notes 歌.notes.json -o 測試.json
    python test/evalalign.py 測試.json 測試.wav.truth.json -v

## 參數

- `--click 檔案.wav`：寫出「原曲＋嗒聲」檢查檔。
- `--anchor 小節=秒`：釘住已知的小節開頭時間，可以給很多個。
- `--beat-weight 0.6`：鼓點拉住拍子的力道，0 = 不看鼓（沒有鼓的錄音、或鼓很亂時）。
- `--onset-weight 0.4`：錄音起音拉住「譜上有音開始的拍」的力道。
- `--smooth 4`：偏好穩定拍子的程度，越大越不允許速度變化（自由速度的歌可以調小，例如 1）。
- `--channels 0,1`：只用譜的某幾個 MIDI 聲道（例如只用 Solo 軌，聲道 0、1）。
- `--ref 主歌`（或段落名稱、小節數）：從音樂清楚的地方開始對齊，開頭有鼓聲或雜音時用。
- `--separate`：先用 Demucs 分離樂器再對齊（需要 `pip install demucs`）。
- `--demucs-model htdemucs_6s`：Demucs 模型。預設的 htdemucs_6s 有獨立的吉他音軌；htdemucs、htdemucs_ft 只分人聲／鼓／貝斯／其他。
- `--stems 資料夾`：用已經分離好的音軌（vocals／drums／bass／guitar／piano／other .wav）。
- `--save-backing`：有分離音軌時，另外寫出去掉吉他的伴奏 `歌-no-guitar.wav`。
- `--no-hpss`：不拆鼓，直接用整個錄音算音高。
- `--no-find-start`、`--no-auto-start`：不自動找音樂開始的位置／不把第一個音釘在第一個起音上。
- `--no-refine`：只做 DTW。
- `--silence-db 35`：比歌曲大聲部分小多少 dB 算空白。
- `--steps 1.5,1.5,2.0`：DTW 步伐權重。
