import { authorizationUrl, DRIVE_SCOPE } from "./gdrive.js";
const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://127.0.0.1";
if (!clientId || !clientSecret) {
  console.log(
    "請在環境變數提供 GOOGLE_CLIENT_ID 與 GOOGLE_CLIENT_SECRET，不要寫進 git 或 render.yaml。",
  );
  console.log("授權範圍只使用 " + DRIVE_SCOPE + "，不會讀取雲端硬碟裡的其他檔案。");
  process.exitCode = 1;
} else if (!process.env.GOOGLE_AUTH_CODE) {
  console.log(authorizationUrl({ clientId, redirectUri }).toString());
  console.log(
    "用將保存備份的 Google 帳號開啟上面的網址。同意後，把重新導向網址裡的 code 放到 GOOGLE_AUTH_CODE，再執行一次。重新整理權杖只會印在這個終端機。",
  );
} else {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: process.env.GOOGLE_AUTH_CODE,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = await response.json();
  if (!response.ok || !json.refresh_token) {
    console.error("沒有取得重新整理權杖 HTTP " + response.status);
    process.exitCode = 1;
  } else {
    console.log("GOOGLE_REFRESH_TOKEN=" + json.refresh_token);
    console.log("請只貼到 Render 的環境變數。不要提交、不要設成公開分享。");
  }
}
