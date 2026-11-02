import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import { brandPhotos } from "../shared/brand.js";
const icon = L.divIcon({
  className: "pin",
  html: '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="2" width="16" height="20" rx="3"/><circle cx="12" cy="14" r="5"/><path d="M7 6h2m2 0h6M8 14q4 4 8 0"/></svg></span>',
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
  openingStatus: "open",
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
const openingLabels = {
  open: "營業中",
  planned: "籌備中",
  temporarily_closed: "暫停營業",
};
function PhotoViewer({ src, alt }) {
  const dialog = useRef(null);
  return (
    <>
      <button
        type="button"
        className="view-photo"
        aria-label={`放大查看：${alt}`}
        onClick={() => dialog.current.showModal()}
      >
        查看完整照片 ↗
      </button>
      <dialog
        className="photo-viewer"
        ref={dialog}
        aria-label={alt}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        <div className="photo-viewer-toolbar">
          <span>{alt}</span>
          <button
            type="button"
            autoFocus
            onClick={() => dialog.current.close()}
          >
            關閉照片 ✕
          </button>
        </div>
        <img className="photo-viewer-image" src={src} alt={alt} />
      </dialog>
    </>
  );
}
function PhotoCarousel({ photos, name }) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [photos.join("|")]);
  if (!photos.length)
    return <div className="photo-empty">門市照片待總部補充</div>;
  return (
    <section className="photo-carousel" aria-label="門市照片輪播">
      <img
        src={photos[index] || photos[0]}
        alt={`${name} 門市照片 ${index + 1}`}
      />
      <PhotoViewer
        src={photos[index] || photos[0]}
        alt={`${name} 門市照片 ${index + 1}`}
      />
      <span className="photo-counter">
        {index + 1} / {photos.length}
      </span>
      {photos.length > 1 && (
        <div className="carousel-controls">
          <button
            aria-label="上一張照片"
            onClick={() =>
              setIndex((index + photos.length - 1) % photos.length)
            }
          >
            ‹
          </button>
          <button
            aria-label="下一張照片"
            onClick={() => setIndex((index + 1) % photos.length)}
          >
            ›
          </button>
        </div>
      )}
    </section>
  );
}
function StatusPanel({ snapshot }) {
  const fresh =
    snapshot?.last_updated &&
    Date.now() - Date.parse(snapshot.last_updated) >= 0 &&
    Date.now() - Date.parse(snapshot.last_updated) <=
      snapshot.ttl_seconds * 1000;
  const state = fresh ? snapshot.status : "unknown";
  const label =
    {
      idle: "空閒",
      running: "運轉中",
      fault: "故障",
      offline: "離線",
      unknown: "未知／未連線",
    }[state] || "未知／未連線";
  return (
    <div className="machine-status">
      <span className={`status status-${state}`}>
        {snapshot?.simulated && <b>DEMO 模擬資料 · </b>}
        {label}
      </span>
      <small>
        最後更新：
        {snapshot?.last_updated
          ? new Date(snapshot.last_updated).toLocaleString("zh-TW")
          : "尚無資料"}
      </small>
      <small>
        剩餘時間：
        {fresh && state === "running" && snapshot.remaining_seconds !== null
          ? `${Math.ceil(snapshot.remaining_seconds / 60)} 分鐘`
          : "尚無資料"}
      </small>
    </div>
  );
}
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
      <PhotoCarousel photos={s.photos} name={s.name} />
      <p className="eyebrow">MCW LAUNDRY / {s.city}</p>
      <h1>{s.name}</h1>
      <div className="store-tags">
        <span>{openingLabels[s.openingStatus] || "營業中"}</span>
        {[...new Set(s.equipment.map((e) => e.type))].map((type) => (
          <span key={type}>{type}</span>
        ))}
      </div>
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
      <p className="notice">
        尚未串接設備，即時狀態暫不可用 · 不提供空機數或倒數預估
      </p>
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
            <small>
              設備 ID：{e.id}
              {e.number ? ` · 機號 ${e.number}` : ""}
            </small>
            {e.specification && <p>{e.specification}</p>}
            {!!e.photos?.length && (
              <div className="equipment-photos">
                {e.photos.map((p) => (
                  <div className="equipment-photo" key={p}>
                    <img src={p} alt={`${e.type}設備照片`} loading="lazy" />
                    <PhotoViewer src={p} alt={`${e.type}設備照片`} />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <strong>{e.price || "費率待確認"}</strong>
            <StatusPanel
              snapshot={statuses.find((x) => x.machine_id === e.id)}
            />
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
    [view, setView] = useState("map"),
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
          <img src="/brand/mcw-round-logo.png" alt="MCW 魔彩正式 Logo" />
          <span>
            洗衣地圖<small>LAUNDRY MAP</small>
          </span>
        </a>
        <LinkButton url={settings.lineUrl}>官方 LINE</LinkButton>
      </header>
      <main
        className={
          !chosen && ["near", "all", "favorites"].includes(tab)
            ? "map-page"
            : ""
        }
      >
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
                <div className="map-toolbar">
                  <span>
                    <i />
                    即時資訊尚未串接
                  </span>
                  <div role="group" aria-label="檢視方式">
                    <button
                      aria-pressed={view === "map"}
                      onClick={() => setView("map")}
                    >
                      地圖
                    </button>
                    <button
                      aria-pressed={view === "list"}
                      onClick={() => setView("list")}
                    >
                      列表
                    </button>
                  </div>
                </div>
                <div
                  className={`map-layout ${view === "list" ? "list-mode" : ""}`}
                >
                  {view === "map" && (
                    <section className="map-wrap" aria-label="互動門市地圖">
                      <MapContainer
                        center={[23.7, 121]}
                        zoom={7}
                        scrollWheelZoom
                        zoomAnimation={false}
                        fadeAnimation={false}
                        markerZoomAnimation={false}
                      >
                        <TileLayer
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          eventHandlers={{
                            tileerror: () => setTileError(true),
                          }}
                        />
                        <MapView
                          stores={filtered}
                          onSelect={(s) => setSelected(s.id)}
                          focus={location ? [location.lat, location.lng] : null}
                        />
                      </MapContainer>
                    </section>
                  )}
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
                        <img
                          className="empty-mascot"
                          src="/brand/mcw-cat.webp"
                          alt="MCW 藍白貓咪吉祥物"
                        />
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
                          <div className="store-tags">
                            <span>
                              {openingLabels[s.openingStatus] || "營業中"}
                            </span>
                            <span>即時資訊尚未串接</span>
                          </div>
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
              <section className="content-panel tutorials-panel">
                <div className="tutorial-feature">
                  <img
                    src="/brand/mcw-wash-dry.webp"
                    alt="MCW 洗脫烘一體機實拍"
                    width="488"
                    height="900"
                  />
                  <div>
                    <p className="eyebrow">WASH · DRY · READY</p>
                    <h2>認識你的洗衣好幫手</h2>
                    <p>從洗脫烘到付款，依門市教學安心操作。</p>
                    <span className="media-label">
                      設備實拍 · 影片依門市設定
                    </span>
                  </div>
                </div>
                <p className="eyebrow">MCW HOW-TO</p>
                <h2>你的洗衣小幫手</h2>
                {["洗脫烘", "雙層烘", "付款"].map((cat) => (
                  <article className="tutorial" key={cat}>
                    <span className="tutorial-icon" aria-hidden="true">
                      {cat === "洗脫烘" ? "01" : cat === "雙層烘" ? "02" : "03"}
                    </span>
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
                <figure className="franchise-photo">
                  <img
                    src="/brand/hualien-store-1.webp"
                    alt="交接包提供的花蓮門市外觀實拍"
                    width="1100"
                    height="825"
                  />
                  <figcaption>
                    花蓮門市實拍 · 地址與營運資訊待總部確認
                  </figcaption>
                </figure>
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
                <div className="brand-guide">
                  <img src="/brand/mcw-cat.webp" alt="MCW 藍白貓咪吉祥物" />
                  <p>
                    從空間規劃到設備選擇，
                    <br />與 MCW 一起打造社區的洗衣好鄰居。
                  </p>
                </div>
                <p className="muted">
                  此頁不收集個人資料。前往外部聯絡管道後，請先閱讀該服務的隱私說明。
                </p>
              </section>
            )}
          </>
        )}
      </main>
      <footer>
        <img
          className="footer-wordmark"
          src="/brand/mcw-logo-red.png"
          alt="MCW"
        />
        魔彩自助洗衣 · 好生活，從乾淨開始。<a href="/admin">總部管理</a>
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
            <label>
              開店狀態
              <select
                aria-label="開店狀態"
                value={editing.openingStatus || "open"}
                onChange={(e) => update("openingStatus", e.target.value)}
              >
                {Object.entries(openingLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <h3>門市與機台照片</h3>
            <details className="asset-library">
              <summary>選用交接包品牌照片</summary>
              <p>花蓮門市照片不代表地址或營運資料已核實。只應用於對應門市。</p>
              <div className="asset-grid">
                {brandPhotos.map((p) => (
                  <button
                    key={p.path}
                    aria-label={p.label}
                    type="button"
                    disabled={editing.photos.includes(p.path)}
                    onClick={() =>
                      update("photos", [...editing.photos, p.path])
                    }
                  >
                    <img src={p.path} alt={p.label} />
                    {p.label}
                  </button>
                ))}
              </div>
            </details>
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
                  ["number", "機號"],
                  ["specification", "設備規格"],
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
                <label>
                  設備照片
                  <select
                    aria-label="設備照片"
                    value={eq.photos?.[0] || ""}
                    onChange={(e) =>
                      updateItem(
                        "equipment",
                        i,
                        "photos",
                        e.target.value ? [e.target.value] : [],
                      )
                    }
                  >
                    <option value="">未指定照片</option>
                    {[
                      ...new Set([
                        ...editing.photos,
                        ...brandPhotos.map((p) => p.path),
                      ]),
                    ].map((path) => (
                      <option value={path} key={path}>
                        {brandPhotos.find((p) => p.path === path)?.label ||
                          path.split("/").pop()}
                      </option>
                    ))}
                  </select>
                </label>
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
