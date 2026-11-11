import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDateTime } from "@/lib/money";
import { PageHead, Badge, Stat } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { CountSheet, type SheetLine } from "../CountSheet";
import { PrintOnLoad } from "../../sales/[id]/PrintOnLoad";
import { abandonCount, finishCount } from "../actions";

export const metadata = { title: "Stock take" };

export default async function StockCountDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("products.view");
  const count = await db.stockCount.findUnique({
    where: { id: (await params).id },
    include: { location: true, createdBy: true, lines: { include: { product: { select: { sku: true, name: true, trackDevices: true, defaultCost: true } } }, orderBy: { product: { name: "asc" } } } },
  });
  if (!count) notFound();
  const showCost = can(user, "cost.view");
  const manage = can(user, "stock.count") && count.status === "OPEN";
  const deviceIds = count.lines.flatMap((l) => [...l.expectedDeviceIds, ...l.countedDeviceIds]);
  const devices = new Map((deviceIds.length ? await db.deviceIdentity.findMany({ where: { id: { in: deviceIds } }, select: { id: true, imei1: true, serial: true } }) : []).map((d) => [d.id, d.imei1 ?? d.serial ?? d.id]));

  const lines: SheetLine[] = count.lines.map((l) => ({
    id: l.id, sku: l.product.sku, name: l.product.name, tracked: l.product.trackDevices, expected: Number(l.expectedQty),
    counted: l.countedQty == null ? null : Number(l.countedQty), cost: showCost ? Number(l.product.defaultCost) : null,
    devices: l.expectedDeviceIds.map((id) => ({ id, label: devices.get(id) ?? id, seen: l.countedDeviceIds.includes(id) })),
    extra: l.countedDeviceIds.filter((id) => !l.expectedDeviceIds.includes(id)).length,
  }));
  const countedLines = count.lines.filter((l) => l.countedQty != null);
  const short = countedLines.reduce((a, l) => { const d = D(l.countedQty!).minus(l.expectedQty); return d.lt(0) ? a.plus(d.abs().mul(l.product.defaultCost)) : a; }, D(0));
  const over = countedLines.reduce((a, l) => { const d = D(l.countedQty!).minus(l.expectedQty); return d.gt(0) ? a.plus(d.mul(l.product.defaultCost)) : a; }, D(0));
  const differing = countedLines.filter((l) => !D(l.countedQty!).eq(l.expectedQty)).length;
  const unknown = count.lines.flatMap((l) => l.unknownCodes);

  return (
    <div className="stack">
      <PageHead eyebrow={`Stock take / ${count.location.name}`} title={count.number}
        actions={<>
          <Badge tone={count.status === "OPEN" ? "warn" : count.status === "POSTED" ? "ok" : "muted"}>{count.status.toLowerCase()}</Badge>
          {count.adjustmentId && <Link className="btn" href={`/adjustments/${count.adjustmentId}`}>Open the adjustment</Link>}
          <PrintOnLoad enabled={false} label="Print sheet" />
        </>} />
      <div className="small muted">{count.scope ?? "Everything at this location"} · opened {fmtDateTime(count.createdAt)} by {count.createdBy.fullName}{count.postedAt ? ` · posted ${fmtDateTime(count.postedAt)}` : ""}</div>
      {count.notes && <p className="note" style={{ whiteSpace: "pre-line" }}>{count.notes}</p>}
      <div className="stats">
        <Stat label="Counted" value={`${countedLines.length} / ${count.lines.length}`} basis="Lines with a count" />
        <Stat label="Lines that differ" value={differing} basis="Counted ≠ expected" />
        {showCost && <Stat label="Shortage" value={<span style={{ color: short.gt(0) ? "var(--err)" : undefined }}>Rs. {money(short)}</span>} basis="At current cost" />}
        {showCost && <Stat label="Surplus" value={`Rs. ${money(over)}`} basis="At current cost" />}
      </div>
      {unknown.length > 0 && <p className="note note-err">Scanned but not recognised: {unknown.join(", ")}. Find these items and check their labels.</p>}

      {count.status === "OPEN" && can(user, "stock.count")
        ? <CountSheet countId={count.id} lines={lines} showCost={showCost} />
        : (
          <div className="tablewrap cards">
            <table className="dt">
              <thead><tr><th>Product</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Difference</th></tr></thead>
              <tbody>{lines.map((l) => { const d = l.counted == null ? null : l.counted - l.expected; return (
                <tr key={l.id}><td className="primary" data-label="Product">{l.sku} · {l.name}</td><td className="num" data-label="Expected">{l.expected}</td><td className="num" data-label="Counted">{l.counted ?? "—"}</td>
                  <td className="num" data-label="Difference" style={{ color: !d ? undefined : d < 0 ? "var(--err)" : "var(--warn)" }}>{d == null ? "not counted" : d > 0 ? `+${d}` : d}</td></tr>
              ); })}</tbody>
            </table>
          </div>
        )}

      {manage && (
        <section className="panel stack no-print">
          <h2 style={{ margin: 0 }}>Post the count</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {differing} line{differing === 1 ? "" : "s"} will be corrected. Shortages are written off at the cost of the oldest lots (missing phones by IMEI); surpluses are added as found stock.
            Lines you did not count are left as they are. This cannot be undone — a wrong count is fixed with a new adjustment.
          </p>
          <ActionForm action={finishCount} className="row">
            <input type="hidden" name="countId" value={count.id} />
            <label className="check"><input type="checkbox" name="confirm" /> I have re-checked the lines that differ</label>
            <SubmitButton pendingText="Posting…">Post differences to stock</SubmitButton>
          </ActionForm>
          <form action={abandonCount}><input type="hidden" name="countId" value={count.id} /><button className="btn">Cancel this count (no stock change)</button></form>
        </section>
      )}
    </div>
  );
}
