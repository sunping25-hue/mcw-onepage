import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBackup } from "./backup.js";
import { s3Request } from "./s3.js";

const TABLES = [
  "stores",
  "settings",
  "bootstrap_records",
  "geocode_attempts",
  "persist_events",
];

function assertOutside(dataDir, root) {
  const inside = relative(resolve(dataDir), resolve(root));
  if (
    !inside ||
    (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`))
  ) {
    throw Error("雲端保存位置必須位於 DATA_DIR 之外");
  }
}

function safeKey(key) {
  if (!/^[a-zA-Z0-9._/-]+$/.test(key) || key.split("/").includes("..")) {
    throw Error("雲端物件名稱不正確");
  }
  return key;
}

function safeRelative(path) {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").includes("..")
  ) {
    throw Error("備份路徑不正確");
  }
  return path;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function createFileStore(root) {
  return {
    async put(key, bytes) {
      const path = join(root, safeKey(key));
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, bytes, { mode: 0o600 });
    },
    async get(key) {
      const path = join(root, safeKey(key));
      return existsSync(path) ? readFileSync(path) : null;
    },
  };
}

function createS3Store(options) {
  return {
    async put(key, bytes) {
      const response = await s3Request({ ...options, method: "PUT", key: safeKey(key), body: bytes });
      if (!response.ok) throw Error(`雲端上傳失敗 HTTP ${response.status}`);
    },
    async get(key) {
      const response = await s3Request({ ...options, method: "GET", key: safeKey(key) });
      if (response.status === 404) return null;
      if (!response.ok) throw Error(`雲端讀取失敗 HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

function uploadFiles(dataDir) {
  const dir = join(dataDir, "uploads");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => /^[a-f0-9-]+\.webp$/.test(name));
}

async function downloadSnapshot(store) {
  const raw = await store.get("latest.json");
  if (!raw) return null;
  const latest = JSON.parse(raw.toString("utf8"));
  if (latest.formatVersion !== 1 || !/^[a-zA-Z0-9._-]+$/.test(latest.snapshotId)) {
    throw Error("雲端備份格式無法辨識");
  }
  if (!Array.isArray(latest.files) || !latest.files.length) {
    throw Error("雲端備份沒有檔案清單");
  }
  const dir = join(tmpdir(), `mcw-restore-${latest.snapshotId}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    for (const file of latest.files) {
      const rel = safeRelative(file.path);
      const bytes = await store.get(`snapshots/${latest.snapshotId}/${rel}`);
      if (!bytes || sha256(bytes) !== file.sha256) throw Error("雲端備份校驗失敗");
      const dest = join(dir, rel);
      mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
      writeFileSync(dest, bytes, { mode: 0o600 });
    }
    return { dir, latest };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

function copySnapshotFiles(snapshotDir, dataDir, files) {
  for (const file of files) {
    const rel = safeRelative(file.path);
    const dest = join(dataDir, rel);
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    copyFileSync(join(snapshotDir, rel), dest);
    chmodSync(dest, 0o600);
  }
}

function replaceLiveRows(db, snapshotPath) {
  const snap = new DatabaseSync(snapshotPath, { readOnly: true });
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of TABLES) db.exec(`DELETE FROM ${table}`);
      for (const table of TABLES) {
        const rows = snap.prepare(`SELECT * FROM ${table}`).all();
        for (const row of rows) {
          const cols = Object.keys(row).filter((col) => /^[a-z_]+$/.test(col));
          const stmt = db.prepare(
            `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
          );
          stmt.run(...cols.map((col) => row[col]));
        }
      }
      db.exec("DELETE FROM sessions");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    snap.close();
  }
}

function recordEvent(db, action, outcome, detail) {
  db.prepare(
    "INSERT INTO persist_events (attempted_at,action,outcome,detail) VALUES (?,?,?,?)",
  ).run(new Date().toISOString(), action, outcome, String(detail).slice(0, 500));
}

