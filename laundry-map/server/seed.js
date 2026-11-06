import { readFileSync } from "node:fs";
import { DEFAULT_STORE_HOURS } from "../shared/storefront.js";
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
    openingStatus: "open",
    phone: "",
    hours: DEFAULT_STORE_HOURS,
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
    machineQueryMode: "off",
    machineQueryUrl: "",
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

const OPERATING_DEFAULTS_KEY = "store-operating-defaults-v1";
/** One-time fill of blank hours and unknown status. Never rewrites other fields or later edits. */
export function applyStoreOperatingDefaults(db) {
  const seen = db
    .prepare("SELECT key FROM bootstrap_records WHERE key=?")
    .get(OPERATING_DEFAULTS_KEY);
  if (seen) return { hours: 0, opening: 0 };
  const rows = db.prepare("SELECT id, document FROM stores").all();
  const update = db.prepare(
    "UPDATE stores SET document=?, updated_at=? WHERE id=?",
  );
  const mark = db.prepare("INSERT INTO bootstrap_records VALUES(?,?)");
  let hours = 0;
  let opening = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const document = JSON.parse(row.document);
      let changed = false;
      if (typeof document.hours !== "string" || !document.hours.trim()) {
        document.hours = DEFAULT_STORE_HOURS;
        hours += 1;
        changed = true;
      }
      if (!document.openingStatus || document.openingStatus === "unknown") {
        document.openingStatus = "open";
        opening += 1;
        changed = true;
      }
      if (changed) {
        update.run(JSON.stringify(document), new Date().toISOString(), row.id);
      }
    }
    mark.run(OPERATING_DEFAULTS_KEY, new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { hours, opening };
}
