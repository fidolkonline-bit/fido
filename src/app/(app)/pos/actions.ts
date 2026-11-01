"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission, requireUser, can } from "@/lib/auth";
import { finalizeSale } from "@/lib/sales";
import { formError } from "@/lib/forms";
import { enqueueSms, kickSms } from "@/lib/sms";
import { money } from "@/lib/money";

export async function completeSale(payload: unknown): Promise<{ id?: string; number?: string; change?: string; error?: string }> {
  const user = await requirePermission("sales.create");
  try {
    const r = await finalizeSale(user, payload);
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
  const rows = await db.contact.findMany({
    where: { isCustomer: true, active: true, OR: [{ name: { contains: term, mode: "insensitive" } }, { phone: { contains: term } }] },
    take: 10, orderBy: { name: "asc" }, select: { id: true, name: true, phone: true },
  });
  const credit = await db.storeCreditEntry.groupBy({ by: ["contactId"], where: { contactId: { in: rows.map((r) => r.id) } }, _sum: { amount: true } });
  const creditOf = new Map(credit.map((c) => [c.contactId, Number(c._sum.amount ?? 0)]));
  return rows.map((r) => ({ ...r, storeCredit: creditOf.get(r.id) ?? 0 }));
}
