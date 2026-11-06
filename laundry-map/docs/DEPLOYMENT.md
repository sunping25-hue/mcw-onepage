# 手機網頁公開測試站部署

這份部署會建立獨立的 Node 網站，不改動原有 MCW 一頁式網站。手機直接開啟網址即可查詢；不需安裝 App。

## 已準備好

- GitHub repo：`sunping25-hue/mcw-onepage`
- 功能分支：`issue-1-laundry-map`
- 專案目錄：`laundry-map`
- 兩筆使用者提供門市地址已隨程式首次建檔；後台後續編輯與刪除不會被啟動程序覆蓋。
- Render 範本：`laundry-map/render.yaml`。

## 建立 Render Web Service

需由帳號擁有者登入 Render 並授權該 GitHub repo，或透過安全的環境設定提供部署 API 權限；不要在聊天或程式碼填入登入密碼／API token。

建立獨立 Web Service，選擇上述 repo 與功能分支。填入：

| 項目 | 設定 |
| --- | --- |
| Runtime | Node |
| Root Directory | `laundry-map` |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/stores` |
| Node version | `24.19.0` |

公開站已經在 Render **Free** 運行：`https://mcw-laundry-map.onrender.com`，分支 `issue-1-laundry-map`，根目錄 `laundry-map`，沒有掛載磁碟。`render.yaml` 只描述 free 方案，**不要**改回 `starter` 或加上付費磁碟。Free 的容器檔案系統會在休眠、重新部署後清空，所以 `DATA_DIR=/tmp/mcw-data` 不能當作永久資料庫。

持久資料用環境變數接上 S3 相容物件儲存（例如 Cloudflare R2 的免費額度），或在已有持久目錄時用 `PERSIST_DRIVER=file`。沒有金鑰就不要填，程式會保持可啟動並在總部後台顯示缺少的變數名稱。本文件不提供、也不假設已經拿到金鑰。

設定下列環境變數：

| 名稱 | 值 |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/tmp/mcw-data` |
| `GEOCODE_ON_START` | `true`（已由目前行程的定位日誌證實有在跑；失敗不會被記成成功） |
| `ADMIN_USER` | 自訂總部帳號，例如 `hq` |
| `ADMIN_PASSWORD` | 在平台安全填入，至少 16 字元 |
| `PERSIST_DRIVER` | 有金鑰後設為 `s3`；只有持久目錄時設為 `file`；否則留空 |
| `PERSIST_S3_ENDPOINT` | S3 相容端點，只在平台填入 |
| `PERSIST_S3_BUCKET` | bucket 名稱 |
| `PERSIST_S3_REGION` | R2 用 `auto` |
| `PERSIST_S3_ACCESS_KEY_ID` | 只在平台填入 |
| `PERSIST_S3_SECRET_ACCESS_KEY` | 只在平台填入 |

Render 提供 `PORT`，程式會自動使用，不需要硬編碼。

## 上線驗收

部署成功後，使用平台提供的 HTTPS 網址檢查：

1. 手機首頁可顯示「魔彩自助洗衣・屏東新園店」及「魔彩自助洗衣・高雄大豐店」。
2. 兩店地址分別為「屏東縣新園鄉仙吉路32號」及「高雄市三民區大豐一路26號」。
3. 在尚未核實座標時，不應出現虛構地圖標記；「開始導航」使用完整地址，能選 Google Maps／Apple 地圖。
4. `/admin` 可使用平台設定的總部帳密登入。未登入時 `/api/admin/stores` 回應 401。
5. 用草稿門市驗證新增、修改與圖片上傳；草稿不會出現在消費者地圖。
6. 已設定 `PERSIST_*` 時，重新啟動後草稿、門市內容和圖片仍在；未設定時 Free 的 `/tmp` 不會保留。測試草稿測完即刪。
7. 手機照片輪播／全圖查看、分享連結、瀏覽器返回、縣市與收藏可操作。

服務啟用後，可將 HTTPS 網址填入 LINE 官方帳號圖文選單。LIFF ID、外部影片／AI 店長／加盟入口與原廠設備 API 尚待總部提供；沒有資料時維持禁用或未串接狀態。

## 備份與還原

在專案工作目錄執行：

```sh
DATA_DIR=/tmp/mcw-data npm run backup -- /tmp/mcw-backup-01
```

在 Render Free 上，這個目錄一樣會跟著容器消失。要留下總部資料，請在後台按「立即備份」，或設定 `PERSIST_DRIVER=s3` 讓每次儲存都上傳。檔案驅動只適合資料目錄以外、真的會保留的路徑。

目標需是尚未存在的目錄，並位於 `DATA_DIR` 外。指令使用 SQLite 原生線上備份 API，取得一致的資料庫，再複製備份中引用的照片；不會修改正在使用的資料庫。備份有 SHA-256 檔案清單，且會清除備份內的登入工作階段。備份目錄有私人權限，請另行保存一份於服務之外。

還原時先停止服務，保留現有 `DATA_DIR` 以便復原，再把備份中的 `mcw.sqlite` 與 `uploads/` 放到一個新的資料目錄，將 `DATA_DIR` 指向該目錄後啟動。不要覆蓋正在使用的資料庫，也不要把 `.env` 或管理員密碼加入備份。還原後管理員必須重新登入。

## 座標確認

總部後台可按「查詢地址座標」。伺服器只向 `nominatim.openstreetmap.org` 送出結構化查詢，帶應用程式識別、限制速率與逾時。門牌、路名、行政區相符且唯一，而且沒有其他店名時才寫入。失敗記在 `geocode_attempts`，不會變成成功，也會在間隔後再試。`bootstrap_records` 裡舊的 `geocode-attempt-v1` 不再阻止重試。

沒有核實座標時不放地圖圖標；「開始導航」使用完整地址，可選 Google Maps／Apple 地圖。

2026-11-06 以標準 HTTP 讀取使用者提供的兩條短網址，轉址店名分別是「魔彩泡泡自助洗衣-廣東南店（洗脫烘）」與「魔彩泡泡自助洗衣（洗脫烘一機到底）」，頁面沒有仙吉路或大豐一路，沒有拿視窗中心或那兩組座標當這兩家店。同一天的 Nominatim 結構化查詢：大豐一路 26 號有一筆未命名門牌；仙吉路 32 號的門牌名稱是全聯福利中心。程式只接受前者。

## 雲端保存與還原

總部登入後可維護店名、地址、電話、營業時間、機台配置與照片，並按「立即備份」或「從雲端還原」。還原需要請求本文 `{"confirm":"RESTORE"}`，會取代門市資料並清掉登入工作階段。備份使用 SQLite backup API，附 SHA-256，不包含管理員密碼。

照片在伺服器解碼、轉成 WebP、去掉 metadata 後才保存。刪除門市不會自動刪除可能被共用的檔案。正式環境請使用 HTTPS。未登入呼叫 `/api/admin/*` 會得到 401。

Render 日誌可查 `門市地址定位完成` 或 `門市地址定位未寫入座標`。不要把測試時主動擋下的 OSM 圖磚，當成公開站圖磚故障。Helmet 的 Referrer-Policy 維持 `strict-origin-when-cross-origin`。
