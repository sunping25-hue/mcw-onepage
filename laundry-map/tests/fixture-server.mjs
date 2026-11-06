// Test-only server: built frontend, real backend, localhost HTTP cookies.
import express from "express";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createApp } from "../server/app.js";
import { openDb } from "../server/db.js";
import { persistenceFromEnv } from "../server/persist.js";
const dataDir = process.env.DATA_DIR;
if (!dataDir?.startsWith("/tmp/mcw-browser-"))
  throw Error("Test requires isolated /tmp data directory");
const persist = persistenceFromEnv();
if (persist.configured && !existsSync(join(dataDir, "mcw.sqlite"))) {
  await persist.restoreInto(dataDir);
}
const app = createApp({
  db: openDb(dataDir),
  dataDir,
  adminUser: process.env.ADMIN_USER,
  adminPassword: process.env.ADMIN_PASSWORD,
  persist,
});
app.use(express.static("dist"));
app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
app.listen(Number(process.env.PORT), "127.0.0.1");
