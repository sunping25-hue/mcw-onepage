import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
const icon = L.divIcon({
  className: "pin",
  html: "<span>MCW</span>",
  iconSize: [42, 42],
  iconAnchor: [21, 42],
});
async function api(path, options = {}) {
  const r = await fetch("/api" + path, {
    ...options,
    headers:
      options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" },
    credentials: "same-origin",
  });
  let d;
  try {
    d = await r.json();
  } catch {
    d = { error: "伺服器暫時無法回應" };
  }
  if (!r.ok) throw new Error(d.error || "請求失敗");
  return d;
}
const emptyStore = () => ({
  name: "",
  city: "",
  address: "",
  phone: "",
  hours: "",
  announcement: "",
  lat: null,
  lng: null,
  confirmed: false,
  published: false,
  photos: [],
  equipment: [],
  tutorials: [],
  aiUrl: "",
  reviewUrl: "",
  franchiseUrl: "",
  provider: "unconnected",
  providerReference: "",
});
function LinkButton({ url, children }) {
  return url ? (
    <a className="button" href={url} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  ) : (
    <span className="button disabled" aria-disabled="true">
      {children}・尚未設定
    </span>
  );
}
function Fit({ points, focus }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.setView(focus, 14, { animate: false });
    else if (points.length)
      map.fitBounds(
        points.map((s) => [s.lat, s.lng]),
        { padding: [45, 45], maxZoom: 14, animate: false },
      );
    else map.setView([23.7, 121], 7, { animate: false });
  }, [
    JSON.stringify(points.map((p) => [p.id, p.lat, p.lng])),
    JSON.stringify(focus),
  ]);
  return null;
}
function MapView({ stores, onSelect, focus }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useEffect(() => {
    const fn = () => setZoom(map.getZoom());
    map.on("zoomend", fn);
    return () => map.off("zoomend", fn);
  }, [map]);
  const groups = new Map();
  const cell = zoom < 10 ? 1 : zoom < 13 ? 0.05 : 0;
  stores.forEach((s) => {
    const k = cell
      ? `${Math.floor(s.lat / cell)},${Math.floor(s.lng / cell)}`
      : s.id;
    groups.set(k, [...(groups.get(k) || []), s]);
  });
  return (
    <>
      {[...groups.values()].map((g) =>
        g.length > 1 ? (
          <Marker
            key={g[0].id}
            position={[
              g.reduce((a, s) => a + s.lat, 0) / g.length,
              g.reduce((a, s) => a + s.lng, 0) / g.length,
            ]}
            icon={L.divIcon({
              className: "cluster",
              html: String(g.length),
              iconSize: [44, 44],
            })}
            eventHandlers={{
              click: () =>
                map.fitBounds(
                  g.map((s) => [s.lat, s.lng]),
                  { padding: [35, 35], maxZoom: 18, animate: false },
                ),
            }}
            title={`${g.length} 間門市，點選展開`}
          />
        ) : (
          <Marker
            key={g[0].id}
            position={[g[0].lat, g[0].lng]}
            icon={icon}
            eventHandlers={{ click: () => onSelect(g[0]) }}
            title={g[0].name}
          />
        ),
      )}
      <Fit points={stores} focus={focus} />
    </>
  );
}
const distance = (a, b) => {
  const r = Math.PI / 180;
  const dlat = (b.lat - a.lat) * r,
    dlng = (b.lng - a.lng) * r;
  return (
    6371 *
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin(dlat / 2) ** 2 +
          Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlng / 2) ** 2,
      ),
    )
  );
};
function StoreDetail({ store: s, settings, onBack, saved, toggle }) {
  const [statuses, setStatuses] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const load = () =>
      api(`/stores/${s.id}/status`)
        .then((d) => {
          if (live) {
            setStatuses(d);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    load();
    const timer = setInterval(load, 60000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [s.id]);
  return (
    <section className="detail">
      <button className="text-button" onClick={onBack}>
        ← 返回地圖
      </button>
      <div className="photos">
        {s.photos.length ? (
          s.photos.map((p, i) => (
            <img src={p} key={p} alt={`${s.name} 門市照片 ${i + 1}`} />
          ))
        ) : (
          <div className="photo-empty">門市照片待總部補充</div>
        )}
      </div>
      <p className="eyebrow">MCW LAUNDRY / {s.city}</p>
      <h1>{s.name}</h1>
      <button onClick={toggle}>{saved ? "♥ 已收藏" : "♡ 收藏門市"}</button>
      <p>{s.address}</p>
      <p>營業時間：{s.hours || "待總部確認"}</p>
      <p>
        {s.phone ? (
          <a href={"tel:" + s.phone}>☎ {s.phone}</a>
        ) : (
          "電話待總部確認"
        )}
      </p>
      {s.announcement && <aside>{s.announcement}</aside>}
      <div className="actions">
        <LinkButton
          url={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}
        >
          Google Maps 導航
        </LinkButton>
        <LinkButton url={`https://maps.apple.com/?daddr=${s.lat},${s.lng}`}>
          Apple 地圖導航
        </LinkButton>
        <LinkButton url={s.reviewUrl}>Google 評價</LinkButton>
        <LinkButton url={s.aiUrl}>AI 智慧店長</LinkButton>
      </div>
      <h2>店內設備</h2>
      <p className="notice">即時資訊尚未串接 · 不提供空機數或倒數預估</p>
      {error && <p role="alert">{error}</p>}
      {!s.equipment.length && <p>設備資料待總部補充。</p>}
      {s.equipment.map((e) => (
        <article className="equipment" key={e.id}>
          <div>
            <h3>
              {e.type} · {e.capacity || "容量待確認"}
            </h3>
            <p>
              {e.model || "型號待確認"} · {e.quantity} 台
            </p>
            <small>設備 ID：{e.id}</small>
          </div>
          <div>
            <strong>{e.price || "費率待確認"}</strong>
            <p className="status">
              {statuses.find((x) => x.machine_id === e.id)?.status === "offline"
                ? "離線"
                : "未知／未連線"}
            </p>
          </div>
        </article>
      ))}
      <h2>YouTube 操作教學</h2>
      {s.tutorials.length ? (
        s.tutorials.map((t, i) => (
          <LinkButton key={i} url={t.url}>
            {t.category} · {t.title}
          </LinkButton>
        ))
      ) : (
        <p>本店尚未配置操作教學影片。</p>
      )}
      <h2>一起經營好生活</h2>
      <LinkButton url={s.franchiseUrl || settings.franchiseUrl}>
        詢問洗衣加盟
      </LinkButton>
    </section>
  );
}
function PublicApp() {
  const [stores, setStores] = useState([]),
    [settings, setSettings] = useState({}),
    [tab, setTab] = useState("near"),
    [query, setQuery] = useState(""),
    [city, setCity] = useState(""),
    [selected, setSelected] = useState(null),
    [location, setLocation] = useState(null),
    [geoMsg, setGeoMsg] = useState(""),
    [error, setError] = useState(""),
    [tileError, setTileError] = useState(false),
    [loading, setLoading] = useState(true),
    [favorite, setFavorite] = useState(() => {
      try {
        const x = JSON.parse(localStorage.getItem("mcw-favorites") || "[]");
        return Array.isArray(x) ? x : [];
      } catch {
        return [];
      }
    });
  const load = () => {
    setLoading(true);
    Promise.all([api("/stores"), api("/settings")])
      .then(([s, c]) => {
        setStores(s);
        setSettings(c);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => {
    const fn = () => load();
    window.addEventListener("focus", fn);
    return () => window.removeEventListener("focus", fn);
  }, []);
  const toggle = (id) =>
    setFavorite((old) => {
      const next = old.includes(id)
        ? old.filter((x) => x !== id)
        : [...old, id];
      try {
        localStorage.setItem("mcw-favorites", JSON.stringify(next));
      } catch {}
      return next;
    });
  let filtered = stores.filter(
    (s) =>
      (!city || s.city === city) &&
      (!query ||
        [s.name, s.city, s.address]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (tab !== "favorites" || favorite.includes(s.id)),
  );
  if (location)
    filtered.sort((a, b) => distance(location, a) - distance(location, b));
  function locate() {
    if (!navigator.geolocation) {
      setGeoMsg("瀏覽器不支援定位，請使用縣市或搜尋。");
      return;
    }
    setGeoMsg("定位中…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocation({ lat: p.coords.latitude, lng: p.coords.longitude });
        setGeoMsg("已依距離排序門市");
      },
      () => setGeoMsg("無法取得定位；你仍可選縣市或搜尋門市。"),
      { timeout: 10000, maximumAge: 60000 },
    );
  }
  const chosen = stores.find((s) => s.id === selected);
  return (
    <>
      <header>
        <a className="brand" href="/">
          <img src="/brand/logo.webp" alt="MCW 魔彩" />
          <span>
            洗衣地圖<small>LAUNDRY MAP</small>
          </span>
        </a>
        <LinkButton url={settings.lineUrl}>官方 LINE</LinkButton>
      </header>
      <main>
        {chosen ? (
          <StoreDetail
            store={chosen}
            settings={settings}
            onBack={() => setSelected(null)}
            saved={favorite.includes(chosen.id)}
            toggle={() => toggle(chosen.id)}
          />
        ) : (
          <>
            <div className="hero">
              <p className="eyebrow">CLEAN CLOTHES. CLEAR MIND.</p>
              <h1>
                {tab === "tutorials"
                  ? "洗衣，其實很簡單。"
                  : tab === "franchise"
                    ? "把好生活，帶進社區。"
                    : "找到你的洗衣好鄰居。"}
              </h1>
              <p>MCW 魔彩自助洗衣 · 為每一天，留一點輕鬆</p>
            </div>
            {error ? (
              <aside role="alert">
                {error} <button onClick={load}>重新載入</button>
              </aside>
            ) : loading ? (
              <p role="status">載入門市中…</p>
            ) : null}
            {["near", "all", "favorites"].includes(tab) && (
              <>
                <section className="search-panel">
                  <label>
                    搜尋門市
                    <input
                      placeholder="輸入門市、地址或縣市"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <div className="filter-row">
                    <label>
                      縣市
                      <select
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                      >
                        <option value="">全台灣</option>
                        {[...new Set(stores.map((s) => s.city))]
                          .sort()
                          .map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                      </select>
                    </label>
                    <button onClick={locate}>◎ 找離我最近</button>
                    <button
                      onClick={() => {
                        setCity("");
                        setQuery("");
                        setLocation(null);
                        setTab("all");
                      }}
                    >
                      台灣全圖
                    </button>
                  </div>
                  {geoMsg && <p role="status">{geoMsg}</p>}
                </section>
                <div className="map-layout">
                  <section className="map-wrap" aria-label="互動門市地圖">
                    <MapContainer center={[23.7, 121]} zoom={7} scrollWheelZoom>
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        eventHandlers={{ tileerror: () => setTileError(true) }}
                      />
                      <MapView
                        stores={filtered}
                        onSelect={(s) => setSelected(s.id)}
                        focus={location ? [location.lat, location.lng] : null}
                      />
                    </MapContainer>
                  </section>
                  <section className="store-list">
                    {tileError && (
                      <p role="status">
                        地圖底圖暫時無法載入，仍可使用下方門市列表與搜尋。
                      </p>
                    )}
                    <div className="section-heading">
                      <h2>{tab === "favorites" ? "我的收藏" : "探索門市"}</h2>
                      <span>{filtered.length} 間已確認門市</span>
                    </div>
                    {!loading && !filtered.length && (
                      <div className="empty">
                        <span>⌖</span>
                        <h3>
                          {stores.length
                            ? "找不到符合條件的門市"
                            : "門市資料確認中"}
                        </h3>
                        <p>
                          {tab === "favorites"
                            ? "收藏喜歡的門市，下次更快找到。"
                            : "總部確認地址與座標並公開後，門市就會出現在這裡。你也可以調整搜尋條件。"}
                        </p>
                      </div>
                    )}
                    {filtered.map((s) => (
                      <article className="store-card" key={s.id}>
                        {s.photos[0] && <img src={s.photos[0]} alt={s.name} />}
                        <div>
                          <p className="eyebrow">
                            {s.city}
                            {location &&
                              ` · ${distance(location, s).toFixed(1)} km`}
                          </p>
                          <h3>
                            <button
                              className="text-button"
                              onClick={() => setSelected(s.id)}
                            >
                              {s.name} →
                            </button>
                          </h3>
                          <p>{s.address}</p>
                          <small>即時資訊尚未串接</small>
                        </div>
                        <button
                          aria-label={"收藏 " + s.name}
                          aria-pressed={favorite.includes(s.id)}
                          onClick={() => toggle(s.id)}
                        >
                          {favorite.includes(s.id) ? "♥" : "♡"}
                        </button>
                      </article>
                    ))}
                  </section>
                </div>
              </>
            )}
            {tab === "tutorials" && (
              <section className="content-panel">
                <p className="eyebrow">MCW HOW-TO</p>
                <h2>你的洗衣小幫手</h2>
                {["洗脫烘", "雙層烘", "付款"].map((cat) => (
                  <article className="tutorial" key={cat}>
                    <span className="tutorial-icon">▶</span>
                    <div>
                      <h3>{cat}操作教學</h3>
                      {stores.flatMap((s) =>
                        s.tutorials
                          .filter((t) => t.category === cat)
                          .map((t, i) => (
                            <LinkButton key={s.id + i} url={t.url}>
                              {s.name} · {t.title}
                            </LinkButton>
                          )),
                      ).length ? (
                        stores.flatMap((s) =>
                          s.tutorials
                            .filter((t) => t.category === cat)
                            .map((t, i) => (
                              <LinkButton key={s.id + i} url={t.url}>
                                {s.name} · {t.title}
                              </LinkButton>
                            )),
                        )
                      ) : (
                        <p>影片準備中，請洽門市了解操作方式。</p>
                      )}
                    </div>
                  </article>
                ))}
              </section>
            )}
            {tab === "franchise" && (
              <section className="content-panel franchise">
                <p className="eyebrow">START YOUR MCW JOURNEY</p>
                <h2>
                  一間洗衣店，
                  <br />
                  一個新的開始。
                </h2>
                <p>
                  想了解 MCW
                  洗衣設備、開店流程與加盟資訊？透過總部指定管道，開始你的開店計畫。
                </p>
                <LinkButton url={settings.franchiseUrl}>
                  詢問洗衣加盟
                </LinkButton>
                <p className="muted">
                  此頁不收集個人資料。前往外部聯絡管道後，請先閱讀該服務的隱私說明。
                </p>
              </section>
            )}
          </>
        )}
      </main>
      <footer>
        MCW 魔彩自助洗衣 · 好生活，從乾淨開始。<a href="/admin">總部管理</a>
      </footer>
      <nav className="bottom-nav" aria-label="主選單">
        {[
          ["near", "◎", "附近地圖"],
          ["all", "⌖", "全台總覽"],
          ["favorites", "♡", "我的收藏"],
          ["tutorials", "▷", "操作教學"],
          ["franchise", "↗", "加盟諮詢"],
        ].map(([id, i, t]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => {
              setTab(id);
              setSelected(null);
              if (id === "all") {
                setLocation(null);
                setCity("");
                setQuery("");
              }
            }}
          >
            <span>{i}</span>
            {t}
          </button>
        ))}
      </nav>
    </>
  );
}
function Field({ label, value, onChange, type = "text", ...props }) {
  return (
    <label>
      {label}
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
    </label>
  );
}
function Admin() {
  const [authorized, setAuthorized] = useState(false),
    [checked, setChecked] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [stores, setStores] = useState([]),
    [editing, setEditing] = useState(null),
    [settings, setSettings] = useState({ lineUrl: "", franchiseUrl: "" }),
    [busy, setBusy] = useState(false),
    [demo, setDemo] = useState(null);
  const load = () =>
    Promise.all([api("/admin/stores"), api("/settings")]).then(([s, c]) => {
      setStores(s);
      setSettings(c);
    });
  useEffect(() => {
    api("/admin/session")
      .then(() => {
        setAuthorized(true);
        return load();
      })
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);
  async function run(fn) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const update = (key, v) => setEditing((s) => ({ ...s, [key]: v }));
  const updateItem = (key, i, k, v) =>
    update(
      key,
      editing[key].map((item, j) => (j === i ? { ...item, [k]: v } : item)),
    );
  if (!checked) return <p>驗證登入中…</p>;
  if (!authorized)
    return (
      <main className="login">
        <a href="/">← 回洗衣地圖</a>
        <p className="eyebrow">MCW HEADQUARTERS</p>
        <h1>總部管理登入</h1>
        <p>僅限 MCW 總部授權人員。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              await api("/login", {
                method: "POST",
                body: JSON.stringify(Object.fromEntries(f)),
              });
              setAuthorized(true);
              await load();
            });
          }}
        >
          <label>
            帳號
            <input name="username" autoComplete="username" required />
          </label>
          <label>
            密碼
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button disabled={busy}>登入</button>
        </form>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <main className="admin">
      <div className="section-heading">
        <h1>MCW 總部後台</h1>
        <a href="/">檢視前台 ↗</a>
        <button
          onClick={() =>
            run(async () => {
              await api("/admin/logout", { method: "POST" });
              setAuthorized(false);
              setEditing(null);
            })
          }
        >
          登出
        </button>
      </div>
      {error && <aside role="alert">{error}</aside>}
      {message && <aside role="status">{message}</aside>}
      <fieldset disabled={busy}>
        <h2>總部聯絡入口</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api("/admin/settings", {
                method: "PUT",
                body: JSON.stringify(settings),
              });
              setMessage("總部入口已更新");
            });
          }}
        >
          <Field
            label="LINE 官方帳號 HTTPS 網址"
            type="url"
            value={settings.lineUrl}
            onChange={(v) => setSettings({ ...settings, lineUrl: v })}
          />
          <Field
            label="加盟聯絡 HTTPS 網址"
            type="url"
            value={settings.franchiseUrl}
            onChange={(v) => setSettings({ ...settings, franchiseUrl: v })}
          />
          <button>儲存入口</button>
        </form>
      </fieldset>
      <div className="section-heading">
        <h2>分店管理 · {stores.length} 間</h2>
        <button
          onClick={() => {
            setEditing(emptyStore());
            setDemo(null);
          }}
        >
          ＋ 新增分店
        </button>
      </div>
      <div className="admin-stores">
        {stores.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setEditing(s);
              setDemo(null);
            }}
          >
            {s.name} · {s.published ? "已公開" : "草稿"}
          </button>
        ))}
      </div>
      {editing && (
        <fieldset disabled={busy}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const s = await api(
                  "/admin/stores" + (editing.id ? "/" + editing.id : ""),
                  {
                    method: editing.id ? "PUT" : "POST",
                    body: JSON.stringify(editing),
                  },
                );
                setEditing(s);
                await load();
                setMessage("門市已儲存；公開且已確認的內容會反映於前台");
              });
            }}
          >
            <h2>{editing.id ? "編輯門市" : "新增門市"}</h2>
            <div className="form-grid">
              {[
                ["name", "門市名稱"],
                ["city", "縣市"],
                ["address", "完整地址"],
                ["phone", "電話"],
                ["hours", "營業時間"],
              ].map(([k, l]) => (
                <Field
                  key={k}
                  label={l}
                  value={editing[k]}
                  onChange={(v) => update(k, v)}
                  required={k === "name"}
                />
              ))}
              {[
                ["lat", "緯度"],
                ["lng", "經度"],
              ].map(([k, l]) => (
                <Field
                  key={k}
                  label={l}
                  type="number"
                  step="any"
                  value={editing[k]}
                  onChange={(v) => update(k, v === "" ? null : Number(v))}
                />
              ))}
            </div>
            <label>
              門市公告
              <textarea
                value={editing.announcement}
                onChange={(e) => update("announcement", e.target.value)}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={editing.confirmed}
                onChange={(e) => update("confirmed", e.target.checked)}
              />
              已核實門市資訊
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={editing.published}
                onChange={(e) => update("published", e.target.checked)}
              />
              公開於消費者地圖（需確認地址與座標）
            </label>
            <h3>門市與機台照片</h3>
            <p>上限 8MB，伺服器會驗證、移除 metadata 並轉為 WebP。</p>
            <input
              aria-label="上傳門市照片"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                run(async () => {
                  const f = new FormData();
                  f.append("photo", file);
                  const p = await api("/admin/photos", {
                    method: "POST",
                    body: f,
                  });
                  setEditing((s) => ({ ...s, photos: [...s.photos, p.url] }));
                });
              }}
            />
            <div className="photo-admin">
              {editing.photos.map((p, i) => (
                <div key={p}>
                  <img src={p} alt={"門市照片 " + (i + 1)} />
                  <button
                    type="button"
                    onClick={() =>
                      update(
                        "photos",
                        editing.photos.filter((_, j) => j !== i),
                      )
                    }
                  >
                    移除照片
                  </button>
                </div>
              ))}
            </div>
            <h3>設備規格與費率</h3>
            {editing.equipment.map((eq, i) => (
              <section className="editor-card" key={i}>
                <label>
                  種類
                  <select
                    value={eq.type}
                    onChange={(e) =>
                      updateItem("equipment", i, "type", e.target.value)
                    }
                  >
                    {["洗脫烘", "雙層烘", "加水站"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                {[
                  ["id", "設備 ID"],
                  ["model", "型號"],
                  ["capacity", "容量"],
                  ["price", "費率（未核實請留白）"],
                  ["providerKey", "原廠設備識別碼（預留）"],
                ].map(([k, l]) => (
                  <Field
                    key={k}
                    label={l}
                    value={eq[k]}
                    onChange={(v) => updateItem("equipment", i, k, v)}
                  />
                ))}
                <Field
                  label="數量"
                  type="number"
                  min="1"
                  value={eq.quantity}
                  onChange={(v) =>
                    updateItem("equipment", i, "quantity", Number(v))
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    update(
                      "equipment",
                      editing.equipment.filter((_, j) => j !== i),
                    )
                  }
                >
                  刪除設備
                </button>
              </section>
            ))}
            <button
              type="button"
              onClick={() =>
                update("equipment", [
                  ...editing.equipment,
                  {
                    id: "",
                    type: "洗脫烘",
                    model: "",
                    capacity: "",
                    quantity: 1,
                    price: "",
                    providerKey: "",
                  },
                ])
              }
            >
              ＋ 新增設備
            </button>
            <h3>YouTube 教學</h3>
            {editing.tutorials.map((t, i) => (
              <section className="editor-card" key={i}>
                <label>
                  分類
                  <select
                    value={t.category}
                    onChange={(e) =>
                      updateItem("tutorials", i, "category", e.target.value)
                    }
                  >
                    {["洗脫烘", "雙層烘", "付款"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <Field
                  label="影片名稱"
                  value={t.title}
                  onChange={(v) => updateItem("tutorials", i, "title", v)}
                />
                <Field
                  label="YouTube 網址"
                  type="url"
                  value={t.url}
                  onChange={(v) => updateItem("tutorials", i, "url", v)}
                />
                <button
                  type="button"
                  onClick={() =>
                    update(
                      "tutorials",
                      editing.tutorials.filter((_, j) => j !== i),
                    )
                  }
                >
                  移除影片
                </button>
              </section>
            ))}
            <button
              type="button"
              onClick={() =>
                update("tutorials", [
                  ...editing.tutorials,
                  { category: "洗脫烘", title: "", url: "" },
                ])
              }
            >
              ＋ 新增教學
            </button>
            <h3>門市外部入口</h3>
            {[
              ["aiUrl", "AI 智慧店長網址（僅連結）"],
              ["reviewUrl", "Google 評價網址"],
              ["franchiseUrl", "加盟聯絡網址（空白則使用總部設定）"],
            ].map(([k, l]) => (
              <Field
                key={k}
                label={l}
                type="url"
                value={editing[k]}
                onChange={(v) => update(k, v)}
              />
            ))}
            <h3>未來機台 API 設定</h3>
            <p>
              目前未連接原廠。設定識別碼不會啟用任何即時資料；不可在此填入密鑰。
            </p>
            <Field
              label="Provider 設定參照（非機密識別名稱）"
              value={editing.providerReference}
              onChange={(v) => update("providerReference", v)}
            />
            <div className="actions">
              <button type="submit">儲存門市</button>
              <button type="button" onClick={() => setEditing(null)}>
                取消編輯
              </button>
              {editing.id && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    if (confirm("確定刪除此門市？"))
                      run(async () => {
                        await api("/admin/stores/" + editing.id, {
                          method: "DELETE",
                        });
                        setEditing(null);
                        await load();
                        setMessage("門市已刪除");
                      });
                  }}
                >
                  刪除門市
                </button>
              )}
            </div>
          </form>
          {editing.id && (
            <button
              onClick={() =>
                run(async () =>
                  setDemo(await api(`/admin/stores/${editing.id}/demo-status`)),
                )
              }
            >
              查看 DEMO 狀態（僅後台）
            </button>
          )}
          {demo && (
            <aside>
              <strong>{demo.label}</strong>
              <pre>{JSON.stringify(demo.statuses, null, 2)}</pre>
            </aside>
          )}
        </fieldset>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")).render(
  location.pathname.startsWith("/admin") ? <Admin /> : <PublicApp />,
);
