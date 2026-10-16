# PDF 吉他譜 → Guitar Pro（.gp）

> 練習網頁的「開啟譜檔 / PDF」也能直接選 PDF，在瀏覽器裡轉（`app/pdfgp.js`，規則跟這裡一樣，轉出來的譜相同）。這個 Python 版適合一次轉一整個資料夾。

把老師給的 PDF 吉他譜轉成練習網頁用的 .gp 檔。

> 練習網頁的「開啟譜檔 / PDF」也能直接選 PDF，在瀏覽器裡轉（`app/pdfgp.js`，規則跟這裡一樣）。這個 Python 版適合一次轉一整個資料夾。
一首歌的「和弦」和「Solo」兩部分會變成同一個 .gp 裡的兩軌（Chords、Solo），
段落名稱（Intro、Verse、主歌…）、和弦名稱、譜上畫的和弦指法圖、調號、速度、滑音、搥勾、推弦、悶音都會帶過去。指法圖會變成 .gp 裡的和弦按法，練習網頁的和弦面板就顯示老師的按法（下面標「譜檔」）。

**只適用同一種排版**：從 Guitar Pro 匯出的向量 PDF（文字可以選取的那種），每個部分的第一頁有大標題和
「KEY:Am  110 bpm」這一行。掃描或拍照的 PDF 不能用。

## 安裝（一次）

需要 Python 3.9 以上、Node.js 18 以上。可以跟 align-tool 共用同一個 conda 環境：

    conda activate align
    pip install -r requirements.txt
    npm install

## 用法

    python pdf2gp.py 老師的譜.pdf

一個 PDF 裡有幾首歌就產生幾個 .gp，檔名用歌名，放在 PDF 旁邊。其他寫法：

    python pdf2gp.py 譜.pdf -o 輸出資料夾
    python pdf2gp.py 嫁禍_solo.pdf 嫁禍_和弦.pdf        # Solo 和和弦分成兩個檔案也可以
    python pdf2gp.py 譜資料夾                            # 資料夾裡所有 PDF
    python pdf2gp.py 譜.pdf --list                       # 只列出找到哪些歌、哪幾頁，不轉檔

執行時會列出每首歌找到的頁數和小節數，例如：

    心愛的再會啦 - 伍佰  (KEY F (-1), 64 bpm)
        Solo    in.pdf page 31-36, 87 bars, chord score 0.00
        Chords  in.pdf page 26-30, 87 bars, chord score 0.83
    wrote 心愛的再會啦.gp  (Solo:87 bars, Chords:87 bars)
        check Solo bar 8: adds up to 3.6 beats, not 4

- **check … bar N**：那一小節的拍子加起來不是 4 拍（多半是 PDF 上有符號沒讀到）。用 Guitar Pro 或網頁打開看一下那幾小節。
- **兩部分的小節數不同**：短的那一軌後面會補空小節，並出現提醒。
- **Solo／Chords 認反了**：加 `--swap`，改成照頁碼順序，前面的是 Solo。
- **歌名讀不出來**（有些 PDF 的標題字型沒有字碼）：會改用檔名，或用 `--title 嫁禍進行式` 指定（多首歌就照順序給多個 `--title`）。
- `--dump`：不轉檔，只寫出 `PDF名.dump.txt`：每一頁讀到的所有文字（位置、大小、字型）、線條數量，以及每一小節認出來的音、音長、和弦、段落和 H／P／推弦／P.M. 等標記。轉出來不對時，先看這個檔就知道是 PDF 上讀不到，還是讀到了卻判斷錯。
- `--keep-tex`：同時留下中間的 .alphatex 文字檔，可以直接改了再轉。

## 接下來

把 .gp 跟錄音放在一起，用 align-tool 對齊：

    python ../align-tool/align.py 心愛的再會啦.gp 心愛的再會啦.mp3

再把 .gp、.mp3、.json 用同樣的檔名放進 zip，在網頁用「匯入歌曲包 (zip)」匯入。
