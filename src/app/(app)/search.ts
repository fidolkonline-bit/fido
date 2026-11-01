"use server";

import { db } from "@/lib/db";
import { requireUser, can } from "@/lib/auth";
import { availability } from "@/lib/stock";
import { activeRules, ruleFor, perUnitDiscount } from "@/lib/discounts";

export type DeviceHit = { id: string; imei1: string | null; imei2: string | null; serial: string | null; condition: string };
export type ProductHit = {
  id: string; sku: string; barcode: string | null; name: string; price: string; minPrice: string | null; cost: string | null;
  available: string | null; lot: string | null; tracked: boolean; device?: DeviceHit;
  offer: { ruleId: string; name: string; perUnit: string } | null;
};

const deviceSelect = { id: true, imei1: true, imei2: true, serial: true, condition: true } as const;

// Scan/search by SKU, barcode, name, lot code or IMEI/serial (spec §8.1). Exact SKU/barcode/IMEI matches come first.
export async function searchProducts(q: string, forSale = true): Promise<ProductHit[]> {
  const user = await requireUser();
  if (!can(user, "products.view") && !can(user, "sales.create")) return [];
  const term = q.trim();
  if (!term) return [];
  const loc = user.location?.id;

  // A scanned IMEI or serial resolves to that exact device in saleable stock here.
  const device = loc
    ? await db.deviceIdentity.findFirst({
        where: { locationId: loc, state: "SALEABLE", OR: [{ imei1: term }, { imei2: term }, { serial: term }] },
        select: { ...deviceSelect, productId: true },
      })
    : null;

  const products = await db.product.findMany({
    where: {
      active: true,
      ...(forSale ? { notForSale: false } : {}),
      OR: [
        ...(device ? [{ id: device.productId }] : []),
        { sku: { equals: term, mode: "insensitive" } },
        { barcode: term },
        { name: { contains: term, mode: "insensitive" } },
        { sku: { startsWith: term, mode: "insensitive" } },
        { costLayers: { some: { lotCode: { equals: term, mode: "insensitive" }, qtyRemaining: { gt: 0 } } } },
      ],
    },
    take: 20,
    orderBy: { name: "asc" },
  });
  const exact = (p: (typeof products)[number]) => p.id === device?.productId || p.sku.toLowerCase() === term.toLowerCase() || p.barcode === term;
  products.sort((a, b) => Number(exact(b)) - Number(exact(a)));

  return toHits(user, products, device);
}

type Prod = Awaited<ReturnType<typeof db.product.findMany>>[number];
async function toHits(user: Awaited<ReturnType<typeof requireUser>>, products: Prod[], device: { id: string; productId: string; imei1: string | null; imei2: string | null; serial: string | null; condition: string } | null): Promise<ProductHit[]> {
  const loc = user.location?.id;
  const stock = loc ? await availability(loc, products.map((p) => p.id)) : new Map();
  const nextLots = loc
    ? await db.costLayer.findMany({
        where: { productId: { in: products.map((p) => p.id) }, locationId: loc, bucket: "SALEABLE", qtyRemaining: { gt: 0 } },
        orderBy: { receivedAt: "asc" }, distinct: ["productId"], select: { productId: true, lotCode: true },
      })
    : [];
  const lotOf = new Map(nextLots.map((l) => [l.productId, l.lotCode]));
  const showCost = can(user, "cost.view");
  const rules = await activeRules(loc ?? null);

  return products.map((p) => ({
    id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, price: p.sellPrice.toFixed(2), minPrice: p.minSellPrice?.toFixed(2) ?? null,
    cost: showCost ? p.defaultCost.toString() : null,
    available: p.stockManaged ? (stock.get(p.id)?.toString() ?? "0") : null,
    lot: lotOf.get(p.id) ?? null,
    tracked: p.trackDevices,
    offer: (() => { const r = ruleFor(rules, p); return r ? { ruleId: r.id, name: r.name, perUnit: perUnitDiscount(r, p.sellPrice).toFixed(2) } : null; })(),
    ...(device && device.productId === p.id ? { device: { id: device.id, imei1: device.imei1, imei2: device.imei2, serial: device.serial, condition: device.condition } } : {}),
  }));
}

// Cart rows for a quote / suspended sale being resumed at the POS (current price, stock and offers).
export async function productHits(ids: string[]): Promise<ProductHit[]> {
  const user = await requireUser();
  if (!can(user, "sales.create")) return [];
  return toHits(user, await db.product.findMany({ where: { id: { in: ids }, active: true } }), null);
}

// Devices of one product available at the current location (or in a given state, e.g. HELD for release).
export async function listDevices(productId: string, state = "SALEABLE"): Promise<DeviceHit[]> {
  const user = await requireUser();
  if (!user.location || (!can(user, "products.view") && !can(user, "sales.create"))) return [];
  return db.deviceIdentity.findMany({
    where: { productId, locationId: user.location.id, state },
    select: deviceSelect,
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}

export type LayerHit = { id: string; lotCode: string | null; qtyRemaining: string; bucket: string; unitCost: string | null; receivedAt: string };

// Lots of one product at the current location, oldest first, for explicit lot choice.
export async function listLayers(productId: string, buckets: string[] = ["SALEABLE"]): Promise<LayerHit[]> {
  const user = await requireUser();
  if (!user.location || !can(user, "products.view")) return [];
  const rows = await db.costLayer.findMany({
    where: { productId, locationId: user.location.id, bucket: { in: buckets }, qtyRemaining: { gt: 0 } },
    orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
    take: 50,
  });
  const showCost = can(user, "cost.view");
  return rows.map((l) => ({
    id: l.id, lotCode: l.lotCode, qtyRemaining: l.qtyRemaining.toString(), bucket: l.bucket,
    unitCost: showCost ? l.unitCost.toString() : null, receivedAt: l.receivedAt.toISOString(),
  }));
}
