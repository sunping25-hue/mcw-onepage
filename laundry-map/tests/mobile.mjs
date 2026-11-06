import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
const YOUTUBE_CHANNEL =
  "https://www.youtube.com/@%E9%AD%94%E5%BD%A9%E8%87%AA%E5%8A%A9%E6%B4%97%E8%A1%A3%E5%8A%A0%E7%9B%9F";
const MACHINE_URL = "https://liff.line.me/2008703133-cY6Q4zpY";
const REVIEW_URL = "https://maps.app.goo.gl/BUQj9nudUjPNoFSc7?g_st=ic";
const WUYING_ID = "mcw-kaohsiung-fengshan-wuying-228";
function previewWuying(dataDir) {
  const db = new DatabaseSync(join(dataDir, "mcw.sqlite"));
  const row = db.prepare("SELECT document FROM stores WHERE id=?").get(WUYING_ID);
  const document = JSON.parse(row.document);
  assert.equal(document.hours, "24小時");
  assert.equal(document.openingStatus, "open");
  assert.equal(document.reviewUrl, "");
  assert.equal(document.machineQueryUrl, "");
  assert.equal(document.equipment.length, 0);
  document.machineQueryMode = "button";
  document.machineQueryUrl = MACHINE_URL;
  document.reviewUrl = REVIEW_URL;
  document.equipment = [
    {
      id: "count:洗脫烘:16",
      type: "洗脫烘",
      capacity: "16KG",
      quantity: 5,
      model: "",
      price: "",
    },
    {
      id: "count:雙層烘:16",
      type: "雙層烘",
      capacity: "16KG",
      quantity: 2,
      model: "",
      price: "",
    },
  ];
  db.prepare("UPDATE stores SET document=? WHERE id=?").run(
    JSON.stringify(document),
    WUYING_ID,
  );
  db.close();
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
mkdirSync("artifacts", { recursive: true });
const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3100";
const catalog = JSON.parse(
  readFileSync(new URL("../config/initial-stores.json", import.meta.url), "utf8"),
);
const seeded = await (await fetch(baseUrl + "/api/stores")).json();
assert.equal(seeded.length, 15);
for (const entry of catalog) {
  const store = seeded.find((item) => item.id === entry.id);
  assert.ok(store, entry.id);
  assert.equal(store.name, entry.name);
  assert.equal(store.address, entry.address);
  assert.equal(store.city, entry.city);
  assert.equal(store.lat, entry.lat);
  assert.equal(store.lng, entry.lng);
  assert.equal(store.hours, "24小時");
  assert.equal(store.openingStatus, "open");
  assert.equal(store.reviewUrl, "");
  assert.equal(store.machineQueryUrl, "");
  assert.equal(store.equipment.length, 0);
  const serialized = JSON.stringify(store);
  assert.equal(serialized.includes(MACHINE_URL), false);
  assert.equal(serialized.includes("maps.app.goo.gl"), false);
}
previewWuying(process.env.DATA_DIR);
const previewStores = await (await fetch(baseUrl + "/api/stores")).json();
assert.equal(
  previewStores.filter((store) => store.machineQueryUrl === MACHINE_URL).map((store) => store.id).join(),
  WUYING_ID,
);
assert.equal(
  previewStores.filter((store) => store.reviewUrl === REVIEW_URL).map((store) => store.id).join(),
  WUYING_ID,
);
for (const store of previewStores) {
  assert.equal(store.hours, "24小時");
  assert.equal(store.openingStatus, "open");
  if (store.id !== WUYING_ID) {
    assert.equal(store.machineQueryUrl, "");
    assert.equal(store.reviewUrl, "");
    assert.equal(store.equipment.length, 0);
    assert.equal(store.name, catalog.find((entry) => entry.id === store.id).name);
    assert.equal(store.address, catalog.find((entry) => entry.id === store.id).address);
  }
}
for (const width of [375, 390, 1280]) {
  const context = await browser.newContext({
    viewport: { width, height: width === 375 ? 812 : 844 },
  });
  await context.grantPermissions([]);
  const page = await context.newPage();
  let errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Block external street tiles to verify the real bundled Taiwan geometry. App API is real.
  const tileReferrers = [];
  await page.route("https://*.tile.openstreetmap.org/**", (r) => {
    tileReferrers.push(r.request().headers()["referer"]);
    return r.abort();
  });
  await page.goto(process.env.TEST_BASE_URL || "http://127.0.0.1:3100");
  assert.equal(await page.title(), "MCW自助洗衣地圖");
  const official = page.getByRole("link", { name: "加入官方 LINE", exact: true });
  await official.waitFor();
  assert.equal(await official.getAttribute("href"), "https://lin.ee/s4v3cIG");
  assert.equal(await official.getAttribute("target"), "_blank");
  assert.equal(await page.locator("nav.fab, .f-tel").count(), 0);
  assert.equal(await page.locator(".franchise-fb").count(), 0);
  assert.equal(await page.locator('a[href^="tel:"]').count(), 0);

  await page
    .getByRole("button", { name: "魔彩自助洗衣・屏東新園店 →", exact: true })
    .waitFor();
  await page.getByText("屏東縣新園鄉仙吉路32號", { exact: true }).waitFor();
  await page.getByText("高雄市三民區大豐一路26號", { exact: true }).waitFor();
  await page.waitForTimeout(100);
  assert.ok(tileReferrers.length > 0, "Browser must request tiles");
  assert.ok(
    tileReferrers.every((value) => value === new URL(page.url()).origin + "/"),
    "Tile Referer must be the website origin only",
  );

  const markerLogos = page.locator(".leaflet-marker-icon img");
  await markerLogos.first().waitFor();
  const logoSrc = await markerLogos.evaluateAll((els) =>
    els.map((el) => el.getAttribute("src")),
  );
  assert.ok(logoSrc.length > 0, "Verified stores must show MCW logo markers");
  assert.ok(logoSrc.every((src) => src === "/brand/mcw-round-logo.png"));
  assert.equal(
    await markerLogos.first().evaluate((el) => getComputedStyle(el).objectFit),
    "contain",
  );
  assert.equal(await page.locator(".pin svg").count(), 0);
  assert.ok(
    (await page.locator(".leaflet-overlay-pane path").count()) > 0,
    "Bundled Taiwan coastline must render when street tiles fail",
  );
  await page.getByRole("combobox").selectOption("高雄市");
  assert.equal(
    await page
      .getByRole("button", { name: "魔彩自助洗衣・屏東新園店 →", exact: true })
      .count(),
    0,
  );
  await page
    .getByRole("button", { name: "魔彩自助洗衣・高雄大豐店 →", exact: true })
    .waitFor();
  await page.getByRole("combobox").selectOption("");

  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  if(width<=700){
    const map=await page.locator('.map-wrap').boundingBox();
    const list=await page.locator('.store-list').boundingBox();
    assert.ok(list.y>=map.y+map.height,'Phone store list must not cover the map');
    await page.getByRole('button',{name:'列表',exact:true}).click();
    assert.equal(await page.locator('.map-wrap').count(),0);
    await page.getByRole('button',{name:'魔彩自助洗衣・高雄大豐店 →',exact:true}).waitFor();
    await page.getByRole('button',{name:'地圖',exact:true}).click();
    await page.evaluate(()=>window.scrollTo(0,0));
  }
  await page.screenshot({
    path: `artifacts/nearby-${width}.png`,
    fullPage: false,
  });
  await page.getByRole("button", { name: /全台總覽$/ }).click();
  await page.screenshot({
    path: `artifacts/taiwan-${width}.png`,
    fullPage: false,
  });
  for (const [slug, name, address] of [
    ["xinyuan", "魔彩自助洗衣・屏東新園店", "屏東縣新園鄉仙吉路32號"],
    ["dafeng", "魔彩自助洗衣・高雄大豐店", "高雄市三民區大豐一路26號"],
  ]) {
    await page.getByRole("button", { name: name + " →", exact: true }).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    await page
      .getByRole("button", { name: "開始導航 ↗", exact: true })
      .click();
    const link = await page
      .getByRole("link", { name: "Google Maps 導航 ↗" })
      .getAttribute("href");
    assert.equal(new URL(link).searchParams.get("destination"), address);
    const apple = await page
      .getByRole("link", { name: "Apple 地圖導航 ↗" })
      .getAttribute("href");
    assert.equal(new URL(apple).searchParams.get("daddr"), address);
    await page.getByRole("button", { name: "取消導航", exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `artifacts/${slug}-${width}.png` });
    await page.goBack();
    await page
      .getByRole("button", { name: name + " →", exact: true })
      .waitFor();
  }
  await page.getByRole("button", { name: /操作教學$/ }).click();
  await page.getByRole("heading", { name: "認識你的洗衣好幫手", exact: true }).waitFor();
  await page.getByRole("heading", { name: "你的洗衣小幫手" }).waitFor();
  const featureImg = page.locator(".tutorial-feature > img");
  assert.equal(await featureImg.getAttribute("src"), "/brand/mcw-22kg-blue.webp");
  assert.equal(await featureImg.getAttribute("alt"), "MCW 22KG 洗脫烘一體機");
  const featureLayout = await page.evaluate(() => {
    const feature = document.querySelector(".tutorial-feature");
    const img = feature.querySelector(":scope > img");
    const title = [...feature.querySelectorAll("h2")].find(
      (node) => node.textContent === "認識你的洗衣好幫手",
    );
    const helper = [...document.querySelectorAll("h2")].find(
      (node) => node.textContent === "你的洗衣小幫手",
    );
    const image = img.getBoundingClientRect();
    const heading = title.getBoundingClientRect();
    const section = helper.getBoundingClientRect();
    const style = getComputedStyle(img);
    return {
      leftOfTitle: image.right <= heading.left + 1,
      aboveTutorials: image.bottom <= section.top + 1,
      objectFit: style.objectFit,
      ratio: image.width / image.height,
    };
  });
  assert.equal(featureLayout.leftOfTitle, true);
  assert.equal(featureLayout.aboveTutorials, true);
  assert.equal(featureLayout.objectFit, "contain");
  if (width <= 700) {
    assert.ok(
      Math.abs(featureLayout.ratio - 923 / 1704) < 0.04,
      "Phone feature photo should use the supplied 22KG frame",
    );
  } else {
    assert.ok(featureLayout.ratio < 0.8, "Desktop feature photo stays portrait on the left");
  }
  for (const name of ["洗脫烘操作教學", "雙層烘操作教學", "付款操作教學", "會員儲值點數操作教學"]) {
    await page.getByRole("heading", { name, exact: true }).waitFor();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `artifacts/tutorials-feature-${width}.png`,
    fullPage: false,
  });
  const stayed = page.url();
  await page.getByRole("heading", { name: "會員儲值點數操作教學", exact: true }).click();
  assert.equal(page.url(), stayed);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  await page.screenshot({
    path: `artifacts/tutorials-${width}.png`,
    fullPage: false,
  });
  await page.getByRole("button", { name: /加盟諮詢$/ }).click();
  await page.getByRole("heading", { name: /一間洗衣店/ }).waitFor();
  await page.getByText("加盟MCW就是你的最佳選擇!").waitFor();
  await page.getByText("成功打入美國市場", { exact: false }).waitFor();
  const ask = page.getByRole("link", { name: "詢問加盟 ↗", exact: true });
  assert.equal(await ask.getAttribute("href"), "https://lin.ee/s4v3cIG");
  assert.equal(await ask.getAttribute("target"), "_blank");
  assert.equal(
    await page.locator(".franchise-photo img").getAttribute("src"),
    "/brand/community-lineup.webp",
  );
  const guide = page.locator(".franchise-equipment img");
  assert.equal(await guide.getAttribute("src"), "/brand/mcw-machine-lineup-guide.webp");
  assert.equal(await guide.getAttribute("alt"), "MCW 洗脫烘一體機完整機型介紹");
  assert.equal(await guide.getAttribute("width"), "1104");
  assert.equal(await guide.getAttribute("height"), "1560");
  await guide.evaluate((img) => img.complete && img.naturalWidth > 0 ? img : new Promise((resolve, reject) => {
    img.addEventListener("load", () => resolve(img), { once: true });
    img.addEventListener("error", () => reject(Error("machine guide failed to load")), { once: true });
  }));
  const guideBox = await guide.evaluate((img) => {
    const box = img.getBoundingClientRect();
    const contacts = document.querySelector(".franchise-contacts").getBoundingClientRect();
    return {
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      objectFit: getComputedStyle(img).objectFit,
      ratio: box.width / box.height,
      belowContacts: box.top >= contacts.bottom - 1,
      inside: box.right <= document.documentElement.clientWidth + 1,
    };
  });
  assert.equal(guideBox.naturalWidth, 1104);
  assert.equal(guideBox.naturalHeight, 1560);
  assert.equal(guideBox.objectFit, "contain");
  assert.equal(guideBox.belowContacts, true);
  assert.equal(guideBox.inside, true);
  assert.ok(
    Math.abs(guideBox.ratio - 1104 / 1560) < 0.03,
    "Machine guide must show the full 1104×1560 poster",
  );
  const linkLayout = await page.evaluate(() => {
    const ask = [...document.querySelectorAll("a")].find(
      (node) => node.textContent.trim() === "詢問加盟 ↗",
    );
    const more = document.querySelector(".franchise-more");
    const fb = document.querySelector(".franchise-fb");
    const heroTitle = [...document.querySelectorAll("h1")].find((node) =>
      node.textContent.includes("把好生活"),
    );
    const askBox = ask.getBoundingClientRect();
    const moreBox = more.getBoundingClientRect();
    const fbBox = fb.getBoundingClientRect();
    const titleBox = heroTitle.getBoundingClientRect();
    return {
      moreBelowAsk: moreBox.top >= askBox.bottom - 1,
      fbAboveTitle: fbBox.bottom <= titleBox.top + 1,
      moreInside: moreBox.right <= document.documentElement.clientWidth + 1,
    };
  });
  assert.equal(linkLayout.moreBelowAsk, true);
  assert.equal(linkLayout.fbAboveTitle, true);
  assert.equal(linkLayout.moreInside, true);
  const fb = page.getByRole("link", { name: "FB粉專", exact: true });
  assert.equal(
    await fb.getAttribute("href"),
    "https://www.facebook.com/share/1JCJbVjMGW/?mibextid=wwXIfr",
  );
  assert.equal(await fb.getAttribute("target"), "_blank");
  assert.equal(await page.getByText("連結整理中").count(), 0);
  const moreInfo = page.getByRole("link", { name: "了解更多訊息", exact: true });
  const site = page.getByRole("link", { name: "MCW官網", exact: true });
  assert.equal(
    await moreInfo.getAttribute("href"),
    "https://sunping25-hue.github.io/mcw-onepage/",
  );
  assert.equal(await moreInfo.getAttribute("target"), "_blank");
  assert.equal(
    await site.getAttribute("href"),
    "https://www.magicbubble-laundry.com/",
  );
  assert.equal(await site.getAttribute("target"), "_blank");
  const franchiseUrl = page.url();
  await ask.evaluate((el) =>
    el.addEventListener("click", (event) => event.preventDefault(), { capture: true }),
  );
  await ask.click();
  assert.equal(page.url(), franchiseUrl);
  await moreInfo.evaluate((el) =>
    el.addEventListener("click", (event) => event.preventDefault(), { capture: true }),
  );
  await moreInfo.click();
  await site.evaluate((el) =>
    el.addEventListener("click", (event) => event.preventDefault(), { capture: true }),
  );
  await site.click();
  await fb.evaluate((el) =>
    el.addEventListener("click", (event) => event.preventDefault(), { capture: true }),
  );
  await fb.click();
  assert.equal(page.url(), franchiseUrl);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  await page.screenshot({
    path: `artifacts/franchise-${width}.png`,
    fullPage: true,
  });
  await page.goto(baseUrl + "/");
  await page.locator(".opening-badge").first().waitFor();
  assert.equal(await page.locator(".opening-badge").count(), 15);
  assert.equal(await page.getByText("營業狀態待確認").count(), 0);
  const badgePaint = await page.locator(".opening-badge").first().evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      text: el.textContent,
      color: style.color,
      background: style.backgroundColor,
    };
  });
  assert.equal(badgePaint.text, "營業中");
  assert.equal(badgePaint.color, "rgb(255, 255, 255)");
  assert.equal(badgePaint.background, "rgb(11, 106, 48)");
  await page.locator(".store-list").screenshot({
    path: `artifacts/open-badges-${width}.png`,
  });
  for (const entry of catalog) {
    await page.goto(baseUrl + "/?store=" + entry.id);
    await page.getByRole("heading", { name: entry.name, exact: true }).waitFor();
    await page.locator(".detail > p").getByText(entry.address, { exact: true }).waitFor();
    await page.getByText("營業時間：24小時", { exact: true }).waitFor();
    await page.getByText("尚未串接設備，即時狀態暫不可用 · 不提供空機數或倒數預估").waitFor();
    assert.equal(await page.getByText("本店尚未配置操作教學影片。").count(), 0);
    assert.equal(await page.getByText("營業狀態待確認").count(), 0);
    const detailBadge = page.locator(".detail .opening-badge");
    assert.equal(await detailBadge.innerText(), "營業中");
    const detailPaint = await detailBadge.evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.color, background: style.backgroundColor };
    });
    assert.equal(detailPaint.color, "rgb(255, 255, 255)");
    assert.equal(detailPaint.background, "rgb(11, 106, 48)");
    const channel = page.getByRole("link", { name: "YouTube 操作教學", exact: true });
    assert.equal(await channel.getAttribute("href"), YOUTUBE_CHANNEL);
    assert.equal(await channel.getAttribute("target"), "_blank");
    assert.equal(await channel.getAttribute("rel"), "noopener noreferrer");
    assert.equal(await channel.locator("svg").count(), 1);
    if (entry.id === WUYING_ID) {
      await page.getByText("洗脫烘 16KG｜5台", { exact: true }).waitFor();
      await page.getByText("雙層烘 16KG｜2台", { exact: true }).waitFor();
      assert.equal(await page.getByText("設備資料待總部補充。").count(), 0);
      const review = page.getByRole("link", { name: "Google 評價 ↗", exact: true });
      const machines = page.getByRole("link", { name: "空機查詢 ↗", exact: true });
      assert.equal(await review.getAttribute("href"), REVIEW_URL);
      assert.equal(await review.getAttribute("target"), "_blank");
      assert.equal(await review.getAttribute("rel"), "noopener noreferrer");
      assert.equal(await machines.getAttribute("href"), MACHINE_URL);
      assert.equal(await machines.getAttribute("target"), "_blank");
      assert.equal(await machines.getAttribute("rel"), "noopener noreferrer");
      if (width === 1280) {
        const detailUrl = page.url();
        const machinePopupPromise = page.waitForEvent("popup");
        await machines.click();
        const machinePopup = await machinePopupPromise;
        await machinePopup.waitForLoadState("domcontentloaded");
        assert.equal(page.url(), detailUrl);
        const landed = machinePopup.url();
        assert.ok(
          landed.startsWith(MACHINE_URL) || landed.includes("waitershop.betcoin.tw/Home/Index"),
          landed,
        );
        if (landed.includes("waitershop.betcoin.tw")) {
          assert.equal(new URL(landed).searchParams.get("StoreID"), "G7HO28GT3MIS");
        }
        await machinePopup.close();
        const channelPopupPromise = page.waitForEvent("popup");
        await channel.click();
        const channelPopup = await channelPopupPromise;
        await channelPopup.waitForLoadState("domcontentloaded");
        assert.equal(page.url(), detailUrl);
        assert.ok(channelPopup.url().includes("youtube.com"), channelPopup.url());
        await channelPopup.close();
      }
      await page.screenshot({ path: `artifacts/wuying-${width}.png`, fullPage: true });
    } else {
      assert.equal(await page.getByRole("link", { name: "空機查詢 ↗" }).count(), 0);
      assert.equal(await page.getByText("設備資料待總部補充。", { exact: true }).count(), 1);
      assert.equal(await page.getByText("Google 評價・尚未設定", { exact: true }).count(), 1);
      assert.equal(await page.locator(`a[href="${MACHINE_URL}"]`).count(), 0);
      assert.equal(await page.locator('a[href*="maps.app.goo.gl"]').count(), 0);
      if (entry.id === "mcw-kaohsiung-sanmin-dafeng-26" && width === 390) {
        await page.screenshot({ path: "artifacts/dafeng-plain-390.png", fullPage: true });
      }
    }
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
  }
  await page.goto(baseUrl + "/admin");
  await page.getByRole("heading", { name: "總部管理登入" }).waitFor();
  await page.screenshot({
    path: `artifacts/admin-${width}.png`,
    fullPage: false,
  });
  assert.deepEqual(errors, []);
  await context.close();
}
await browser.close();
console.log(
  "375px / 390px mobile and 1280px desktop navigation, real owner-provided addresses and offline outline, login and overflow checks passed. Street tiles blocked to verify the bundled geographic fallback.",
);
