import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import {
  applyStoreOperatingDefaults,
  applyVerifiedCoordinates,
  seedKnownStores,
} from "./seed.js";
import { locateKnownStores } from "./geocode.js";
import { persistenceFromEnv } from "./persist.js";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const dataDir = resolve(process.env.DATA_DIR || "data");
const production = process.env.NODE_ENV === "production";
const persist = persistenceFromEnv();
if (persist.configured && !existsSync(join(dataDir, "mcw.sqlite"))) {
  try {
    const restored = await persist.restoreInto(dataDir);
    if (restored.restored) console.log("已從雲端還原門市資料：" + restored.snapshotId);
    else console.log("雲端保存已設定，目前沒有可還原的備份（" + restored.reason + "）");
  } catch (error) {
    persist.holdBackups?.();
    console.error("雲端還原失敗，已停止自動覆蓋雲端備份：" + error.message);
  }
} else if (!persist.configured && persist.driver !== "none") {
  console.error(
    "雲端保存未完成設定，缺少：" + (persist.missing || []).join("、"),
  );
}
const db = openDb(dataDir);
seedKnownStores(db);
const filledCoordinates = applyVerifiedCoordinates(db);
const operatingDefaults = applyStoreOperatingDefaults(db);
const filledOperating = operatingDefaults.hours + operatingDefaults.opening;
if (
  (filledCoordinates || filledOperating) &&
  persist?.configured &&
  !persist.backupBlocked?.()
) {
  persist
    .backupFrom(dataDir, db)
    .then((result) =>
      console.log("已把補上的門市資料備份到雲端：" + result.snapshotId),
    )
    .catch((error) =>
      console.error("門市資料已保留在本機，雲端備份未完成：" + error.message),
    );
} else if (filledCoordinates || filledOperating) {
  console.log(
    "已補上空白門市座標 " +
      filledCoordinates +
      " 家，空白營業資料 " +
      filledOperating +
      " 筆",
  );
}
const app = createApp({
  db,
  dataDir,
  adminUser: process.env.ADMIN_USER || "hq",
  adminPassword: process.env.ADMIN_PASSWORD,
  production,
  persist,
});
if (production) {
  app.use(express.static("dist"));
  app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: {
      middlewareMode: true,
      hmr: { port: Number(process.env.PORT || 3000) + 1 },
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log(
    "MCW laundry map listening on port " + (process.env.PORT || 3000),
  ),
);

if (production && process.env.GEOCODE_ON_START === "true") {
  locateKnownStores(db).catch((error) =>
    console.error("地址定位服務：" + error.message),
  );
}
