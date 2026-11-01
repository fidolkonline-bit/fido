import "server-only";
import { Prisma } from "@prisma/client";
import { db, posting } from "./db";
import { D } from "./money";
import type { CurrentUser } from "./auth";
import { parseCsv } from "./csv";

export class ImportError extends Error {}

export { parseCsv } from "./csv";

export const TEMPLATES = {
  CONTACTS: "type,code,name,phone,email,address,group,credit_limit,pay_terms_days,opening_balance,store_credit,tax_number\ncustomer,C-0001,Nimal Perera,0771234567,,Kandy,Retail,10000,30,2500,,\nsupplier,S-0001,ABC Accessories,0112345678,,Colombo,,,,15000,,\n",
  PEOPLE: "code,name,phone,kind\n2023/0044,Hashan Kulasingha,0716027835,AGENT\n",
  CATEGORIES: "legacy_id,name,parent,pool_rate,user_share,agent_share\n101,Back Covers,,9,22.22,77.78\n102,Charging Docks,,3,33,66\n",
  PRODUCTS: "sku,name,category,brand,unit,sell_price,min_price,cost,alert_qty,barcode,track_imei,stock_managed\nD-301,Tempered glass iPhone 15,Accessories > Screen Guards,Generic,Pieces,750,,250,5,,no,yes\n",
  OPENING_STOCK: "sku,qty,unit_cost,lot,imei,imei2,serial,condition,location\nD-301,25,250,OPEN-2026,,,,,\nD-201,1,52000,OPEN-2026,356789012345678,,,new,\n",
} as const;

type RowResult = { line: number; status: "OK" | "ERROR" | "SKIP"; action?: string; message?: string; data?: Record<string, unknown> };
const num = (v: string) => (v === "" ? null : Number(v.replace(/,/g, "")));
const yes = (v: string) => /^(y|yes|true|1)$/i.test(v);

// Dry run: validate every row against the live catalog and store the verdict. Nothing else is written.
export type ImportKind = "PRODUCTS" | "OPENING_STOCK" | "CONTACTS" | "CATEGORIES" | "PEOPLE";

// `notes` are file-level findings from a converter (e.g. the Clicky export reader); stored with the batch for review.
const tierColumns = async () => (await db.priceGroup.findMany({ select: { id: true, name: true } })).map((g) => ({ ...g, key: g.name.trim().toLowerCase().replace(/[\s-]+/g, "_") }));

