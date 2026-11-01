import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getInvoiceLayout, getPrinters } from "@/lib/settings";
import { PageHead, DataTable } from "@/components/ui";
import { LayoutForm, PrinterForm } from "./PrintingForms";
import { removePrinter } from "../printing-actions";

export const metadata = { title: "Invoice layouts & printers" };

export default async function Printing() {
  await requirePermission("settings.manage");
  const [layout, printers, locations, lastSale] = await Promise.all([
    getInvoiceLayout(), getPrinters(), db.location.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.sale.findFirst({ orderBy: { soldAt: "desc" }, select: { id: true, number: true } }),
  ]);
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <PageHead eyebrow="Settings" title="Invoice layouts & printers" actions={lastSale && <Link className="btn" href={`/sales/${lastSale.id}`}>Preview on {lastSale.number}</Link>} />
      <LayoutForm layout={layout} />
      <section className="stack">
        <h2 style={{ margin: 0 }}>Printers</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Printing goes through the device&apos;s normal print dialog (browser/system print). A receipt printer set for a location decides the receipt paper there.
          Sending to the print dialog is not proof that paper came out — check the first print on each new printer.
        </p>
        <DataTable rows={printers} rowKey={(p) => p.id} empty="No printers set up — receipts use the default paper above." cards={false}
          columns={[
            { label: "Printer", render: (p) => p.name },
            { label: "Used for", render: (p) => ({ RECEIPT: "Receipts", LABEL: "Labels", A4: "A4" })[p.kind] },
            { label: "Paper", render: (p) => p.paper },
            { label: "Location", render: (p) => locations.find((l) => l.id === p.locationId)?.name ?? "All" },
            { label: "Notes", render: (p) => p.notes },
            { label: "", render: (p) => <form action={removePrinter}><input type="hidden" name="id" value={p.id} /><button className="btn btn-sm btn-ghost btn-danger">Remove</button></form> },
          ]} />
        <PrinterForm locations={locations} />
      </section>
    </div>
  );
}
