import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3100";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
mkdirSync("artifacts", { recursive: true });

const listed = await (await fetch(base + "/api/stores")).json();
assert.equal(listed.length, 15, "published map should list the 15 current stores");
assert.ok(
  listed.every((s) => typeof s.lat === "number" && typeof s.lng === "number"),
);
const stores = listed.map((s) => ({
  name: s.name,
  lat: s.lat,
  lng: s.lng,
  address: s.address,
}));

function coversTaiwan(view, rows) {
  if (!view || view.zoom > 8 || view.zoom < 5) return false;
  if (view.south > 21.95 || view.north < 25.25) return false;
  if (view.west > 120.05 || view.east < 121.95) return false;
  if (view.east - view.west > 20) return false;
  if (view.north - view.south > 10) return false;
  return rows.every(
    (s) =>
      s.lat > view.south &&
      s.lat < view.north &&
      s.lng > view.west &&
      s.lng < view.east,
  );
}

async function readView(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".leaflet-container");
    const map = el?._mcwMap;
    if (!map) return null;
    const bounds = map.getBounds();
    const size = map.getSize();
    return {
      zoom: map.getZoom(),
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast(),
      width: size.x,
      height: size.y,
    };
  });
}

async function expectOverview(page, rows) {
  let last = null;
  for (let i = 0; i < 30; i++) {
    last = await readView(page);
    if (coversTaiwan(last, rows)) return last;
    await page.waitForTimeout(100);
  }
  assert.fail("台灣全圖 did not fit Taiwan and every store: " + JSON.stringify(last));
}

async function assertIconsInside(page) {
  const boxes = await page.evaluate(() => {
    const map = document.querySelector(".leaflet-container");
    const mapBox = map.getBoundingClientRect();
    return [...map.querySelectorAll(".leaflet-marker-icon")].map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left - mapBox.left,
        top: rect.top - mapBox.top,
        right: rect.right - mapBox.left,
        bottom: rect.bottom - mapBox.top,
        width: mapBox.width,
        height: mapBox.height,
        src: el.querySelector("img")?.getAttribute("src") || "",
        viewportTop: rect.top,
        viewportBottom: rect.bottom,
        viewportLeft: rect.left,
        viewportRight: rect.right,
        viewWidth: window.innerWidth,
        viewHeight: window.innerHeight,
      };
    });
  });
  assert.ok(boxes.length > 0, "full Taiwan view must draw store markers");
  for (const box of boxes) {
    assert.equal(box.src, "/brand/mcw-round-logo.png");
    assert.ok(box.left >= -1, `marker clipped on the left (${box.left})`);
    assert.ok(box.top >= -1, `marker clipped on the top (${box.top})`);
    assert.ok(
      box.right <= box.width + 1,
      `marker clipped on the right (${box.right} > ${box.width})`,
    );
    assert.ok(
      box.bottom <= box.height + 1,
      `marker clipped on the bottom (${box.bottom} > ${box.height})`,
    );
    assert.ok(
      box.viewportTop >= -1 &&
        box.viewportLeft >= -1 &&
        box.viewportRight <= box.viewWidth + 1 &&
        box.viewportBottom <= box.viewHeight + 1,
      `marker outside the screen (${box.viewportLeft},${box.viewportTop})`,
    );
  }
}

async function zoomIn(page, times) {
  const before = (await readView(page)).zoom;
  for (let i = 0; i < times; i++) {
    await page.locator(".leaflet-control-zoom-in").click();
  }
  const target = before + times;
  await page.waitForFunction(
    (zoom) => document.querySelector(".leaflet-container")._mcwMap.getZoom() >= zoom,
    target,
  );
  return target;
}

