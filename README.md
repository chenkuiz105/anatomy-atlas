# Anatomy Atlas 解剖學互動複習

一階國考解剖重點筆記（來源：個人 Notion 筆記）＋ 類 Complete Anatomy 的 3D 人體檢視器。純靜態網站，可直接用 GitHub Pages 發布。

## 功能

**筆記**
- 保留 Notion 原本的顏色規則（紅＝口訣、綠＝血管、橘＝神經、紫＝疾病、★＝國考考點、底線＝考過的敘述）
- 🙈 遮住重點：橘色螢光重點變成空格，點一下才顯示，用來自我測驗
- ★ 只看國考點：淡化沒有星號的段落
- 每頁三次複習勾選（存在瀏覽器）、全文搜尋
- 英文結構名稱自動連到 3D 檢視器的對應位置

**3D 檢視器**（`viewer.html`）
- 6 個系統層（皮膚、肌肉、骨骼/關節、神經、血管、內臟），可開關與調透明度
- 依區域顯示（頭、頸、胸、腹、背、上肢、下肢）
- 點選結構看名稱與所屬群組；隱藏（H）、半透明（F）、只看這個（I）、置中（空白鍵）、復原（Ctrl+Z）
- 被擋住的已選結構會以藍色 X 光顯示
- 測驗：「找結構」（給名稱，點出位置）、「命名測驗」（標出結構，四選一）
- 網址參數：`viewer.html#t=biceps brachii`、`#q=femur`、`#id=FMA24474`、`#mode=find`

## 專案結構

```
index.html          首頁（章節列表、搜尋）
viewer.html         3D 檢視器
notes/              由 Notion 匯出轉成的筆記頁（tools/build_notes.py 產生）
models/             3D 模型（glb, meshopt 壓縮）與結構名稱 parts.json / terms.json
js/ css/            前端程式
vendor/             three.js r186、three-mesh-bvh（本地化，不依賴 CDN）
tools/              建置腳本
```

## 重新產生筆記

```
python3 tools/build_notes.py <notion 匯出資料夾> .
```

匯出資料夾內為 `NN-<pageid>.md`（Notion enhanced markdown）與 `img/<pageid>/`。

## 本地預覽

```
python3 -m http.server
```

然後開 http://localhost:8000 。

## 授權與來源

- 3D 模型：BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan（經簡化與壓縮；原始 STL 取自 Kevin-Mattheus-Moerman/BodyParts3D）。
  Mitsuhashi N, et al. BodyParts3D: 3D structure database for anatomical concepts. Nucleic Acids Res. 2009;37:D782-5.
- three.js（MIT）、three-mesh-bvh（MIT），授權檔在 `vendor/`。
- 筆記內容為作者個人整理。
