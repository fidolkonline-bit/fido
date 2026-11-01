import "server-only";
import { Prisma } from "@prisma/client";
import { db, posting } from "./db";
import { D } from "./money";
import type { CurrentUser } from "./auth";

export class ImportError extends Error {}

// Minimal RFC 4180 CSV: quoted fields, escaped quotes, CRLF. Values stay text (IMEIs and SKUs keep leading zeros).
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((x) => x.trim() !== ""));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export const TEMPLATES = {
  CONTACTS: "type,code,name,phone,email,address,group,credit_limit,pay_terms_days,opening_balance,tax_number\ncustomer,C-0001,Nimal Perera,0771234567,,Kandy,Retail,10000,30,2500,\nsupplier,S-0001,ABC Accessories,0112345678,,Colombo,,,,15000,\n",
  CATEGORIES: "legacy_id,name,parent,pool_rate,user_share,agent_share\n101,Back Covers,,9,22.22,77.78\n102,Charging Docks,,3,33,66\n",
  PRODUCTS: "sku,name,category,brand,unit,sell_price,min_price,cost,alert_qty,barcode,track_imei\nD-301,Tempered glass iPhone 15,Screen Guards,Generic,Pieces,750,,250,5,,no\n",
  OPENING_STOCK: "sku,qty,unit_cost,lot,imei,imei2,serial,condition\nD-301,25,250,OPEN-2026,,,,\nD-201,1,52000,OPEN-2026,356789012345678,,,new\n",
} as const;

type RowResult = { line: number; status: "OK" | "ERROR" | "SKIP"; action?: string; message?: string; data?: Record<string, unknown> };
const num = (v: string) => (v === "" ? null : Number(v.replace(/,/g, "")));
const yes = (v: string) => /^(y|yes|true|1)$/i.test(v);

// Dry run: validate every row against the live catalog and store the verdict. Nothing else is written.
export type ImportKind = "PRODUCTS" | "OPENING_STOCK" | "CONTACTS" | "CATEGORIES";

