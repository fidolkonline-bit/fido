"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission, requireUser, can } from "@/lib/auth";
import { finalizeSale } from "@/lib/sales";
import { formError } from "@/lib/forms";
import { enqueueSms, kickSms } from "@/lib/sms";
import { closeDraft } from "@/lib/drafts";
import { money } from "@/lib/money";
import { customerPolicy } from "@/lib/pricing";
import { DebtError, collectionByKey, ledgerView, loadLedger, receiveDebtPayment, type LedgerView, type ReceiptView } from "@/lib/debt";
import { maskPhone } from "@/lib/debt-rules";

export async function completeSale(payload: unknown): Promise<{ id?: string; number?: string; change?: string; error?: string }> {
  const user = await requirePermission("sales.create");
  try {
    const r = await finalizeSale(user, payload);
    const draftId = (payload as { draftId?: string | null }).draftId;
    if (draftId) await closeDraft(draftId, "CONVERTED", r.id);
    // Receipt SMS only after the sale has committed; a failed SMS never undoes the sale (spec §18).
    if ((payload as { smsReceipt?: boolean }).smsReceipt) {
      const sale = await db.sale.findUnique({ where: { id: r.id }, include: { customer: true } });
      if (sale?.customer?.phone) {
        const due = sale.total.minus(sale.paid);
        const queued = await enqueueSms("SALE_RECEIPT", {
          to: sale.customer.phone, sourceType: "Sale", sourceId: sale.id,
          vars: { invoice: sale.number, total: money(sale.total), paid: money(sale.paid), due: due.gt(0) ? `. Due Rs.${money(due)}` : "" },
        });
        if (queued) kickSms();
      }
    }
    revalidatePath("/");
    revalidatePath("/sales");
    return r;
  } catch (e) {
    return formError(e) ?? {};
  }
}

export async function searchCustomers(q: string) {
  const user = await requireUser();
  if (!can(user, "sales.create") && !can(user, "contacts.view")) return [];
  const term = q.trim();
  if (!term) return [];
  // Name or mobile (digits only, so "077 123 4567" still matches), or the exact customer ID. Several matches are listed
  // for the cashier to pick; nothing is selected automatically.
  const digits = term.replace(/\D/g, "");
  const rows = await db.contact.findMany({
    where: {
      isCustomer: true, active: true,
      OR: [{ name: { contains: term, mode: "insensitive" } }, { phone: { contains: term } }, ...(digits.length >= 3 && digits !== term ? [{ phone: { contains: digits } }] : []), { code: { equals: term, mode: "insensitive" } }],
    },
    take: 10, orderBy: { name: "asc" }, select: { id: true, name: true, phone: true, code: true },
  });
  const policies = await Promise.all(rows.map((r) => customerPolicy(db, r.id)));
  const credit = await db.storeCreditEntry.groupBy({ by: ["contactId"], where: { contactId: { in: rows.map((r) => r.id) } }, _sum: { amount: true } });
  const creditOf = new Map(credit.map((c) => [c.contactId, Number(c._sum.amount ?? 0)]));
  return rows.map((r, i) => ({ ...r, phoneMasked: maskPhone(r.phone), storeCredit: creditOf.get(r.id) ?? 0, pricing: policies[i] }));
}

// ── Customer debt at the POS (CR-03) ──────────────────────────────────────────────────────────────────────────

// Live balance for the selected customer. Never a cached figure: the strip shows "Loading balance" until this returns.
export async function customerBalance(customerId: string): Promise<{ ledger?: LedgerView; error?: string }> {
  const user = await requireUser();
  if (!can(user, "debt.view")) return { error: "You are not allowed to see customer balances." };
  try {
    return { ledger: ledgerView(await loadLedger(db, customerId, user)) };
  } catch (e) {
    return { error: e instanceof DebtError ? e.message : "Balance unavailable." };
  }
}

export async function recordDebtPayment(payload: unknown): Promise<{ receipt?: ReceiptView; error?: string; stale?: boolean }> {
  const user = await requireUser();
  if (!can(user, "debt.receive")) return { error: "You are not allowed to receive debt payments." };
  try {
    const receipt = await receiveDebtPayment(user, payload);
    revalidatePath("/sales/collections");
    return { receipt };
  } catch (e) {
    if (e instanceof DebtError) return { error: e.message, stale: e.code === "STALE" };
    return formError(e) ?? { error: "The payment could not be recorded." };
  }
}

// After a timeout or lost connection: was this receipt recorded? Asked before anyone may collect again.
export async function debtReceiptStatus(idempotencyKey: string): Promise<{ receipt?: ReceiptView | null; error?: string }> {
  const user = await requireUser();
  if (!can(user, "debt.receive")) return { error: "Not allowed." };
  return { receipt: await collectionByKey(user, idempotencyKey) };
}

// SMS only after the receipt has committed; a failed SMS never undoes or repeats the payment.
export async function smsDebtReceipt(collectionId: string): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser();
  if (!can(user, "debt.receive")) return { error: "Not allowed." };
  const c = await db.debtCollection.findUnique({ where: { id: collectionId }, include: { customer: true } });
  if (!c || c.state !== "POSTED") return { error: "Receipt not found." };
  try {
    const queued = await enqueueSms("DEBT_RECEIPT", { to: c.customer.phone, sourceType: "DebtCollection", sourceId: c.id, vars: { receipt: c.number, amount: money(c.received), balance: money(c.debtAfter) } });
    if (queued) kickSms();
    return queued ? { ok: "SMS receipt queued." } : { error: "No SMS sent (no valid mobile, the message type is switched off, or it was already sent)." };
  } catch {
    return { error: "SMS could not be queued. The payment is recorded." };
  }
}

// Recent debt receipts and invoice payments for the history panel.
export async function customerHistory(customerId: string) {
  const user = await requireUser();
  if (!can(user, "debt.view")) return null;
  const visible = new Set(user.locations.map((l) => l.id));
  const [receipts, invoicePayments] = await Promise.all([
    db.debtCollection.findMany({ where: { customerId }, orderBy: { paidAt: "desc" }, take: 10, include: { allocations: { include: { sale: { select: { number: true, locationId: true } } } } } }),
    db.payment.findMany({ where: { contactId: customerId, saleId: { not: null }, sale: { stage: "FINAL" } }, orderBy: { paidAt: "desc" }, take: 10, include: { sale: { select: { number: true, locationId: true } } } }),
  ]);
  const ref = (s: { number: string; locationId: string } | null) => (!s ? "Opening balance" : visible.has(s.locationId) ? s.number : "Invoice at another branch");
  return {
    receipts: receipts.map((r) => ({ id: r.id, number: r.number, paidAt: r.paidAt.toISOString(), method: r.method, amount: r.received.toFixed(2), advance: r.advance.toFixed(2), state: r.state, applied: r.allocations.map((a) => `${ref(a.sale)} ${money(a.amount)}`).join(", ") })),
    payments: invoicePayments.map((p) => ({ id: p.id, number: p.number, paidAt: p.paidAt.toISOString(), method: p.method, direction: p.direction, amount: p.amount.toFixed(2), invoice: ref(p.sale) })),
  };
}
