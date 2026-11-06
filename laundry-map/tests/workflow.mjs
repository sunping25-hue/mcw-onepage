import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const dir = mkdtempSync(join(tmpdir(), "mcw-browser-"));
const persistDir = mkdtempSync(join(tmpdir(), "mcw-persist-"));
const password = randomBytes(24).toString("hex");
const port = 3199,
  base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["tests/fixture-server.mjs"], {
  env: {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dir,
    ADMIN_USER: "hq",
    ADMIN_PASSWORD: password,
    PERSIST_DRIVER: "file",
    PERSIST_FILE_DIR: persistDir,
    GEOCODE_ON_START: "false",
  },
  stdio: "ignore",
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/stores")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) throw Error("Server not ready");
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.stack));
  await page.route("https://*.tile.openstreetmap.org/**", (r) => r.abort());
  await page.goto(base + "/admin");
  await page.getByLabel("帳號", { exact: true }).fill("hq");
  await page.getByLabel("密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await page.getByRole("heading", { name: "MCW 總部後台" }).waitFor();
  await page
    .getByLabel("LINE 官方帳號 HTTPS 網址")
    .fill("https://line.me/example");
  await page
    .getByLabel("加盟聯絡 HTTPS 網址", { exact: true })
    .fill("https://example.com/franchise");
  await page.getByRole("button", { name: "儲存入口" }).click();
  await page.getByText("總部入口已更新").waitFor();
  await page.getByRole("button", { name: "＋ 新增分店" }).click();
  assert.equal(await page.getByLabel("營業時間", { exact: true }).inputValue(), "24小時");
  assert.equal(await page.getByLabel("開店狀態", { exact: true }).inputValue(), "open");
  await page
    .getByLabel("門市名稱", { exact: true })
    .fill("DEMO 測試門市（非營運資料）");
  await page.getByLabel("縣市", { exact: true }).fill("測試縣市");
  await page.getByLabel("完整地址").fill("測試地址，僅自動測試使用");
  await page.getByLabel("緯度", { exact: true }).fill("24");
  await page.getByLabel("經度", { exact: true }).fill("121");
  await page.getByLabel("電話", { exact: true }).fill("0912345678");
  await page.getByLabel("營業時間").fill("測試時段");
  await page.getByLabel("已核實門市資訊").check();
  await page.getByLabel("公開於消費者地圖", { exact: false }).check();
  await page.getByLabel("開店狀態", { exact: true }).selectOption("planned");
  await page.getByText("選用交接包品牌照片", { exact: true }).click();
  await page
    .getByRole("button", { name: "花蓮門市外觀實拍", exact: true })
    .click();
  await page
    .getByRole("button", { name: "花蓮門市實拍 2", exact: true })
    .click();
  await page.getByRole("button", { name: "＋ 新增設備" }).click();
  await page.getByLabel("機號", { exact: true }).fill("TEST-01");
  await page.getByLabel("設備規格", { exact: true }).fill("僅自動測試規格");
  await page
    .getByLabel("設備照片", { exact: true })
    .selectOption("/brand/mcw-wash-dry.webp");
  await page.getByLabel("設備 ID", { exact: true }).fill("test-1");
  await page.getByLabel("型號", { exact: true }).fill("測試型號");
  await page.getByLabel("容量", { exact: true }).fill("測試容量");
  await page.getByLabel("費率（未核實請留白）").fill("測試費率");
  await page.getByRole("button", { name: "＋ 新增教學" }).click();
  await page.getByLabel("影片名稱").fill("測試教學");
  await page
    .getByLabel("YouTube 網址")
    .fill("https://www.youtube.com/watch?v=test");
  await page
    .getByLabel("AI 智慧店長網址（僅連結）")
    .fill("https://example.com/manager");
  await page.getByLabel("Google 評價網址").fill("https://example.com/review");
  await page.getByLabel("洗脫烘 16KG 台數").fill("5");
  await page.getByLabel("洗脫烘 22KG 台數").fill("0");
  await page.getByLabel("無 API 時的查詢方式").selectOption("button");
  await page.getByLabel("機台查詢網址").fill("https://example.com/machines");
  await page.getByLabel("洗脫烘 16KG 台數").scrollIntoViewIfNeeded();
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  await page.screenshot({ path: "artifacts/admin-machine-counts-375.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/admin-machine-counts-390.png" });
  await page.getByLabel("機台查詢網址").scrollIntoViewIfNeeded();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: "artifacts/admin-machine-query-375.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/admin-machine-query-390.png" });
  await page.getByRole("button", { name: "儲存門市", exact: true }).click();
  await page.getByText("門市已儲存；公開且已確認的內容會反映於前台").waitFor();
  await page.getByRole("button", { name: "立即備份", exact: true }).click();
  await page.getByText("雲端備份完成").waitFor();
  mkdirSync("artifacts", { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "artifacts/admin-backup-390.png", fullPage: false });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "artifacts/admin-backup-375.png", fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  const existing = await (
    await ctx.request.get(base + "/api/admin/stores")
  ).json();
  const copy = {
    ...existing[0],
    name: "DEMO 第二測試門市",
    lat: 24.001,
    lng: 121.001,
  };
  const created = await ctx.request.post(base + "/api/admin/stores", {
    data: copy,
    headers: { Origin: base },
  });
  assert.equal(created.status(), 200);
  await page.goto(base);
  await page
    .getByRole("button", { name: "DEMO 測試門市（非營運資料） →" })
    .waitFor();
  await page.locator(".leaflet-control-zoom-out").click();
  await page.waitForTimeout(400);
  await page.locator(".leaflet-control-zoom-out").click();
  await page.waitForTimeout(400);
  await page.locator(".cluster").waitFor();
  await page.locator(".cluster").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".pin").length === 2,
  );
  await page.getByTitle("DEMO 測試門市（非營運資料）", { exact: true }).click();
  await page
    .getByRole("heading", { name: "DEMO 測試門市（非營運資料）" })
    .waitFor();
  await page.getByRole("button", { name: "← 返回地圖" }).click();

  await page
    .getByRole("button", { name: "DEMO 測試門市（非營運資料） →" })
    .waitFor();
  await page
    .getByRole("button", { name: "收藏 DEMO 測試門市（非營運資料）" })
    .click();
  await page.getByRole("button", { name: /我的收藏$/ }).click();
  await page.getByRole("heading", { name: "我的收藏" }).waitFor();
  await page.getByRole("button", { name: "列表", exact: true }).click();
  assert.equal(await page.locator(".leaflet-container").count(), 0);
  await page.getByRole("button", { name: "地圖", exact: true }).click();
  await page
    .getByRole("button", { name: "DEMO 測試門市（非營運資料） →" })
    .click();
  await page
    .getByRole("heading", { name: "DEMO 測試門市（非營運資料）" })
    .waitFor();
  await page.getByText("未知／未連線").waitFor();
  await page.getByText("洗脫烘 16KG｜5台", { exact: true }).waitFor();
  assert.equal(await page.getByText("洗脫烘 22KG｜0台").count(), 0);
  assert.equal(await page.getByText("本店尚未配置操作教學影片。").count(), 0);
  const channel = page.getByRole("link", { name: "YouTube 操作教學", exact: true });
  assert.equal(
    await channel.getAttribute("href"),
    "https://www.youtube.com/@%E9%AD%94%E5%BD%A9%E8%87%AA%E5%8A%A9%E6%B4%97%E8%A1%A3%E5%8A%A0%E7%9B%9F",
  );
  assert.equal(await channel.getAttribute("target"), "_blank");
  const machines = page.getByRole("link", { name: "空機查詢 ↗", exact: true });
  assert.equal(await machines.getAttribute("href"), "https://example.com/machines");
  assert.equal(await machines.getAttribute("target"), "_blank");
  assert.equal(await machines.getAttribute("rel"), "noopener noreferrer");
  await page.getByRole("button", { name: "下一張照片" }).click();
  assert.equal(
    await page.locator(".photo-carousel>img").getAttribute("src"),
    "/brand/hualien-store-2.webp",
  );
  await page.getByRole("button", { name: "上一張照片" }).click();
  assert.equal(
    await page.locator(".photo-carousel>img").getAttribute("src"),
    "/brand/hualien-store-1.webp",
  );
  assert.equal(
    await page.locator(".equipment-photo > img").getAttribute("src"),
    "/brand/mcw-wash-dry.webp",
  );
  await page.getByText("最後更新：尚無資料").waitFor();
  await page.getByText("剩餘時間：尚無資料").waitFor();
  await page.getByRole("button", { name: "開始導航 ↗", exact: true }).click();
  await page.getByRole("dialog", { name: "選擇導航地圖" }).waitFor();
  assert.match(
    decodeURIComponent(
      await page
        .getByRole("link", { name: "Google Maps 導航 ↗" })
        .getAttribute("href"),
    ),
    /destination=測試地址，僅自動測試使用/,
  );
  await page.getByRole("button", { name: "取消導航", exact: true }).click();
  const lesson = page.getByRole("link", { name: "洗脫烘 · 測試教學 ↗" });
  assert.match(await lesson.getAttribute("href"), /youtube/);
  assert.equal(await lesson.getAttribute("target"), "_blank");
  const beforeLesson = page.url();
  await lesson.evaluate((el) =>
    el.addEventListener("click", (event) => event.preventDefault(), {
      capture: true,
    }),
  );
  await lesson.click();
  assert.equal(page.url(), beforeLesson);
  const detailUrl = page.url();
  assert.match(detailUrl, /store=/);
  await page.reload();
  await page
    .getByRole("heading", { name: "DEMO 測試門市（非營運資料）" })
    .waitFor();
  await page.locator(".photo-carousel").evaluate((el) => {
    const t = new Touch({
      identifier: 1,
      target: el,
      clientX: 260,
      clientY: 150,
    });
    el.dispatchEvent(
      new TouchEvent("touchstart", { bubbles: true, touches: [t] }),
    );
    const end = new Touch({
      identifier: 1,
      target: el,
      clientX: 100,
      clientY: 155,
    });
    el.dispatchEvent(
      new TouchEvent("touchend", { bubbles: true, changedTouches: [end] }),
    );
  });
  await page.waitForFunction(
    () =>
      document.querySelector(".photo-carousel>img").getAttribute("src") ===
      "/brand/hualien-store-2.webp",
  );
  await page.getByRole("button", { name: "上一張照片" }).click();
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: base,
  });
  await page.getByRole("button", { name: "分享門市 ↗", exact: true }).click();
  await page.getByText("門市連結已複製").waitFor();
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /store=/,
  );
  mkdirSync("artifacts", { recursive: true });
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({
      width,
      height: { 320: 568, 375: 812, 390: 844, 430: 932 }[width],
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const ratio = await page
      .locator(".photo-carousel > img")
      .evaluate((el) => el.clientWidth / el.clientHeight);
    assert.ok(
      Math.abs(ratio - 4 / 3) < 0.02,
      "Phone store images must use a responsive 4:3 frame",
    );
    assert.equal(
      await page
        .locator(".photo-carousel > img")
        .evaluate((el) => getComputedStyle(el).objectFit),
      "contain",
    );
    await page.locator(".photo-carousel > .view-photo").click();
    const viewer = page.getByRole("dialog");
    await viewer.waitFor();
    assert.ok((await viewer.boundingBox()).width <= width);
    assert.equal(
      await viewer.locator("img").getAttribute("src"),
      "/brand/hualien-store-1.webp",
    );
    await page.getByRole("button", { name: "關閉照片 ✕" }).click();
    await viewer.waitFor({ state: "hidden" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/detail-demo-${width}.png` });
    await page.screenshot({
      path: `artifacts/detail-demo-${width}-full.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "← 返回地圖" }).click();
  await page.getByRole("button", { name: /操作教學$/ }).click();
  await page.getByRole("heading", { name: "會員儲值點數操作教學", exact: true }).waitFor();
  const catalogLesson = page.getByRole("link", {
    name: "DEMO 測試門市（非營運資料） · 測試教學 ↗",
    exact: true,
  });
  await catalogLesson.waitFor();
  assert.equal(await catalogLesson.getAttribute("target"), "_blank");
  const tutorialUrl = page.url();
  await catalogLesson.evaluate((el) =>
    el.addEventListener("click", (event) => event.preventDefault(), {
      capture: true,
    }),
  );
  await catalogLesson.click();
  assert.equal(page.url(), tutorialUrl);
  await page.getByRole("button", { name: /附近地圖$/ }).click();
  await page.getByRole("button", { name: "◎ 找離我最近" }).click();
  await page.getByText("無法取得定位；你仍可選縣市或搜尋門市。").waitFor();
  await page.getByPlaceholder("輸入門市、地址或縣市").fill("不存在的門市");
  await page.getByRole("heading", { name: "找不到符合條件的門市" }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Real HQ login → settings → create/publication → favorites → details/links → GPS refusal/search passed; isolated test data removed.",
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  rmSync(dir, { recursive: true, force: true });
  rmSync(persistDir, { recursive: true, force: true });
}
