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

/** Fill only blank coordinates when the saved address still matches. Never resurrects rows or edits other fields. */
export function applyVerifiedCoordinates(db) {
  const select = db.prepare("SELECT document FROM stores WHERE id=?");
  const update = db.prepare(
    "UPDATE stores SET document=?,updated_at=? WHERE id=?",
  );
  let filled = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const entry of stores) {
      if (typeof entry.lat !== "number" || typeof entry.lng !== "number") continue;
      const row = select.get(entry.id);
      if (!row) continue;
      const document = JSON.parse(row.document);
      if (document.address !== entry.address) continue;
      if (document.lat !== null || document.lng !== null) continue;
      document.lat = entry.lat;
      document.lng = entry.lng;
      update.run(JSON.stringify(document), new Date().toISOString(), entry.id);
      filled += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return filled;
}
