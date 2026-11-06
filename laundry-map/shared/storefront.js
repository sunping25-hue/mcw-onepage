export const DEFAULT_STORE_HOURS = "24小時";
export const OFFICIAL_YOUTUBE_CHANNEL_URL =
  "https://www.youtube.com/@%E9%AD%94%E5%BD%A9%E8%87%AA%E5%8A%A9%E6%B4%97%E8%A1%A3%E5%8A%A0%E7%9B%9F";
export const EQUIPMENT_TYPES = [
  "洗脫烘",
  "雙層烘",
  "下洗上烘",
  "寵物機",
  "一般洗衣機",
  "加水站",
];
export const MACHINE_CATALOG = [
  { type: "洗脫烘", capacities: [16, 22, 27] },
  { type: "雙層烘", capacities: [16] },
  { type: "下洗上烘", capacities: [12, 16, 22] },
  { type: "寵物機", capacities: [12] },
  { type: "一般洗衣機", capacities: [12, 16, 22] },
];
export function countEquipmentId(type, kg) {
  return `count:${type}:${kg}`;
}
export function capacityKg(value) {
  const match = String(value ?? "")
    .trim()
    .match(/^(\d+)\s*KG$/i);
  return match ? Number(match[1]) : null;
}
export function isOfficialCount(type, kg) {
  return MACHINE_CATALOG.some(
    (group) => group.type === type && group.capacities.includes(kg),
  );
}
export function catalogChips(equipment = []) {
  const chips = [];
  for (const group of MACHINE_CATALOG) {
    for (const kg of group.capacities) {
      const item = equipment.find(
        (entry) =>
          entry?.type === group.type &&
          capacityKg(entry.capacity) === kg &&
          Number.isInteger(entry.quantity) &&
          entry.quantity > 0,
      );
      if (!item) continue;
      chips.push({
        key: countEquipmentId(group.type, kg),
        label: `${group.type} ${kg}KG｜${item.quantity}台`,
      });
    }
  }
  return chips;
}
export function isPlainCatalogCount(entry) {
  const kg = capacityKg(entry?.capacity);
  if (!isOfficialCount(entry?.type, kg)) return false;
  return !(
    entry.model ||
    entry.price ||
    entry.specification ||
    entry.number ||
    entry.providerKey ||
    entry.photos?.length
  );
}
