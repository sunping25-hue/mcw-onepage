import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../server/db.js";
import { seedKnownStores } from "../server/seed.js";
import { createPersistence, persistenceFromEnv } from "../server/persist.js";
import {
  DRIVE_SCOPE,
  authorizationUrl,
  createDriveStore,
  signServiceAccountJwt,
} from "../server/gdrive.js";

function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function matchQuery(file, query) {
  const name = query.match(/name='((?:\\'|[^'])*)'/)?.[1]?.replace(/\\'/g, "'");
  const parent = query.match(/'((?:\\'|[^'])*)' in parents/)?.[1];
  if (name && file.name !== name) return false;
  if (parent === "root") {
    if (file.parent) return false;
  } else if (parent && parent !== file.parent) return false;
  if (query.includes("mimeType='application/vnd.google-apps.folder'") && file.mime !== "folder")
    return false;
  if (query.includes("mimeType!='application/vnd.google-apps.folder'") && file.mime === "folder")
    return false;
  return true;
}

async function driveMock() {
  const files = [];
  let seq = 1;
  const seen = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const payload = await body(req);
    seen.push(url.pathname + url.search);
    if (url.pathname.includes("permissions")) {
      res.writeHead(500);
      res.end("public sharing is not allowed");
      return;
    }
    if (url.pathname === "/token") {
      const form = new URLSearchParams(payload.toString());
      assert.equal(form.get("grant_type") === "refresh_token" || form.get("assertion")?.length > 0, true);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ access_token: "ya29.test-token", expires_in: 3600 }));
      return;
    }
    if (!String(req.headers.authorization || "").startsWith("Bearer ya29.test-token")) {
      res.writeHead(401);
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/drive/v3/files") {
      const matched = files.filter((file) => matchQuery(file, url.searchParams.get("q") || ""));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ files: matched.map(({ id, name, mime }) => ({ id, name, mimeType: mime === "folder" ? "application/vnd.google-apps.folder" : "application/octet-stream" })) }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/drive/v3/files") {
      const meta = JSON.parse(payload.toString());
      assert.equal(meta.permissions, undefined);
      const file = { id: "id" + seq++, name: meta.name, parent: meta.parents?.[0] || "", mime: "folder", body: Buffer.alloc(0) };
      files.push(file);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: file.id }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/upload/drive/v3/files") {
      const boundary = /boundary=([^;]+)/.exec(req.headers["content-type"])[1];
      const marker = Buffer.from(`\r\n--${boundary}`);
      const header = Buffer.from("application/octet-stream");
      const split = payload.indexOf(header);
      const dataStart = payload.indexOf(Buffer.from("\r\n\r\n"), split) + 4;
      const dataEnd = payload.indexOf(marker, dataStart);
      const meta = JSON.parse(payload.subarray(0, split).toString().match(/\{[\s\S]*\}/)[0]);
      const file = { id: "id" + seq++, name: meta.name, parent: meta.parents?.[0] || "", mime: "file", body: payload.subarray(dataStart, dataEnd) };
      files.push(file);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: file.id }));
      return;
    }
    if (req.method === "PATCH" && url.pathname.startsWith("/upload/drive/v3/files/")) {
      const id = url.pathname.split("/")[5];
      const file = files.find((item) => item.id === id);
      file.body = payload;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id }));
      return;
    }
    if (req.method === "GET" && url.searchParams.get("alt") === "media") {
      const id = url.pathname.split("/")[4];
      const file = files.find((item) => item.id === id);
      if (!file) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200);
      res.end(file.body);
      return;
    }
    res.writeHead(404);
    res.end(url.pathname);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  return {
    files,
    seen,
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("Drive OAuth URL requests only the file scope and a private refresh token", () => {
  const url = authorizationUrl({ clientId: "client" });
  assert.equal(url.searchParams.get("scope"), DRIVE_SCOPE);
  assert.equal(DRIVE_SCOPE, "https://www.googleapis.com/auth/drive.file");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("include_granted_scopes"), "false");
});

