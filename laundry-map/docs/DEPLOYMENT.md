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

後台使用 SQLite 與上傳照片，需要持久磁碟；現有範本採 `starter` 付費方案和 1GB 磁碟。建立服務前由帳號擁有者確認平台顯示的方案與費用。**目前尚未建立服務或部署。**

將磁碟掛載到 `/var/data`，設定下列環境變數：

| 名稱 | 值 |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/var/data/mcw` |
| `ADMIN_USER` | 自訂總部帳號，例如 `hq` |
| `ADMIN_PASSWORD` | 在平台安全填入，至少 16 字元 |

Render 提供 `PORT`，程式會自動使用，不需要硬編碼。

## 上線驗收

部署成功後，使用平台提供的 HTTPS 網址檢查：

1. 手機首頁可顯示「魔彩自助洗衣・屏東新園店」及「魔彩自助洗衣・高雄大豐店」。
2. 兩店地址分別為「屏東縣新園鄉仙吉路32號」及「高雄市三民區大豐一路26號」。
3. 在尚未核實座標時，不應出現虛構地圖標記；「開始導航」使用完整地址，能選 Google Maps／Apple 地圖。
4. `/admin` 可使用平台設定的總部帳密登入。未登入時 `/api/admin/stores` 回應 401。
5. 用草稿門市驗證新增、修改與圖片上傳；草稿不會出現在消費者地圖。
6. 重啟服務後，再次確認草稿／門市內容和圖片保留；測試後刪除測試草稿。
7. 手機照片輪播／全圖查看、分享連結、瀏覽器返回、縣市與收藏可操作。

服務啟用後，可將 HTTPS 網址填入 LINE 官方帳號圖文選單。LIFF ID、外部影片／AI 店長／加盟入口與原廠設備 API 尚待總部提供；沒有資料時維持禁用或未串接狀態。

## 備份與還原

在專案工作目錄執行：

```sh
DATA_DIR=/var/data/mcw npm run backup -- /var/data/backups/mcw-backup-01
```

目標需是尚未存在的目錄，並位於 `DATA_DIR` 外。指令使用 SQLite 原生線上備份 API，取得一致的資料庫，再複製備份中引用的照片；不會修改正在使用的資料庫。備份有 SHA-256 檔案清單，且會清除備份內的登入工作階段。備份目錄有私人權限，請另行保存一份於服務之外。

還原時先停止服務，保留現有 `DATA_DIR` 以便復原，再把備份中的 `mcw.sqlite` 與 `uploads/` 放到一個新的資料目錄，將 `DATA_DIR` 指向該目錄後啟動。不要覆蓋正在使用的資料庫，也不要把 `.env` 或管理員密碼加入備份。還原後管理員必須重新登入。

## 座標確認

總部後台的地址欄位下方有「在 Google Maps 核對門市位置」入口。請核對實際門牌與店面，再填入緯度與經度並儲存。地址搜尋只提供核對入口，不會自動把搜尋中心點當成店址。

也可以把兩家門市的 Google Maps 商家連結提供給開發者核對。目前雲端地址查詢服務的網路設定尚未生效，所以沒有用推測值代替店址。
