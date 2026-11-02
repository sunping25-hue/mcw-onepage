import { z } from "zod";
const link = z
  .string()
  .max(2000)
  .refine(
    (v) =>
      !v ||
      (() => {
        try {
          const u = new URL(v);
          return u.protocol === "https:" && !u.username && !u.password;
        } catch {
          return false;
        }
      })(),
    "請使用 HTTPS 網址",
  );
const youtube = link.refine((v) => {
  if (!v) return true;
  try {
    return [
      "youtube.com",
      "www.youtube.com",
      "youtu.be",
      "m.youtube.com",
    ].includes(new URL(v).hostname);
  } catch {
    return false;
  }
}, "請填寫 YouTube 網址");
const photo = z.string().regex(/^\/uploads\/[a-f0-9-]+\.webp$/);
export const equipmentSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(["洗脫烘", "雙層烘", "加水站"]),
  model: z.string().max(100),
  capacity: z.string().max(100),
  quantity: z.number().int().min(1).max(1000),
  price: z.string().max(200),
  providerKey: z.string().max(100).default(""),
});
export const storeSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    city: z.string().max(20),
    address: z.string().max(300),
    phone: z
      .string()
      .regex(/^[+\d ()-]*$/)
      .max(40),
    hours: z.string().max(200),
    announcement: z.string().max(2000),
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
    confirmed: z.boolean(),
    published: z.boolean(),
    photos: z.array(photo).max(12),
    equipment: z.array(equipmentSchema).max(100),
    tutorials: z
      .array(
        z.object({
          category: z.enum(["洗脫烘", "雙層烘", "付款"]),
          title: z.string().min(1).max(100),
          url: youtube.refine(Boolean),
        }),
      )
      .max(30),
    aiUrl: link,
    reviewUrl: link,
    franchiseUrl: link,
    provider: z.enum(["unconnected", "demo"]).default("unconnected"),
    providerReference: z.string().max(200).default(""),
  })
  .superRefine((s, c) => {
    if (
      s.published &&
      (!s.confirmed ||
        !s.address ||
        !s.city ||
        s.lat === null ||
        s.lng === null)
    )
      c.addIssue({
        code: "custom",
        message: "公開門市必須確認資料並提供縣市、地址與座標",
      });
    if (new Set(s.equipment.map((e) => e.id)).size !== s.equipment.length)
      c.addIssue({ code: "custom", message: "設備 ID 不可重複" });
  });
export const settingsSchema = z.object({ franchiseUrl: link, lineUrl: link });
export const machineStatusSchema = z.object({
  machine_id: z.string(),
  status: z.enum(["idle", "running", "fault", "offline", "unknown"]),
  last_updated: z.string().datetime().nullable(),
  ttl_seconds: z.number().int().positive(),
  source: z.enum(["unconnected", "demo", "manufacturer"]),
  simulated: z.boolean(),
});
/** Future API/MQTT adapters implement async getStatuses(equipment). Never pass secrets to the client. */
export class MachineStatusProvider {
  async getStatuses(equipment) {
    return equipment.map((e) => ({
      machine_id: e.id,
      status: "unknown",
      last_updated: null,
      ttl_seconds: 60,
      source: "unconnected",
      simulated: false,
    }));
  }
}
export class StubMachineStatusProvider extends MachineStatusProvider {
  async getStatuses(equipment) {
    return equipment.map((e, i) => ({
      machine_id: e.id,
      status: ["idle", "running", "fault", "offline", "unknown"][i % 5],
      last_updated: new Date().toISOString(),
      ttl_seconds: 60,
      source: "demo",
      simulated: true,
    }));
  }
}
export function normalizeStatus(raw, now = Date.now()) {
  const s = machineStatusSchema.parse(raw);
  const age = s.last_updated ? now - Date.parse(s.last_updated) : Infinity;
  return {
    ...s,
    status: age > s.ttl_seconds * 1000 || age < 0 ? "unknown" : s.status,
  };
}
export function publicStore(s) {
  const { providerReference, provider, ...rest } = s;
  return {
    ...rest,
    equipment: rest.equipment.map(({ providerKey, ...e }) => e),
  };
}

/** Integration seam for a trusted server-side API/MQTT snapshot reader; not enabled publicly. */
export class ManufacturerApiAdapter extends MachineStatusProvider {
  constructor(readSnapshot) {
    super();
    this.readSnapshot = readSnapshot;
  }
  async getStatuses(equipment) {
    const unknown = await super.getStatuses(equipment);
    let snapshots;
    try {
      snapshots = await this.readSnapshot(
        equipment.map((e) => ({ id: e.id, providerKey: e.providerKey })),
      );
    } catch {
      return unknown;
    }
    if (!Array.isArray(snapshots)) return unknown;
    return equipment.map((e, i) => {
      const raw = snapshots.find((s) => s?.machine_id === e.id);
      const checked = machineStatusSchema.safeParse(raw);
      if (
        !checked.success ||
        checked.data.source !== "manufacturer" ||
        checked.data.simulated
      )
        return unknown[i];
      return normalizeStatus(checked.data);
    });
  }
}
