import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
export function openDb(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(resolve(dir, "mcw.sqlite"));
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(
    readFileSync(
      new URL("../migrations/001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  return db;
}
