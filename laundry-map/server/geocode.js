// Owner-address lookup against the public Nominatim API. Coordinates are written
// only for one house-level result that matches county/city, district, road and
// house number, and that is not tagged as a different business.

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
// Only the two originally confirmed addresses are queried on startup.
// Later owner-supplied rows stay unlistable as map pins until headquarters asks.
const AUTOMATIC_ADDRESSES = new Set([
  "高雄市三民區大豐一路26號",
  "屏東縣新園鄉仙吉路32號",
]);
const USER_AGENT =
  "MCW-Laundry-Map/1.0 (store geocoding; https://mcw-laundry-map.onrender.com)";
const DEFAULT_RETRY_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MIN_GAP_MS = 10 * 1000;

export function parseTaiwanAddress(address) {
  const match = String(address || "")
    .trim()
    .match(/^(.+?[縣市])(.+?[鄉鎮市區])(.+?(?:路|街|大道|巷))(\d+)號$/);
  if (!match) return null;
  return {
    city: match[1],
    district: match[2],
    road: match[3],
    number: match[4],
  };
}

function normHouse(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/號$/, "")
    .replace(/^0+(?=\d)/, "");
}

function addressMatches(result, parsed) {
  const address = result?.address || {};
  if (result?.category === "highway") return false;
  if (normHouse(address.house_number) !== parsed.number) return false;
  if (!String(address.road || "").includes(parsed.road)) return false;
  const cityOk = ["city", "county", "state", "municipality"].some((key) =>
    String(address[key] || "").includes(parsed.city),
  );
  const districtOk =
    [
      "town",
      "city_district",
      "suburb",
      "village",
      "neighbourhood",
      "quarter",
      "hamlet",
      "borough",
      "municipality",
    ].some((key) => String(address[key] || "").includes(parsed.district)) ||
    String(result.display_name || "").includes(parsed.district);
  const lat = Number(result.lat);
  const lon = Number(result.lon);
  return (
    cityOk &&
    districtOk &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat > 21 &&
    lat < 26 &&
    lon > 118 &&
    lon < 123
  );
}

function businessLabels(result, parsed) {
  const address = result?.address || {};
  return [result?.name, address.shop, address.amenity, address.office, address.tourism, address.leisure]
    .map((value) => String(value || "").trim())
    .filter(
      (value) =>
        value &&
        value !== parsed.road &&
        value !== parsed.city &&
        value !== parsed.district,
    );
}

function nameConflicts(result, storeName, parsed) {
  const names = businessLabels(result, parsed);
  if (!names.length) return false;
  return !names.every(
    (name) =>
      name.includes("魔彩") ||
      name.includes("自助洗衣") ||
      (storeName && name.includes(storeName)),
  );
}

function messageFor(outcome, detail) {
  const text = {
    success: "已寫入與門牌相符的唯一座標",
    conflict: "地址結果標成其他店名，未寫入座標",
    no_match: "沒有唯一且門牌相符的結果，未寫入座標",
    ambiguous: "相符結果不只一處，未寫入座標",
    http_error: "地址服務沒有成功回應，未寫入座標",
    timeout: "地址查詢逾時，未寫入座標",
    error: "地址查詢未完成，未寫入座標",
    unparsed: "地址無法拆成縣市、鄉鎮市區、路名與門牌，未送出查詢",
    kept: "門市已有座標，未覆寫",
    backoff: "距離上次查詢尚短，未再次送出",
    rate_limited: "查詢間隔過短，請稍後再試",
    unconfirmed: "請先核實門市資料再查詢座標",
    missing: "找不到門市",
  }[outcome] || "未寫入座標";
  return detail ? `${text}。${detail}` : text;
}

