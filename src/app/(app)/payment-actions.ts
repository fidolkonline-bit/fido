"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { receiveSalePayment, paySupplier, updateCheque } from "@/lib/payments";
import { createShipment, setShipmentStatus, remitCod } from "@/lib/shipments";
import { formError, num, str } from "@/lib/forms";

type Res = { error?: string; ok?: string } | undefined;
const payFrom = (f: FormData) => ({
  amount: num(f, "amount"), method: str(f, "method"), accountId: str(f, "accountId"), reference: str(f, "reference"),
  cheque: str(f, "method") === "CHEQUE" ? { number: str(f, "chequeNumber") ?? "", bank: str(f, "chequeBank"), realizeDate: str(f, "chequeDate") ?? "" } : null,
});

export async function salePaymentForm(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("sales.create");
  const id = String(f.get("saleId"));
  try { await receiveSalePayment(user, id, payFrom(f)); } catch (e) { return formError(e); }
  revalidatePath(`/sales/${id}`);
  return { ok: "Payment received." };
}

export async function supplierPaymentForm(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("purchases.post");
  const id = String(f.get("receiptId"));
  try { await paySupplier(user, id, payFrom(f)); } catch (e) { return formError(e); }
  revalidatePath(`/purchases/${id}`);
  return { ok: "Payment recorded." };
}

export async function chequeForm(f: FormData) {
  const user = await requirePermission("accounts.manage");
  await updateCheque(user, String(f.get("id")), String(f.get("action")) as "CLEAR", str(f, "note"));
  revalidatePath("/accounts/cheques");
}

export async function newShipmentForm(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("sales.create");
  const saleId = String(f.get("saleId"));
  try {
    await createShipment(user, { saleId, address: str(f, "address"), contactName: str(f, "contactName"), contactPhone: str(f, "contactPhone"), carrier: str(f, "carrier"), trackingRef: str(f, "trackingRef"), charge: num(f, "charge") ?? 0, codAmount: num(f, "codAmount") ?? 0, notes: str(f, "notes") });
  } catch (e) { return formError(e); }
  revalidatePath(`/sales/${saleId}`);
  return { ok: "Shipment created." };
}

export async function shipmentStatusForm(f: FormData) {
  const user = await requirePermission("sales.create");
  await setShipmentStatus(user, String(f.get("id")), String(f.get("status")), str(f, "note"), str(f, "deliveredTo"));
  revalidatePath("/sales/shipments");
  revalidatePath(`/sales/${f.get("saleId")}`);
}

export async function codForm(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("sales.create");
  try { await remitCod(user, String(f.get("id")), { amount: num(f, "amount") ?? 0, method: String(f.get("method")), accountId: str(f, "accountId"), reference: str(f, "reference") }); } catch (e) { return formError(e); }
  revalidatePath("/sales/shipments");
  return { ok: "COD money recorded against the sale." };
}

export async function discountRuleForm(_: Res, f: FormData): Promise<Res> {
  await requirePermission("products.manage");
  const name = str(f, "name");
  const scope = str(f, "scope") ?? "ALL";
  const percent = num(f, "percent"), amount = num(f, "amount");
  if (!name) return { error: "Name the offer." };
  if ((percent == null) === (amount == null)) return { error: "Give either a percent or a fixed amount per item." };
  if (percent != null && (percent <= 0 || percent > 90)) return { error: "Percent must be between 0 and 90." };
  const targetIds = f.getAll("targetIds").map(String).filter(Boolean);
  if (scope !== "ALL" && !targetIds.length) return { error: "Choose what the offer applies to." };
  const s = str(f, "startsAt"), e = str(f, "endsAt");
  await db.discountRule.create({
    data: { name, scope, targetIds, percent, amount, priority: num(f, "priority") ?? 1, locationId: str(f, "locationId"),
      startsAt: s ? new Date(`${s}T00:00:00+05:30`) : null, endsAt: e ? new Date(`${e}T23:59:59+05:30`) : null },
  });
  revalidatePath("/sales/discounts");
  return { ok: `${name} is live for its dates.` };
}

export async function toggleRule(f: FormData) {
  await requirePermission("products.manage");
  await db.discountRule.update({ where: { id: String(f.get("id")) }, data: { active: f.get("active") === "true" } });
  revalidatePath("/sales/discounts");
}

export async function recurringForm(_: Res, f: FormData): Promise<Res> {
  const user = await requirePermission("expenses.manage");
  const name = str(f, "name"), start = str(f, "nextDate"), amount = num(f, "amount");
  if (!name || !start || !amount || amount <= 0 || !user.location) return { error: "Name, amount and first date are required." };
  await db.recurringExpense.create({
    data: { name, categoryId: String(f.get("categoryId")), locationId: user.location.id, contactId: str(f, "contactId"), amount, interval: str(f, "interval") ?? "MONTH",
      nextDate: new Date(`${start}T00:00:00.000Z`), endDate: str(f, "endDate") ? new Date(`${str(f, "endDate")}T00:00:00.000Z`) : null, createdById: user.personId },
  });
  revalidatePath("/expenses/recurring");
  return { ok: `${name} saved. An expense (due) is created once on each date.` };
}

export async function stopRecurring(f: FormData) {
  await requirePermission("expenses.manage");
  await db.recurringExpense.update({ where: { id: String(f.get("id")) }, data: { active: false } });
  revalidatePath("/expenses/recurring");
}
