import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../server/db.js";
import { seedKnownStores } from "../server/seed.js";
import { createPersistence, persistenceFromEnv } from "../server/persist.js";
import { authorizationHeaders } from "../server/s3.js";

function temp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("file snapshots restore stores and uploads into an empty data directory", async () => {
  const data = temp("mcw-data-");
  const remote = temp("mcw-remote-");
  const restored = temp("mcw-restored-");
  const db = openDb(data);
  try {
    seedKnownStores(db);
    const photo = "11111111-1111-1111-1111-111111111111.webp";
    mkdirSync(join(data, "uploads"), { recursive: true });
    writeFileSync(join(data, "uploads", photo), Buffer.from("webp-bytes"));
    const row = db.prepare("SELECT id,document FROM stores LIMIT 1").get();
    const document = JSON.parse(row.document);
    document.phone = "07-000-0000";
    document.photos = ["/uploads/" + photo];
    db.prepare("UPDATE stores SET document=? WHERE id=?").run(JSON.stringify(document), row.id);
    const persist = createPersistence({
      driver: "file",
      root: remote,
      store: {
        async put(key, bytes) {
          const { mkdirSync, writeFileSync } = await import("node:fs");
          const { dirname, join } = await import("node:path");
          const path = join(remote, key);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, bytes);
        },
        async get(key) {
          const { existsSync, readFileSync } = await import("node:fs");
          const path = join(remote, key);
          return existsSync(path) ? readFileSync(path) : null;
        },
      },
    });
    const backup = await persist.backupFrom(data, db);
    assert.equal(backup.persisted, true);
    assert.equal(backup.photos, 1);
    const result = await persist.restoreInto(restored);
    assert.equal(result.restored, true);
    const copy = openDb(restored);
    try {
      const again = JSON.parse(copy.prepare("SELECT document FROM stores WHERE id=?").get(row.id).document);
      assert.equal(again.phone, "07-000-0000");
      assert.deepEqual(again.photos, ["/uploads/" + photo]);
      assert.equal(copy.prepare("SELECT count(*) AS n FROM sessions").get().n, 0);
      assert.equal(
        readFileSync(join(restored, "uploads", photo)).toString(),
        "webp-bytes",
      );
    } finally {
      copy.close();
    }
    document.phone = "08-111-1111";
    db.prepare("UPDATE stores SET document=? WHERE id=?").run(JSON.stringify(document), row.id);
    const live = await persist.restoreIntoLive(data, db);
    assert.equal(live.restored, true);
    assert.equal(
      JSON.parse(db.prepare("SELECT document FROM stores WHERE id=?").get(row.id).document).phone,
      "07-000-0000",
    );
  } finally {
    db.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
    rmSync(restored, { recursive: true, force: true });
  }
});

test("S3-compatible client round-trips a snapshot and reports missing credentials", async () => {
  const objects = new Map();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    assert.match(req.headers.authorization || "", /^AWS4-HMAC-SHA256 /);
    if (req.method === "PUT") {
      objects.set(req.url, body);
      res.writeHead(200);
      res.end();
      return;
    }
    if (!objects.has(req.url)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200);
    res.end(objects.get(req.url));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const data = temp("mcw-s3-data-");
  const restored = temp("mcw-s3-restored-");
  const db = openDb(data);
  try {
    seedKnownStores(db);
    const { s3Request } = await import("../server/s3.js");
    const options = {
      endpoint: `http://127.0.0.1:${port}`,
      bucket: "mcw",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "auto",
    };
    const persist = createPersistence({
      driver: "s3",
      store: {
        async put(key, bytes) {
          const response = await s3Request({ ...options, method: "PUT", key, body: bytes });
          assert.equal(response.status, 200);
        },
        async get(key) {
          const response = await s3Request({ ...options, method: "GET", key });
          if (response.status === 404) return null;
          assert.equal(response.status, 200);
          return Buffer.from(await response.arrayBuffer());
        },
      },
    });
    await persist.backupFrom(data, db);
    assert.equal((await persist.restoreInto(restored)).restored, true);
    const copy = openDb(restored);
    try {
      assert.equal(copy.prepare("SELECT count(*) AS n FROM stores").get().n, 2);
    } finally {
      copy.close();
    }
    const missing = persistenceFromEnv({ PERSIST_DRIVER: "s3", PERSIST_S3_BUCKET: "mcw" });
    assert.equal(missing.configured, false);
    assert.ok(missing.missing.includes("PERSIST_S3_SECRET_ACCESS_KEY"));
    assert.equal(persistenceFromEnv({}).configured, false);
  } finally {
    db.close();
    server.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(restored, { recursive: true, force: true });
  }
});

test("SigV4 matches the published AWS Signature Version 4 example", () => {
  const url = new URL("https://examplebucket.s3.amazonaws.com/test.txt");
  const headers = authorizationHeaders({
    method: "GET",
    url,
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    now: new Date("2013-05-24T00:00:00Z"),
    extraHeaders: { Range: "bytes=0-9" },
  });
  assert.equal(
    headers.Authorization,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
  assert.equal(
    createHash("sha256").update("").digest("hex"),
    headers["x-amz-content-sha256"],
  );
});
