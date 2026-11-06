import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import sharp from "sharp";

const dir = mkdtempSync(join(tmpdir(), "mcw-browser-album-"));
const persistDir = mkdtempSync(join(tmpdir(), "mcw-album-persist-"));
const password = randomBytes(24).toString("hex");
const port = 3201;
const base = `http://127.0.0.1:${port}`;
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
const colors = {
  red: { r: 220, g: 30, b: 30 },
  green: { r: 20, g: 160, b: 60 },
  blue: { r: 30, g: 70, b: 210 },
  yellow: { r: 230, g: 190, b: 20 },
  purple: { r: 120, g: 40, b: 180 },
};
const pngs = {};
let browser;
try {
  for (const [name, color] of Object.entries(colors)) {
    pngs[name] = await sharp({
      create: { width: 48, height: 36, channels: 3, background: color },
    })
      .png()
      .toBuffer();
  }
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/stores")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) throw Error("Album test server not ready");
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.stack || String(e)));
  await page.route("https://*.tile.openstreetmap.org/**", (r) => r.abort());
  await page.route("https://photos.example.test/**", async (route) => {
    const name = new URL(route.request().url()).pathname.slice(1).replace(/\.png$/, "");
    if (!pngs[name]) return route.abort();
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: pngs[name],
    });
  });
  await page.goto(base + "/admin");
  await page.getByLabel("帳號", { exact: true }).fill("hq");
  await page.getByLabel("密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await page.getByRole("heading", { name: "MCW 總部後台" }).waitFor();
  const empty = await ctx.request.post(base + "/api/admin/stores", {
    headers: { Origin: base },
    data: {
      name: "照片待補測試門市（非營運資料）",
      openingStatus: "open",
      city: "測試縣市",
      address: "照片待補測試地址",
      phone: "",
      hours: "24小時",
      announcement: "",
      lat: 24.2,
      lng: 121.2,
      confirmed: true,
      published: true,
      photos: [],
      equipment: [],
      tutorials: [],
      aiUrl: "",
      reviewUrl: "",
      franchiseUrl: "",
      machineQueryMode: "off",
      machineQueryUrl: "",
      provider: "unconnected",
      providerReference: "",
    },
  });
  assert.equal(empty.status(), 200);
  const emptyStore = await empty.json();
  await page.getByRole("button", { name: "＋ 新增分店" }).click();
  await page.getByLabel("門市名稱", { exact: true }).fill("相簿測試門市（非營運資料）");
  await page.getByLabel("縣市", { exact: true }).fill("測試縣市");
  await page.getByLabel("完整地址").fill("相簿測試地址，僅自動測試使用");
  await page.getByLabel("緯度", { exact: true }).fill("24.1");
  await page.getByLabel("經度", { exact: true }).fill("121.1");
  await page.getByLabel("已核實門市資訊").check();
  await page.getByLabel("公開於消費者地圖", { exact: false }).check();
  assert.equal(await page.getByLabel("上傳門市照片").count(), 0);
  await page.getByText("選用交接包品牌照片", { exact: true }).click();
  await page.getByRole("button", { name: "花蓮門市外觀實拍", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "MCW 洗脫烘設備實拍", exact: true }).count(),
    0,
  );
  async function addLink(url) {
    const before = await page.locator(".photo-admin img").count();
    await page.getByLabel("照片網址", { exact: true }).fill(url);
    await page.getByRole("button", { name: "加入照片連結", exact: true }).click();
    await page.locator(".photo-admin img").nth(before).waitFor();
  }
  await page.getByLabel("照片網址", { exact: true }).fill("http://photos.example.test/red.png");
  await page.getByRole("button", { name: "加入照片連結", exact: true }).click();
  await page.getByRole("alert").getByText(/https/).waitFor();
  assert.equal(await page.locator(".photo-admin img").count(), 0);
  for (const name of ["red", "green", "blue"]) {
    await addLink(`https://photos.example.test/${name}.png`);
  }
  assert.equal(await page.getByText("主照片", { exact: true }).count(), 1);
  await page.getByRole("button", { name: "上移第 3 張", exact: true }).click();
  await page.getByRole("button", { name: "上移第 2 張", exact: true }).click();
  const moved = await page.locator(".photo-admin img").evaluateAll((els) =>
    els.map((el) => el.getAttribute("src")),
  );
  assert.equal(moved[0], "https://photos.example.test/blue.png");
  await page.getByRole("button", { name: "移除第 3 張", exact: true }).click();
  await page.locator(".photo-admin img").nth(2).waitFor({ state: "detached" });
  await addLink("https://photos.example.test/yellow.png");
  await addLink("https://photos.example.test/purple.png");
  await addLink("https://photos.example.test/missing.png");
  const savedOrder = await page.locator(".photo-admin img").evaluateAll((els) =>
    els.map((el) => el.getAttribute("src")),
  );
  assert.deepEqual(savedOrder, [
    "https://photos.example.test/blue.png",
    "https://photos.example.test/red.png",
    "https://photos.example.test/yellow.png",
    "https://photos.example.test/purple.png",
    "https://photos.example.test/missing.png",
  ]);
  await page.getByText("已達 5 張上限。請先移除再加入。").waitFor();
  assert.equal(await page.getByLabel("照片網址", { exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "儲存門市", exact: true }).click();
  await page.getByText("門市已儲存；公開且已確認的內容會反映於前台").waitFor();
  const stores = await (await ctx.request.get(base + "/api/admin/stores")).json();
  const album = stores.find((store) => store.name === "相簿測試門市（非營運資料）");
  const blank = stores.find((store) => store.id === emptyStore.id);
  assert.deepEqual(album.photos, savedOrder);
  assert.deepEqual(blank.photos, []);
  const overflow = await ctx.request.put(base + "/api/admin/stores/" + album.id, {
    headers: { Origin: base },
    data: {
      ...album,
      photos: [...album.photos, "https://photos.example.test/extra.png"],
    },
  });
  assert.equal(overflow.status(), 400);
  assert.match((await overflow.json()).error, /5/);
  const promo = await ctx.request.put(base + "/api/admin/stores/" + album.id, {
    headers: { Origin: base },
    data: { ...album, photos: ["/brand/mcw-round-logo.png"] },
  });
  assert.equal(promo.status(), 400);
  await page.getByRole("button", { name: "立即備份", exact: true }).click();
  await page.getByText("雲端備份完成").waitFor();
  const afterBackup = await (await ctx.request.get(base + "/api/admin/stores")).json();
  assert.deepEqual(
    afterBackup.find((store) => store.id === album.id).photos,
    savedOrder,
  );
  assert.deepEqual(
    afterBackup.find((store) => store.id === emptyStore.id).photos,
    [],
  );
  mkdirSync("artifacts", { recursive: true });
  await page.locator(".photo-admin").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/album-admin-390.png" });
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  await page.screenshot({ path: "artifacts/album-admin-1280.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.getByRole("button", { name: "相簿測試門市（非營運資料） →" }).click();
  await page.getByRole("heading", { name: "相簿測試門市（非營運資料）" }).waitFor();
  const stage = page.locator(".photo-stage > img");
  assert.equal(await stage.getAttribute("src"), savedOrder[0]);
  await page.getByText("第 1 張，共 5 張", { exact: true }).waitFor();
  async function swipe(direction) {
    const box = await page.locator(".photo-stage").boundingBox();
    const y = box.y + box.height * 0.42;
    const startX = box.x + box.width * (direction === "left" ? 0.82 : 0.18);
    const endX = box.x + box.width * (direction === "left" ? 0.16 : 0.84);
    await page.locator(".photo-stage").evaluate((el) => {
      el.dataset.trusted = "";
      el.addEventListener(
        "touchend",
        (event) => {
          el.dataset.trusted = String(event.isTrusted);
        },
        { once: true },
      );
    });
    const session = await page.context().newCDPSession(page);
    const point = (x) => ({
      x: Math.round(x),
      y: Math.round(y),
      id: 1,
      radiusX: 1,
      radiusY: 1,
      force: 1,
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(startX)],
    });
    for (let step = 1; step <= 6; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point(startX + ((endX - startX) * step) / 6)],
      });
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await session.detach();
  }
  await swipe("left");
  await page.waitForFunction(
    (src) => document.querySelector(".photo-stage > img")?.getAttribute("src") === src,
    savedOrder[1],
  );
  assert.equal(
    await page.locator(".photo-stage").getAttribute("data-trusted"),
    "true",
  );
  await page.getByText("第 2 張，共 5 張", { exact: true }).waitFor();
  await page.screenshot({ path: "artifacts/album-swipe-390.png" });
  await swipe("right");
  await page.waitForFunction(
    (src) => document.querySelector(".photo-stage > img")?.getAttribute("src") === src,
    savedOrder[0],
  );
  assert.equal(
    await page.locator(".photo-stage").getAttribute("data-trusted"),
    "true",
  );
  await page.getByRole("button", { name: "下一張照片", exact: true }).click();
  assert.equal(await stage.getAttribute("src"), savedOrder[1]);
  await page.getByRole("button", { name: "上一張照片", exact: true }).click();
  assert.equal(await stage.getAttribute("src"), savedOrder[0]);
  await page.getByRole("button", { name: "第 4 張縮圖", exact: true }).click();
  assert.equal(await stage.getAttribute("src"), savedOrder[3]);
  await page.locator(".photo-carousel").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await stage.getAttribute("src"), savedOrder[4]);
  await page.getByRole("alert").getByText("這張照片無法載入", { exact: true }).waitFor();
  await page.screenshot({ path: "artifacts/album-load-error-390.png" });
  await page.keyboard.press("ArrowLeft");
  assert.equal(await stage.getAttribute("src"), savedOrder[3]);
  await page.locator(".photo-stage > .view-photo").click();
  const viewer = page.getByRole("dialog");
  await viewer.waitFor();
  assert.equal(await viewer.locator("img").getAttribute("src"), savedOrder[3]);
  assert.ok((await viewer.boundingBox()).width <= 390);
  await page.getByRole("button", { name: "關閉照片 ✕" }).click();
  await viewer.waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  const ratio = await stage.evaluate((el) => el.clientWidth / el.clientHeight);
  assert.ok(Math.abs(ratio - 4 / 3) < 0.02, "Phone album frame stays 4:3");
  await page.screenshot({ path: "artifacts/album-public-390.png" });
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  await page.locator(".photo-carousel").focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(await stage.getAttribute("src"), savedOrder[2]);
  await page.screenshot({ path: "artifacts/album-public-1280.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/?tab=near&store=" + emptyStore.id);
  await page.getByRole("heading", { name: "照片待補測試門市（非營運資料）" }).waitFor();
  await page.getByText("門市照片待總部補充", { exact: true }).waitFor();
  assert.equal(await page.locator(".photo-stage").count(), 0);
  assert.equal(await page.locator(".photo-carousel img").count(), 0);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  await page.screenshot({ path: "artifacts/album-empty-390.png" });
  await page.getByRole("button", { name: "← 返回地圖" }).click();
  const card = page.locator(".store-card", { hasText: "相簿測試門市（非營運資料）" });
  assert.equal(await card.locator("img").first().getAttribute("src"), savedOrder[0]);
  const phonePhoto = await card.locator("img").evaluate((el) => ({
    width: el.clientWidth,
    height: el.clientHeight,
  }));
  assert.equal(phonePhoto.width, phonePhoto.height);
  assert.ok(phonePhoto.width >= 90, "Phone store main photo stays a large square");
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  const desktopPhoto = await card.locator("img").evaluate((el) => ({
    width: el.clientWidth,
    height: el.clientHeight,
  }));
  assert.equal(desktopPhoto.width, desktopPhoto.height);
  assert.ok(desktopPhoto.width >= 110, "Desktop store main photo stays a large square");
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const blankCard = page.locator(".store-card", {
    hasText: "照片待補測試門市（非營運資料）",
  });
  assert.equal(await blankCard.locator("img").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "Album URL links, reorder, five-link limit, trusted touch swipe both ways, keyboard, thumbs, load error, and empty state passed.",
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  rmSync(dir, { recursive: true, force: true });
  rmSync(persistDir, { recursive: true, force: true });
}
