import { db } from "../db";
import type { ReportDef, Row } from "./types";
import { D, ZERO, inPeriod, locIn, totalsOf, groupSum } from "./util";

const bucketName = (b: string) => b.toLowerCase().replace("_", " ");

export const stockReports: ReportDef[] = [
  {
    id: "RP-04", slug: "product-purchase", title: "Product purchase", group: "Stock & purchasing",
    basis: "Accepted GRN lines by receipt date, at the unit cost on the receipt.",
    async run(ctx) {
      const lines = await db.receiptLine.findMany({ where: { receipt: { status: "POSTED", receivedAt: inPeriod(ctx), locationId: locIn(ctx) } }, include: { receipt: { include: { supplier: true } }, product: true }, orderBy: { receipt: { receivedAt: "asc" } } });
      const rows: Row[] = lines.map((l) => ({ date: l.receipt.receivedAt, grn: l.receipt.number, supplier: l.receipt.supplier.name, ref: l.receipt.supplierRef ?? "", product: `${l.product.sku} · ${l.product.name}`, lot: l.lotCode ?? "", received: l.qtyReceived, rejected: l.qtyRejected, accepted: l.qtyAccepted, cost: l.unitCost, subtotal: D(l.qtyAccepted).mul(l.unitCost), _href: `/purchases/${l.receiptId}` }));
      return { columns: [{ key: "date", label: "Date", kind: "datetime" }, { key: "grn", label: "GRN" }, { key: "supplier", label: "Supplier" }, { key: "ref", label: "Supplier ref" }, { key: "product", label: "Product" }, { key: "lot", label: "Lot" }, { key: "received", label: "Received", kind: "qty" }, { key: "rejected", label: "Rejected", kind: "qty" }, { key: "accepted", label: "Accepted", kind: "qty" }, { key: "cost", label: "Unit cost", kind: "money", cost: true }, { key: "subtotal", label: "Subtotal", kind: "money", cost: true }], rows, totals: totalsOf(rows, ["received", "rejected", "accepted", "subtotal"]) };
    },
  },
  {
    id: "RP-06", slug: "purchase-to-sale", title: "Items / purchase-to-sale trace", group: "Stock & purchasing",
    basis: "Each sold unit traced to the exact lot and receipt it was allocated from (FIFO or chosen lot / IMEI).",
    async run(ctx) {
      const allocs = await db.costAllocation.findMany({
        where: { saleLine: { sale: { stage: "FINAL", soldAt: inPeriod(ctx), locationId: locIn(ctx) } } },
        include: { saleLine: { include: { sale: { include: { customer: true } }, product: true } }, costLayer: { include: { receiptLine: { include: { receipt: { include: { supplier: true } } } } } } },
        orderBy: { saleLine: { sale: { soldAt: "asc" } } },
      });
      const rows: Row[] = allocs.map((a) => {
        const r = a.costLayer.receiptLine?.receipt;
        return {
          sold: a.saleLine.sale.soldAt, invoice: a.saleLine.sale.number, customer: a.saleLine.sale.customer?.name ?? "Walk-in", product: `${a.saleLine.product.sku} · ${a.saleLine.nameSnapshot}`,
          lot: a.costLayer.lotCode ?? "", received: a.costLayer.receivedAt, grn: r?.number ?? (a.costLayer.sourceType ?? "Opening"), supplier: r?.supplier.name ?? "", qty: a.qty, cost: a.unitCost, price: D(a.saleLine.lineTotal).div(a.saleLine.qty), imei: a.saleLine.deviceLabels.join(", "), _href: `/sales/${a.saleLine.saleId}`,
        };
      });
      return { columns: [{ key: "sold", label: "Sold", kind: "datetime" }, { key: "invoice", label: "Invoice" }, { key: "customer", label: "Customer" }, { key: "product", label: "Product" }, { key: "imei", label: "IMEI" }, { key: "lot", label: "Lot" }, { key: "grn", label: "From" }, { key: "supplier", label: "Supplier" }, { key: "received", label: "Lot received", kind: "date" }, { key: "qty", label: "Qty", kind: "qty" }, { key: "cost", label: "Unit cost", kind: "money", cost: true }, { key: "price", label: "Net price", kind: "money" }], rows, totals: totalsOf(rows, ["qty"]), notes: ["Non-stock items (reloads, services) have no lot and are not listed; their cost is still in Profit / Loss."] };
    },
  },
  {
    id: "RP-07", slug: "stock", title: "Stock", group: "Stock & purchasing", asOf: true,
    basis: "Current stock per product and location: available (saleable) and held separately, at original lot cost. Potential margin is not earned profit.",
    async run(ctx) {
      const layers = await db.costLayer.findMany({ where: { locationId: locIn(ctx), qtyRemaining: { gt: 0 }, bucket: { not: "WRITTEN_OFF" } }, include: { product: { include: { category: true } }, location: true } });
      const g = groupSum(layers, (l) => `${l.productId}|${l.locationId}`, {
        saleable: (l) => (l.bucket === "SALEABLE" ? l.qtyRemaining : 0), held: (l) => (l.bucket !== "SALEABLE" ? l.qtyRemaining : 0),
        cost: (l) => D(l.qtyRemaining).mul(l.unitCost), retail: (l) => (l.bucket === "SALEABLE" ? D(l.qtyRemaining).mul(l.product.sellPrice) : 0),
      });
      const meta = new Map(layers.map((l) => [`${l.productId}|${l.locationId}`, l]));
      const rows: Row[] = [...g.entries()].map(([k, v]) => { const l = meta.get(k)!; return { product: `${l.product.sku} · ${l.product.name}`, category: l.product.category?.name ?? "", location: l.location.name, saleable: v.saleable, held: v.held, cost: v.cost, retail: v.retail, margin: v.retail.minus(v.cost), _href: `/products/${l.productId}` }; })
        .sort((a, b) => String(a.product).localeCompare(String(b.product)));
      return { columns: [{ key: "product", label: "Product" }, { key: "category", label: "Category" }, { key: "location", label: "Location" }, { key: "saleable", label: "Available", kind: "qty" }, { key: "held", label: "Held / blocked", kind: "qty" }, { key: "cost", label: "Cost value", kind: "money", cost: true }, { key: "retail", label: "Selling value", kind: "money" }, { key: "margin", label: "Potential margin", kind: "money", cost: true }], rows, totals: totalsOf(rows, ["saleable", "held", "cost", "retail", "margin"]) };
    },
  },
  {
    id: "RP-08", slug: "lots", title: "Lots", group: "Stock & purchasing",
    basis: "Every cost layer received in the period: in, sold, returned, adjusted, transferred and remaining, from the movement ledger.",
    async run(ctx) {
      const layers = await db.costLayer.findMany({ where: { locationId: locIn(ctx), receivedAt: inPeriod(ctx) }, include: { product: true, location: true, movements: true, receiptLine: { include: { receipt: true } } }, orderBy: { receivedAt: "asc" } });
      const k = (l: (typeof layers)[number], kinds: string[]) => l.movements.filter((m) => kinds.includes(m.kind)).reduce((a, m) => a.plus(m.qty), ZERO);
      const rows: Row[] = layers.map((l) => ({
        product: `${l.product.sku} · ${l.product.name}`, lot: l.lotCode ?? "", source: l.receiptLine?.receipt.number ?? (l.sourceType ?? "Opening"), location: l.location.name, bucket: bucketName(l.bucket), received: l.receivedAt,
        in: l.qtyIn, sold: k(l, ["SALE", "REPAIR_ISSUE"]).neg(), returned: k(l, ["SALE_RETURN", "REPAIR_RETURN"]), adjusted: k(l, ["ADJUSTMENT", "DISPOSITION", "SUPPLIER_RETURN"]), transferred: k(l, ["TRANSFER_OUT"]).neg(),
        remaining: l.qtyRemaining, cost: l.unitCost, _href: `/products/${l.productId}`,
      }));
      return { columns: [{ key: "product", label: "Product" }, { key: "lot", label: "Lot" }, { key: "source", label: "Source" }, { key: "location", label: "Location" }, { key: "bucket", label: "Bucket" }, { key: "received", label: "Received", kind: "date" }, { key: "in", label: "In", kind: "qty" }, { key: "sold", label: "Sold / issued", kind: "qty" }, { key: "returned", label: "Returned", kind: "qty" }, { key: "adjusted", label: "Adjusted", kind: "qty" }, { key: "transferred", label: "Transferred out", kind: "qty" }, { key: "remaining", label: "Remaining", kind: "qty" }, { key: "cost", label: "Unit cost", kind: "money", cost: true }], rows, totals: totalsOf(rows, ["in", "sold", "returned", "adjusted", "transferred", "remaining"]) };
    },
  },
  {
    id: "RP-09", slug: "adjustments", title: "Stock adjustments / wastage", group: "Stock & purchasing",
    basis: "Adjustment lines by date at original lot cost; legacy normal/abnormal type kept.",
    async run(ctx) {
      const lines = await db.stockAdjustmentLine.findMany({ where: { adjustment: { createdAt: inPeriod(ctx), locationId: locIn(ctx) } }, include: { adjustment: { include: { createdBy: true } }, product: true }, orderBy: { adjustment: { createdAt: "asc" } } });
      const rows: Row[] = lines.map((l) => ({ date: l.adjustment.createdAt, ref: l.adjustment.number, type: l.adjustment.kind.toLowerCase(), reason: l.adjustment.reason.toLowerCase().replace("_", " "), product: `${l.product.sku} · ${l.product.name}`, lot: l.lotCode ?? "", move: `${l.fromBucket ? bucketName(l.fromBucket) : "—"} → ${l.toBucket ? bucketName(l.toBucket) : "—"}`, qty: l.qty, value: D(l.qty).mul(l.unitCost), by: l.adjustment.createdBy.fullName, _href: `/adjustments/${l.adjustmentId}` }));
      const recovered = await db.stockAdjustment.aggregate({ where: { createdAt: inPeriod(ctx), locationId: locIn(ctx) }, _sum: { recoveredAmount: true } });
      return { columns: [{ key: "date", label: "Date", kind: "datetime" }, { key: "ref", label: "Reference" }, { key: "type", label: "Type" }, { key: "reason", label: "Reason" }, { key: "product", label: "Product" }, { key: "lot", label: "Lot" }, { key: "move", label: "From → to" }, { key: "qty", label: "Qty", kind: "qty" }, { key: "value", label: "Value at cost", kind: "money", cost: true }, { key: "by", label: "By" }], rows, totals: totalsOf(rows, ["qty", "value"]), summary: [{ label: "Amount recovered", value: recovered._sum.recoveredAmount, kind: "money" }] };
    },
  },
  {
    id: "RP-10", slug: "transfers", title: "Stock transfers", group: "Stock & purchasing",
    basis: "Transfer lines by dispatch date: sent, received, in transit and shortfall, with lot and cost.",
    async run(ctx) {
      const lines = await db.stockTransferLine.findMany({ where: { transfer: { dispatchedAt: inPeriod(ctx), OR: [{ fromLocationId: locIn(ctx) }, { toLocationId: locIn(ctx) }] } }, include: { transfer: { include: { fromLocation: true, toLocation: true } }, product: true } });
      const rows: Row[] = lines.map((l) => ({ date: l.transfer.dispatchedAt, ref: l.transfer.number, route: `${l.transfer.fromLocation.name} → ${l.transfer.toLocation.name}`, product: `${l.product.sku} · ${l.product.name}`, lot: l.lotCode ?? "", sent: l.qtySent, received: l.qtyReceived ?? 0, transit: l.qtyReceived == null ? l.qtySent : 0, short: l.qtyReceived == null ? 0 : D(l.qtySent).minus(l.qtyReceived), value: D(l.qtySent).mul(l.unitCost), _href: `/transfers/${l.transferId}`, _tone: l.qtyReceived != null && D(l.qtyReceived).lt(l.qtySent) ? "err" : undefined }));
      return { columns: [{ key: "date", label: "Sent", kind: "datetime" }, { key: "ref", label: "Transfer" }, { key: "route", label: "From → to" }, { key: "product", label: "Product" }, { key: "lot", label: "Lot" }, { key: "sent", label: "Sent", kind: "qty" }, { key: "received", label: "Received", kind: "qty" }, { key: "transit", label: "In transit", kind: "qty" }, { key: "short", label: "Shortfall", kind: "qty" }, { key: "value", label: "Value sent", kind: "money", cost: true }], rows, totals: totalsOf(rows, ["sent", "received", "transit", "short", "value"]) };
    },
  },
  {
    id: "RP-11", slug: "stock-alerts", title: "Stock alerts", group: "Stock & purchasing", asOf: true,
    basis: "Saleable stock at or below the alert level, and stock held for inspection or supplier recovery.",
    async run(ctx) {
      const [products, layers] = await Promise.all([
        db.product.findMany({ where: { active: true, stockManaged: true, alertQty: { gt: 0 } } }),
        db.costLayer.findMany({ where: { locationId: locIn(ctx), qtyRemaining: { gt: 0 }, bucket: { not: "WRITTEN_OFF" } }, include: { product: true, location: true } }),
      ]);
      const avail = groupSum(layers.filter((l) => l.bucket === "SALEABLE"), (l) => l.productId, { q: (l) => l.qtyRemaining });
      const low: Row[] = products.filter((p) => (avail.get(p.id)?.q ?? ZERO).lte(p.alertQty))
        .map((p) => ({ issue: "Low stock", product: `${p.sku} · ${p.name}`, detail: `alert at ${D(p.alertQty).toString()}`, qty: avail.get(p.id)?.q ?? ZERO, _href: `/products/${p.id}`, _tone: "warn" as const }));
      const held: Row[] = layers.filter((l) => l.bucket !== "SALEABLE").map((l) => ({ issue: `Held — ${bucketName(l.bucket)}`, product: `${l.product.sku} · ${l.product.name}`, detail: `lot ${l.lotCode ?? "—"} · ${l.location.name}`, qty: l.qtyRemaining, _href: `/products/${l.productId}`, _tone: "err" as const }));
      return { columns: [{ key: "issue", label: "Issue" }, { key: "product", label: "Product" }, { key: "detail", label: "Detail" }, { key: "qty", label: "Qty", kind: "qty" }], rows: [...low, ...held], notes: ["Expiry dates are not tracked for these products."] };
    },
  },
  {
    id: "RP-28", slug: "supplier-recovery", title: "Supplier recovery", group: "Stock & purchasing",
    basis: "Supplier returns sent in the period: cost sent, what was actually recovered, and loss. Expected recovery is never counted as received.",
    async run(ctx) {
      const claims = await db.supplierClaim.findMany({ where: { sentAt: inPeriod(ctx), locationId: locIn(ctx) }, include: { supplier: true }, orderBy: { sentAt: "asc" } });
      const now = Date.now();
      const rows: Row[] = claims.map((c) => ({ ref: c.number, supplier: c.supplier.name, sent: c.sentAt, age: c.status === "SENT" ? Math.floor((now - c.sentAt.getTime()) / 86_400_000) : null, status: c.status === "SENT" ? "awaiting supplier" : c.status.toLowerCase(), value: c.claimValue, credit: c.creditAmount, refund: c.refundAmount, replaced: c.replacedValue, loss: c.status === "SETTLED" ? c.lossValue : null, _href: `/purchases/returns/${c.id}`, _tone: c.status === "SENT" && now - c.sentAt.getTime() > 30 * 86_400_000 ? "warn" : undefined }));
      return { columns: [{ key: "ref", label: "Claim" }, { key: "supplier", label: "Supplier" }, { key: "sent", label: "Sent", kind: "date" }, { key: "age", label: "Days waiting", kind: "qty" }, { key: "status", label: "Status" }, { key: "value", label: "Cost sent", kind: "money" }, { key: "credit", label: "Credit", kind: "money" }, { key: "refund", label: "Refund", kind: "money" }, { key: "replaced", label: "Replaced", kind: "money" }, { key: "loss", label: "Loss", kind: "money" }], rows, totals: totalsOf(rows, ["value", "credit", "refund", "replaced", "loss"]) };
    },
  },
];
