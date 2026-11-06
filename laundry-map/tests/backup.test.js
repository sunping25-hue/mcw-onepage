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
test("album backup keeps upload order and does not rewrite the other seeded stores", async () => {
  const root = mkdtempSync(join(tmpdir(), "mcw-album-backup-")),
    data = join(root, "data"),
    destination = join(root, "snapshot");
  const db = openDb(data);
  try {
    seedKnownStores(db);
    const rows = db.prepare("SELECT id,document FROM stores ORDER BY id").all();
    assert.equal(rows.length, 15);
    const photos = [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1.webp",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2.webp",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3.webp",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4.webp",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5.webp",
    ].map((name) => "/uploads/" + name);
    mkdirSync(join(data, "uploads"));
    for (const path of photos) {
      writeFileSync(
        join(data, path.slice(1)),
        await sharp({
          create: {
            width: 8,
            height: 8,
            channels: 3,
            background: path.slice(-6, -5) === "1" ? "red" : "blue",
          },
        })
          .webp()
          .toBuffer(),
      );
    }
    const target = JSON.parse(rows[0].document);
    target.photos = photos;
    db.prepare("UPDATE stores SET document=? WHERE id=?").run(
      JSON.stringify(target),
      rows[0].id,
    );
    const links = [
      "https://photos.example.test/a.jpg",
      "https://photos.example.test/b.webp",
    ];
    const linked = JSON.parse(rows[1].document);
    linked.photos = links;
    db.prepare("UPDATE stores SET document=? WHERE id=?").run(
      JSON.stringify(linked),
      rows[1].id,
    );
    const manifest = await createBackup(data, destination);
    assert.equal(manifest.stores, 15);
    assert.equal(manifest.photos, 5);
    assert.equal(
      manifest.files.some((file) => String(file.path).includes("example.test")),
      false,
    );
    for (const row of rows.slice(2)) {
      assert.equal(
        db.prepare("SELECT document FROM stores WHERE id=?").get(row.id)
          .document,
        row.document,
      );
    }
    const restored = new DatabaseSync(join(destination, "mcw.sqlite"));
    try {
      assert.deepEqual(
        JSON.parse(
          restored.prepare("SELECT document FROM stores WHERE id=?").get(
            rows[0].id,
          ).document,
        ).photos,
        photos,
      );
      assert.deepEqual(
        JSON.parse(
          restored.prepare("SELECT document FROM stores WHERE id=?").get(
            rows[1].id,
          ).document,
        ).photos,
        links,
      );
      for (const row of rows.slice(2)) {
        assert.equal(
          restored.prepare("SELECT document FROM stores WHERE id=?").get(row.id)
            .document,
          row.document,
        );
      }
      assert.equal(restored.prepare("SELECT count(*) AS n FROM stores").get().n, 15);
    } finally {
      restored.close();
    }
    for (const path of photos) {
      assert.ok(existsSync(join(destination, path.slice(1))));
    }
    const blocked = JSON.parse(rows[1].document);
    blocked.photos = ["/brand/mcw-round-logo.png"];
    db.prepare("UPDATE stores SET document=? WHERE id=?").run(
      JSON.stringify(blocked),
      rows[1].id,
    );
    const failed = join(root, "logo-backup");
    await assert.rejects(createBackup(data, failed), /無效照片路徑/);
    assert.equal(existsSync(failed), false);
    assert.equal(
      JSON.parse(
        db.prepare("SELECT document FROM stores WHERE id=?").get(rows[0].id)
          .document,
      ).photos.length,
      5,
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
