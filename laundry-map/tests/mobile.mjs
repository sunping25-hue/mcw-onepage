import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
mkdirSync("artifacts", { recursive: true });
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

  assert.equal(
    await page.locator(".pin").count(),
    0,
    "Unverified coordinates must not create map markers",
  );
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
  await page.getByRole("heading", { name: "你的洗衣小幫手" }).waitFor();
  await page.screenshot({
    path: `artifacts/tutorials-${width}.png`,
    fullPage: false,
  });
  await page.getByRole("button", { name: /加盟諮詢$/ }).click();
  await page.getByRole("heading", { name: /一間洗衣店/ }).waitFor();
  await page.screenshot({
    path: `artifacts/franchise-${width}.png`,
    fullPage: false,
  });
  await page.goto(
    (process.env.TEST_BASE_URL || "http://127.0.0.1:3100") + "/admin",
  );
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