export async function dryRun(user: CurrentUser, kind: ImportKind, fileName: string, text: string, existing: "UPDATE" | "SKIP") {
  const rows = parseCsv(text);
  if (!rows.length) throw new ImportError("The file has no data rows (the first row must be the column headings).");
  if (rows.length > 5000) throw new ImportError("Import at most 5,000 rows per file.");
  const results: RowResult[] = [];

  if (kind === "PRODUCTS") {
    if (!("sku" in rows[0]) || !("name" in rows[0])) throw new ImportError("Columns sku and name are required. Download the template.");
    const existingSkus = new Set((await db.product.findMany({ where: { sku: { in: rows.map((r) => r.sku) } }, select: { sku: true } })).map((p) => p.sku));
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const line = i + 2;
      const errs: string[] = [];
      if (!r.sku) errs.push("SKU is empty");
      if (!r.name) errs.push("name is empty");
      if (seen.has(r.sku)) errs.push(`SKU ${r.sku} appears twice in this file`);
      seen.add(r.sku);
      for (const k of ["sell_price", "min_price", "cost", "alert_qty"]) {
        const v = num(r[k] ?? "");
        if (v !== null && (!Number.isFinite(v) || v < 0)) errs.push(`${k} is not a valid number`);
      }
      if (errs.length) return results.push({ line, status: "ERROR", message: errs.join("; "), data: r });
      const exists = existingSkus.has(r.sku);
      if (exists && existing === "SKIP") return results.push({ line, status: "SKIP", message: `SKU ${r.sku} already exists`, data: r });
      results.push({ line, status: "OK", action: exists ? "update" : "create", data: r });
    });
  } else if (kind === "CONTACTS") {
    if (!("name" in rows[0])) throw new ImportError("Column name is required. Download the template.");
    const codes = rows.map((r) => r.code).filter(Boolean);
    const existingCodes = new Set((await db.contact.findMany({ where: { code: { in: codes } }, select: { code: true } })).map((c) => c.code));
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const line = i + 2;
      const errs: string[] = [];
      const type = (r.type || "customer").toLowerCase();
      if (!["customer", "supplier", "both"].includes(type)) errs.push("type must be customer, supplier or both");
      if (!r.name) errs.push("name is empty");
      if (r.code && seen.has(r.code)) errs.push(`code ${r.code} appears twice in this file`);
      if (r.code) seen.add(r.code);
      for (const k of ["credit_limit", "pay_terms_days", "opening_balance"]) { const v = num(r[k] ?? ""); if (v !== null && !Number.isFinite(v)) errs.push(`${k} is not a number`); }
      if (errs.length) return results.push({ line, status: "ERROR", message: errs.join("; "), data: r });
      const exists = !!r.code && existingCodes.has(r.code);
      if (exists && existing === "SKIP") return results.push({ line, status: "SKIP", message: `code ${r.code} already exists`, data: r });
      results.push({ line, status: "OK", action: exists ? "update" : "create", data: r });
    });
  } else if (kind === "CATEGORIES") {
    if (!("name" in rows[0]) || !("pool_rate" in rows[0])) throw new ImportError("Columns name and pool_rate are required. Download the template.");
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const line = i + 2;
      const errs: string[] = [];
      const pool = num(r.pool_rate ?? ""), u = num(r.user_share ?? "") ?? 0, a = num(r.agent_share ?? "") ?? 0;
      if (!r.name) errs.push("name is empty");
      if (pool === null || !Number.isFinite(pool) || pool < 0 || pool > 100) errs.push("pool_rate must be 0–100 (percent)");
      if (![u, a].every((x) => Number.isFinite(x) && x >= 0 && x <= 100)) errs.push("shares must be 0–100 (percent of the pool)");
      if (r.legacy_id && seen.has(r.legacy_id)) errs.push(`legacy_id ${r.legacy_id} appears twice`);
      if (r.legacy_id) seen.add(r.legacy_id);
      if (errs.length) return results.push({ line, status: "ERROR", message: errs.join("; "), data: r });
      // Do not normalise legacy share totals (e.g. 33% + 66% = 99%): import as-is and flag (spec §9.2).
      const warn = u + a > 0 && Math.abs(u + a - 100) > 0.01 ? `shares total ${u + a}% — imported as-is, review the rule` : undefined;
      results.push({ line, status: "OK", action: "create or update", message: warn, data: r });
    });
  } else {
    if (!user.location) throw new ImportError("No location assigned for opening stock.");
    if (!("sku" in rows[0]) || !("qty" in rows[0])) throw new ImportError("Columns sku and qty are required. Download the template.");
    const products = await db.product.findMany({ where: { sku: { in: rows.map((r) => r.sku) } }, select: { id: true, sku: true, trackDevices: true, stockManaged: true, defaultCost: true } });
    const bySku = new Map(products.map((p) => [p.sku, p]));
    const imeis = rows.map((r) => r.imei).filter(Boolean);
    const inStock = new Set((await db.deviceIdentity.findMany({ where: { imei1: { in: imeis }, state: { notIn: ["SOLD", "WRITTEN_OFF"] } }, select: { imei1: true } })).map((d) => d.imei1));
    const seenImei = new Set<string>();
    rows.forEach((r, i) => {
      const line = i + 2;
      const errs: string[] = [];
      const p = bySku.get(r.sku);
      const qty = num(r.qty ?? "");
      const cost = num(r.unit_cost ?? "") ?? (p ? Number(p.defaultCost) : null);
      if (!p) errs.push(`no product with SKU ${r.sku || "(empty)"}`);
      else if (!p.stockManaged) errs.push("product is not stock-managed");
      if (qty === null || !Number.isFinite(qty) || qty <= 0) errs.push("qty must be more than 0");
      if (cost === null || !Number.isFinite(cost) || cost < 0) errs.push("unit_cost is missing or invalid");
      if (p?.trackDevices) {
        if (qty !== 1) errs.push("IMEI-tracked products need one row per device (qty 1)");
        if (!r.imei && !r.serial) errs.push("IMEI or serial is required for this product");
        if (r.imei && !/^\d{14,17}$/.test(r.imei)) errs.push("IMEI must be 14–17 digits");
        if (r.imei && inStock.has(r.imei)) errs.push(`IMEI ${r.imei} is already in stock`);
        if (r.imei && seenImei.has(r.imei)) errs.push(`IMEI ${r.imei} appears twice in this file`);
        if (r.imei) seenImei.add(r.imei);
      } else if (r.imei) errs.push("this product is not IMEI-tracked; leave imei empty");
      if (errs.length) return results.push({ line, status: "ERROR", message: errs.join("; "), data: r });
      results.push({ line, status: "OK", action: "add stock", data: { productId: p!.id, sku: r.sku, qty, cost, lot: r.lot || null, imei: r.imei || null, imei2: r.imei2 || null, serial: r.serial || null, condition: /used/i.test(r.condition ?? "") ? "USED" : "NEW" } });
    });
  }

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.status === "OK").length,
    errors: results.filter((r) => r.status === "ERROR").length,
    skipped: results.filter((r) => r.status === "SKIP").length,
    existing,
  };
  const batch = await db.importBatch.create({
    data: { kind, fileName: fileName.slice(0, 200), rows: results as unknown as Prisma.InputJsonValue, summary, locationId: user.location?.id ?? null, createdById: user.personId },
  });
  return batch.id;
}

