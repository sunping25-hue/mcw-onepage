// Assets supplied by the user in the MCW handoff ZIP; photos are not verified store records.
export const STORE_PHOTO_LIMIT = 5;
export const brandPhotos = [
  { path: "/brand/hualien-store-1.webp", label: "花蓮門市外觀實拍" },
  { path: "/brand/hualien-store-2.webp", label: "花蓮門市實拍 2" },
  { path: "/brand/hualien-store-3.webp", label: "花蓮門市實拍 3" },
  { path: "/brand/hualien-store-4.webp", label: "花蓮門市實拍 4" },
  { path: "/brand/hualien-store-5.webp", label: "花蓮門市實拍 5" },
  { path: "/brand/mcw-wash-dry.webp", label: "MCW 洗脫烘設備實拍" },
];
/** Real handoff storefront shots. They are not logos, machine ads, or placeholders. */
export const handoffStorePhotos = brandPhotos.filter((photo) =>
  photo.path.startsWith("/brand/hualien-store-"),
);
const equipmentBrandPhotos = ["/brand/mcw-wash-dry.webp"];
const blockedPhotoExtensions = [
  ".html",
  ".htm",
  ".js",
  ".mjs",
  ".svg",
  ".php",
  ".exe",
];
export const isUploadPhotoPath = (value) =>
  /^\/uploads\/[a-f0-9-]+\.webp$/.test(value);
function privateIpv4(parts) {
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
/** https photo links only. Legacy upload paths stay valid separately. */
export function isSafePhotoUrl(value) {
  if (typeof value !== "string" || !value || value.length > 2000) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.includes(":")
  )
    return false;
  if (/^[\d.]+$/.test(host)) {
    const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!match) return false;
    const parts = match.slice(1).map(Number);
    if (parts.some((part) => part > 255) || privateIpv4(parts)) return false;
  }
  let path;
  try {
    path = decodeURIComponent(url.pathname).toLowerCase();
  } catch {
    return false;
  }
  if (blockedPhotoExtensions.some((ext) => path.endsWith(ext))) return false;
  return true;
}
/** New album entries are https links. Existing uploads and Hualien handoff shots still load. */
export const isStorePhotoPath = (value) =>
  isSafePhotoUrl(value) ||
  isUploadPhotoPath(value) ||
  handoffStorePhotos.some((photo) => photo.path === value);
export const isPhotoPath = (value) =>
  isStorePhotoPath(value) || equipmentBrandPhotos.includes(value);
