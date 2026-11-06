import { readFileSync } from "node:fs";
import { storeSchema } from "./model.js";
const stores = JSON.parse(
  readFileSync(
    new URL("../config/initial-stores.json", import.meta.url),
    "utf8",
  ),
);
const batches = [
  ["owner-provided-stores-v1", "v1"],
  ["owner-provided-stores-v2", "v2"],
];
function blankStore(entry) {
  return storeSchema.parse({
    name: entry.name,
    city: entry.city,
    address: entry.address,
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
}
/** Owner-supplied names/addresses only. Each batch runs once and never overwrites or restores later edits. */
export function seedKnownStores(db) {
  const seen = db.prepare("SELECT key FROM bootstrap_records WHERE key=?");
  const mark = db.prepare("INSERT INTO bootstrap_records VALUES(?,?)");
  const insert = db.prepare("INSERT OR IGNORE INTO stores VALUES(?,?,?)");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [key, batch] of batches) {
      if (seen.get(key)) continue;
      const stamp = new Date().toISOString();
      for (const entry of stores.filter((store) => store.batch === batch)) {
        insert.run(entry.id, JSON.stringify(blankStore(entry)), stamp);
      }
      mark.run(key, stamp);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
