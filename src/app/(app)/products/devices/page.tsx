import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";

export const metadata = { title: "Phone / device identities" };

const TONE: Record<string, "ok" | "warn" | "err" | "muted"> = { SALEABLE: "ok", HELD: "warn", IN_TRANSIT: "warn", SOLD: "muted", WRITTEN_OFF: "err" };

export default async function Devices({ searchParams }: { searchParams: Promise<{ q?: string; state?: string }> }) {
  await requirePermission("products.view");
  const { q, state = "IN_STOCK" } = await searchParams;
  const term = q?.trim();
  const devices = await db.deviceIdentity.findMany({
    where: {
      ...(state === "IN_STOCK" ? { state: { in: ["SALEABLE", "HELD", "IN_TRANSIT"] } } : state !== "ALL" ? { state } : {}),
      ...(term ? { OR: [{ imei1: { contains: term } }, { imei2: { contains: term } }, { serial: { contains: term, mode: "insensitive" } }, { product: { name: { contains: term, mode: "insensitive" } } }] } : {}),
    },
    orderBy: { createdAt: "desc" }, take: 200,
    include: { product: true, location: true, receiptLine: { include: { receipt: true } }, saleLine: { include: { sale: true } } },
  });
  return (
    <div>
      <PageHead eyebrow="Products" title="Phone / device identities" />
      <form className="toolbar" role="search">
        <input name="q" defaultValue={q} placeholder="IMEI, serial or model" inputMode="search" aria-label="Search devices" />
        <select name="state" defaultValue={state} aria-label="State">
          <option value="IN_STOCK">In stock (incl. held / in transit)</option><option value="SALEABLE">Saleable</option><option value="HELD">Held</option><option value="SOLD">Sold</option><option value="WRITTEN_OFF">Written off</option><option value="ALL">All</option>
        </select>
        <button className="btn">Search</button>
      </form>
      <DataTable rows={devices} rowKey={(d) => d.id} empty={term ? `No device matches “${term}”.` : "No device-tracked stock yet. Tick “Track IMEI / serial” on a product, then receive it through a GRN."}
        columns={[
          { label: "IMEI / serial", primary: true, render: (d) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{d.imei1 ?? d.serial}{d.imei2 ? ` / ${d.imei2}` : ""}</span> },
          { label: "Product", render: (d) => <RowLink href={`/products/${d.productId}`}>{d.product.name}</RowLink> },
          { label: "Condition", render: (d) => d.condition.toLowerCase() },
          { label: "Location", render: (d) => d.location?.name ?? "—" },
          { label: "Received", render: (d) => (d.receiptLine ? <RowLink href={`/purchases/${d.receiptLine.receiptId}`}>{d.receiptLine.receipt.number}</RowLink> : fmtDate(d.createdAt)) },
          { label: "Sold on", render: (d) => (d.saleLine ? <RowLink href={`/sales/${d.saleLine.saleId}`}>{d.saleLine.sale.number}</RowLink> : "—") },
          { label: "State", render: (d) => <Badge tone={TONE[d.state] ?? "muted"}>{d.state.toLowerCase().replace("_", " ")}</Badge> },
        ]} />
    </div>
  );
}
