import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../server/db.js";
import { seedKnownStores } from "../server/seed.js";
import { locateKnownStores } from "../server/geocode.js";

const dafeng = JSON.parse(
  readFileSync(new URL("./fixtures/nominatim-dafeng.json", import.meta.url), "utf8"),
);
const xinyuan = JSON.parse(
  readFileSync(new URL("./fixtures/nominatim-xinyuan.json", import.meta.url), "utf8"),
);

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "mcw-geocode-"));
  const db = openDb(dir);
  seedKnownStores(db);
  return {
    dir,
    db,
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function store(db, city) {
  return db
    .prepare("SELECT id,document FROM stores")
    .all()
    .map((row) => ({ id: row.id, ...JSON.parse(row.document) }))
    .find((row) => row.city === city);
}

test("structured lookup saves one exact house and does not retry a recorded failure immediately", async () => {
  const ctx = setup();
  try {
    let calls = 0;
    const headers = [];
    await locateKnownStores(ctx.db, {
      pause: async () => {},
      log: () => {},
      fetcher: async (url, options) => {
        calls += 1;
        headers.push(options.headers);
        assert.equal(url.hostname, "nominatim.openstreetmap.org");
        assert.equal(url.searchParams.get("q"), null);
        assert.equal(url.searchParams.get("countrycodes"), "tw");
        const street = url.searchParams.get("street");
        if (street === "大豐一路 26") {
          assert.equal(url.searchParams.get("city"), "高雄市");
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                lat: "22.65000",
                lon: "120.32000",
                category: "place",
                address: {
                  house_number: "26",
                  road: "大豐一路",
                  suburb: "三民區",
                  city: "高雄市",
                },
              },
            ],
          };
        }
        assert.equal(street, "仙吉路 32");
        assert.equal(url.searchParams.get("county"), "屏東縣");
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              lat: "22.50000",
              lon: "120.40000",
              category: "place",
              address: {
                house_number: "99",
                road: "仙吉路",
                town: "新園鄉",
                county: "屏東縣",
              },
            },
          ],
        };
      },
    });
    assert.equal(store(ctx.db, "高雄市").lat, 22.65);
    assert.equal(store(ctx.db, "屏東縣").lat, null);
    assert.equal(
      ctx.db
        .prepare(
          "SELECT outcome FROM geocode_attempts WHERE store_id=? ORDER BY id DESC LIMIT 1",
        )
        .get(store(ctx.db, "屏東縣").id).outcome,
      "no_match",
    );
    assert.equal(
      ctx.db.prepare("SELECT count(*) AS n FROM bootstrap_records WHERE key LIKE 'geocode-attempt-v1:%'").get().n,
      0,
    );
    assert.match(headers[0]["User-Agent"], /MCW-Laundry-Map/);
    await locateKnownStores(ctx.db, {
      pause: async () => {},
      fetcher: async () => {
        throw Error("must not repeat");
      },
    });
    assert.equal(calls, 2);
  } finally {
    ctx.close();
  }
});

test("real Nominatim payloads keep the Kaohsiung house and reject the Xinyuan supermarket", async () => {
  const ctx = setup();
  try {
    const attempts = await locateKnownStores(ctx.db, {
      pause: async () => {},
      log: () => {},
      fetcher: async (url) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.searchParams.get("street").includes("大豐一路") ? dafeng : xinyuan,
      }),
    });
    const kaohsiung = store(ctx.db, "高雄市");
    const pingtung = store(ctx.db, "屏東縣");
    assert.equal(kaohsiung.lat, Number("22.6544477"));
    assert.equal(kaohsiung.lng, Number("120.3315108"));
    assert.notEqual(kaohsiung.lat, Number("22.6570269"));
    assert.equal(pingtung.lat, null);
    assert.equal(pingtung.lng, null);
    assert.equal(attempts.find((row) => row.storeId === pingtung.id).outcome, "conflict");
    assert.match(attempts.find((row) => row.storeId === pingtung.id).detail, /全聯福利中心/);
    const saved = ctx.db
      .prepare("SELECT lat,lng,outcome FROM geocode_attempts WHERE store_id=? AND outcome='conflict'")
      .get(pingtung.id);
    assert.equal(saved.lat, null);
    assert.equal(saved.lng, null);
  } finally {
    ctx.close();
  }
});

test("HTTP failures stay retryable and a prewritten attempt key does not block lookup", async () => {
  const ctx = setup();
  try {
    const kaohsiungId = store(ctx.db, "高雄市").id;
    ctx.db
      .prepare("INSERT INTO bootstrap_records VALUES(?,?)")
      .run("geocode-attempt-v1:" + kaohsiungId, new Date().toISOString());
    let calls = 0;
    await locateKnownStores(ctx.db, {
      pause: async () => {},
      log: () => {},
      onlyId: kaohsiungId,
      fetcher: async () => {
        calls += 1;
        return { ok: false, status: 429, json: async () => ({}) };
      },
    });
    assert.equal(store(ctx.db, "高雄市").lat, null);
    assert.equal(
      ctx.db.prepare("SELECT outcome,http_status,lat FROM geocode_attempts").get().outcome,
      "http_error",
    );
    assert.equal(ctx.db.prepare("SELECT http_status FROM geocode_attempts").get().http_status, 429);
    assert.equal(ctx.db.prepare("SELECT lat FROM geocode_attempts").get().lat, null);
    await locateKnownStores(ctx.db, {
      pause: async () => {},
      onlyId: kaohsiungId,
      fetcher: async () => {
        throw Error("backoff");
      },
    });
    assert.equal(calls, 1);
    const saved = await locateKnownStores(ctx.db, {
      pause: async () => {},
      log: () => {},
      retryMs: 0,
      onlyId: kaohsiungId,
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => dafeng,
      }),
    });
    assert.equal(saved[0].outcome, "success");
    assert.equal(store(ctx.db, "高雄市").lat, Number("22.6544477"));
    assert.equal(store(ctx.db, "屏東縣").lat, null);
  } finally {
    ctx.close();
  }
});

test("ambiguous houses and cleared coordinates are not treated as success", async () => {
  const ctx = setup();
  try {
    const id = store(ctx.db, "高雄市").id;
    const attempts = await locateKnownStores(ctx.db, {
      pause: async () => {},
      log: () => {},
      onlyId: id,
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => [
          dafeng[0],
          { ...dafeng[0], lat: "22.65490", lon: "120.33210", osm_id: 2 },
        ],
      }),
    });
    assert.equal(attempts[0].outcome, "ambiguous");
    assert.equal(store(ctx.db, "高雄市").lat, null);
    ctx.db.prepare("DELETE FROM geocode_attempts").run();
    await locateKnownStores(ctx.db, {
      pause: async () => {},
      log: () => {},
      onlyId: id,
      fetcher: async () => ({ ok: true, status: 200, json: async () => [dafeng[0]] }),
    });
    const document = JSON.parse(ctx.db.prepare("SELECT document FROM stores WHERE id=?").get(id).document);
    document.lat = null;
    document.lng = null;
    ctx.db.prepare("UPDATE stores SET document=? WHERE id=?").run(JSON.stringify(document), id);
    await locateKnownStores(ctx.db, {
      pause: async () => {},
      onlyId: id,
      fetcher: async () => {
        throw Error("success record must block automatic refill");
      },
    });
    assert.equal(store(ctx.db, "高雄市").lat, null);
  } finally {
    ctx.close();
  }
});