function recordAttempt(db, row) {
  db.prepare(
    `INSERT INTO geocode_attempts
      (store_id,address,attempted_at,outcome,http_status,detail,lat,lng)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    row.storeId,
    row.address,
    row.attemptedAt,
    row.outcome,
    row.httpStatus,
    String(row.detail || "").slice(0, 500),
    row.outcome === "success" ? row.lat : null,
    row.outcome === "success" ? row.lng : null,
  );
}

function lastAttempt(db, storeId, address) {
  return address
    ? db
        .prepare(
          `SELECT outcome,attempted_at,address FROM geocode_attempts
           WHERE store_id=? AND address=? ORDER BY id DESC LIMIT 1`,
        )
        .get(storeId, address)
    : db
        .prepare(
          `SELECT outcome,attempted_at,address FROM geocode_attempts
           WHERE store_id=? ORDER BY id DESC LIMIT 1`,
        )
        .get(storeId);
}

function buildSearchUrl(parsed) {
  const url = new URL(NOMINATIM);
  const params = {
    format: "jsonv2",
    addressdetails: "1",
    countrycodes: "tw",
    limit: "5",
    street: `${parsed.road} ${parsed.number}`,
    country: "Taiwan",
  };
  if (parsed.city.endsWith("縣")) params.county = parsed.city;
  else params.city = parsed.city;
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

function classify(results, parsed, storeName) {
  if (!Array.isArray(results)) {
    return {
      outcome: "error",
      detail: "地址服務回應不是結果清單",
      lat: null,
      lng: null,
    };
  }
  const matches = results.filter((result) => addressMatches(result, parsed));
  const conflicts = matches.filter((result) => nameConflicts(result, storeName, parsed));
  const acceptable = matches.filter((result) => !nameConflicts(result, storeName, parsed));
  const unique = [
    ...new Map(
      acceptable.map((result) => [
        `${Number(result.lat).toFixed(5)},${Number(result.lon).toFixed(5)}`,
        result,
      ]),
    ).values(),
  ];
  if (conflicts.length) {
    const label = businessLabels(conflicts[0], parsed)[0] || "其他名稱";
    return {
      outcome: "conflict",
      detail: `OpenStreetMap 將此門牌標為「${label}」，與「${storeName}」不同`,
      lat: null,
      lng: null,
    };
  }
  if (unique.length === 1) {
    const result = unique[0];
    return {
      outcome: "success",
      detail: `相符門牌 ${parsed.road}${parsed.number}號；${result.osm_type || "result"} ${result.osm_id || ""}`.trim(),
      lat: Number(result.lat),
      lng: Number(result.lon),
    };
  }
  if (unique.length > 1) {
    return {
      outcome: "ambiguous",
      detail: `相符座標 ${unique.length} 組`,
      lat: null,
      lng: null,
    };
  }
  return {
    outcome: "no_match",
    detail: `回傳 ${results.length} 筆，沒有同時符合門牌、路名與行政區的結果`,
    lat: null,
    lng: null,
  };
}

/**
 * Look up confirmed stores that still have no coordinates.
 * A bootstrap_records key is not a geocode result and never blocks a later attempt.
 * Failures are stored as failures and can be retried after the backoff. Success is
 * not written when the response is empty, ambiguous, conflicting, or an HTTP error.
 */
export async function locateKnownStores(
  db,
  {
    fetcher = fetch,
    pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = console.log,
    now = () => new Date(),
    retryMs = DEFAULT_RETRY_MS,
    minGapMs = DEFAULT_MIN_GAP_MS,
    limit = 5,
    onlyId = null,
    force = false,
    pauseMs = 1100,
  } = {},
) {
  const rows = db.prepare("SELECT id,document FROM stores ORDER BY id").all();
  if (onlyId && !rows.some((row) => row.id === onlyId)) {
    return [
      {
        storeId: onlyId,
        address: "",
        outcome: "missing",
        httpStatus: null,
        detail: "找不到門市",
        lat: null,
        lng: null,
        message: messageFor("missing"),
      },
    ];
  }
  const attempts = [];
  let requests = 0;
  for (const row of rows) {
    if (onlyId && row.id !== onlyId) continue;
    if (!onlyId && requests >= limit) break;
    const store = JSON.parse(row.document);
    const stamp = now().toISOString();
    const base = {
      storeId: row.id,
      address: store.address || "",
      attemptedAt: stamp,
      httpStatus: null,
      lat: null,
      lng: null,
    };
    if (!force && (!store.confirmed || !store.published)) continue;
    if (!force && !AUTOMATIC_ADDRESSES.has(store.address)) continue;
    if (force && !store.confirmed) {
      attempts.push({
        ...base,
        outcome: "unconfirmed",
        detail: "門市尚未標為已核實",
        message: messageFor("unconfirmed"),
      });
      continue;
    }
    if (store.lat !== null || store.lng !== null) {
      if (onlyId) {
        attempts.push({
          ...base,
          outcome: "kept",
          lat: store.lat,
          lng: store.lng,
          detail: "既有座標保留",
          message: messageFor("kept"),
        });
      }
      continue;
    }
    const previous = lastAttempt(db, row.id, store.address);
    if (!force && previous?.outcome === "success") continue;
    const elapsed = previous ? now() - Date.parse(previous.attempted_at) : Infinity;
    if (!force && previous && elapsed < retryMs) continue;
    if (force && previous && elapsed < minGapMs) {
      attempts.push({
        ...base,
        outcome: "rate_limited",
        detail: "未送出新的地址查詢",
        message: messageFor("rate_limited"),
      });
      continue;
    }
    const parsed = parseTaiwanAddress(store.address);
    if (!parsed) {
      const attempt = {
        ...base,
        outcome: "unparsed",
        detail: "需要「縣市＋鄉鎮市區＋路街＋門牌號」",
        message: messageFor("unparsed"),
      };
      recordAttempt(db, attempt);
      attempts.push(attempt);
      continue;
    }
    let outcome = "error";
    let detail = "地址查詢未完成";
    let httpStatus = null;
    let lat = null;
    let lng = null;
    let sent = false;
    try {
      const response = await fetcher(buildSearchUrl(parsed), {
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "zh-TW",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(12000),
      });
      sent = true;
      httpStatus = response.status;
      if (!response.ok) {
        outcome = "http_error";
        detail = `HTTP ${response.status}`;
      } else {
        const payload = await response.json();
        if (payload && !Array.isArray(payload) && payload.error) {
          outcome = "error";
          detail = String(payload.error).slice(0, 200);
        } else {
          const classified = classify(payload, parsed, store.name);
          outcome = classified.outcome;
          detail = classified.detail;
          lat = classified.lat;
          lng = classified.lng;
        }
      }
    } catch (error) {
      sent = true;
      const timedOut = /timeout|aborted/i.test(error?.name || "") || /timeout/i.test(error?.message || "");
      outcome = timedOut ? "timeout" : "error";
      detail = String(error?.message || "地址查詢失敗").slice(0, 200);
    }
    if (outcome === "success") {
      const current = db.prepare("SELECT document FROM stores WHERE id=?").get(row.id);
      if (!current) {
        outcome = "missing";
        detail = "查詢完成前門市已刪除";
        lat = null;
        lng = null;
      } else {
        const latest = JSON.parse(current.document);
        if (latest.address !== store.address || latest.lat !== null || latest.lng !== null) {
          outcome = "kept";
          detail = "查詢期間總部已修改地址或座標，未覆寫";
          lat = null;
          lng = null;
        } else {
          latest.lat = lat;
          latest.lng = lng;
          db.prepare("UPDATE stores SET document=?,updated_at=? WHERE id=?").run(
            JSON.stringify(latest),
            stamp,
            row.id,
          );
        }
      }
    }
    const attempt = {
      ...base,
      outcome,
      httpStatus,
      detail,
      lat: outcome === "success" ? lat : null,
      lng: outcome === "success" ? lng : null,
      message: messageFor(outcome, detail),
    };
    if (sent) requests += 1;
    recordAttempt(db, attempt);
    attempts.push(attempt);
    log(
      outcome === "success"
        ? `門市地址定位完成：${store.address}`
        : `門市地址定位未寫入座標：${store.address}；${outcome}；${detail}`,
    );
    await pause(pauseMs);
  }
  return attempts;
}
