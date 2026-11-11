import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDate } from "@/lib/money";
import { planProgress } from "@/lib/instalments";
import { PageHead, Badge } from "@/components/ui";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { PrintOnLoad } from "../../[id]/PrintOnLoad";
import { stopPlan } from "../actions";

export const metadata = { title: "Instalment plan" };

const STATE: Record<string, [string, "ok" | "warn" | "err" | "muted"]> = { PAID: ["Paid", "ok"], PART: ["Part paid", "warn"], DUE: ["Due soon", "warn"], OVERDUE: ["Overdue", "err"], UPCOMING: ["Upcoming", "muted"] };

export default async function PlanDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.view");
  const plan = await db.instalmentPlan.findUnique({
    where: { id: (await params).id },
    include: { dues: true, customer: true, createdBy: true, sale: { include: { location: { include: { business: true } }, lines: true } } },
  });
  if (!plan) notFound();
  const s = planProgress(plan);
  const every = ({ WEEKLY: "week", FORTNIGHTLY: "two weeks", MONTHLY: "month" } as Record<string, string>)[plan.frequency];
  return (
    <div className="stack">
      <div className="no-print">
        <PageHead eyebrow="Sell / Instalments" title={plan.number}
          actions={<>
            {plan.status === "CANCELLED" ? <Badge>Cancelled</Badge> : s.complete ? <Badge tone="ok">Paid off</Badge> : s.overdue > 0 ? <Badge tone="err">Overdue Rs. {money(s.overdue)}</Badge> : <Badge tone="warn">On track</Badge>}
            <Link className="btn" href={`/sales/${plan.saleId}`}>Invoice {plan.sale.number}</Link>
            {!s.complete && plan.status === "ACTIVE" && can(user, "debt.receive") && <Link className="btn btn-primary" href={`/pos?customer=${plan.customerId}`}>Receive payment</Link>}
            {!s.complete && s.next && <WhatsAppLink phone={plan.customer.phone} label="WhatsApp reminder"
              text={`${plan.sale.location.business.name}: Dear ${plan.customer.name}, your instalment of Rs. ${money(s.next.amount - s.next.paid)} for invoice ${plan.sale.number} ${s.next.state === "OVERDUE" ? "was due on" : "is due on"} ${fmtDate(s.next.dueAt)}.${s.overdue > 0 ? ` Total overdue: Rs. ${money(s.overdue)}.` : ""} Thank you.`} />}
            <PrintOnLoad enabled={false} label="Print agreement" />
          </>} />
      </div>
      <style>{"@page { size: A4; margin: 14mm; }"}</style>
      <div className="doc paper-A4">
        <div className="doc-top">
          <div><h3>{plan.sale.location.business.name.toUpperCase()}</h3><div className="small">{plan.sale.location.name}{plan.sale.location.phone ? ` · ${plan.sale.location.phone}` : ""}</div></div>
          <div className="small" style={{ textAlign: "right" }}><strong>INSTALMENT AGREEMENT</strong><br />{plan.number}<br />{fmtDate(plan.createdAt)}</div>
        </div>
        <p className="small" style={{ margin: "0 0 10px" }}>
          <strong>Customer:</strong> {plan.customer.name}{plan.customer.phone ? ` · ${plan.customer.phone}` : ""}{plan.customer.address ? ` · ${plan.customer.address}` : ""}<br />
          {plan.guarantorName && <><strong>Guarantor:</strong> {plan.guarantorName}{plan.guarantorPhone ? ` · ${plan.guarantorPhone}` : ""}{plan.guarantorId ? ` · NIC ${plan.guarantorId}` : ""}<br /></>}
          <strong>Goods:</strong> {plan.sale.lines.map((l) => `${l.nameSnapshot}${l.deviceLabels.length ? ` (${l.deviceLabels.join(", ")})` : ""}`).join("; ")} — invoice {plan.sale.number}
        </p>
        <div className="totalrow"><span>Invoice total</span><strong>{money(plan.sale.total)}</strong></div>
        <div className="totalrow"><span>Paid before the plan (down payment)</span><strong>{money(plan.paidBefore)}</strong></div>
        <div className="totalrow grand"><span>To pay in {plan.count} instalments, one every {every}</span><strong>Rs. {money(plan.financed)}</strong></div>
        <div style={{ marginTop: 10 }}>
          {s.dues.map((d) => (
            <div key={d.seq} className="totalrow small">
              <span>{d.seq}. {fmtDate(d.dueAt)} <span className="no-print"><Badge tone={STATE[d.state][1]}>{STATE[d.state][0]}{d.state === "PART" || (d.state === "OVERDUE" && d.paid > 0) ? ` · ${money(d.paid)} paid` : ""}</Badge></span></span>
              <strong>{money(d.amount)}</strong>
            </div>
          ))}
        </div>
        <div className="totalrow no-print"><span>Balance still to pay</span><strong>{money(s.balance)}</strong></div>
        <p className="small" style={{ margin: "14px 0 18px" }}>
          I agree to pay the instalments above on or before each date. The goods remain subject to this agreement until the full amount is paid.
          {plan.guarantorName ? " The guarantor agrees to pay any instalment the customer does not pay." : ""}
          {plan.notes ? ` ${plan.notes}` : ""}
        </p>
        <div className="row" style={{ justifyContent: "space-between", gap: 24, marginTop: 40 }}>
          <div className="small" style={{ borderTop: "1px solid currentColor", paddingTop: 4, minWidth: 160 }}>Customer</div>
          {plan.guarantorName && <div className="small" style={{ borderTop: "1px solid currentColor", paddingTop: 4, minWidth: 160 }}>Guarantor</div>}
          <div className="small" style={{ borderTop: "1px solid currentColor", paddingTop: 4, minWidth: 160 }}>For the shop: {plan.createdBy.fullName}</div>
        </div>
      </div>
      {plan.status === "ACTIVE" && !s.complete && can(user, "instalments.manage") && (
        <form action={stopPlan} className="no-print"><input type="hidden" name="planId" value={plan.id} /><button className="btn">Cancel the plan (the debt stays on the invoice)</button></form>
      )}
    </div>
  );
}
