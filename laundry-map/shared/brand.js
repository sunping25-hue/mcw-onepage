// Assets supplied by the user in the MCW handoff ZIP; photos are not verified store records.
export const brandPhotos = [
  { path: "/brand/hualien-store-1.webp", label: "花蓮門市外觀實拍" },
  { path: "/brand/hualien-store-2.webp", label: "花蓮門市實拍 2" },
  { path: "/brand/hualien-store-3.webp", label: "花蓮門市實拍 3" },
  { path: "/brand/hualien-store-4.webp", label: "花蓮門市實拍 4" },
  { path: "/brand/hualien-store-5.webp", label: "花蓮門市實拍 5" },
  { path: "/brand/mcw-wash-dry.webp", label: "MCW 洗脫烘設備實拍" },
];
export const isPhotoPath = (value) =>
  /^\/uploads\/[a-f0-9-]+\.webp$/.test(value) ||
  brandPhotos.some((p) => p.path === value);
