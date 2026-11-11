import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";

export const metadata = { title: "Warranty lookup" };

type Hit = { key: string; item: string; label: string; saleId: string; saleNumber: string; soldAt: Date; customer: string; customerId: string | null; warranty: string | null; until: Date | null; saleLineId: string; deviceId: string | null; returned: boolean; claims: { id: string; number: string; status: string }[] };

const daysLeft = (d: Date) => Math.ceil((d.getTime() - Date.now()) / 86_400_000);

export default async function Warranty({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("sales.view");
  const q = ((await searchParams).q ?? "").trim();
  const hits: Hit[] = [];
  if (q.length >= 4) {
    const digits = q.replace(/\D/g, "");
    const [devices, lines] = await Promise.all([
      // By IMEI / serial: the exact unit that was sold.
      db.deviceIdentity.findMany({
        where: { saleLineId: { not: null }, OR: [{ imei1: { contains: q } }, { imei2: { contains: q } }, { serial: { contains: q, mode: "insensitive" } }] },
        include: { product: true, saleLine: { include: { sale: { include: { customer: true } }, repairClaims: { select: { id: true, number: true, status: true } } } } },
        take: 20, orderBy: { soldAt: "desc" },
      }),
      // By invoice number or the customer's mobile: every line on those sales that carries a warranty.
      db.saleLine.findMany({
        where: { warrantyDays: { gt: 0 }, sale: { stage: "FINAL", OR: [{ number: { contains: q, mode: "insensitive" } }, ...(digits.length >= 7 ? [{ customer: { phone: { contains: digits.slice(-9) } } }] : [])] } },
        include: { sale: { include: { customer: true } }, repairClaims: { select: { id: true, number: true, status: true } } },
        take: 40, orderBy: { sale: { soldAt: "desc" } },
      }),
    ]);
    for (const d of devices) {
      const l = d.saleLine!;
      hits.push({
        key: `d${d.id}`, item: d.product.name, label: d.imei1 ?? d.serial ?? "", saleId: l.saleId, saleNumber: l.sale.number, soldAt: d.soldAt ?? l.sale.soldAt, customer: l.sale.customer?.name ?? "Walk-in",
        customerId: l.sale.customerId, warranty: l.warrantyName, until: d.warrantyUntil ?? l.warrantyUntil, saleLineId: l.id, deviceId: d.id, returned: d.state !== "SOLD",
        claims: l.repairClaims,
      });
    }
    const seen = new Set(devices.map((d) => d.saleLineId));
    for (const l of lines) {
      if (seen.has(l.id)) continue;
      hits.push({
        key: `l${l.id}`, item: l.nameSnapshot, label: l.deviceLabels.join(", "), saleId: l.saleId, saleNumber: l.sale.number, soldAt: l.sale.soldAt, customer: l.sale.customer?.name ?? "Walk-in",
        customerId: l.sale.customerId, warranty: l.warrantyName, until: l.warrantyUntil, saleLineId: l.id, deviceId: null, returned: l.returnedQty.gte(l.qty), claims: l.repairClaims,
      });
    }
  }
  return (
    <div className="stack">
      <PageHead eyebrow="Sell" title="Warranty lookup" />
      <form className="toolbar" role="search">
        <input name="q" defaultValue={q} placeholder="IMEI, serial, invoice number or customer mobile" aria-label="Search warranty" autoFocus />
        <button className="btn btn-primary">Check</button>
      </form>
      {q.length >= 4 ? (
        <DataTable rows={hits} rowKey={(h) => h.key} empty="Nothing sold by this shop matches. Check the number, or look for the paper invoice."
          columns={[
            { label: "Item", primary: true, render: (h) => <>{h.item}{h.label && <><br /><span className="small muted">{h.label}</span></>}</> },
            { label: "Sold", render: (h) => <><RowLink href={`/sales/${h.saleId}`}>{h.saleNumber}</RowLink><br /><span className="small muted">{fmtDate(h.soldAt)} · {h.customer}</span></> },
            { label: "Warranty", render: (h) => h.warranty ?? "None" },
            {
              label: "Status", render: (h) => h.returned ? <Badge>Returned to shop</Badge> : !h.until ? <Badge>No warranty</Badge>
                : daysLeft(h.until) >= 0 ? <Badge tone="ok">In warranty · {daysLeft(h.until)} days left (until {fmtDate(h.until)})</Badge>
                : <Badge tone="err">Expired {fmtDate(h.until)}</Badge>,
            },
            { label: "Claims", render: (h) => h.claims.length ? h.claims.map((c) => <span key={c.id}><RowLink href={`/repairs/${c.id}`}>{c.number}</RowLink> <span className="small muted">{c.status.toLowerCase().replace("_", " ")}</span><br /></span>) : "—" },
            {
              label: "", render: (h) => can(user, "repairs.manage") && !h.returned && h.customerId
                ? <Link className="btn btn-sm" href={`/repairs/new?claim=${h.saleLineId}${h.deviceId ? `&device=${h.deviceId}` : ""}`}>{h.until && daysLeft(h.until) >= 0 ? "Open warranty job" : "Open repair job"}</Link>
                : null,
            },
          ]} />
      ) : (
        <p className="note">Scan or type an IMEI, a serial number, an invoice number or the customer&apos;s mobile (at least 4 characters). Warranty dates are kept for sales made in this system.</p>
      )}
    </div>
  );
}
