# 譜 ↔ 錄音 自動對齊（DTW）

把吉他譜（.gp / .gp5 / .gpx / .alphatex）跟歌曲錄音（.mp3 / .wav / .m4a …）對齊，產生練習頁讀得懂的對齊檔（.json），
游標就能跟著錄音實際的快慢走，不再只靠一個起點加 BPM。

## 安裝（一次）

需要 Python 3.9 以上、Node.js 18 以上。ffmpeg 可以不裝（soundfile 已經能讀 mp3）；真的讀不進某個音檔時，Windows 用 `winget install Gyan.FFmpeg` 安裝。

請裝在獨立的環境裡，不要裝進 Anaconda 的 base：這些套件會把 NumPy 升到 2.x，
base 裡原本的 pandas、pyarrow 是對 NumPy 1.x 編譯的，會出現「compiled using NumPy 1.x cannot be run in NumPy 2.x」。

Anaconda（Windows 用 Anaconda Prompt 或 PowerShell）：

    conda create -n align python=3.11 -y
    conda activate align
    pip install -r requirements.txt
    npm install

一般 Python：

    python -m venv .venv
    .venv\Scripts\activate            # macOS / Linux：source .venv/bin/activate
    pip install -r requirements.txt
    npm install

之後每次使用前先 `conda activate align`（或啟用 .venv）。

Windows 注意事項：

- PowerShell 執行 `conda activate` 沒反應時，先執行一次 `conda init powershell` 再重開 PowerShell，或改用「Anaconda Prompt」。
- 電腦同時裝了 Anaconda 和 Miniconda 時，`conda activate align` 可能找不到環境，可以用完整路徑啟用，例如 `conda activate C:\Users\你的帳號\anaconda3\envs\align`。
- `npm` 找不到時，安裝 Node.js LTS（`winget install OpenJS.NodeJS.LTS`），裝完要重開終端機。
- Windows 上指令用 `python`，不是 `python3`。

## 用法

一首歌：

    python3 align.py 嫁禍進行式.gp 嫁禍進行式.mp3          # 產生 嫁禍進行式.json
    python3 align.py 嫁禍進行式.gp 某版本.mp3 -o 嫁禍進行式.json

整個資料夾（每個譜檔配同檔名的音檔）：

    python3 align.py 我的歌/

一首 4 分鐘的歌大約要 1 分鐘。

## 放進練習頁

- 單首：開好譜和 MP3（或 YouTube）後，在「配上音樂」按「載入對齊檔」選這個 .json。
- 多首：把 .gp、.mp3、.json 用同樣的檔名放進 zip，用「匯入歌曲包 (zip)」匯入。

套用後會顯示「精細對齊：N 個對齊點」。若某一段還是有偏，播放中在那小節第一拍按「現在是這小節的第一拍」（或 S），
只會修正那一小節之後的部分，前面對好的不受影響。「改回單點對齊」可以回到只用起點＋BPM。

## 做法

1. `score2notes.mjs` 用 alphaTab 讀譜，展開成實際演奏的音符清單（時間、音高、力度）和每小節的起點時間。
2. 譜的音符直接換成音高特徵；錄音用濾波器組算音高特徵。兩邊都轉成量化的 chroma（12 個音級）
   和音符起音特徵（DLNCO），並自動找最佳移調（錄音降半音、調弦不同、移調夾都能對上）。
3. 用 synctoolbox 的多尺度 DTW（MrMsDTW）算出整首的時間對應。
4. 第二輪逐拍修正：DTW 在一長段完全重複的刷法裡可能整拍滑掉（每個位置都一樣像）。
   這一輪讓每一拍在 DTW 結果附近 ±1.2 秒內移動，同時看「這拍的譜跟錄音像不像」和「拍長有沒有突然變」，
   用 Viterbi 找最穩的那條。
5. 開頭和結尾的空白會先切掉，避免前奏空拍、淡出把對齊帶歪。

輸出的對齊點是每一拍一個：`[小節, 小節內位置(0–1), 錄音秒數]`。

## 準確度（實測）

用譜合成一段速度忽快忽慢（±7%）、前面有 3.2 秒空白的測試錄音，再跟真實時間比較（嫁禍進行式，114 小節）：

- 中位誤差約 0.02 秒，82% 的小節誤差在 0.1 秒內。
- 誤差集中在長段重複的刷弦（例如副歌 66–85 小節），最差約 0.8 秒。
- 只做 DTW、不做第二輪時，平均誤差 0.25 秒，最差 2 秒。

這是合成音色的測試；真實錄音有人聲、鼓、貝斯和混音，和弦特徵會更雜，準確度通常會比這差。
譜跟錄音的段落不一致（錄音多了間奏、少了一段反覆）時，DTW 會在那附近亂掉，需要手動修。

`test/` 裡有產生測試錄音和計算誤差的程式：

    node score2notes.mjs 歌.gp 歌.notes.json
    python3 test/make_test_audio.py 歌.notes.json 測試.wav 3.2 0
    python3 align.py 歌.gp 測試.wav --notes 歌.notes.json -o 測試.json
    python3 test/evalalign.py 測試.json 測試.wav.truth.json -v

## 參數

- `--channels 0,1`：只用譜的某幾個 MIDI 聲道（例如只用 Solo 軌，聲道 0、1）。
- `--smooth 4`：第二輪偏好穩定拍子的程度，越大越不允許速度變化。
- `--no-refine`：只做 DTW。
- `--silence-db 40`：多安靜算空白。
- `--steps 1.5,1.5,2.0`：DTW 步伐權重。