// Commit the valid rows of a reviewed dry run, in bulk statements so large files fit in one transaction.
export async function commitBatch(user: CurrentUser, batchId: string) {
  return posting(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ImportBatch" WHERE id = ${batchId} FOR UPDATE`;
    const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (batch.status !== "DRY_RUN") throw new ImportError("This import has already been committed or discarded.");
    const ok = (batch.rows as unknown as RowResult[]).filter((r) => r.status === "OK");
    if (!ok.length) throw new ImportError("There are no valid rows to import.");

    if (batch.kind === "PRODUCTS") {
      const data = ok.map((r) => r.data as Record<string, string>);
      const named = async (names: string[], model: "brand" | "unit" | "category") => {
        const wanted = [...new Set(names.filter(Boolean))];
        const map = new Map<string, string>();
        for (const name of wanted) {
          const found = model === "brand" ? await tx.brand.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })
            : model === "unit" ? await tx.unit.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })
            : await tx.category.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
          const id = found?.id ?? (model === "brand" ? (await tx.brand.create({ data: { name } })).id
            : model === "unit" ? (await tx.unit.create({ data: { name, shortName: name } })).id
            : (await tx.category.create({ data: { name } })).id);
          map.set(name.toLowerCase(), id);
        }
        return map;
      };
      const brands = await named(data.map((r) => r.brand), "brand");
      const units = await named(data.map((r) => r.unit), "unit");
      const cats = await named(data.map((r) => r.category), "category");
      const fields = (r: Record<string, string>) => ({
        name: r.name,
        ...(r.barcode ? { barcode: r.barcode } : {}),
        ...(r.category ? { categoryId: cats.get(r.category.toLowerCase()) } : {}),
        ...(r.brand ? { brandId: brands.get(r.brand.toLowerCase()) } : {}),
        ...(r.unit ? { unitId: units.get(r.unit.toLowerCase()) } : {}),
        ...(num(r.sell_price ?? "") !== null ? { sellPrice: D(num(r.sell_price)!) } : {}),
        ...(num(r.min_price ?? "") !== null ? { minSellPrice: D(num(r.min_price)!) } : {}),
        ...(num(r.cost ?? "") !== null ? { defaultCost: D(num(r.cost)!) } : {}),
        ...(num(r.alert_qty ?? "") !== null ? { alertQty: D(num(r.alert_qty)!) } : {}),
        ...(r.track_imei ? { trackDevices: yes(r.track_imei) } : {}),
      });
      const creates = ok.filter((r) => r.action === "create").map((r) => ({ sku: (r.data as Record<string, string>).sku, ...fields(r.data as Record<string, string>) }));
      if (creates.length) await tx.product.createMany({ data: creates });
      for (const r of ok.filter((x) => x.action === "update")) {
        const d = r.data as Record<string, string>;
        await tx.product.update({ where: { sku: d.sku }, data: fields(d) });
      }
    } else if (batch.kind === "CONTACTS") {
      for (const r of ok) {
        const d = r.data as Record<string, string>;
        const type = (d.type || "customer").toLowerCase();
        let groupId: string | null = null;
        if (d.group) groupId = (await tx.customerGroup.upsert({ where: { name: d.group }, update: {}, create: { name: d.group } })).id;
        const data = {
          name: d.name, isCustomer: type !== "supplier", isSupplier: type !== "customer", phone: d.phone || null, email: d.email || null, address: d.address || null,
          taxNumber: d.tax_number || null, groupId, creditLimit: num(d.credit_limit ?? "") ?? null, payTermDays: num(d.pay_terms_days ?? "") ?? null,
          openingBalance: D(num(d.opening_balance ?? "") ?? 0),
        };
        if (d.code && r.action === "update") await tx.contact.update({ where: { code: d.code }, data });
        else await tx.contact.create({ data: { ...data, code: d.code || null } });
      }
    } else if (batch.kind === "CATEGORIES") {
      const rows = ok.map((r) => r.data as Record<string, string>);
      // Parents first so children can link to them.
      for (const pass of [false, true]) {
        for (const d of rows.filter((x) => !!x.parent === pass)) {
          const parent = d.parent ? await tx.category.findFirst({ where: { name: { equals: d.parent, mode: "insensitive" }, parentId: null } }) : null;
          const data = { name: d.name, parentId: parent?.id ?? null, poolRate: D(num(d.pool_rate)!).div(100), userShare: D(num(d.user_share ?? "") ?? 0).div(100), agentShare: D(num(d.agent_share ?? "") ?? 0).div(100), legacyId: d.legacy_id || null };
          const found = d.legacy_id ? await tx.category.findFirst({ where: { legacyId: d.legacy_id } }) : await tx.category.findFirst({ where: { name: { equals: d.name, mode: "insensitive" }, parentId: data.parentId } });
          if (found) await tx.category.update({ where: { id: found.id }, data });
          else await tx.category.create({ data });
        }
      }
    } else {
      const locationId = batch.locationId!;
      type Row = { productId: string; qty: number; cost: number; lot: string | null; imei: string | null; imei2: string | null; serial: string | null; condition: string };
      const data = ok.map((r) => r.data as unknown as Row);
      const now = new Date();
      const layers = await tx.costLayer.createManyAndReturn({
        data: data.map((r) => ({
          productId: r.productId, locationId, lotCode: r.lot, qtyIn: D(r.qty), qtyRemaining: D(r.qty), unitCost: D(r.cost),
          receivedAt: now, sourceType: "ImportBatch", sourceId: batch.id,
        })),
        select: { id: true },
      });
      await tx.stockMovement.createMany({
        data: data.map((r, i) => ({
          productId: r.productId, locationId, costLayerId: layers[i].id, qty: D(r.qty), unitCost: D(r.cost),
          kind: "OPENING", sourceType: "ImportBatch", sourceId: batch.id, reference: `IMPORT ${batch.fileName}`.slice(0, 120), actorId: user.personId,
        })),
      });
      const devices = data.map((r, i) => ({ r, layerId: layers[i].id })).filter(({ r }) => r.imei || r.serial);
      if (devices.length) {
        await tx.deviceIdentity.createMany({
          data: devices.map(({ r, layerId }) => ({ productId: r.productId, costLayerId: layerId, locationId, imei1: r.imei, imei2: r.imei2, serial: r.serial, condition: r.condition })),
        });
      }
    }
    await tx.importBatch.update({ where: { id: batch.id }, data: { status: "COMMITTED", committedAt: new Date() } });
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "IMPORT_COMMITTED", subjectType: "ImportBatch", subjectId: batch.id, detail: { kind: batch.kind, rows: ok.length } } });
    return { imported: ok.length };
  }, 120_000);
}
