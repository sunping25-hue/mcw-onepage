import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
export function openDb(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(resolve(dir, "mcw.sqlite"));
  db.exec("PRAGMA journal_mode=WAL;");
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    db.exec(readFileSync(new URL(file, migrations), "utf8"));
  return db;
}
