import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TAIWAN_OVERVIEW,
  overviewLatLngs,
  overviewPadding,
} from "../src/taiwan-overview.js";

const stores = JSON.parse(
  readFileSync(new URL("../config/initial-stores.json", import.meta.url), "utf8"),
);

test("full-Taiwan bounds cover the island and all 15 published store coordinates", () => {
  assert.equal(stores.length, 15);
  const [[south, west], [north, east]] = overviewLatLngs(stores);
  assert.equal(south, TAIWAN_OVERVIEW.south);
  assert.equal(west, TAIWAN_OVERVIEW.west);
  assert.equal(north, TAIWAN_OVERVIEW.north);
  assert.equal(east, TAIWAN_OVERVIEW.east);
  assert.ok(south <= 21.95 && north >= 25.25);
  assert.ok(west <= 119.5 && east >= 122);
  for (const store of stores) {
    assert.equal(typeof store.lat, "number", store.name);
    assert.equal(typeof store.lng, "number", store.name);
    assert.ok(store.lat >= south && store.lat <= north, store.name);
    assert.ok(store.lng >= west && store.lng <= east, store.name);
  }
});

test("a marker outside the island still expands the overview instead of being clipped", () => {
  const [[south, west], [north, east]] = overviewLatLngs([
    { lat: 20.5, lng: 123.4 },
  ]);
  assert.equal(south, 20.5);
  assert.equal(east, 123.4);
  assert.equal(west, TAIWAN_OVERVIEW.west);
  assert.equal(north, TAIWAN_OVERVIEW.north);
  assert.deepEqual(overviewLatLngs([]), [
    [TAIWAN_OVERVIEW.south, TAIWAN_OVERVIEW.west],
    [TAIWAN_OVERVIEW.north, TAIWAN_OVERVIEW.east],
  ]);
  assert.deepEqual(overviewLatLngs([{ lat: null, lng: null }]), [
    [TAIWAN_OVERVIEW.south, TAIWAN_OVERVIEW.west],
    [TAIWAN_OVERVIEW.north, TAIWAN_OVERVIEW.east],
  ]);
});

test("overview padding fits short phone maps and larger desktop maps", () => {
  const phone = overviewPadding(343, 280);
  const tallPhone = overviewPadding(360, 440);
  const desktop = overviewPadding(680, 460);
  assert.deepEqual(phone, [18, 18]);
  assert.ok(phone[0] * 2 < 280);
  assert.ok(tallPhone[0] >= phone[0] && tallPhone[0] <= desktop[0]);
  assert.ok(desktop[0] > phone[0] && desktop[0] <= 40);
  assert.ok(desktop[0] * 2 < 460);
});
