import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import sharp from "sharp";
import {
  randomBytes,
  randomUUID,
  createHash,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  storeSchema,
  settingsSchema,
  publicStore,
  MachineStatusProvider,
  StubMachineStatusProvider,
  normalizeStatus,
} from "./model.js";
const hash = (v) => createHash("sha256").update(v).digest("hex");
export function createApp({
  db,
  dataDir,
  adminUser,
  adminPassword,
  production = false,
}) {
  const app = express();
  const uploadDir = resolve(dataDir, "uploads");
  mkdirSync(uploadDir, { recursive: true });
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: production
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org"],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              upgradeInsecureRequests: [],
            },
          }
        : false,
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "256kb" }));
  app.use(
    "/uploads",
    express.static(uploadDir, { dotfiles: "deny", maxAge: "1d" }),
  );
  const salt = randomBytes(16);
  const passwordHash =
    adminPassword?.length >= 16 ? scryptSync(adminPassword, salt, 64) : null;
  const cookieName = production ? "__Host-mcw_session" : "mcw_session";
  function auth(req, res, next) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    const row =
      token &&
      db
        .prepare("SELECT expires_at FROM sessions WHERE token_hash=?")
        .get(hash(token));
    if (!row || row.expires_at <= Date.now())
      return res.status(401).json({ error: "請先登入總部帳號" });
    req.sessionHash = hash(token);
    next();
  }
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      const expected = `${production ? "https" : "http"}://${req.get("host")}`;
      if (!origin || origin !== expected)
        return res.status(403).json({ error: "來源驗證失敗" });
    }
    next();
  });
  const stores = () =>
    db
      .prepare("SELECT id,document FROM stores ORDER BY updated_at DESC")
      .all()
      .map((r) => ({ id: r.id, ...JSON.parse(r.document) }));
  app.get("/api/stores", (req, res) =>
    res.json(
      stores()
        .filter((s) => s.published && s.confirmed)
        .map(publicStore),
    ),
  );
  app.get("/api/settings", (req, res) =>
    res.json(
      JSON.parse(
        db.prepare("SELECT document FROM settings WHERE id=1").get().document,
      ),
    ),
  );
  app.get("/api/stores/:id/status", async (req, res, next) => {
    try {
      const s = stores().find(
        (s) => s.id === req.params.id && s.published && s.confirmed,
      );
      if (!s) return res.sendStatus(404);
      res.json(
        (await new MachineStatusProvider().getStatuses(s.equipment)).map((x) =>
          normalizeStatus(x),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.post(
    "/api/login",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
    }),
    (req, res) => {
      if (!passwordHash)
        return res
          .status(503)
          .json({
            error: "總部登入尚未設定，請設定 ADMIN_PASSWORD（至少 16 字元）",
          });
      const p = typeof req.body?.password === "string" ? req.body.password : "";
      if (p.length > 1024) return res.sendStatus(401);
      const valid = timingSafeEqual(scryptSync(p, salt, 64), passwordHash);
      if (!valid || req.body?.username !== adminUser)
        return res.status(401).json({ error: "帳號或密碼不正確" });
      db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
      const token = randomBytes(32).toString("hex");
      db.prepare("INSERT INTO sessions VALUES(?,?)").run(
        hash(token),
        Date.now() + 8 * 3600 * 1000,
      );
      res.cookie(cookieName, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: production,
        maxAge: 8 * 3600 * 1000,
        path: "/",
      });
      res.json({ ok: true });
    },
  );
  app.use("/api/admin", auth);
  app.get("/api/admin/session", (req, res) => res.json({ ok: true }));
  app.post("/api/admin/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(req.sessionHash);
    res.clearCookie(cookieName, {
      path: "/",
      secure: production,
      httpOnly: true,
      sameSite: "strict",
    });
    res.json({ ok: true });
  });
  app.get("/api/admin/stores", (req, res) => res.json(stores()));
  const save = (req, res) => {
    const parsed = storeSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: parsed.error.issues.map((x) => x.message).join("；") });
    const id = req.params.id || randomUUID();
    if (
      req.params.id &&
      !db.prepare("SELECT id FROM stores WHERE id=?").get(id)
    )
      return res.sendStatus(404);
    db.prepare(
      "INSERT INTO stores VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,updated_at=excluded.updated_at",
    ).run(id, JSON.stringify(parsed.data), new Date().toISOString());
    res.json({ id, ...parsed.data });
  };
  app.post("/api/admin/stores", save);
  app.put("/api/admin/stores/:id", save);
  app.delete("/api/admin/stores/:id", (req, res) => {
    const r = db.prepare("DELETE FROM stores WHERE id=?").run(req.params.id);
    res.status(r.changes ? 200 : 404).json({ ok: !!r.changes });
  });
  app.put("/api/admin/settings", (req, res) => {
    const p = settingsSchema.safeParse(req.body);
    if (!p.success)
      return res.status(400).json({ error: "請使用有效的 HTTPS 網址" });
    db.prepare("UPDATE settings SET document=? WHERE id=1").run(
      JSON.stringify(p.data),
    );
    res.json(p.data);
  });
  app.get("/api/admin/stores/:id/demo-status", async (req, res) => {
    const s = stores().find((s) => s.id === req.params.id);
    if (!s) return res.sendStatus(404);
    res.json({
      label: "DEMO 模擬資料，非即時狀態",
      statuses: await new StubMachineStatusProvider().getStatuses(s.equipment),
    });
  });
  app.post(
    "/api/admin/photos",
    multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    }).single("photo"),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "請選擇圖片" });
        const name = randomUUID() + ".webp";
        await sharp(req.file.buffer, {
          limitInputPixels: 24_000_000,
          animated: false,
        })
          .rotate()
          .resize({
            width: 1800,
            height: 1800,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 85 })
          .toFile(resolve(uploadDir, name));
        res.json({ url: "/uploads/" + name });
      } catch {
        return res
          .status(400)
          .json({ error: "不支援或損壞的圖片（上限 8MB / 2400 萬像素）" });
      }
    },
  );
  app.use((e, req, res, next) =>
    res
      .status(e.status || 400)
      .json({
        error:
          e.code === "LIMIT_FILE_SIZE" ? "圖片不得超過 8MB" : "請求處理失敗",
      }),
  );
  return app;
}
