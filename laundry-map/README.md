# MCW 洗衣地圖 V1

Issue #1 的獨立 React / Express 專案。既有根目錄一頁式網站不受影響。採 Node 24 內建 SQLite、React Leaflet / OpenStreetMap；不需 Supabase 即可在瀏覽器操作。

## 開發

```sh
cd /workspace/mcw-onepage/laundry-map
npm ci
npm run dev
```

預設 port 3000，總部介面 `/admin`。啟動前以安全的環境設定提供 `ADMIN_USER`（預設 `hq`）與至少 16 字元的 `ADMIN_PASSWORD`。沒有密碼時只開放公開讀取，登入回應 503，沒有預設帳密。`.env.example` 僅供欄位說明；若使用本機 `.env`，執行 `node --env-file=.env server/index.js`，npm scripts 不會自動載入 `.env`。不要提交 `.env`。

每個雲端任務已隔離，直接使用現有 checkout，除非使用者要求，不建立 worktree。

## 功能與資料界線

- 五個主要流程：附近／全台互動地圖、門市詳情、YouTube 教學、加盟入口；另有本機收藏。地圖可平移、縮放、門市點選與低縮放群聚，GPS 失敗時可手動搜尋及選縣市。距離為球面直線距離，非行車時間。
- 正式資料庫不預植門市。未確認地址／座標或未公開的草稿不進入公開 API。花蓮店規劃數量、設計圖店數及未知費率都不作為營運資料。
- 單一總部帳號管理門市、地址座標、電話、時段、公告、圖片、設備數量／型號／容量／費率、設備識別、YouTube 分類與外部入口。保存後下一次 API 請求即反映；前台重新整理或切回視窗會重新讀取。
- AI 智慧店長、LINE、Google 評價與加盟均只連到後台設定的 HTTPS 網址；未設定即禁用，不模擬內容。導航由已確認座標產生 Google Maps / Apple 地圖連結。
- 不收集加盟個資、不提供支付、掃碼、遠端啟停、加盟主後台或 AI 對話邏輯。
- 一般手機瀏覽器與 LINE 內建瀏覽器可使用。LIFF-ready：沒有強制 LINE 登入；LIFF ID／SDK 與 LINE 官方帳號 rich-menu 導流尚待總部配置，不宣稱已完成 LIFF 整合。

## 資料、照片與權限

`DATA_DIR` 預設 `./data`，自動執行 `migrations/001_initial.sql`，保留 SQLite 與 uploads。正式部署必須使用永久儲存空間、定期備份，單一 Node instance；多 instance 需先改用共用資料庫／物件儲存。備份時停止寫入或使用 SQLite backup API，不能只任意複製正在寫入的主檔而忽略 WAL。

所有 `/api/admin/*` 由伺服器驗證 session；登入密碼以 scrypt 比對，資料庫僅存 session token SHA-256，8 小時有效、登出撤銷。登入限流、SameSite=Strict / HttpOnly cookie、同來源 Origin 驗證、Helmet/CSP、Zod 白名單驗證。正式模式 cookie Secure，需 HTTPS。無開放註冊、無前端密碼或管理員金鑰。正式上線前應依總部需求評估 SSO/MFA、密碼輪替與稽核紀錄；目前為單一總部帳號 V1。

照片限 8MB / 2400 萬像素，伺服器解碼、重編 WebP、移除 metadata，以隨機檔名存放。原始檔不公開。刪除照片引用或門市不會自動清除實體檔案，以免誤刪共用引用；應另行制定保留與清理政策。只上傳有權公開的照片。

## 機台狀態整合契約

`server/model.js` 定義 `machineStatusSchema`、`MachineStatusProvider`、`StubMachineStatusProvider`、`ManufacturerApiAdapter`、`normalizeStatus`。欄位包含 `machine_id`、`status`（idle/running/fault/offline/unknown）、`last_updated`、`ttl_seconds`、`source`、`simulated`。過期、未更新或未來時間戳記一律降為 unknown。

`GET /api/stores/:id/status` **目前固定使用未連接 provider**，不因門市設定而冒充原廠連線。UI 明示「即時資訊尚未串接」，不顯示假空機數／倒數。`GET /api/admin/stores/:id/demo-status` 需總部登入，回應明標 DEMO 模擬資料；不發布到消費者端。

