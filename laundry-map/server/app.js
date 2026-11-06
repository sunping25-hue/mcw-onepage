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
import { locateKnownStores } from "./geocode.js";
const hash = (v) => createHash("sha256").update(v).digest("hex");
export function createApp({
  db,
  dataDir,
  adminUser,
  adminPassword,
  production = false,
  persist = null,
  geocode = locateKnownStores,
}) {
  const app = express();
  const uploadDir = resolve(dataDir, "uploads");
  mkdirSync(uploadDir, { recursive: true });
  app.disable("x-powered-by");
  app.use(
    helmet({
      // OSM public tiles require a valid website Referer. Send only our origin cross-site.
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
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
  async function persistNow() {
    if (!persist?.configured || !persist.backupFrom) {
      return {
        configured: Boolean(persist?.configured),
        persisted: false,
        missing: persist?.missing || [],
      };
    }
    try {
      return { configured: true, ...(await persist.backupFrom(dataDir, db)) };
    } catch (error) {
      console.error("雲端備份失敗：" + error.message);
      return { configured: true, persisted: false, error: error.message };
    }
  }
  function persistenceView(remote = {}) {
    const last = db
      .prepare(
        "SELECT action,outcome,attempted_at,detail FROM persist_events ORDER BY id DESC LIMIT 1",
      )
      .get();
    return {
      configured: Boolean(persist?.configured),
      driver: persist?.driver || "none",
      missing: persist?.missing || [],
      last: last
        ? {
            action: last.action,
            outcome: last.outcome,
            attemptedAt: last.attempted_at,
            detail: last.detail,
          }
        : null,
      remoteSnapshot: remote.remoteSnapshot || null,
      remoteError: remote.remoteError || "",
      backupBlocked: Boolean(persist?.backupBlocked?.()),
    };
  }
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
        return res.status(503).json({
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
    persistNow().then((persistence) =>
      res.json({ id, ...parsed.data, persistence }),
    );
  };
  app.post("/api/admin/stores", save);
  app.put("/api/admin/stores/:id", save);
  app.delete("/api/admin/stores/:id", (req, res) => {
    const r = db.prepare("DELETE FROM stores WHERE id=?").run(req.params.id);
    if (!r.changes) return res.status(404).json({ ok: false });
    persistNow().then((persistence) => res.json({ ok: true, persistence }));
  });
  app.put("/api/admin/settings", (req, res) => {
    const p = settingsSchema.safeParse(req.body);
    if (!p.success)
      return res.status(400).json({ error: "請使用有效的 HTTPS 網址" });
    db.prepare("UPDATE settings SET document=? WHERE id=1").run(
      JSON.stringify(p.data),
    );
    persistNow().then((persistence) => res.json({ ...p.data, persistence }));
  });
  app.get("/api/admin/persistence", async (req, res) => {
    const remote = persist?.describe ? await persist.describe() : {};
    res.json(persistenceView(remote));
  });
  app.post("/api/admin/persistence/backup", async (req, res) => {
    if (!persist?.configured) {
      return res.status(409).json({
        error: "尚未設定雲端保存。請在環境變數設定 PERSIST_DRIVER，不要把金鑰寫進程式。",
        ...persistenceView(),
      });
    }
    if (persist.backupBlocked?.() && req.body?.confirm !== "OVERWRITE") {
      return res.status(409).json({
        error: "雲端還原未成功，自動備份已暫停。確認覆寫雲端備份時才繼續。",
        ...persistenceView(),
      });
    }
    try {
      const result = await persist.backupFrom(dataDir, db, { explicit: true });
      res.json({ ...result, ...persistenceView(await persist.describe()) });
    } catch (error) {
      res.status(502).json({ error: "雲端備份失敗：" + error.message });
    }
  });
  app.post("/api/admin/persistence/restore", async (req, res) => {
    if (req.body?.confirm !== "RESTORE") {
      return res.status(400).json({ error: "還原前請送出確認" });
    }
    if (!persist?.configured || !persist.restoreIntoLive) {
      return res.status(409).json({ error: "尚未設定雲端保存，沒有可還原的雲端資料" });
    }
    try {
      const result = await persist.restoreIntoLive(dataDir, db);
      res.json({ ...result, ...persistenceView(await persist.describe()) });
    } catch (error) {
      res.status(502).json({ error: "雲端還原失敗：" + error.message });
    }
  });
  app.get("/api/admin/stores/:id/geocode-attempts", (req, res) => {
    if (!db.prepare("SELECT id FROM stores WHERE id=?").get(req.params.id)) {
      return res.sendStatus(404);
    }
    res.json(
      db
        .prepare(
          `SELECT attempted_at,outcome,http_status,detail,lat,lng FROM geocode_attempts
           WHERE store_id=? ORDER BY id DESC LIMIT 10`,
        )
        .all(req.params.id),
    );
  });
  app.post("/api/admin/stores/:id/geocode", async (req, res) => {
    const attempts = await geocode(db, {
      onlyId: req.params.id,
      force: req.body?.force === true,
      log: () => {},
    });
    const attempt = attempts[0];
    if (!attempt || attempt.outcome === "missing") {
      return res.status(404).json({ error: "找不到門市" });
    }
    const row = db.prepare("SELECT document FROM stores WHERE id=?").get(req.params.id);
    const persistence = attempt.outcome === "success" ? await persistNow() : null;
    res.json({
      ...attempt,
      persistence,
      store: row ? { id: req.params.id, ...JSON.parse(row.document) } : null,
    });
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
        res.json({ url: "/uploads/" + name, persistence: await persistNow() });
      } catch {
        return res
          .status(400)
          .json({ error: "不支援或損壞的圖片（上限 8MB / 2400 萬像素）" });
      }
    },
  );
  app.use((e, req, res, next) =>
    res.status(e.status || 400).json({
      error: e.code === "LIMIT_FILE_SIZE" ? "圖片不得超過 8MB" : "請求處理失敗",
    }),
  );
  return app;
}