const viewports = [
  { width: 375, height: 812, label: "mobile" },
  { width: 375, height: 640, label: "short-mobile" },
  { width: 1280, height: 900, label: "desktop" },
];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      geolocation: { latitude: 25.04, longitude: 121.55 },
      permissions: ["geolocation"],
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://*.tile.openstreetmap.org/**", (route) => route.abort());
    await page.goto(base);
    await page
      .getByRole("button", { name: "魔彩自助洗衣・屏東新園店 →", exact: true })
      .waitFor();
    await page.locator(".leaflet-marker-icon").first().waitFor();
    await page.getByRole("button", { name: "台灣全圖", exact: true }).waitFor();

    const tightened = await zoomIn(page, 4);
    await page.getByRole("button", { name: "台灣全圖", exact: true }).click();
    const first = await expectOverview(page, stores);
    assert.ok(
      first.zoom < tightened,
      `button left the map zoomed in at ${first.zoom}`,
    );
    await assertIconsInside(page);
    assert.equal(await page.getByRole("combobox").inputValue(), "");
    assert.equal(
      await page.getByRole("textbox", { name: "搜尋門市" }).inputValue(),
      "",
    );
    await page.getByText("15 間已確認門市").waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    if (viewport.width <= 700) {
      const map = await page.locator(".map-wrap").boundingBox();
      const list = await page.locator(".store-list").boundingBox();
      assert.ok(map && list, "mobile map and store list should both be visible");
      assert.ok(list.y >= map.y + map.height - 1, "store list must not cover the map");
      assert.ok(first.height >= 260 && first.height <= 450, `phone map height ${first.height}`);
    } else {
      const map = await page.locator(".map-wrap").boundingBox();
      const list = await page.locator(".store-list").boundingBox();
      assert.ok(map && list);
      assert.ok(
        list.x >= map.x + map.width - 2,
        "desktop store list should sit beside the map",
      );
      assert.ok(first.width >= 400, `desktop map width ${first.width}`);
      assert.ok(
        first.height >= 450 && first.height <= 520,
        `desktop map should stay a visible panel, not stretch with the list (${first.height})`,
      );
    }

    const zoomedAgain = await zoomIn(page, 4);
    assert.ok(zoomedAgain >= first.zoom + 4);
    await page.getByRole("button", { name: "台灣全圖", exact: true }).click();
    const second = await expectOverview(page, stores);
    assert.ok(
      second.zoom < zoomedAgain,
      "second press was a no-op and left the zoomed map in place",
    );

    await page.getByRole("combobox").selectOption("桃園市");
    await page.waitForFunction(() => {
      const map = document.querySelector(".leaflet-container")._mcwMap;
      return map && map.getZoom() >= 12 && map.getBounds().getSouth() > 23;
    });
    assert.equal(
      await page
        .getByRole("button", { name: "魔彩自助洗衣・屏東新園店 →", exact: true })
        .count(),
      0,
    );
    await page.getByRole("button", { name: "台灣全圖", exact: true }).click();
    await expectOverview(page, stores);
    assert.equal(await page.getByRole("combobox").inputValue(), "");
    await page.getByText("15 間已確認門市").waitFor();

    await page.getByRole("textbox", { name: "搜尋門市" }).fill("新園");
    await page.getByText("1 間已確認門市").waitFor();
    await page.waitForFunction(() => {
      const map = document.querySelector(".leaflet-container")._mcwMap;
      return map && map.getZoom() >= 12;
    });
    await page.getByRole("button", { name: "台灣全圖", exact: true }).click();
    await expectOverview(page, stores);
    assert.equal(
      await page.getByRole("textbox", { name: "搜尋門市" }).inputValue(),
      "",
    );

    await page.getByRole("button", { name: "列表", exact: true }).click();
    assert.equal(await page.locator(".leaflet-container").count(), 0);
    await page.getByRole("button", { name: "台灣全圖", exact: true }).click();
    await page.locator(".leaflet-container").waitFor();
    await expectOverview(page, stores);
    await assertIconsInside(page);

    await page.getByRole("button", { name: "◎ 找離我最近" }).click();
    await page.getByText("已依距離排序門市").waitFor();
    await page.waitForFunction(
      () => document.querySelector(".leaflet-container")._mcwMap.getZoom() >= 13,
    );
    await page.getByRole("button", { name: "台灣全圖", exact: true }).click();
    await expectOverview(page, stores);
    assert.equal(await page.getByText("已依距離排序門市").count(), 0);

    await page
      .getByRole("button", { name: "魔彩自助洗衣・屏東新園店 →", exact: true })
      .click();
    await page.getByRole("button", { name: "開始導航 ↗", exact: true }).click();
    const google = await page
      .getByRole("link", { name: "Google Maps 導航 ↗" })
      .getAttribute("href");
    const apple = await page
      .getByRole("link", { name: "Apple 地圖導航 ↗" })
      .getAttribute("href");
    assert.equal(
      new URL(google).searchParams.get("destination"),
      "屏東縣新園鄉仙吉路32號",
    );
    assert.equal(
      new URL(apple).searchParams.get("daddr"),
      "屏東縣新園鄉仙吉路32號",
    );
    await page.getByRole("button", { name: "取消導航", exact: true }).click();
    await page.goBack();
    await page
      .getByRole("button", { name: "魔彩自助洗衣・屏東新園店 →", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "台灣全圖", exact: true }).click();
    const restored = await expectOverview(page, stores);
    await assertIconsInside(page);
    await page.screenshot({
      path: `artifacts/taiwan-overview-${viewport.label}.png`,
      fullPage: false,
    });
    assert.deepEqual(errors, []);
    assert.ok(restored.zoom <= 8);
    await context.close();
  }
} finally {
  await browser.close();
}

const after = await (await fetch(base + "/api/stores")).json();
const fingerprint = (rows) =>
  rows
    .map((s) => [s.id, s.lat, s.lng, s.address])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
assert.deepEqual(fingerprint(after), fingerprint(listed));
console.log(
  "台灣全圖 fits all 15 stores on mobile, short mobile, and desktop, including a second press after zooming, and address navigation still works.",
);
