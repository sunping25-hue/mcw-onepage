import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const dataDir = resolve(process.env.DATA_DIR || "data");
const production = process.env.NODE_ENV === "production";
const app = createApp({
  db: openDb(dataDir),
  dataDir,
  adminUser: process.env.ADMIN_USER || "hq",
  adminPassword: process.env.ADMIN_PASSWORD,
  production,
});
if (production) {
  app.use(express.static("dist"));
  app.get("/{*path}", (req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log(
    "MCW laundry map listening on port " + (process.env.PORT || 3000),
  ),
);
