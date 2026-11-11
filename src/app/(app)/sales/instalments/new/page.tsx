import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money } from "@/lib/money";
import { PageHead } from "@/components/ui";
import { PlanForm } from "../PlanForm";

export const metadata = { title: "New instalment plan" };

export default async function NewPlan({ searchParams }: { searchParams: Promise<{ sale?: string }> }) {
  await requirePermission("instalments.manage");
  const { sale: saleId } = await searchParams;
  const sale = saleId ? await db.sale.findUnique({ where: { id: saleId }, include: { customer: true, instalmentPlan: true } }) : null;
  if (!sale) notFound();
  const due = D(sale.total).minus(sale.paid).minus(sale.credited);
  const first = new Date(Date.now() + 330 * 60_000 + 30 * 86_400_000).toISOString().slice(0, 10);
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <PageHead eyebrow="Sell / Instalments" title={`Instalment plan for ${sale.number}`} />
      <p className="small muted" style={{ margin: 0 }}>
        {sale.customer?.name ?? "No customer"} · total Rs. {money(sale.total)} · already paid Rs. {money(sale.paid)} (the down payment) · <strong>Rs. {money(due)} to spread</strong>.
        No interest is added. Payments are taken as usual (POS › Receive payment, or on the invoice) and settle the oldest instalment first.
      </p>
      {!sale.customerId ? <p className="note note-err">This sale has no customer. Instalments need a named customer.</p>
        : sale.instalmentPlan ? <p className="note note-err">This sale already has plan {sale.instalmentPlan.number}.</p>
        : due.lte(0) ? <p className="note note-err">Nothing is due on this sale.</p>
        : <PlanForm saleId={sale.id} due={due.toNumber()} defaultFirst={first} />}
    </div>
  );
}