test("service account JWT is RS256 and limited to drive.file", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const token = signServiceAccountJwt({
    clientEmail: "mcw@example.iam.gserviceaccount.com",
    privateKey: pem,
    now: new Date("2026-11-06T00:00:00Z"),
  });
  const [header, claim, signature] = token.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url").toString()).alg, "RS256");
  assert.equal(JSON.parse(Buffer.from(claim, "base64url").toString()).scope, DRIVE_SCOPE);
  assert.equal(
    createVerify("RSA-SHA256").update(`${header}.${claim}`).verify(publicKey, Buffer.from(signature, "base64url")),
    true,
  );
});

test("Google Drive snapshots round-trip, reject a corrupt backup, and do not publish files", async () => {
  const mock = await driveMock();
  const data = mkdtempSync(join(tmpdir(), "mcw-drive-data-"));
  const restored = mkdtempSync(join(tmpdir(), "mcw-drive-restored-"));
  const db = openDb(data);
  try {
    seedKnownStores(db);
    mkdirSync(join(data, "uploads"));
    const album = [
      ["12345678-1234-1234-1234-123456789abc.webp", "photo-a"],
      ["22345678-1234-1234-1234-123456789abd.webp", "photo-b"],
      ["32345678-1234-1234-1234-123456789abe.webp", "photo-c"],
    ];
    for (const [name, bytes] of album) {
      writeFileSync(join(data, "uploads", name), Buffer.from(bytes));
    }
    const row = db.prepare("SELECT id,document FROM stores LIMIT 1").get();
    const untouched = db
      .prepare("SELECT id,document FROM stores WHERE id!=?")
      .all(row.id);
    const document = JSON.parse(row.document);
    document.phone = "07-111-2222";
    document.photos = [
      ...album.map(([name]) => "/uploads/" + name),
      "https://photos.example.test/store.jpg",
    ];
    db.prepare("UPDATE stores SET document=? WHERE id=?").run(JSON.stringify(document), row.id);
    const store = createDriveStore({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      fetcher: (url, options) => fetch(String(url).replace("https://oauth2.googleapis.com", mock.base).replace("https://www.googleapis.com", mock.base).replace("https://www.googleapis.com/upload", mock.base), options),
      tokenUrl: mock.base + "/token",
      apiBase: mock.base + "/drive/v3",
      uploadBase: mock.base + "/upload/drive/v3",
    });
    const persist = createPersistence({ driver: "gdrive", store });
    const saved = await persist.backupFrom(data, db);
    assert.equal(saved.persisted, true);
    assert.equal((await persist.restoreInto(restored)).restored, true);
    const copy = openDb(restored);
    try {
      const restoredDoc = JSON.parse(copy.prepare("SELECT document FROM stores WHERE id=?").get(row.id).document);
      assert.equal(restoredDoc.phone, "07-111-2222");
      assert.deepEqual(restoredDoc.photos, document.photos);
      assert.equal(readFileSync(join(restored, document.photos[2].slice(1))).toString(), "photo-c");
      assert.equal(copy.prepare("SELECT count(*) AS n FROM stores").get().n, 15);
      for (const other of untouched) {
        assert.equal(
          copy.prepare("SELECT document FROM stores WHERE id=?").get(other.id).document,
          other.document,
        );
      }
    } finally {
      copy.close();
    }
    const latest = mock.files.find((file) => file.name === "latest.json");
    const manifest = JSON.parse(latest.body.toString());
    const sqlite = mock.files.find((file) => file.name === "mcw.sqlite" && file.body.includes(Buffer.from("SQLite format 3")));
    sqlite.body = Buffer.from("corrupt");
    await assert.rejects(persist.restoreIntoLive(data, db), /校驗失敗/);
    assert.equal(JSON.parse(db.prepare("SELECT document FROM stores WHERE id=?").get(row.id).document).phone, "07-111-2222");
    assert.equal(JSON.parse(latest.body.toString()).snapshotId, manifest.snapshotId);
    assert.equal(mock.seen.some((path) => path.includes("permissions")), false);
    const missing = persistenceFromEnv({ PERSIST_DRIVER: "gdrive", GOOGLE_CLIENT_ID: "only-id" });
    assert.equal(missing.configured, false);
    assert.deepEqual(missing.missing, ["GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]);
    assert.equal(JSON.stringify(missing).includes("only-id"), false);
  } finally {
    db.close();
    await mock.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(restored, { recursive: true, force: true });
  }
});