export function createPersistence({ driver, store, root = null }) {
  let chain = Promise.resolve();
  const enqueue = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => {},
      () => {},
    );
    return run;
  };
  return {
    configured: true,
    driver,
    missing: [],
    async backupFrom(dataDir, db) {
      return enqueue(async () => {
        if (root) assertOutside(dataDir, root);
        db.exec("PRAGMA wal_checkpoint(PASSIVE)");
        const temp = join(tmpdir(), `mcw-snap-${Date.now()}`);
        const output = join(temp, "snap");
        try {
          const manifest = await createBackup(dataDir, output);
          const files = [...manifest.files];
          for (const name of uploadFiles(dataDir)) {
            const rel = `uploads/${name}`;
            if (files.some((file) => file.path === rel)) continue;
            const bytes = readFileSync(join(dataDir, rel));
            const dest = join(output, rel);
            mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
            writeFileSync(dest, bytes, { mode: 0o600 });
            files.push({ path: rel, sha256: sha256(bytes) });
          }
          const snapshotId = manifest.createdAt.replace(/[:.]/g, "-");
          for (const file of files) {
            await store.put(
              `snapshots/${snapshotId}/${file.path}`,
              readFileSync(join(output, file.path)),
            );
          }
          const latest = {
            formatVersion: 1,
            snapshotId,
            createdAt: manifest.createdAt,
            stores: manifest.stores,
            photos: files.filter((file) => file.path.startsWith("uploads/")).length,
            files,
          };
          await store.put("latest.json", Buffer.from(JSON.stringify(latest)));
          recordEvent(db, "backup", "success", snapshotId);
          return {
            persisted: true,
            snapshotId,
            stores: latest.stores,
            photos: latest.photos,
          };
        } catch (error) {
          try {
            recordEvent(db, "backup", "error", error.message);
          } catch {
            // The caller still receives the backup error if event logging fails.
          }
          throw error;
        } finally {
          rmSync(temp, { recursive: true, force: true });
        }
      });
    },
    async restoreInto(dataDir) {
      if (root) assertOutside(dataDir, root);
      if (existsSync(join(dataDir, "mcw.sqlite"))) {
        return { restored: false, reason: "local-exists" };
      }
      const snap = await downloadSnapshot(store);
      if (!snap) return { restored: false, reason: "no-snapshot" };
      try {
        mkdirSync(dataDir, { recursive: true, mode: 0o700 });
        copySnapshotFiles(snap.dir, dataDir, snap.latest.files);
        return { restored: true, snapshotId: snap.latest.snapshotId };
      } finally {
        rmSync(snap.dir, { recursive: true, force: true });
      }
    },
    async restoreIntoLive(dataDir, db) {
      return enqueue(async () => {
        if (root) assertOutside(dataDir, root);
        const snap = await downloadSnapshot(store);
        if (!snap) throw Error("雲端還沒有可還原的備份");
        try {
          replaceLiveRows(db, join(snap.dir, "mcw.sqlite"));
          for (const file of snap.latest.files) {
            if (!file.path.startsWith("uploads/")) continue;
            const dest = join(dataDir, safeRelative(file.path));
            mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
            copyFileSync(join(snap.dir, file.path), dest);
            chmodSync(dest, 0o600);
          }
          recordEvent(db, "restore", "success", snap.latest.snapshotId);
          return { restored: true, snapshotId: snap.latest.snapshotId };
        } catch (error) {
          try {
            recordEvent(db, "restore", "error", error.message);
          } catch {
            // Preserve the original restore error.
          }
          throw error;
        } finally {
          rmSync(snap.dir, { recursive: true, force: true });
        }
      });
    },
    async describe() {
      try {
        const raw = await store.get("latest.json");
        if (!raw) return { remoteSnapshot: null };
        const latest = JSON.parse(raw.toString("utf8"));
        return {
          remoteSnapshot: {
            snapshotId: latest.snapshotId,
            createdAt: latest.createdAt,
            stores: latest.stores,
            photos: latest.photos,
          },
        };
      } catch (error) {
        return { remoteSnapshot: null, remoteError: error.message };
      }
    },
  };
}

export function persistenceFromEnv(env = process.env) {
  const driver = String(env.PERSIST_DRIVER || "none").toLowerCase();
  if (!driver || driver === "none") {
    return { configured: false, driver: "none", missing: [] };
  }
  if (driver === "file") {
    if (!env.PERSIST_FILE_DIR) {
      return { configured: false, driver: "file", missing: ["PERSIST_FILE_DIR"] };
    }
    const root = resolve(env.PERSIST_FILE_DIR);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    return createPersistence({ driver, root, store: createFileStore(root) });
  }
  if (driver === "s3") {
    const names = [
      "PERSIST_S3_ENDPOINT",
      "PERSIST_S3_BUCKET",
      "PERSIST_S3_ACCESS_KEY_ID",
      "PERSIST_S3_SECRET_ACCESS_KEY",
    ];
    const missing = names.filter((name) => !env[name]);
    if (missing.length) return { configured: false, driver: "s3", missing };
    return createPersistence({
      driver: "s3",
      store: createS3Store({
        endpoint: env.PERSIST_S3_ENDPOINT,
        bucket: env.PERSIST_S3_BUCKET,
        accessKeyId: env.PERSIST_S3_ACCESS_KEY_ID,
        secretAccessKey: env.PERSIST_S3_SECRET_ACCESS_KEY,
        region: env.PERSIST_S3_REGION || "auto",
      }),
    });
  }
  return { configured: false, driver, missing: ["PERSIST_DRIVER"] };
}
