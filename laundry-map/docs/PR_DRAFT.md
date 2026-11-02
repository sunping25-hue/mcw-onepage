## 變更

為 Issue #1 新增獨立 `laundry-map/` React / Express 專案，保留原有一頁式網站。包含 OSM 互動地圖／群聚／GPS／搜尋與收藏、門市詳情、YouTube 分類與外部入口、單一總部登入與 CRUD、SQLite migration、圖片驗證重編與持久儲存。

公開門市必須經總部確認地址與座標。正式資料庫不預植未核實門市；未配置影片或連結明確禁用。公開機台狀態固定為未串接，提供 schema、TTL、受信任 API adapter 與受保護的 DEMO stub，不產生假即時空機資訊。

## 驗證

- `npm test`：8 項通過，包含權限、同來源驗證、CRUD／持久化、圖片、網址、TTL、adapter 與登出。
- `npm run build` 成功；`npm audit --omit=dev` 為 0 個已知漏洞。
- Chromium 375px / 390px：主要頁面、空狀態、無水平溢出；真實本機後端總部登入→新增／公開→群聚展開／標記選店→收藏→詳情連結→定位拒絕／搜尋通過。
- 正式模式 HTML、JS 資產、CSP、公開 API 與未設定帳密時拒絕登入通過。
- 圖磚在瀏覽器測試中替代／阻擋；截圖與測試資料為隔離 DEMO，不代表真實門市或外部圖磚連線已驗證。

## 待補與驗收範圍

- 交接 ZIP、主要五支手機參考圖與原始品牌／門市照片未提供；目前使用既有正式 Logo，不能宣稱通過核准視覺驗收。
- 需填入真實門市、費率、照片、LINE／教學／AI 店長／評價／加盟網址；未整合原廠 API 或 LIFF SDK。
- 需以環境設定提供總部密碼並使用 HTTPS／永久磁碟。內含 README、.env.example、migrations、Render Blueprint 範例及五個 390px 截圖。
- 未配置 Render 部署權限，尚無公開測試網址。

Related to #1. 此 PR 供功能與技術驗收，不自動關閉尚待品牌素材與部署驗收的 Issue。
