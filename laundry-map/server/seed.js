import { readFileSync } from "node:fs";
import { storeSchema } from "./model.js";
const stores = JSON.parse(
  readFileSync(
    new URL("../config/initial-stores.json", import.meta.url),
    "utf8",
  ),
);
/** Owner-supplied names/addresses only. Do not overwrite later headquarters edits or invent coordinates. */
export function seedKnownStores(db) {
  const key = "owner-provided-stores-v1";
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT key FROM bootstrap_records WHERE key=?").get(key)) {
      const insert = db.prepare("INSERT OR IGNORE INTO stores VALUES(?,?,?)");
      for (const { id, ...entry } of stores) {
        const store = storeSchema.parse({
          ...entry,
          openingStatus: "unknown",
          phone: "",
          hours: "",
          announcement: "",
          lat: null,
          lng: null,
          confirmed: true,
          published: true,
          photos: [],
          equipment: [],
          tutorials: [],
          aiUrl: "",
          reviewUrl: "",
          franchiseUrl: "",
          provider: "unconnected",
          providerReference: "",
        });
        insert.run(id, JSON.stringify(store), new Date().toISOString());
      }
      db.prepare("INSERT INTO bootstrap_records VALUES(?,?)").run(
        key,
        new Date().toISOString(),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
