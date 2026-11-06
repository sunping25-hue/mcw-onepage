/** Main island and Penghu. Outlying Kinmen is west of this box. */
export const TAIWAN_OVERVIEW = Object.freeze({
  south: 21.82,
  west: 119.4,
  north: 25.38,
  east: 122.12,
});

/** Bounds that show the whole Taiwan overview and still include every marker. */
export function overviewLatLngs(points) {
  let { south, west, north, east } = TAIWAN_OVERVIEW;
  for (const point of points || []) {
    if (typeof point?.lat !== "number" || typeof point?.lng !== "number") continue;
    const lat = point.lat;
    const lng = point.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  return [
    [south, west],
    [north, east],
  ];
}

/** Pixel inset so marker icons stay inside short phone maps and wide desktop maps. */
export function overviewPadding(width, height) {
  const edge = Math.min(Number(width) || 0, Number(height) || 0);
  const pad = Math.max(18, Math.min(40, Math.round(edge * 0.05)));
  return [pad, pad];
}
