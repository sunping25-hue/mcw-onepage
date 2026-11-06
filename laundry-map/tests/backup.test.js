import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { openDb } from "../server/db.js";
import { seedKnownStores } from "../server/seed.js";
import { createBackup } from "../server/backup.js";
test("online backup restores the SQLite snapshot and referenced photos, purges sessions, and never overwrites source or existing backups", async () => {
  const root = mkdtempSync(join(tmpdir(), "mcw-backup-test-")),
    data = join(root, "data"),
    destination = join(root, "snapshot");
  const db = openDb(data);
  try {
    seedKnownStores(db);
    const row = db.prepare("SELECT id,document FROM stores LIMIT 1").get();
    const doc = JSON.parse(row.document);
    doc.photos = ["/uploads/12345678-1234-1234-1234-123456789abc.webp"];
    doc.announcement = "總部公告保留";
    doc.equipment = [
      {
        id: "count:洗脫烘:16",
        type: "洗脫烘",
        capacity: "16KG",
        quantity: 5,
        model: "",
        price: "",
      },
    ];
    mkdirSync(join(data, "uploads"));
    const photo = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "blue" },
    })
      .webp()
      .toBuffer();
    writeFileSync(join(data, doc.photos[0].slice(1)), photo);
    db.prepare("UPDATE stores SET document=? WHERE id=?").run(
      JSON.stringify(doc),
      row.id,
    );
    db.prepare("INSERT INTO sessions VALUES(?,?)").run(
      "test-hash",
      Date.now() + 100000,
    );
    const manifest = await createBackup(data, destination);
    assert.equal(manifest.stores, 15);
    assert.equal(manifest.photos, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sessions").get().n, 1);
    assert.deepEqual(
      readFileSync(join(destination, doc.photos[0].slice(1))),
      photo,
    );
    for (const f of manifest.files)
      assert.equal(
        createHash("sha256")
          .update(readFileSync(join(destination, f.path)))
          .digest("hex"),
        f.sha256,
      );
    db.prepare("DELETE FROM stores WHERE id=?").run(row.id);
    const restored = new DatabaseSync(join(destination, "mcw.sqlite"));
    assert.equal(
      restored.prepare("SELECT count(*) AS n FROM stores").get().n,
      15,
    );
    assert.equal(
      restored.prepare("SELECT count(*) AS n FROM sessions").get().n,
      0,
    );
    assert.equal(
      JSON.parse(
        restored.prepare("SELECT document FROM stores WHERE id=?").get(row.id)
          .document,
      ).address,
      doc.address,
    );
    const restoredDoc = JSON.parse(
      restored.prepare("SELECT document FROM stores WHERE id=?").get(row.id)
        .document,
    );
    assert.equal(restoredDoc.announcement, "總部公告保留");
    assert.equal(restoredDoc.equipment[0].quantity, 5);
    assert.equal(restoredDoc.equipment[0].capacity, "16KG");
    assert.equal(restoredDoc.name, doc.name);
    restored.close();
    await assert.rejects(createBackup(data, destination), /已存在/);
    await assert.rejects(
      createBackup(data, join(data, "nested-backup")),
      /之外/,
    );
    await assert.rejects(createBackup(data, join(data, "..backup")), /之外/);
    const other = db.prepare("SELECT id,document FROM stores LIMIT 1").get();
    const broken = JSON.parse(other.document);
    broken.photos = ["/uploads/ffffffff-ffff-ffff-ffff-ffffffffffff.webp"];
    db.prepare("UPDATE stores SET document=? WHERE id=?").run(
      JSON.stringify(broken),
      other.id,
    );
    const failed = join(root, "failed");
    await assert.rejects(createBackup(data, failed));
    assert.equal(existsSync(failed), false);
    assert.equal(db.prepare("SELECT count(*) AS n FROM stores").get().n, 14);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