`ManufacturerApiAdapter` 接受受信任的伺服器端 snapshot reader，驗證回應與 TTL，錯誤或無效資料降為 unknown；目前沒有在公開 API 啟用。未來 API / MQTT 應在伺服器側實作 `getStatuses(equipment)` adapter，驗證 schema / TTL，另加提供者授權與測試後才啟用。設備 `providerKey`、門市 `providerReference` 是非機密參照，不回傳前台；API 密鑰必須以安全 runtime 配置提供。V1 不接受任意 API URL，不從使用者輸入發出遠端請求，避免 SSRF。

## 驗證

```sh
npm test
npm run build
npm audit --omit=dev
# 開發服務另外啟動：PORT=3100 DATA_DIR=/tmp/mcw-browser-dev npm run dev
node tests/mobile.mjs
# 自行啟動隔離 server / DB，完成後清除測試資料：
node tests/workflow.mjs
```

瀏覽器測試需 `/usr/bin/chromium`（或調整腳本 executablePath）。`mobile.mjs` 在 375px / 390px 擷取四個主要入口與登入畫面；`workflow.mjs` 實測總部登入、設定、建立／公開門市、群聚展開、標記選店、收藏、詳情導航連結、定位拒絕及搜尋，並擷取第五個詳情畫面。所有測試門市均明標 DEMO 且只在 `/tmp` 隔離 DB，結束刪除。圖片保存在 ignored 的 `artifacts/`。瀏覽器測試只替代／阻擋 OSM 圖磚，其他 API 為真實本機服務，**不代表外部圖磚連線或核准設計相似度已驗證**。8 項後端測試包含未授權操作、來源驗證、持久化 CRUD、私有設定隔離、圖片、URL、TTL、登出。

## 正式部署

```sh
npm ci
npm run build
NODE_ENV=production DATA_DIR=/persistent/mcw npm start
```

有提供 `render.yaml` 部署範例：使用 permanent disk、HTTPS 與安全設定的 `ADMIN_PASSWORD`，不要將密碼寫入 YAML。Render Blueprint 可使用 repo 內此檔路徑；既有一頁式 GitHub Pages 不會啟動此 Node 服務。健康檢查 `/api/stores`。正式部署後需驗證 HTTPS 登入、圖片持久化與重啟保留資料。Render 權限／服務未配置，未建立公開測試站。

需要 npm registry、GitHub、OpenStreetMap 圖磚連線；雲端已保存額外需求 `api.github.com`、`drive.google.com`、`drive.usercontent.google.com`、`*.tile.openstreetmap.org` 至環境草稿。保存不代表已套用，請在環境設定檢閱儲存並發布。

## 尚待提供／驗收

- `MCW_洗衣地圖_Codex交接包.zip` / `CODEX_HANDOFF.md` / `five-phone-original.jpg` 尚未提供，無法驗證五支手機核准設計相似度。暫用 repo 正式 Logo、深科技藍介面。缺少藍白貓咪、花蓮店與機台原始照片；Drive 下載在目前網路設定下回應 403，未以生成素材替代品牌資料。
- 總部填入已核實門市、照片、費率、YouTube／AI／評價／加盟／LINE 入口。未配置入口誠實顯示禁用。
- 未配置原廠設備 API、LIFF、正式 ADMIN_PASSWORD、Render 部署；不影響本機開發與非假資料版本。
- PR 與測試網址狀態依交付回報；GitHub API 目前 Forbidden，已保存 API 網域需求，不能視為已建立 PR。

## 手機驗證截圖

[附近地圖](docs/screenshots/nearby-390.png) · [全台總覽](docs/screenshots/taiwan-390.png) · [門市詳情（隔離 DEMO 測試資料）](docs/screenshots/detail-demo-390.png) · [YouTube 教學空狀態](docs/screenshots/tutorials-390.png) · [加盟入口空狀態](docs/screenshots/franchise-390.png)。此為 390px 實際 UI；底圖為測試替代圖磚，不是正式地圖視覺或真實門市證據。
