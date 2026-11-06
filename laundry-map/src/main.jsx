import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  MapContainer,
  TileLayer,
  Marker,
  GeoJSON,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import taiwanOutline from "./data/taiwan.json";
import { overviewLatLngs, overviewPadding } from "./taiwan-overview.js";
import { brandPhotos } from "../shared/brand.js";
import {
  DEFAULT_STORE_HOURS,
  EQUIPMENT_TYPES,
  MACHINE_CATALOG,
  OFFICIAL_YOUTUBE_CHANNEL_URL,
  catalogChips,
  countEquipmentId,
  isPlainCatalogCount,
} from "../shared/storefront.js";
const logoHtml = (count) =>
  `<span class="logo-mark${count ? " cluster-mark" : ""}"><img src="/brand/mcw-round-logo.png" alt="" />${count ? `<b>${count}</b>` : ""}</span>`;
function storeIcon(selected) {
  return L.divIcon({
    className: "pin" + (selected ? " is-selected" : ""),
    html: logoHtml(),
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}
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
  hours: DEFAULT_STORE_HOURS,
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
  machineQueryMode: "off",
  machineQueryUrl: "",
  provider: "unconnected",
  providerReference: "",
});
function editorStore(store) {
  return {
    ...store,
    openingStatus:
      store.openingStatus && store.openingStatus !== "unknown"
        ? store.openingStatus
        : "open",
    hours: store.hours?.trim() ? store.hours : DEFAULT_STORE_HOURS,
    machineQueryMode: store.machineQueryMode === "button" ? "button" : "off",
    machineQueryUrl: store.machineQueryUrl || "",
  };
}
function withCatalogCount(equipment, type, kg, raw) {
  const id = countEquipmentId(type, kg);
  const rest = equipment.filter((entry) => entry.id !== id);
  if (raw === "" || raw === "0") return rest;
  if (!/^\d+$/.test(raw)) return equipment;
  const quantity = Number(raw);
  if (quantity < 1 || quantity > 1000) return equipment;
  return [
    ...rest,
    {
      id,
      type,
      capacity: `${kg}KG`,
      quantity,
      model: "",
      number: "",
      specification: "",
      photos: [],
      price: "",
      providerKey: "",
    },
  ];
}
const OFFICIAL_LINE_URL = "https://lin.ee/s4v3cIG";
const BUSINESS_LINE_URL = "https://line.me/ti/p/~mcw27";
const FRANCHISE_PAGE_URL = "https://sunping25-hue.github.io/mcw-onepage/";
const MCW_SITE_URL = "https://www.magicbubble-laundry.com/";
const FACEBOOK_PAGE_URL =
  "https://www.facebook.com/share/1JCJbVjMGW/?mibextid=wwXIfr";
