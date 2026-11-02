import { DatabaseSync, backup } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { resolve, dirname, relative, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isPhotoPath } from "../shared/brand.js";

/** Consistent SQLite snapshot plus referenced public uploads. Never changes the live database. */
export async function createBackup(dataDir, outputDir) {
  const sourceDir = resolve(dataDir),
    target = resolve(outputDir),
    inside = relative(sourceDir, target);
  // Prevent backups from being written inside live storage, where deployment cleanup may remove them.
  if (
    !inside ||
    (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(".." + sep))
  )
    throw Error("備份目錄必須位於 DATA_DIR 之外");
  if (existsSync(target)) throw Error("備份目錄已存在，未覆寫任何檔案");
  const sourcePath = join(sourceDir, "mcw.sqlite");
  if (!existsSync(sourcePath)) throw Error("找不到現有資料庫");
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  mkdirSync(target, { mode: 0o700 });
  let source, snapshot;
  try {
    source = new DatabaseSync(sourcePath, { readOnly: true });
    const snapshotPath = join(target, "mcw.sqlite");
    await backup(source, snapshotPath);
    source.close();
    source = null;
    snapshot = new DatabaseSync(snapshotPath);
    snapshot.exec("PRAGMA journal_mode=DELETE; DELETE FROM sessions; VACUUM;");
    const documents = snapshot
      .prepare("SELECT document FROM stores")
      .all()
      .map((r) => JSON.parse(r.document));
    const uploads = new Set();
    for (const s of documents)
      for (const path of [
        ...(s.photos || []),
        ...(s.equipment || []).flatMap((e) => e.photos || []),
      ]) {
        if (!isPhotoPath(path)) throw Error("資料庫包含無效照片路徑");
        if (path.startsWith("/uploads/")) uploads.add(path);
      }
    snapshot.close();
    snapshot = null;
    const paths = ["mcw.sqlite"];
    mkdirSync(join(target, "uploads"), { mode: 0o700 });
    for (const path of uploads) {
      const sourceFile = join(sourceDir, path.slice(1));
      if (
        !lstatSync(sourceFile).isFile() ||
        lstatSync(sourceFile).isSymbolicLink()
      )
        throw Error("照片遺失或不是一般檔案");
      const dest = join(target, path.slice(1));
      copyFileSync(sourceFile, dest);
      chmodSync(dest, 0o600);
      paths.push(path.slice(1));
    }
    chmodSync(snapshotPath, 0o600);
    const manifest = {
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      stores: documents.length,
      photos: uploads.size,
      sessionsRemoved: true,
      files: paths.map((path) => ({
        path,
        sha256: createHash("sha256")
          .update(readFileSync(join(target, path)))
          .digest("hex"),
      })),
    };
    writeFileSync(
      join(target, "backup-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { mode: 0o600 },
    );
    return { ...manifest, directory: target };
  } catch (error) {
    source?.close();
    snapshot?.close();
    rmSync(target, { recursive: true, force: true });
    throw error;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dataDir = resolve(process.env.DATA_DIR || "data");
  const output =
    process.argv[2] ||
    resolve(
      "backups",
      new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID(),
    );
  try {
    const result = await createBackup(dataDir, output);
    console.log(
      `備份完成：${result.directory}\n門市 ${result.stores} 筆；照片 ${result.photos} 張；備份不保留登入工作階段。`,
    );
  } catch (error) {
    console.error("備份失敗：" + error.message);
    process.exitCode = 1;
  }
}