export async function dryRun(user: CurrentUser, kind: ImportKind, fileName: string, text: string, existing: "UPDATE" | "SKIP", notes: string[] = []) {
  const rows = parseCsv(text);
  if (!rows.length) throw new ImportError("The file has no data rows (the first row must be the column headings).");
  if (rows.length > 5000) throw new ImportError("Import at most 5,000 rows per file.");
  const results: RowResult[] = [];

  if (kind === "PRODUCTS") {
    if (!("sku" in rows[0]) || !("name" in rows[0])) throw new ImportError("Columns sku and name are required. Download the template.");
    // A column named after a price tier (e.g. "VIP Customer Prices") sets that tier's price. Legacy 0s stay unverified.
    const tierCols = (await tierColumns()).filter((t) => t.key in rows[0]);
    if (tierCols.length) notes = [...notes, `Tier prices from columns: ${tierCols.map((t) => t.name).join(", ")}. Empty = default price; 0 is kept but not used as free until confirmed on the product.`];
    const existingSkus = new Set((await db.product.findMany({ where: { sku: { in: rows.map((r) => r.sku) } }, select: { sku: true } })).map((p) => p.sku));
    // Excel turns "0005" into "5": catch a new numeric SKU that matches an existing one apart from its leading zeros.
    const padded = new Map((await db.product.findMany({ where: { sku: { startsWith: "0" } }, select: { sku: true } })).filter((p) => /^\d+$/.test(p.sku)).map((p) => [p.sku.replace(/^0+/, ""), p.sku]));
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const line = i + 2;
      const errs: string[] = [];
      if (!r.sku) errs.push("SKU is empty");
      if (!r.name) errs.push("name is empty");
      if (seen.has(r.sku)) errs.push(`SKU ${r.sku} appears twice in this file`);
      if (!existingSkus.has(r.sku) && padded.has(r.sku)) errs.push(`SKU ${r.sku} looks like ${padded.get(r.sku)} with its leading zeros lost (Excel does this) — fix the SKU column`);
      seen.add(r.sku);
      for (const k of ["sell_price", "min_price", "cost", "alert_qty", ...tierCols.map((t) => t.key)]) {
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
      const credit = num(r.store_credit ?? "");
      if (credit !== null && (!Number.isFinite(credit) || credit < 0)) errs.push("store_credit must be a positive number");
      if (errs.length) return results.push({ line, status: "ERROR", message: errs.join("; "), data: r });
      const exists = !!r.code && existingCodes.has(r.code);
      if (exists && existing === "SKIP") return results.push({ line, status: "SKIP", message: `code ${r.code} already exists`, data: r });
      const note = [r.note, exists && credit ? "store credit is only added for new contacts; adjust it by hand" : ""].filter(Boolean).join("; ");
      results.push({ line, status: "OK", action: exists ? "update" : "create", message: note || undefined, data: r });
    });
  } else if (kind === "CATEGORIES") {
    if (!("name" in rows[0]) || !("pool_rate" in rows[0])) throw new ImportError("Columns name and pool_rate are required. Download the template.");
    // match=name (Clicky): the rate applies to every category with that name, whatever its parent.
    const all = await db.category.findMany({ include: { parent: true, _count: { select: { products: true } } } });
    const path = (c: (typeof all)[number]) => (c.parent ? `${c.parent.name} > ${c.name}` : c.name);
    const byName = (n: string) => all.filter((c) => c.name.toLowerCase() === n.toLowerCase());
    const rated = new Set<string>();
    const byNameSeen = new Map<string, string>();
    const fileRate = new Map(rows.filter((r) => r.match === "name").map((r) => [r.name.toLowerCase(), num(r.pool_rate)]));
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const line = i + 2;
      const errs: string[] = [];
      const pool = num(r.pool_rate ?? ""), u = num(r.user_share ?? "") ?? 0, a = num(r.agent_share ?? "") ?? 0;
      if (!r.name) errs.push("name is empty");
      if (pool === null || !Number.isFinite(pool) || pool < 0 || pool > 100) errs.push("pool_rate must be 0–100 (percent)");
      if (![u, a].every((x) => Number.isFinite(x) && x >= 0 && x <= 100)) errs.push("shares must be 0–100 (percent of the pool)");
      if (r.legacy_id && seen.has(r.legacy_id)) errs.push(`legacy_id ${r.legacy_id} appears twice`);
      const rates = `${r.pool_rate}/${r.user_share}/${r.agent_share}`;
      if (r.match === "name") {
        const prev = byNameSeen.get(r.name.toLowerCase());
        if (prev !== undefined && prev !== rates) errs.push(`${r.name} appears twice with different rates`);
        if (prev === rates) return results.push({ line, status: "SKIP", message: "same name and rates as an earlier row", data: r });
        byNameSeen.set(r.name.toLowerCase(), rates);
      }
      if (r.legacy_id) seen.add(r.legacy_id);
      if (errs.length) return results.push({ line, status: "ERROR", message: errs.join("; "), data: r });
      // Do not normalise legacy share totals (e.g. 33% + 66% = 99%): import as-is and flag (spec §9.2).
      const warn = u + a > 0 && Math.abs(u + a - 100) > 0.01 ? `shares total ${u + a}% — imported as-is, review the rule` : undefined;
      if (r.match === "name") {
        const targets = byName(r.name);
        if (!targets.length) return results.push({ line, status: "SKIP", message: "no Fido category has this name (no product uses it)", data: r });
        targets.forEach((c) => rated.add(c.id));
        const parents = new Set(targets.map((c) => c.parentId));
        const mixed = targets.filter((c) => c.parent && fileRate.has(c.parent.name.toLowerCase()) && fileRate.get(c.parent.name.toLowerCase()) !== num(r.pool_rate));
        const msg = [warn, r.note, parents.size > 1 || targets.length > 1 ? `applies to ${targets.map(path).join(", ")}` : `applies to ${path(targets[0])}`,
          mixed.length ? "main category has a different rate — products here use this sub-category rate" : ""].filter(Boolean).join("; ");
        return results.push({ line, status: "OK", action: `rate ${targets.length} categor${targets.length === 1 ? "y" : "ies"}`, message: msg, data: { ...r, ids: targets.map((c) => c.id) } });
      }
      results.push({ line, status: "OK", action: "create or update", message: warn, data: r });
    });
    if (rows.some((r) => r.match === "name")) {
      const left = all.filter((c) => !rated.has(c.id) && c._count.products > 0).sort((x, y) => y._count.products - x._count.products);
      if (left.length) notes = [...notes, `Still without a rate after this file (${left.length}): ${left.map((c) => `${path(c)} (${c._count.products} products)`).join("; ")}. Their current rate is kept.`];
    }
  } else if (kind === "PEOPLE") {
    if (!("name" in rows[0])) throw new ImportError("Column name is required. Download the template.");
    const codes = rows.map((r) => r.code).filter(Boolean);
    const existingCodes = new Set((await db.commissionProfile.findMany({ where: { code: { in: codes } }, select: { code: true } })).map((c) => c.code));
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const line = i + 2;
      const errs: string[] = [];
      const kind = (r.kind || "AGENT").toUpperCase();
      if (!r.name) errs.push("name is empty");
      if (!["AGENT", "USER", "BOTH", "NONE"].includes(kind)) errs.push("kind must be AGENT, USER, BOTH or NONE");
      if (r.code && seen.has(r.code)) errs.push(`code ${r.code} appears twice in this file`);
      if (r.code) seen.add(r.code);
      if (errs.length) return results.push({ line, status: "ERROR", message: errs.join("; "), data: r });
      const exists = !!r.code && existingCodes.has(r.code);
      if (exists && existing === "SKIP") return results.push({ line, status: "SKIP", message: `code ${r.code} already exists`, data: r });
      results.push({ line, status: "OK", action: exists ? "update" : "create", message: r.note || undefined, data: r });
    });
  } else {
    if (!user.location) throw new ImportError("No location assigned for opening stock.");
    const locations = await db.location.findMany({ where: { active: true }, select: { id: true, name: true, code: true } });
    const findLoc = (v: string) => locations.find((l) => l.name.toLowerCase() === v.toLowerCase() || l.code.toLowerCase() === v.toLowerCase());
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
      const loc = r.location ? findLoc(r.location) : user.location;
      if (!loc) errs.push(`no location named “${r.location}” — add it in Settings › Business & locations, or rename the existing one to match`);
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
      results.push({ line, status: "OK", action: "add stock", data: { productId: p!.id, sku: r.sku, locationId: loc!.id, location: r.location || null, qty, cost, lot: r.lot || null, imei: r.imei || null, imei2: r.imei2 || null, serial: r.serial || null, condition: /used/i.test(r.condition ?? "") ? "USED" : "NEW" } });
    });
  }

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.status === "OK").length,
    errors: results.filter((r) => r.status === "ERROR").length,
    skipped: results.filter((r) => r.status === "SKIP").length,
    existing,
    notes,
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
      // "Parent > Child" finds or creates both levels. Same names under different parents stay separate (spec §22).
      const category = async (path: string) => {
        let parentId: string | null = null;
        let node: { id: string } | null = null;
        for (const name of path.split(">").map((x) => x.trim()).filter(Boolean)) {
          node = await tx.category.findFirst({ where: { name: { equals: name, mode: "insensitive" }, parentId } }) ?? await tx.category.create({ data: { name, parentId } });
          parentId = node.id;
        }
        return node;
      };
      const named = async (names: string[], model: "brand" | "unit" | "category") => {
        const wanted = [...new Set(names.filter(Boolean))];
        const map = new Map<string, string>();
        for (const name of wanted) {
          const found = model === "brand" ? await tx.brand.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })
            : model === "unit" ? await tx.unit.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })
            : await category(name);
          const id = found?.id ?? (model === "brand" ? (await tx.brand.create({ data: { name } })).id
            : (await tx.unit.create({ data: { name, shortName: name } })).id);
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
        ...(r.stock_managed ? { stockManaged: yes(r.stock_managed) } : {}),
      });
      const creates = ok.filter((r) => r.action === "create").map((r) => ({ sku: (r.data as Record<string, string>).sku, ...fields(r.data as Record<string, string>) }));
      if (creates.length) await tx.product.createMany({ data: creates });
      for (const r of ok.filter((x) => x.action === "update")) {
        const d = r.data as Record<string, string>;
        await tx.product.update({ where: { sku: d.sku }, data: fields(d) });
      }
      const tierCols = (await tierColumns()).filter((t) => data.some((r) => (r[t.key] ?? "") !== ""));
      if (tierCols.length) {
        const ids = new Map((await tx.product.findMany({ where: { sku: { in: data.map((r) => r.sku) } }, select: { id: true, sku: true } })).map((p) => [p.sku, p.id]));
        const prices = data.flatMap((r) => tierCols.filter((t) => (r[t.key] ?? "") !== "").map((t) => ({ productId: ids.get(r.sku)!, priceGroupId: t.id, price: D(num(r[t.key])!) })));
        await tx.productPrice.deleteMany({ where: { OR: tierCols.map((t) => ({ priceGroupId: t.id, productId: { in: prices.filter((x) => x.priceGroupId === t.id).map((x) => x.productId) } })) } });
        await tx.productPrice.createMany({ data: prices });
      }
    } else if (batch.kind === "CONTACTS") {
      const rows = ok.map((r) => ({ action: r.action, d: r.data as Record<string, string> }));
      const groups = new Map<string, string>();
      for (const name of new Set(rows.map((r) => r.d.group).filter(Boolean))) groups.set(name, (await tx.customerGroup.upsert({ where: { name }, update: {}, create: { name } })).id);
      const fields = (d: Record<string, string>) => ({
        name: d.name, phone: d.phone || null, email: d.email || null, address: d.address || null, taxNumber: d.tax_number || null,
        groupId: d.group ? groups.get(d.group)! : null, creditLimit: num(d.credit_limit ?? "") ?? null, payTermDays: num(d.pay_terms_days ?? "") ?? null,
        openingBalance: D(num(d.opening_balance ?? "") ?? 0),
      });
      const type = (d: Record<string, string>) => (d.type || "customer").toLowerCase();
      // Bulk insert: thousands of contacts must fit one transaction over the pooler.
      const creates = rows.filter((r) => r.action !== "update");
      const made = creates.length ? await tx.contact.createManyAndReturn({
        data: creates.map(({ d }) => ({ ...fields(d), code: d.code || null, isCustomer: type(d) !== "supplier", isSupplier: type(d) !== "customer" })),
        select: { id: true },
      }) : [];
      const credits = creates.map(({ d }, i) => ({ contactId: made[i].id, amount: D(num(d.store_credit ?? "") ?? 0) })).filter((c) => c.amount.gt(0));
      if (credits.length) await tx.storeCreditEntry.createMany({ data: credits.map((c) => ({ ...c, sourceType: "ImportBatch", sourceId: batch.id, reference: "Opening advance" })) });
      for (const { d } of rows.filter((r) => r.action === "update")) {
        // A code already known as a customer that now arrives as a supplier becomes both, never one or the other.
        const prev = await tx.contact.findUniqueOrThrow({ where: { code: d.code }, select: { isCustomer: true, isSupplier: true } });
        await tx.contact.update({ where: { code: d.code }, data: { ...fields(d), isCustomer: prev.isCustomer || type(d) !== "supplier", isSupplier: prev.isSupplier || type(d) !== "customer" } });
      }
    } else if (batch.kind === "PEOPLE") {
      for (const r of ok) {
        const d = r.data as Record<string, string>;
        const kind = (d.kind || "AGENT").toUpperCase();
        if (r.action === "update") {
          const prof = await tx.commissionProfile.update({ where: { code: d.code }, data: { kind: kind === "NONE" ? undefined : kind } });
          await tx.person.update({ where: { id: prof.personId }, data: { fullName: d.name, phone: d.phone || null } });
          continue;
        }
        const person = await tx.person.create({ data: { fullName: d.name, phone: d.phone || null } });
        if (kind !== "NONE") await tx.commissionProfile.create({ data: { personId: person.id, kind, code: d.code || null } });
      }
    } else if (batch.kind === "CATEGORIES") {
      const byName = ok.map((r) => r.data as Record<string, string> & { ids?: string[] }).filter((d) => d.match === "name");
      for (const d of byName) {
        await tx.category.updateMany({ where: { id: { in: d.ids ?? [] } }, data: { poolRate: D(num(d.pool_rate)!).div(100), userShare: D(num(d.user_share ?? "") ?? 0).div(100), agentShare: D(num(d.agent_share ?? "") ?? 0).div(100) } });
      }
      const rows = ok.map((r) => r.data as Record<string, string>).filter((d) => d.match !== "name");
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
      type Row = { productId: string; locationId?: string; qty: number; cost: number; lot: string | null; imei: string | null; imei2: string | null; serial: string | null; condition: string };
      const data = ok.map((r) => r.data as unknown as Row);
      const now = new Date();
      const layers = await tx.costLayer.createManyAndReturn({
        data: data.map((r) => ({
          productId: r.productId, locationId: r.locationId ?? batch.locationId!, lotCode: r.lot, qtyIn: D(r.qty), qtyRemaining: D(r.qty), unitCost: D(r.cost),
          receivedAt: now, sourceType: "ImportBatch", sourceId: batch.id,
        })),
        select: { id: true },
      });
      await tx.stockMovement.createMany({
        data: data.map((r, i) => ({
          productId: r.productId, locationId: r.locationId ?? batch.locationId!, costLayerId: layers[i].id, qty: D(r.qty), unitCost: D(r.cost),
          kind: "OPENING", sourceType: "ImportBatch", sourceId: batch.id, reference: `IMPORT ${batch.fileName}`.slice(0, 120), actorId: user.personId,
        })),
      });
      const devices = data.map((r, i) => ({ r, layerId: layers[i].id })).filter(({ r }) => r.imei || r.serial);
      if (devices.length) {
        await tx.deviceIdentity.createMany({
          data: devices.map(({ r, layerId }) => ({ productId: r.productId, costLayerId: layerId, locationId: r.locationId ?? batch.locationId!, imei1: r.imei, imei2: r.imei2, serial: r.serial, condition: r.condition })),
        });
      }
    }
    await tx.importBatch.update({ where: { id: batch.id }, data: { status: "COMMITTED", committedAt: new Date() } });
    await tx.auditEvent.create({ data: { actorId: user.personId, action: "IMPORT_COMMITTED", subjectType: "ImportBatch", subjectId: batch.id, detail: { kind: batch.kind, rows: ok.length } } });
    return { imported: ok.length };
  }, 120_000);
}
