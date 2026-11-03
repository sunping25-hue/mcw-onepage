import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { openDb } from "../server/db.js";
import { createApp } from "../server/app.js";
import { seedKnownStores } from "../server/seed.js";
import {
  MachineStatusProvider,
  ManufacturerApiAdapter,
  StubMachineStatusProvider,
  normalizeStatus,
  storeSchema,
} from "../server/model.js";
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
    assert.equal(rows.length, 2);
    const docs = rows.map((r) => JSON.parse(r.document));
    assert.deepEqual(
      new Set(docs.map((s) => s.address)),
      new Set(["屏東縣新園鄉仙吉路32號", "高雄市三民區大豐一路26號"]),
    );
    assert.ok(
      docs.every(
        (s) =>
          s.lat === null &&
          s.lng === null &&
          s.confirmed &&
          s.published &&
          s.openingStatus === "unknown" &&
          s.phone === "",
      ),
    );
    seeded.prepare("DELETE FROM stores WHERE id=?").run(rows[0].id);
    const edited = { ...docs[1], hours: "總部更新" };
    seeded
      .prepare("UPDATE stores SET document=? WHERE id=?")
      .run(JSON.stringify(edited), rows[1].id);
    seedKnownStores(seeded);
    assert.equal(seeded.prepare("SELECT count(*) AS n FROM stores").get().n, 1);
    assert.equal(
      JSON.parse(seeded.prepare("SELECT document FROM stores").get().document)
        .hours,
      "總部更新",
    );
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

test("map requests retain origin attribution without leaking store query parameters", async () => {
  const r = await req("/stores");
  assert.equal(
    r.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
});

test('official LINE is initialized once without overwriting later headquarters settings',()=>{
 const path=mkdtempSync(join(tmpdir(),'mcw-line-test-'));let local=openDb(path);
 try{
  assert.equal(JSON.parse(local.prepare('SELECT document FROM settings WHERE id=1').get().document).lineUrl,'https://lin.ee/s4v3cIG');
  local.prepare('UPDATE settings SET document=? WHERE id=1').run(JSON.stringify({lineUrl:'https://line.me/updated-by-hq',franchiseUrl:'https://example.com/contact'}));local.close();local=openDb(path);
  assert.equal(JSON.parse(local.prepare('SELECT document FROM settings WHERE id=1').get().document).lineUrl,'https://line.me/updated-by-hq');
 }finally{local.close();rmSync(path,{recursive:true,force:true})}
});
