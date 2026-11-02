import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { seedKnownStores } from "./seed.js";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const dataDir = resolve(process.env.DATA_DIR || "data");
const production = process.env.NODE_ENV === "production";
const db = openDb(dataDir);
seedKnownStores(db);
const app = createApp({
  db,
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
