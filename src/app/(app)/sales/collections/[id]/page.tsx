import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDateTime } from "@/lib/money";
import { PageHead, Badge } from "@/components/ui";
import { PrintOnLoad } from "../../[id]/PrintOnLoad";
import { Barcode } from "@/components/Barcode";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { getInvoiceLayout, receiptPaper } from "@/lib/settings";
import { reverseCollectionForm } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const row = await db.debtCollection.findUnique({ where: { id: (await params).id }, select: { number: true } });
  return { title: row?.number ?? "Not found" };
}

const method = (m: string) => (m === "STORE_CREDIT" ? "store credit" : m.replace("_", " ").toLowerCase());

// Debt payment receipt: what was received, where it went and what it settled. Printable on the shop's receipt paper.
export default async function CollectionReceipt({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string; paper?: string }> }) {
  const user = await requirePermission("debt.view");
  const c = await db.debtCollection.findUnique({
    where: { id: (await params).id },
    include: {
      customer: true, account: true, createdBy: true, location: { include: { business: true } },
      allocations: { include: { sale: { select: { id: true, number: true, locationId: true } } } },
      payments: { include: { cheque: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!c) notFound();
  const { print, paper: paperParam } = await searchParams;
  const layout = await getInvoiceLayout();
  const paper = (["A4", "80mm", "58mm"].includes(paperParam ?? "") ? paperParam : await receiptPaper(c.locationId)) as string;
  const visible = new Set(user.locations.map((l) => l.id));
  const cheque = c.payments.find((p) => p.direction === "IN" && p.cheque)?.cheque ?? null;
  const reversal = c.payments.find((p) => p.reversesId);
  const stateBy = c.stateById ? await db.person.findUnique({ where: { id: c.stateById }, select: { fullName: true } }) : null;

  return (
    <div className="stack">
      <div className="no-print">
        <PageHead eyebrow={`Sell / Debt payments / ${c.location.name}`} title={c.number}
          actions={<><Badge tone={c.state === "POSTED" ? "ok" : "warn"}>{c.state === "POSTED" ? (cheque && cheque.status !== "CLEARED" ? "Cheque pending" : "Recorded") : c.state.toLowerCase()}</Badge>
            <span className="row" style={{ gap: 4 }}>{(["80mm", "58mm", "A4"] as const).map((p) => <Link key={p} className={"btn btn-sm" + (p === paper ? " btn-primary" : "")} href={`?paper=${p}`} replace>{p}</Link>)}</span>
            <PrintOnLoad enabled={print === "1"} /></>} />
      </div>
      <style>{paper === "A4" ? "@page { size: A4; margin: 12mm; }" : `@page { size: ${paper} auto; margin: 0; }`}</style>
      <div className={`doc paper-${paper}`}>
        <div className="doc-top">
          <div><h3>{c.location.business.name.toUpperCase()}</h3><div className="small">{c.location.name}{c.location.phone ? ` · ${c.location.phone}` : ""}</div></div>
          <div className="small" style={{ textAlign: "right" }}><strong>PAYMENT RECEIPT</strong><br />{c.number}<br />{fmtDateTime(c.paidAt)}</div>
        </div>
        <div className="small" style={{ marginBottom: 10 }}>
          Received from: {c.customer.name}{c.customer.phone ? ` · ${c.customer.phone}` : ""}<br />
          Received by: {c.createdBy.fullName}
        </div>
        <div className="totalrow"><span>Previous balance</span><strong>{money(c.debtBefore)}</strong></div>
        <div className="totalrow grand"><span>Received · {method(c.method)}{c.reference ? ` (${c.reference})` : ""}</span><strong>Rs. {money(c.received)}</strong></div>
        {D(c.change).gt(0) && <div className="totalrow small"><span>Tendered {money(c.tendered)} · change given</span><strong>{money(c.change)}</strong></div>}
        {c.allocations.map((a) => (
          <div key={a.id} className="totalrow small">
            <span>{!a.sale ? "Opening balance" : visible.has(a.sale.locationId) ? <span>Invoice <Link href={`/sales/${a.sale.id}`}>{a.sale.number}</Link></span> : "Invoice at another branch"} · left {money(a.dueAfter)}</span>
            <strong>{money(a.amount)}</strong>
          </div>
        ))}
        {D(c.advance).gt(0) && <div className="totalrow small"><span>Kept as advance credit</span><strong>{money(c.advance)}</strong></div>}
        <div className="totalrow"><span>Balance due after this payment</span><strong>Rs. {money(c.debtAfter)}</strong></div>
        {cheque && <p className="small" style={{ marginTop: 8 }}>Cheque {cheque.number}{cheque.bank ? ` · ${cheque.bank}` : ""} · {cheque.status.toLowerCase()}{cheque.status === "PENDING" || cheque.status === "DEPOSITED" ? " — subject to clearance" : ""}</p>}
        {c.state !== "POSTED" && <p className="small" style={{ marginTop: 8 }}><strong>{c.state === "BOUNCED" ? "BOUNCED" : "REVERSED"}</strong>{c.stateAt ? ` ${fmtDateTime(c.stateAt)}` : ""}{stateBy ? ` by ${stateBy.fullName}` : ""}{c.stateReason ? ` — ${c.stateReason}` : ""}. This receipt no longer reduces the balance.</p>}
        {c.note && <p className="small muted no-print">Note: {c.note}</p>}
        {layout.footerText && <p className="small muted" style={{ textAlign: "center", marginTop: 14, whiteSpace: "pre-line" }}>{layout.footerText}</p>}
        {layout.showBarcode && <div style={{ textAlign: "center", marginTop: 8 }}><Barcode value={c.number} height={paper === "58mm" ? 30 : 36} /></div>}
      </div>

      <div className="no-print stack">
        <section className="panel small">
          <strong>Money movement</strong>
          {c.payments.map((p) => <div key={p.id} className="totalrow"><span>{p.number} · {p.direction === "IN" ? "in" : "out"} · {method(p.method)}{c.account && p.method !== "STORE_CREDIT" ? ` · ${c.account.name}` : ""}{p.registerId ? " · register" : ""}</span><strong>{p.direction === "OUT" ? "−" : ""}{money(p.amount)}</strong></div>)}
          {reversal && <p className="muted" style={{ margin: "6px 0 0" }}>Reversed by {reversal.number}.</p>}
          <Link href={`/contacts/${c.customerId}`}>Customer page</Link>
        </section>
        {c.state === "POSTED" && can(user, "debt.reverse") && (
          <section className="panel">
            <details><summary className="small" style={{ cursor: "pointer" }}>Reverse this receipt</summary>
              <ActionForm action={reverseCollectionForm} style={{ marginTop: 10 }}>
                <input type="hidden" name="id" value={c.id} />
                <p className="small muted" style={{ margin: 0 }}>The receipt stays on record, marked reversed; every invoice it paid owes again and the money is paid back out of {c.account?.name ?? "store credit"}{c.method === "CASH" && c.registerId ? " (from your open register)" : ""}.{cheque && cheque.status !== "CLEARED" ? " A cheque that has not cleared is bounced or cancelled in the cheque register instead." : ""}</p>
                <label className="field"><span>Reason</span><input name="reason" required minLength={3} maxLength={300} /></label>
                <div><SubmitButton className="btn btn-danger">Reverse receipt</SubmitButton></div>
              </ActionForm>
            </details>
          </section>
        )}
      </div>
    </div>
  );
}
