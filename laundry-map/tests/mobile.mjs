import { chromium } from "playwright";
import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdirSync } from "node:fs";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
mkdirSync("artifacts", { recursive: true });
const tile = await sharp({
  create: { width: 256, height: 256, channels: 3, background: "#c4d8e7" },
})
  .png()
  .toBuffer();
for (const width of [375, 390, 1280]) {
  const context = await browser.newContext({
    viewport: { width, height: width === 375 ? 812 : 844 },
  });
  await context.grantPermissions([]);
  const page = await context.newPage();
  let errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Only tile imagery is replaced for deterministic/offline browser checks. App API is real.
  await page.route("https://*.tile.openstreetmap.org/**", (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: tile }),
  );
  await page.goto("http://127.0.0.1:3100");
  await page.getByText("門市資料確認中").waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: `artifacts/nearby-${width}.png`,
    fullPage: false,
  });
  await page.getByRole("button", { name: /全台總覽$/ }).click();
  await page.screenshot({
    path: `artifacts/taiwan-${width}.png`,
    fullPage: false,
  });
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
  await page.goto("http://127.0.0.1:3100/admin");
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
  "375px / 390px mobile and 1280px desktop navigation, real API empty states, login and overflow checks passed. Tiles mocked only.",
);