const tutorialCategories = ["洗脫烘", "雙層烘", "付款", "會員儲值點數"];
function officialLineUrl(settings) {
  return settings?.lineUrl || OFFICIAL_LINE_URL;
}
function LinkButton({ url, children, className }) {
  const classes = className ? `button ${className}` : "button";
  return url ? (
    <a className={classes} href={url} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  ) : (
    <span className="button disabled" aria-disabled="true">
      {children}・尚未設定
    </span>
  );
}
function LineMark() {
  return (
    <span className="line-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path
          fill="#fff"
          d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"
        />
      </svg>
    </span>
  );
}
function FacebookMark() {
  return (
    <span className="fb-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path
          fill="#fff"
          d="M22 12.07C22 6.5 17.52 2 12 2S2 6.5 2 12.07C2 17.1 5.66 21.24 10.44 22v-7.03H7.9v-2.9h2.54V9.84c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.9h-2.34V22C18.34 21.24 22 17.1 22 12.07z"
        />
      </svg>
    </span>
  );
}
function OfficialLineButton({ url }) {
  return (
    <a
      className="button line-join"
      href={officialLineUrl({ lineUrl: url })}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="加入官方 LINE"
    >
      加入官方
      <LineMark />
    </a>
  );
}
function Fit({ points, focus, camera }) {
  const map = useMap();
  useEffect(() => {
    if (camera.mode === "taiwan") {
      let cancelled = false;
      let frame = 0;
      let tries = 0;
      const apply = () => {
        if (cancelled) return;
        const size = map.getSize();
        if ((size.x < 20 || size.y < 20) && tries < 20) {
          tries += 1;
          frame = requestAnimationFrame(apply);
          return;
        }
        map.fitBounds(overviewLatLngs(points), {
          padding: overviewPadding(size.x, size.y),
          maxZoom: 8,
          animate: false,
        });
      };
      apply();
      return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
      };
    }
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
    camera.mode,
    camera.nonce,
    map,
  ]);
  return null;
}
function MapView({ stores, onSelect, focus, camera }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useEffect(() => {
    const el = map.getContainer();
    el._mcwMap = map;
    const fn = () => setZoom(map.getZoom());
    map.on("zoomend", fn);
    return () => {
      map.off("zoomend", fn);
      if (el._mcwMap === map) delete el._mcwMap;
    };
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
              html: logoHtml(g.length),
              iconSize: [48, 48],
              iconAnchor: [24, 24],
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
            icon={storeIcon(false)}
            eventHandlers={{ click: () => onSelect(g[0]) }}
            title={g[0].name}
          />
        ),
      )}
      <Fit points={stores} focus={focus} camera={camera} />
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
function openingLabel(status) {
  return openingLabels[status] || "營業中";
}
function OpeningBadge({ status }) {
  const label = openingLabel(status);
  return (
    <span className={label === "營業中" ? "opening-badge" : undefined}>
      {label}
    </span>
  );
}
function YouTubeMark() {
  return (
    <span className="youtube-mark" aria-hidden="true">
      <svg viewBox="0 0 24 18">
        <rect x="0.5" y="0.5" width="23" height="17" rx="4" fill="#fff" />
        <path d="M10 5.2v7.6L16.4 9z" fill="#cc0000" />
      </svg>
    </span>
  );
}
const allowedTabs = ["near", "all", "favorites", "tutorials", "franchise"];
function readRoute() {
  const params = new URLSearchParams(window.location.search);
  return {
    tab: allowedTabs.includes(params.get("tab")) ? params.get("tab") : "near",
    store: params.get("store") || null,
  };
}
function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const pop = () => {
      setRoute(readRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const navigate = (next, replace = false) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next.tab);
    if (next.store) url.searchParams.set("store", next.store);
    else url.searchParams.delete("store");
    window.history[replace ? "replaceState" : "pushState"](
      { mcwDetail: !!next.store },
      "",
      url,
    );
    setRoute(next);
    window.scrollTo(0, 0);
  };
  const back = () => {
    if (window.history.state?.mcwDetail) window.history.back();
    else navigate({ ...route, store: null }, true);
  };
  return [route, navigate, back];
}
function NavigationChooser({ store }) {
  const dialog = useRef(null);
  return (
    <>
      <button className="primary" onClick={() => dialog.current.showModal()}>
        開始導航 ↗
      </button>
      <dialog
        ref={dialog}
        className="navigation-dialog"
        aria-label="選擇導航地圖"
      >
        <h2>前往 {store.name}</h2>
        <p>{store.address}</p>
        <div className="actions">
          <LinkButton
            url={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(store.address)}`}
          >
            Google Maps 導航
          </LinkButton>
          <LinkButton
            url={`https://maps.apple.com/?daddr=${encodeURIComponent(store.address)}`}
          >
            Apple 地圖導航
          </LinkButton>
        </div>
        <button onClick={() => dialog.current.close()}>取消導航</button>
      </dialog>
    </>
  );
}
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
  const start = useRef(null);
  useEffect(() => setIndex(0), [photos.join("|")]);
  if (!photos.length)
    return <div className="photo-empty">門市照片待總部補充</div>;
  return (
    <section
      className="photo-carousel"
      aria-label="門市照片輪播"
      onTouchStart={(e) => {
        if (e.target.closest("dialog") || e.touches.length !== 1) {
          start.current = null;
          return;
        }
        const t = e.touches[0];
        start.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        if (!start.current || e.target.closest("dialog")) return;
        const t = e.changedTouches[0],
          dx = t.clientX - start.current.x,
          dy = t.clientY - start.current.y;
        start.current = null;
        if (
          photos.length > 1 &&
          Math.abs(dx) > 45 &&
          Math.abs(dx) > Math.abs(dy) * 1.3
        )
          setIndex(
            (i) => (i + (dx < 0 ? 1 : photos.length - 1)) % photos.length,
          );
      }}
      onTouchCancel={() => {
        start.current = null;
      }}
    >
      <img
        src={photos[index] || photos[0]}
        alt={`${name} 門市照片 ${index + 1}`}
      />
      <PhotoViewer
        src={photos[index] || photos[0]}
        alt={`${name} 門市照片 ${index + 1}`}
      />
      <span className="sr-only" aria-live="polite">
        第 {index + 1} 張，共 {photos.length} 張
      </span>
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
  const [shareMsg, setShareMsg] = useState("");
  async function share() {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "near");
    url.searchParams.set("store", s.id);
    try {
      if (navigator.share) {
        await navigator.share({
          title: s.name,
          text: "MCW自助洗衣地圖",
          url: url.href,
        });
        setShareMsg("");
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url.href);
        setShareMsg("門市連結已複製");
      } else setShareMsg(url.href);
    } catch (e) {
      if (e.name !== "AbortError")
        setShareMsg("無法分享，請複製網址列的門市連結");
    }
  }
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
        <OpeningBadge status={s.openingStatus} />
        {[...new Set(s.equipment.map((e) => e.type))].map((type) => (
          <span key={type}>{type}</span>
        ))}
      </div>
      <div className="detail-quick-actions">
        <button onClick={toggle}>{saved ? "♥ 已收藏" : "♡ 收藏門市"}</button>
        <button onClick={share}>分享門市 ↗</button>
        <NavigationChooser store={s} />
      </div>
      {shareMsg && (
        <p role="status" className="share-message">
          {shareMsg}
        </p>
      )}
      <p>{s.address}</p>
      <p>營業時間：{s.hours?.trim() ? s.hours : DEFAULT_STORE_HOURS}</p>
      <p>
        {s.phone ? (
          <a href={"tel:" + s.phone}>☎ {s.phone}</a>
        ) : (
          "電話待總部確認"
        )}
      </p>
      {s.announcement && <aside>{s.announcement}</aside>}
      <div className="actions">
        <LinkButton url={s.reviewUrl}>Google 評價</LinkButton>
        <LinkButton url={s.aiUrl}>AI 智慧店長</LinkButton>
      </div>
      <h2>店內設備</h2>
      <p className="notice">
        尚未串接設備，即時狀態暫不可用 · 不提供空機數或倒數預估
      </p>
      {s.machineQueryUrl ? (
        <LinkButton className="machine-query" url={s.machineQueryUrl}>
          空機查詢
        </LinkButton>
      ) : null}
      {catalogChips(s.equipment).length ? (
        <div className="equip-chips">
          {catalogChips(s.equipment).map((chip) => (
            <span className="equip-chip" key={chip.key}>
              {chip.label}
            </span>
          ))}
        </div>
      ) : null}
      {error && <p role="alert">{error}</p>}
      {!s.equipment.length && <p>設備資料待總部補充。</p>}
      {s.equipment.filter((e) => !isPlainCatalogCount(e)).map((e) => (
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
      <a
        className="button youtube-channel"
        href={OFFICIAL_YOUTUBE_CHANNEL_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <YouTubeMark />
        YouTube 操作教學
      </a>
      {s.tutorials.map((t, i) => (
        <LinkButton key={i} url={t.url}>
          {t.category} · {t.title}
        </LinkButton>
      ))}
      <h2>一起經營好生活</h2>
      <LinkButton url={officialLineUrl(settings)}>
        詢問加盟
      </LinkButton>
    </section>
  );
}
function PublicApp() {
  const [{ tab, store: selected }, navigate, backToMap] = useRoute();
  const openStore = (id) => navigate({ tab, store: id });
  const [stores, setStores] = useState([]),
    [settings, setSettings] = useState({}),
    [view, setView] = useState("map"),
    [query, setQuery] = useState(""),
    [city, setCity] = useState(""),
    [location, setLocation] = useState(null),
    [camera, setCamera] = useState({ mode: "auto", nonce: 0 }),
    [geoMsg, setGeoMsg] = useState(""),
    [error, setError] = useState(""),
    [tileError, setTileError] = useState(false),
    [tilesLoaded, setTilesLoaded] = useState(false),
    [tileAttempt, setTileAttempt] = useState(0),
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
    filtered.sort(
      (a, b) =>
        (a.lat !== null && a.lng !== null ? distance(location, a) : Infinity) -
        (b.lat !== null && b.lng !== null ? distance(location, b) : Infinity),
    );
  const followStores = () =>
    setCamera((c) => (c.mode === "auto" ? c : { mode: "auto", nonce: c.nonce }));
  function locate() {
    if (!navigator.geolocation) {
      setGeoMsg("瀏覽器不支援定位，請使用縣市或搜尋。");
      return;
    }
    setGeoMsg("定位中…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocation({ lat: p.coords.latitude, lng: p.coords.longitude });
        followStores();
        setGeoMsg(
          stores.some((s) => s.lat !== null && s.lng !== null)
            ? "已依距離排序門市"
            : "已取得定位；門市座標確認後即可依距離排序。",
        );
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
            MCW自助洗衣地圖<small>LAUNDRY MAP</small>
          </span>
        </a>
        <OfficialLineButton url={settings.lineUrl} />
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
            onBack={backToMap}
            saved={favorite.includes(chosen.id)}
            toggle={() => toggle(chosen.id)}
          />
        ) : (
          <>
            <div className="hero">
              {tab === "franchise" && (
                <a
                  className="franchise-fb"
                  href={FACEBOOK_PAGE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FacebookMark />
                  FB粉專
                </a>
              )}
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
            {selected && !loading && !error && !chosen && (
              <aside role="alert">
                此門市目前無法查看，可能已下架或連結有誤。
                <button onClick={backToMap}>返回門市地圖</button>
              </aside>
            )}
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
                      onChange={(e) => {
                        setQuery(e.target.value);
                        followStores();
                      }}
                    />
                  </label>
                  <div className="filter-row">
                    <label>
                      縣市
                      <select
                        value={city}
                        onChange={(e) => {
                          setCity(e.target.value);
                          followStores();
                        }}
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
                      type="button"
                      onClick={() => {
                        setCity("");
                        setQuery("");
                        setLocation(null);
                        setGeoMsg("");
                        setView("map");
                        setCamera((c) => ({
                          mode: "taiwan",
                          nonce: c.nonce + 1,
                        }));
                        navigate({ tab: "all", store: null });
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
                          key={tileAttempt}
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          eventHandlers={{
                            tileerror: () => setTileError(true),
                            tileload: () => setTilesLoaded(true),
                          }}
                        />
                        {(!tilesLoaded || tileError) && (
                          <GeoJSON
                            data={taiwanOutline}
                            interactive={false}
                            attribution="Natural Earth (public domain)"
                            style={{
                              color: "#39b8f0",
                              weight: 1.5,
                              fillColor: "#123e60",
                              fillOpacity: 0.8,
                            }}
                          />
                        )}
                        <MapView
                          stores={filtered.filter(
                            (s) => s.lat !== null && s.lng !== null,
                          )}
                          onSelect={(s) => openStore(s.id)}
                          focus={location ? [location.lat, location.lng] : null}
                          camera={camera}
                        />
                      </MapContainer>
                      {tileError && (
                        <div className="map-fallback-note" role="status">
                          <span>臺灣輪廓（無街道）</span>
                          <button
                            className="retry-tiles"
                            onClick={() => {
                              setTileError(false);
                              setTilesLoaded(false);
                              setTileAttempt((n) => n + 1);
                            }}
                          >
                            重試街道地圖
                          </button>
                        </div>
                      )}
                    </section>
                  )}
                  <section className="store-list">
                    {filtered.some((s) => s.lat === null || s.lng === null) && (
                      <p className="location-note">
                        座標確認中，可先使用地址導航。
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
                            : "門市資訊陸續更新中。你可以稍後再來，或透過官方 LINE 洽詢。"}
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
                              s.lat !== null &&
                              s.lng !== null &&
                              ` · ${distance(location, s).toFixed(1)} km`}
                          </p>
                          <h3>
                            <button
                              className="text-button"
                              onClick={() => openStore(s.id)}
                            >
                              {s.name} →
                            </button>
                          </h3>
                          <p>{s.address}</p>
                          <div className="store-tags">
                            <OpeningBadge status={s.openingStatus} />
                            <span>即時資訊尚未串接</span>
                            {s.lat === null && <span>地圖位置待確認</span>}
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
                    src="/brand/mcw-22kg-blue.webp"
                    alt="MCW 22KG 洗脫烘一體機"
                    width="923"
                    height="1704"
                  />
                  <div>
                    <p className="eyebrow">WASH · DRY · READY</p>
                    <h2>認識你的洗衣好幫手</h2>
                    <p>從洗脫烘到付款，依門市教學安心操作。</p>
                    <span className="media-label">設備實拍 · 非即時畫面</span>
                  </div>
                </div>
                <p className="eyebrow">MCW HOW-TO</p>
                <h2>你的洗衣小幫手</h2>
                {tutorialCategories.map((cat, index) => (
                  <article className="tutorial" key={cat}>
                    <span className="tutorial-icon" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
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
                    src="/brand/community-lineup.webp"
                    alt="MCW 洗脫烘一體機，16、22、27、35KG，不鏽鋼色、珍珠白、無限藍、鈦銀、寶石紅、宇宙黑"
                    width="1672"
                    height="941"
                  />
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
                <div className="franchise-pitch">
                  <p>💎為什麼選擇 MCW 洗脫烘？</p>
                  <p>
                    頂級商用規格：機種款式尺寸齊全（16、22、27、35KG），多款時尚美學色彩供選擇（珍珠白、無限藍、鈦銀、寶石紅、宇宙黑、不銹鋼色）。
                  </p>
                  <p>
                    💎 國際品質認證：通過 CE、ISO 9001、ISO 45001、ISO 14001
                    國際認證，擁有多項技術專利，成功打入美國市場的高品質外銷機種。高效節能耐用，專為商用專業首選打造，讓洗衣體驗更聰明、更美好。
                  </p>
                  <p>💎 誠摯邀請您加入加盟合作行列！</p>
                  <p className="franchise-contacts">
                    <a
                      href={officialLineUrl(settings)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      加入官方LINE：@mcw27
                    </a>
                    <a
                      href={BUSINESS_LINE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      業務LINE：mcw27
                    </a>
                    <a href="tel:077881902">加盟專線：07-788-1902</a>
                  </p>
                </div>
                <figure className="franchise-equipment">
                  <img
                    src="/brand/mcw-machine-lineup-guide.webp"
                    alt="MCW 洗脫烘一體機完整機型介紹"
                    width="1104"
                    height="1560"
                  />
                </figure>
                <LinkButton url={officialLineUrl(settings)}>
                  詢問加盟
                </LinkButton>
                <div className="franchise-more">
                  <a
                    className="button"
                    href={FRANCHISE_PAGE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    了解更多訊息
                  </a>
                  <a
                    className="button"
                    href={MCW_SITE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    MCW官網
                  </a>
                </div>
                <div className="brand-guide">
                  <img src="/brand/mcw-cat.webp" alt="MCW 藍白貓咪吉祥物" />
                  <p>
                    從空間規劃到設備選擇，
                    <br />與 MCW 一起打造社區的洗衣好鄰居。
                    <br />
                    加盟MCW就是你的最佳選擇!
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
              navigate({ tab: id, store: null });
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
    [demo, setDemo] = useState(null),
    [cloud, setCloud] = useState(null),
    [geoNote, setGeoNote] = useState("");
  const load = () =>
    Promise.all([
      api("/admin/stores"),
      api("/settings"),
      api("/admin/persistence"),
    ]).then(([s, c, p]) => {
      setStores(s);
      setSettings(c);
      setCloud(p);
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
      <fieldset disabled={busy}>
        <h2>雲端門市資料</h2>
        <p>
          {cloud?.configured
            ? `雲端保存已連接（${cloud.driver}）。最近備份：${cloud.remoteSnapshot?.createdAt || cloud.last?.attemptedAt || "尚無"}。`
            : "尚未接通雲端保存。正式環境使用既有 Google 雲端硬碟（PERSIST_DRIVER=gdrive）；檔案與 S3 只是可選驅動。金鑰尚未填入前，Render 免費方案的本機資料會在重新啟動後消失。"}
        </p>
        {!!cloud?.missing?.length && (
          <p role="status">尚缺環境變數：{cloud.missing.join("、")}</p>
        )}
        {cloud?.last?.outcome === "error" && (
          <p role="alert">最近一次雲端操作失敗：{cloud.last.detail}</p>
        )}
        <div className="stack-actions">
          <button
            type="button"
            onClick={() =>
              run(async () => {
                if (
                  cloud?.backupBlocked &&
                  !confirm("雲端還原未成功。確定要用目前資料覆寫雲端備份？")
                )
                  return;
                const result = await api("/admin/persistence/backup", {
                  method: "POST",
                  body: JSON.stringify(
                    cloud?.backupBlocked ? { confirm: "OVERWRITE" } : {},
                  ),
                });
                setCloud(result);
                setMessage("雲端備份完成");
              })
            }
          >
            立即備份
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                !confirm(
                  "從雲端還原會取代目前門市資料，並使總部重新登入。確定還原？",
                )
              )
                return;
              run(async () => {
                const result = await api("/admin/persistence/restore", {
                  method: "POST",
                  body: JSON.stringify({ confirm: "RESTORE" }),
                });
                setCloud(result);
                setEditing(null);
                setDemo(null);
                await load();
                setMessage("已從雲端還原門市資料");
              });
            }}
          >
            從雲端還原
          </button>
        </div>
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
              setEditing(editorStore(s));
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
                const saved = await api(
                  "/admin/stores" + (editing.id ? "/" + editing.id : ""),
                  {
                    method: editing.id ? "PUT" : "POST",
                    body: JSON.stringify(editing),
                  },
                );
                const { persistence, ...store } = saved;
                setEditing(editorStore(store));
                await load();
                if (persistence?.error) {
                  throw Error("門市已儲存，但雲端備份失敗：" + persistence.error);
                }
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
            {editing.address && (
              <div className="coordinate-help">
                <a
                  className="button"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(editing.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  在 Google Maps 核對門市位置 ↗
                </a>
                <p>
                  確認門牌與位置後，再填入緯度、經度並儲存。地址搜尋結果不會自動當成已核實座標。
                </p>
              </div>
            )}
            {editing.id && (
              <div className="stack-actions">
                <button
                  type="button"
                  onClick={() =>
                    run(async () => {
                      const result = await api(
                        "/admin/stores/" + editing.id + "/geocode",
                        {
                          method: "POST",
                          body: JSON.stringify({ force: true }),
                        },
                      );
                      setGeoNote(result.message);
                      if (result.store) setEditing(editorStore(result.store));
                      await load();
                    })
                  }
                >
                  查詢地址座標
                </button>
              </div>
            )}
            {geoNote && <p role="status">{geoNote}</p>}
            <p>
              只有門牌、路名與行政區都相符，而且沒有標成其他店名時，才會放入地圖圖標。沒有核實座標時仍可用完整地址導航。
            </p>
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
              公開於消費者地圖（需確認地址；座標可稍後補齊）
            </label>
            <label>
              開店狀態
              <select
                aria-label="開店狀態"
                value={
                  editing.openingStatus && editing.openingStatus !== "unknown"
                    ? editing.openingStatus
                    : "open"
                }
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
            <h3>機型台數</h3>
            <p>
              填正整數才會出現在前台。0 或空白不保存、不顯示，也不代表即時空機。
            </p>
            <div className="machine-counts">
              {MACHINE_CATALOG.flatMap((group) =>
                group.capacities.map((kg) => {
                  const saved = editing.equipment.find(
                    (entry) => entry.id === countEquipmentId(group.type, kg),
                  );
                  return (
                    <label key={countEquipmentId(group.type, kg)}>
                      {group.type} {kg}KG
                      <input
                        aria-label={`${group.type} ${kg}KG 台數`}
                        type="number"
                        inputMode="numeric"
                        min="0"
                        max="1000"
                        step="1"
                        value={saved ? String(saved.quantity) : ""}
                        onChange={(event) =>
                          update(
                            "equipment",
                            withCatalogCount(
                              editing.equipment,
                              group.type,
                              kg,
                              event.target.value,
                            ),
                          )
                        }
                      />
                    </label>
                  );
                }),
              )}
            </div>
            <h3>設備規格與費率</h3>
            {editing.equipment.map((eq, i) =>
              isPlainCatalogCount(eq) ? null : (
              <section className="editor-card" key={eq.id || i}>
                <label>
                  種類
                  <select
                    value={eq.type}
                    onChange={(e) =>
                      updateItem("equipment", i, "type", e.target.value)
                    }
                  >
                    {EQUIPMENT_TYPES.map((x) => (
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
              ),
            )}
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
                    {tutorialCategories.map((x) => (
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
            <label>
              無 API 時
              <select
                aria-label="無 API 時的查詢方式"
                value={editing.machineQueryMode || "off"}
                onChange={(event) =>
                  update("machineQueryMode", event.target.value)
                }
              >
                <option value="off">不顯示查詢按鈕</option>
                <option value="button">按鈕查詢</option>
              </select>
            </label>
            {(editing.machineQueryMode || "off") === "button" && (
              <Field
                label="機台查詢網址"
                type="url"
                value={editing.machineQueryUrl}
                onChange={(value) => update("machineQueryUrl", value)}
              />
            )}
            <p>
              按鈕查詢只會另開你貼上的頁面，前台名稱固定為「空機查詢」。這不是即時
              API，也不會取得空機數。未選擇或網址空白時，前台不顯示。接上原廠 API
              後不再顯示這個按鈕。
            </p>
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
