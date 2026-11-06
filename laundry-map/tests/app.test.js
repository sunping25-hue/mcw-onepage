import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { openDb } from "../server/db.js";
import { createApp } from "../server/app.js";
import {
  applyStoreOperatingDefaults,
  applyVerifiedCoordinates,
  seedKnownStores,
} from "../server/seed.js";
import {
  MachineStatusProvider,
  ManufacturerApiAdapter,
  StubMachineStatusProvider,
  normalizeStatus,
  publicMachineQueryUrl,
  publicStore,
  storeSchema,
} from "../server/model.js";
import { catalogChips } from "../shared/storefront.js";
const dir = mkdtempSync(join(tmpdir(), "mcw-test-"));
let db, server, base, cookie, id;
const doc = {
  name: "測試門市（非真實營運資料）",
  city: "測試縣市",
  address: "測試地址",
  phone: "",
  hours: "",
  announcement: "",
  lat: 24,
  lng: 121,
  confirmed: true,
  published: true,
  photos: [],
  equipment: [
    {
      id: "test-washer-1",
      type: "洗脫烘",
      model: "",
      capacity: "",
      quantity: 1,
      price: "",
      providerKey: "private-reference",
    },
  ],
  tutorials: [],
  aiUrl: "",
  reviewUrl: "",
  franchiseUrl: "",
  provider: "demo",
  providerReference: "private-provider",
};
before(async () => {
  db = openDb(dir);
  const app = createApp({
    db,
    dataDir: dir,
    adminUser: "hq",
    adminPassword: "test-only-password-123456",
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  await new Promise((r) => server.close(r));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
async function req(path, method = "GET", body, auth = true, origin = base) {
  return fetch(base + "/api" + path, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(auth && cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
test("server rejects unauthorized writes, missing/cross-site origins and invalid login", async () => {
  assert.equal((await req("/admin/stores", "POST", doc, false)).status, 401);
  assert.equal((await req("/admin/persistence")).status, 401);
  assert.equal((await req("/admin/persistence/backup", "POST", {})).status, 401);
  assert.equal((await req("/admin/persistence/restore", "POST", { confirm: "RESTORE" })).status, 401);
  assert.equal((await req("/admin/stores/missing/geocode", "POST", { force: true })).status, 401);
  assert.equal(
    (await req("/login", "POST", { username: "hq", password: "bad" }, false))
      .status,
    401,
  );
  assert.equal(
    (await req("/login", "POST", {}, false, "https://evil.example")).status,
    403,
  );
  assert.equal((await req("/login", "POST", {}, false, null)).status, 403);
});
test("headquarters CRUD persists and public API hides drafts and private provider config", async () => {
  const login = await req(
    "/login",
    "POST",
    { username: "hq", password: "test-only-password-123456" },
    false,
  );
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  const r = await req("/admin/stores", "POST", doc);
  assert.equal(r.status, 200);
  id = (await r.json()).id;
  let published = await (await req("/stores")).json();
  assert.equal(published.length, 1);
  assert.equal(published[0].providerReference, undefined);
  assert.equal(published[0].equipment[0].providerKey, undefined);
  assert.equal(published[0].reviewUrl, "");
  assert.equal(published[0].machineQueryUrl, "");
  assert.equal(published[0].machineQueryMode, undefined);
  assert.equal(
    (await req("/admin/stores/" + id, "PUT", { ...doc, confirmed: false }))
      .status,
    400,
  );
  await req("/admin/stores/" + id, "PUT", { ...doc, published: false });
  assert.deepEqual(await (await req("/stores")).json(), []);
  await req("/admin/stores/" + id, "PUT", doc);
  const reopened = openDb(dir);
  assert.equal(reopened.prepare("SELECT count(*) AS n FROM stores").get().n, 1);
  reopened.close();
  const cloud = await (await req("/admin/persistence")).json();
  assert.equal(cloud.configured, false);
  assert.equal((await req("/admin/persistence/backup", "POST", {})).status, 409);
  assert.equal((await req("/admin/persistence/restore", "POST", {})).status, 400);
});
test("public machine statuses never leak simulated availability; demo requires admin", async () => {
  const statuses = await (await req(`/stores/${id}/status`)).json();
  assert.equal(statuses[0].status, "unknown");
  assert.equal(statuses[0].simulated, false);
  assert.equal(statuses[0].source, "unconnected");
  assert.equal(
    (await req(`/admin/stores/${id}/demo-status`, "GET", undefined, false))
      .status,
    401,
  );
  const demo = await (await req(`/admin/stores/${id}/demo-status`)).json();
  assert.match(demo.label, /模擬/);
  assert.equal(demo.statuses[0].simulated, true);
});
test("image upload decodes actual bytes, strips metadata and rejects malformed input", async () => {
  const form = new FormData();
  form.append(
    "photo",
    new Blob(['<svg onload="alert(1)"></svg>'], { type: "image/png" }),
    "fake.png",
  );
  let r = await fetch(base + "/api/admin/photos", {
    method: "POST",
    headers: { Origin: base, Cookie: cookie },
    body: form,
  });
  assert.equal(r.status, 400);
  const valid = new FormData();
  valid.append(
    "photo",
    new Blob([
      await sharp({
        create: { width: 30, height: 20, channels: 3, background: "blue" },
      })
        .png()
        .toBuffer(),
    ]),
    "valid.png",
  );
  r = await fetch(base + "/api/admin/photos", {
    method: "POST",
    headers: { Origin: base, Cookie: cookie },
    body: valid,
  });
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.match(p.url, /^\/uploads\/[a-f0-9-]+\.webp$/);
  const response = await fetch(base + p.url);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /webp/);
});
test("store album accepts five photo links, rejects unsafe URLs, and leaves other stores unchanged", async () => {
  const urls = ["red", "green", "blue", "yellow", "purple"].map(
    (color) => `https://photos.example.test/${color}.png`,
  );
  for (const blocked of [
    "http://photos.example.test/red.png",
    "https://user:pass@photos.example.test/red.png",
    "javascript:alert(1)",
    "https://localhost/red.png",
    "https://127.0.0.1/red.png",
    "https://10.1.1.1/red.png",
    "https://192.168.1.8/red.png",
    "https://172.16.0.4/red.png",
    "https://169.254.1.1/red.png",
    "https://[::1]/red.png",
    "https://photos.example.test/page.html",
    "https://photos.example.test/app.js",
    "https://photos.example.test/icon.svg",
    "/brand/mcw-wash-dry.webp",
    "/brand/mcw-round-logo.png",
    "/brand/mcw-logo-red.png",
    "/brand/logo.webp",
    "/brand/mcw-22kg-blue.webp",
    "/brand/mcw-machine-lineup-guide.webp",
    "/brand/community-lineup.webp",
    "/brand/mcw-cat.webp",
    "/brand/placeholder.webp",
  ]) {
    assert.equal(
      storeSchema.safeParse({ ...doc, photos: [blocked] }).success,
      false,
      blocked,
    );
  }
  assert.equal(
    storeSchema.safeParse({
      ...doc,
      photos: ["  https://photos.example.test/room.jpg  "],
    }).data.photos[0],
    "https://photos.example.test/room.jpg",
  );
  assert.equal(
    storeSchema.safeParse({
      ...doc,
      photos: ["https://cdn.example.com/room?id=1"],
    }).success,
    true,
  );
  const album = {
    ...doc,
    name: "相簿測試門市（非營運資料）",
    address: "相簿測試地址",
    photos: urls,
  };
  const created = await req("/admin/stores", "POST", album);
  assert.equal(created.status, 200);
  const saved = await created.json();
  assert.deepEqual(saved.photos, urls);
  const reversed = [...urls].reverse();
  const reordered = await req("/admin/stores/" + saved.id, "PUT", {
    ...album,
    photos: reversed,
  });
  assert.equal(reordered.status, 200);
  assert.deepEqual((await reordered.json()).photos, reversed);
  const removed = await req("/admin/stores/" + saved.id, "PUT", {
    ...album,
    photos: reversed.slice(1),
  });
  assert.equal(removed.status, 200);
  assert.deepEqual((await removed.json()).photos, reversed.slice(1));
  const tooMany = await req("/admin/stores/" + saved.id, "PUT", {
    ...album,
    photos: [...reversed, "https://photos.example.test/orange.png"],
  });
  assert.equal(tooMany.status, 400);
  assert.match((await tooMany.json()).error, /5/);
  const legacy = "/uploads/12345678-1234-1234-1234-123456789abc.webp";
  assert.equal(
    storeSchema.safeParse({ ...doc, photos: [legacy] }).success,
    true,
  );
  const hualien = [1, 2, 3, 4, 5].map(
    (n) => `/brand/hualien-store-${n}.webp`,
  );
  assert.equal(storeSchema.safeParse({ ...doc, photos: hualien }).success, true);
  assert.equal(
    storeSchema.safeParse({ ...doc, photos: [...hualien, urls[0]] }).success,
    false,
  );
  assert.equal(
    storeSchema.safeParse({ ...doc, photos: [urls[0], urls[0]] }).success,
    false,
  );
  assert.equal(
    storeSchema.safeParse({
      ...doc,
      photos: [],
      equipment: [
        { ...doc.equipment[0], photos: ["/brand/mcw-wash-dry.webp"] },
      ],
    }).success,
    true,
  );
  const otherResponse = await req("/admin/stores", "POST", {
    ...doc,
    name: "另一家測試門市（非營運資料）",
    address: "另一個測試地址",
    photos: [],
  });
  assert.equal(otherResponse.status, 200);
  const otherId = (await otherResponse.json()).id;
  const again = await req("/admin/stores/" + saved.id, "PUT", {
    ...album,
    photos: reversed,
  });
  assert.equal(again.status, 200);
  const rows = await (await req("/admin/stores")).json();
  assert.deepEqual(rows.find((s) => s.id === saved.id).photos, reversed);
  assert.deepEqual(rows.find((s) => s.id === otherId).photos, []);
  assert.deepEqual(rows.find((s) => s.id === id).photos, []);
  const pub = await (await req("/stores")).json();
  assert.deepEqual(pub.find((s) => s.id === saved.id).photos, reversed);
  assert.deepEqual(pub.find((s) => s.id === otherId).photos, []);
  assert.equal((await req("/admin/stores/" + saved.id, "DELETE")).status, 200);
  assert.equal((await req("/admin/stores/" + otherId, "DELETE")).status, 200);
  assert.deepEqual(
    (await (await req("/admin/stores")).json()).find((s) => s.id === id).photos,
    [],
  );
});
test("member points tutorial category is allowed and still requires YouTube", () => {
  assert.equal(
    storeSchema.safeParse({
      ...doc,
      tutorials: [
        {
          category: "會員儲值點數",
          title: "儲值教學",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        },
      ],
    }).success,
    true,
  );
  assert.equal(
    storeSchema.safeParse({
      ...doc,
      tutorials: [
        { category: "會員儲值點數", title: "儲值教學", url: "https://example.com/v" },
      ],
    }).success,
    false,
  );
});
test("URL validation rejects executable URLs and non-YouTube tutorials", () => {
  assert.equal(
    storeSchema.safeParse({ ...doc, aiUrl: "javascript:alert(1)" }).success,
    false,
  );
  assert.equal(
    storeSchema.safeParse({
      ...doc,
      tutorials: [
        { category: "付款", title: "x", url: "https://evil.example/video" },
      ],
    }).success,
    false,
  );
});
test("TTL normalizes stale/future machine status to unknown and stub covers all states", async () => {
  const eq = Array.from({ length: 5 }, (_, i) => ({ id: String(i) }));
  const demo = await new StubMachineStatusProvider().getStatuses(eq);
  assert.deepEqual(
    demo.map((x) => x.status),
    ["idle", "running", "fault", "offline", "unknown"],
  );
  assert.equal(
    normalizeStatus({ ...demo[0], last_updated: "2020-01-01T00:00:00.000Z" })
      .status,
    "unknown",
  );
  assert.equal(
    normalizeStatus({ ...demo[0], last_updated: "2099-01-01T00:00:00.000Z" })
      .status,
    "unknown",
  );
  assert.equal(
    (await new MachineStatusProvider().getStatuses(eq))[0].last_updated,
    null,
  );
});
test("settings reflected publicly and logout revokes session; deleting store works", async () => {
  const c = {
    lineUrl: "https://line.me/example",
    franchiseUrl: "https://example.com/franchise",
  };
  assert.equal((await req("/admin/settings", "PUT", c)).status, 200);
  assert.deepEqual(await (await req("/settings")).json(), c);
  assert.equal((await req("/admin/stores/" + id, "DELETE")).status, 200);
  assert.deepEqual(await (await req("/stores")).json(), []);
  assert.equal((await req("/admin/logout", "POST")).status, 200);
  assert.equal((await req("/admin/session")).status, 401);
});

test("trusted API adapter validates schema, ages timestamps, and fails closed", async () => {
  const equipment = [{ id: "m1", providerKey: "ref" }];
  const raw = {
    machine_id: "m1",
    status: "idle",
    last_updated: new Date().toISOString(),
    ttl_seconds: 60,
    source: "manufacturer",
    simulated: false,
  };
  assert.equal(
    (
      await new ManufacturerApiAdapter(async () => [raw]).getStatuses(equipment)
    )[0].status,
    "idle",
  );
  assert.equal(
    (
      await new ManufacturerApiAdapter(async () => [
        { ...raw, simulated: true },
      ]).getStatuses(equipment)
    )[0].status,
    "unknown",
  );
  assert.equal(
    (
      await new ManufacturerApiAdapter(async () => {
        throw Error("offline");
      }).getStatuses(equipment)
    )[0].status,
    "unknown",
  );
  assert.equal(
    storeSchema.safeParse({
      ...doc,
      tutorials: [{ category: "付款", title: "x", url: "not a URL" }],
    }).success,
    false,
  );
});

test("handoff media paths and equipment metadata validate without exposing private or arbitrary paths", () => {
  const raw = {
    ...doc,
    openingStatus: "planned",
    photos: ["/brand/hualien-store-1.webp"],
    equipment: [
      {
        ...doc.equipment[0],
        number: "01",
        specification: "test spec",
        photos: ["/brand/mcw-wash-dry.webp"],
      },
    ],
  };
  const parsed = storeSchema.safeParse(raw);
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.equipment[0].number, "01");
  assert.equal(
    storeSchema.safeParse({ ...raw, photos: ["/brand/../../.env"] }).success,
    false,
  );
  assert.equal(
    storeSchema.safeParse({ ...raw, photos: ["https://example.com/image.jpg"] })
      .success,
    true,
  );
  assert.equal(
    storeSchema.safeParse({
      ...raw,
      photos: ["https://user:secret@example.com/image.jpg"],
    }).success,
    false,
  );
  const status = {
    machine_id: "m1",
    status: "running",
    last_updated: new Date().toISOString(),
    ttl_seconds: 60,
    source: "manufacturer",
    simulated: false,
    remaining_seconds: 120,
  };
  assert.equal(normalizeStatus(status).remaining_seconds, 120);
  assert.equal(
    normalizeStatus({ ...status, last_updated: "2020-01-01T00:00:00.000Z" })
      .remaining_seconds,
    null,
  );
});

test("owner-provided stores seed once, retain exact addresses, and do not invent coordinates or resurrect deletions", () => {
  const path = mkdtempSync(join(tmpdir(), "mcw-seed-test-"));
  const seeded = openDb(path);
  try {
    seedKnownStores(seeded);
    const rows = seeded
      .prepare("SELECT id,document FROM stores ORDER BY id")
      .all();
    assert.equal(rows.length, 15);
    const docs = rows.map((r) => ({ id: r.id, ...JSON.parse(r.document) }));
    const byAddress = new Map(docs.map((s) => [s.address, s]));
    assert.equal(byAddress.get("屏東縣新園鄉仙吉路32號").name, "魔彩自助洗衣・屏東新園店");
    assert.equal(byAddress.get("高雄市三民區大豐一路26號").name, "魔彩自助洗衣・高雄大豐店");
    assert.deepEqual(
      [
        "桃園-民生洗衣（衣美專家）",
        "關廟店",
        "屏東-德豐洗衣（寶朕盈）",
        "屏東-廣東南洗衣",
        "鳳山-福誠洗衣",
        "大寮-鳳林洗衣",
        "萬丹-香社洗衣",
        "大寮-非凡洗衣",
        "屏東-大連洗衣",
        "鳳山-武營洗衣",
        "前鎮-賢明（淨衣閣）",
        "保長店",
        "台中嶺東店",
      ].map((name) => docs.find((s) => s.name === name)?.address),
      [
        "桃園市民生路860號",
        "台南市關廟區中正路1029號",
        "屏東市德豐街142號",
        "屏東市廣東南路73號",
        "高雄市鳳山區福誠三街16號",
        "大寮區鳳林三路29號",
        "屏東縣萬丹鄉中興路一段111號",
        "高雄市大寮區鳳林三路105巷24弄19號",
        "屏東市大連路32-4號",
        "高雄市鳳山區武營路228號",
        "高雄市前鎮區賢明路19號",
        "新北市汐止區保長路19巷1號",
        "臺中市南屯區永春南路61巷18號",
      ],
    );
    assert.equal(byAddress.get("大寮區鳳林三路29號").city, "高雄市");
    assert.equal(byAddress.get("臺中市南屯區永春南路61巷18號").city, "臺中市");
    assert.ok(
      docs.every(
        (s) =>
          s.lat === null &&
          s.lng === null &&
          s.confirmed &&
          s.published &&
          s.openingStatus === "open" &&
          s.phone === "" &&
          s.hours === "24小時" &&
          s.photos.length === 0 &&
          s.equipment.length === 0,
      ),
    );
    const removed = docs.find((s) => s.name === "關廟店");
    const kept = docs.find((s) => s.address === "高雄市三民區大豐一路26號");
    seeded.prepare("DELETE FROM stores WHERE id=?").run(removed.id);
    const edited = { ...kept, hours: "總部更新" };
    delete edited.id;
    seeded
      .prepare("UPDATE stores SET document=? WHERE id=?")
      .run(JSON.stringify(edited), kept.id);
    seedKnownStores(seeded);
    assert.equal(seeded.prepare("SELECT count(*) AS n FROM stores").get().n, 14);
    assert.equal(
      seeded.prepare("SELECT id FROM stores WHERE id=?").get(removed.id),
      undefined,
    );
    assert.equal(
      JSON.parse(
        seeded.prepare("SELECT document FROM stores WHERE id=?").get(kept.id)
          .document,
      ).hours,
      "總部更新",
    );
    const legacyPath = mkdtempSync(join(tmpdir(), "mcw-seed-legacy-"));
    const legacy = openDb(legacyPath);
    try {
      legacy
        .prepare("INSERT INTO bootstrap_records VALUES(?,?)")
        .run("owner-provided-stores-v1", new Date().toISOString());
      for (const address of ["屏東縣新園鄉仙吉路32號", "高雄市三民區大豐一路26號"]) {
        const current = byAddress.get(address);
        const { id, ...document } = current;
        if (address.endsWith("32號")) document.hours = "總部已改";
        legacy
          .prepare("INSERT INTO stores VALUES(?,?,?)")
          .run(id, JSON.stringify(document), new Date().toISOString());
      }
      seedKnownStores(legacy);
      assert.equal(legacy.prepare("SELECT count(*) AS n FROM stores").get().n, 15);
      assert.equal(
        JSON.parse(
          legacy
            .prepare("SELECT document FROM stores WHERE id=?")
            .get(byAddress.get("屏東縣新園鄉仙吉路32號").id).document,
        ).hours,
        "總部已改",
      );
      assert.equal(
        JSON.parse(
          legacy
            .prepare(
              "SELECT document FROM stores WHERE json_extract(document,'$.name')=?",
            )
            .get("大寮-鳳林洗衣").document,
        ).address,
        "大寮區鳳林三路29號",
      );
    } finally {
      legacy.close();
      rmSync(legacyPath, { recursive: true, force: true });
    }
    assert.equal(
      storeSchema.safeParse({ ...doc, lat: null, lng: 121 }).success,
      false,
    );
    assert.equal(
      storeSchema.safeParse({ ...doc, lat: null, lng: null }).success,
      true,
    );
  } finally {
    seeded.close();
    rmSync(path, { recursive: true, force: true });
  }
});

test("verified coordinates fill only blank matching addresses and keep the Dafeng pin", () => {
  const path = mkdtempSync(join(tmpdir(), "mcw-coord-test-"));
  const db = openDb(path);
  try {
    seedKnownStores(db);
    const before = db
      .prepare("SELECT id,document FROM stores")
      .all()
      .map((row) => ({ id: row.id, ...JSON.parse(row.document) }));
    const dafeng = before.find((store) => store.address === "高雄市三民區大豐一路26號");
    const xinyuan = before.find((store) => store.address === "屏東縣新園鄉仙吉路32號");
    dafeng.lat = 22.6544477;
    dafeng.lng = 120.3315108;
    dafeng.hours = "總部時段";
    const dafengDoc = { ...dafeng };
    delete dafengDoc.id;
    db.prepare("UPDATE stores SET document=? WHERE id=?").run(
      JSON.stringify(dafengDoc),
      dafeng.id,
    );
    xinyuan.address = "總部改過的地址";
    const moved = { ...xinyuan };
    delete moved.id;
    db.prepare("UPDATE stores SET document=? WHERE id=?").run(
      JSON.stringify(moved),
      xinyuan.id,
    );
    db.prepare("DELETE FROM stores WHERE id=?").run(
      before.find((store) => store.name === "關廟店").id,
    );
    assert.equal(applyVerifiedCoordinates(db), 12);
    const after = db
      .prepare("SELECT id,document FROM stores")
      .all()
      .map((row) => ({ id: row.id, ...JSON.parse(row.document) }));
    const kept = after.find((store) => store.id === dafeng.id);
    assert.equal(kept.lat, 22.6544477);
    assert.equal(kept.lng, 120.3315108);
    assert.equal(kept.hours, "總部時段");
    const changed = after.find((store) => store.id === xinyuan.id);
    assert.equal(changed.address, "總部改過的地址");
    assert.equal(changed.lat, null);
    assert.equal(after.some((store) => store.name === "關廟店"), false);
    assert.ok(
      after
        .filter((store) => store.id !== dafeng.id && store.id !== xinyuan.id)
        .every((store) => typeof store.lat === "number" && typeof store.lng === "number"),
    );
    assert.equal(applyVerifiedCoordinates(db), 0);
  } finally {
    db.close();
    rmSync(path, { recursive: true, force: true });
  }
});

test("map requests retain origin attribution without leaking store query parameters", async () => {
  const r = await req("/stores");
  assert.equal(
    r.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
});

test("operating defaults fill only blank hours and unknown status once", () => {
  const path = mkdtempSync(join(tmpdir(), "mcw-hours-test-"));
  const db = openDb(path);
  try {
    seedKnownStores(db);
    const rows = db.prepare("SELECT id, document FROM stores").all();
    const wuying = rows.find((row) => row.id === "mcw-kaohsiung-fengshan-wuying-228");
    const custom = rows.find((row) => row.id !== wuying.id);
    const removed = rows.find((row) => row.id !== wuying.id && row.id !== custom.id);
    const legacy = JSON.parse(wuying.document);
    legacy.hours = "";
    legacy.openingStatus = "unknown";
    legacy.ownerNote = "保留";
    legacy.reviewUrl = "https://maps.app.goo.gl/BUQj9nudUjPNoFSc7?g_st=ic";
    legacy.announcement = "總部公告";
    db.prepare("UPDATE stores SET document=? WHERE id=?").run(JSON.stringify(legacy), wuying.id);
    const kept = JSON.parse(custom.document);
    kept.hours = "總部時段";
    kept.openingStatus = "planned";
    kept.reviewUrl = "https://example.com/owner-review";
    db.prepare("UPDATE stores SET document=? WHERE id=?").run(JSON.stringify(kept), custom.id);
    db.prepare("DELETE FROM stores WHERE id=?").run(removed.id);
    const filled = applyStoreOperatingDefaults(db);
    assert.equal(filled.hours >= 1, true);
    assert.equal(filled.opening >= 1, true);
    const afterWuying = JSON.parse(db.prepare("SELECT document FROM stores WHERE id=?").get(wuying.id).document);
    assert.equal(afterWuying.hours, "24小時");
    assert.equal(afterWuying.openingStatus, "open");
    assert.equal(afterWuying.ownerNote, "保留");
    assert.equal(afterWuying.reviewUrl, "https://maps.app.goo.gl/BUQj9nudUjPNoFSc7?g_st=ic");
    assert.equal(afterWuying.announcement, "總部公告");
    assert.equal(afterWuying.name, "鳳山-武營洗衣");
    assert.equal(afterWuying.address, "高雄市鳳山區武營路228號");
    assert.equal(afterWuying.machineQueryUrl || "", "");
    const afterCustom = JSON.parse(db.prepare("SELECT document FROM stores WHERE id=?").get(custom.id).document);
    assert.equal(afterCustom.hours, "總部時段");
    assert.equal(afterCustom.openingStatus, "planned");
    assert.equal(afterCustom.reviewUrl, "https://example.com/owner-review");
    assert.equal(afterCustom.name, kept.name);
    assert.equal(db.prepare("SELECT id FROM stores WHERE id=?").get(removed.id), undefined);
    afterWuying.hours = "";
    db.prepare("UPDATE stores SET document=? WHERE id=?").run(JSON.stringify(afterWuying), wuying.id);
    assert.deepEqual(applyStoreOperatingDefaults(db), { hours: 0, opening: 0 });
    assert.equal(JSON.parse(db.prepare("SELECT document FROM stores WHERE id=?").get(wuying.id).document).hours, "");
    seedKnownStores(db);
    assert.equal(JSON.parse(db.prepare("SELECT document FROM stores WHERE id=?").get(custom.id).document).hours, "總部時段");
  } finally {
    db.close();
    rmSync(path, { recursive: true, force: true });
  }
});

test("machine counts and query links stay per store and reject invalid quantities", async () => {
  const path = mkdtempSync(join(tmpdir(), "mcw-counts-test-"));
  const db = openDb(path);
  let server;
  try {
    seedKnownStores(db);
    applyStoreOperatingDefaults(db);
    const raw = db.prepare("SELECT document FROM stores").all().map((row) => row.document).join("\n");
    assert.equal(raw.includes("liff.line.me"), false);
    assert.equal(raw.includes("count:洗脫烘:12"), false);
    const app = createApp({
      db,
      dataDir: path,
      adminUser: "hq",
      adminPassword: "test-only-password-123456",
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const origin = "http://127.0.0.1:" + server.address().port;
    const login = await fetch(origin + "/api/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "hq", password: "test-only-password-123456" }),
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const id = "mcw-kaohsiung-fengshan-wuying-228";
    const current = JSON.parse(db.prepare("SELECT document FROM stores WHERE id=?").get(id).document);
    const count = {
      id: "count:洗脫烘:16",
      type: "洗脫烘",
      capacity: "16KG",
      quantity: 5,
      model: "",
      price: "",
    };
    const saved = await fetch(origin + "/api/admin/stores/" + id, {
      method: "PUT",
      headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...current,
        machineQueryMode: "button",
        machineQueryUrl: "https://liff.line.me/2008703133-cY6Q4zpY",
        equipment: [count],
      }),
    });
    assert.equal(saved.status, 200);
    const stored = JSON.parse(db.prepare("SELECT document FROM stores WHERE id=?").get(id).document);
    assert.equal(stored.name, current.name);
    assert.equal(stored.address, current.address);
    assert.equal(stored.hours, current.hours);
    assert.equal(stored.lat, current.lat);
    assert.equal(stored.lng, current.lng);
    assert.equal(stored.reviewUrl, "");
    assert.equal(stored.equipment.length, 1);
    assert.equal(stored.equipment[0].quantity, 5);
    const published = await (await fetch(origin + "/api/stores")).json();
    assert.equal(published.length, 15);
    for (const store of published) {
      if (store.id === id) {
        assert.equal(store.machineQueryUrl, "https://liff.line.me/2008703133-cY6Q4zpY");
        assert.deepEqual(catalogChips(store.equipment).map((chip) => chip.label), ["洗脫烘 16KG｜5台"]);
      } else {
        assert.equal(store.machineQueryUrl, "");
        assert.equal(store.equipment.length, 0);
        assert.equal(store.hours, "24小時");
        assert.equal(store.openingStatus, "open");
      }
    }
    assert.equal(storeSchema.safeParse({ ...doc, equipment: [{ ...doc.equipment[0], quantity: 0 }] }).success, false);
    assert.equal(storeSchema.safeParse({ ...doc, equipment: [{ ...doc.equipment[0], quantity: 1.5 }] }).success, false);
    assert.equal(storeSchema.safeParse({ ...doc, equipment: [{ ...doc.equipment[0], quantity: -1 }] }).success, false);
    assert.equal(storeSchema.safeParse({
      ...doc,
      equipment: [{ ...count, id: "count:洗脫烘:12", capacity: "12KG", type: "洗脫烘" }],
    }).success, false);
    assert.equal(storeSchema.safeParse({
      ...doc,
      machineQueryUrl: "javascript:alert(1)",
    }).success, false);
    assert.equal(publicMachineQueryUrl({ provider: "demo", machineQueryMode: "button", machineQueryUrl: "https://example.com/machines" }), "");
    assert.equal(publicMachineQueryUrl({ provider: "unconnected", machineQueryMode: "off", machineQueryUrl: "https://example.com/machines" }), "");
    assert.equal(publicMachineQueryUrl({ provider: "unconnected", machineQueryMode: "button", machineQueryUrl: "" }), "");
    const hidden = publicStore({
      id: "other",
      ...doc,
      provider: "demo",
      machineQueryMode: "button",
      machineQueryUrl: "https://example.com/machines",
    });
    assert.equal(hidden.machineQueryUrl, "");
    assert.equal(hidden.machineQueryMode, undefined);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(path, { recursive: true, force: true });
  }
});

test('official LINE is initialized once without overwriting later headquarters settings',()=>{
 const path=mkdtempSync(join(tmpdir(),'mcw-line-test-'));let local=openDb(path);
 try{
  assert.equal(JSON.parse(local.prepare('SELECT document FROM settings WHERE id=1').get().document).lineUrl,'https://lin.ee/s4v3cIG');
  local.prepare('UPDATE settings SET document=? WHERE id=1').run(JSON.stringify({lineUrl:'https://line.me/updated-by-hq',franchiseUrl:'https://example.com/contact'}));local.close();local=openDb(path);
  assert.equal(JSON.parse(local.prepare('SELECT document FROM settings WHERE id=1').get().document).lineUrl,'https://line.me/updated-by-hq');
 }finally{local.close();rmSync(path,{recursive:true,force:true})}
});
