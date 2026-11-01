import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { returnPreview } from "@/lib/returns";
import { PageHead } from "@/components/ui";
import { ReturnForm } from "../ReturnForm";

export const metadata = { title: "Sell return / exchange" };

export default async function NewReturn({ searchParams }: { searchParams: Promise<{ sale?: string; invoice?: string }> }) {
  await requirePermission("returns.create");
  const { sale: saleId, invoice } = await searchParams;

  if (!saleId) {
    if (invoice) {
      const found = await db.sale.findFirst({ where: { number: { equals: invoice.trim(), mode: "insensitive" } }, select: { id: true } });
      if (found) redirect(`/returns/new?sale=${found.id}`);
    }
    return (
      <div style={{ maxWidth: 560 }} className="stack">
        <PageHead eyebrow="Sell" title="Sell return / exchange" />
        <form className="panel stack">
          <label className="field"><span>Original invoice number</span><input name="invoice" defaultValue={invoice} placeholder="INV2026/0001" autoFocus required /></label>
          {invoice && <p className="error-text">No sale found with invoice {invoice}.</p>}
          <div className="form-actions" style={{ marginTop: 0 }}><button className="btn btn-primary">Find sale</button></div>
        </form>
        <p className="small muted">Returns are always linked to the original invoice so lot, cost and commission can be reversed correctly.</p>
      </div>
    );
  }

  const preview = await returnPreview(saleId);
  if (!preview) redirect("/returns/new");
  const { sale } = preview;
  const accounts = await db.account.findMany({ where: { active: true, type: { in: ["CARD", "BANK"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } });

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHead eyebrow="Sell / Return" title={`Return against ${sale.number}`} actions={<Link className="btn" href={`/sales/${sale.id}`}>View sale</Link>} />
      <p className="small muted" style={{ marginTop: -8 }}>Customer: {sale.customer?.name ?? "Walk-in"} · Sold {sale.soldAt.toLocaleDateString("en-GB", { timeZone: "Asia/Colombo" })}</p>
      <ReturnForm
        saleId={sale.id}
        saleNumber={sale.number}
        due={Number(preview.due)}
        hasCustomer={!!sale.customerId}
        customerName={sale.customer?.name ?? null}
        accounts={accounts}
        lines={preview.lines.map(({ line, remaining, unitValue, remainingValue }) => ({
          id: line.id, name: line.nameSnapshot, sku: line.product.sku, sold: Number(line.qty), remaining: Number(remaining),
          unitValue: Number(unitValue.toDecimalPlaces(2)), remainingValue: Number(remainingValue.toDecimalPlaces(2)),
          tracked: line.product.trackDevices && line.allocations.length > 0,
          devices: line.devices.map((d) => ({ id: d.id, label: d.imei1 ?? d.serial ?? d.id })),
        }))}
      />
    </div>
  );
}
