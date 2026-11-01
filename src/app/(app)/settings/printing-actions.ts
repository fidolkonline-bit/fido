"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { invoiceLayoutSchema, labelTemplateSchema, printerSchema, getPrinters, getLabelTemplates, saveSetting } from "@/lib/settings";
import { formError, num, str, type FormState } from "@/lib/forms";

const DOC_TYPES = ["SALE", "CREDIT_NOTE", "GRN", "PURCHASE_ORDER", "SUPPLIER_CLAIM", "PAYMENT_IN", "PAYMENT_OUT", "ADJUSTMENT", "TRANSFER", "EXPENSE"];

export async function saveScheme(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("settings.manage");
  const docType = str(f, "docType");
  const prefix = str(f, "prefix")?.toUpperCase();
  const nextValue = num(f, "nextValue");
  const digits = num(f, "digits");
  if (!docType || !DOC_TYPES.includes(docType)) return { error: "Unknown document type." };
  if (!prefix || !/^[A-Z0-9-]{1,8}$/.test(prefix)) return { error: "Prefix: 1–8 letters, numbers or dashes." };
  if (!nextValue || nextValue < 1 || !Number.isInteger(nextValue)) return { error: "Next number must be a whole number ≥ 1." };
  if (!digits || digits < 1 || digits > 8) return { error: "Digits must be between 1 and 8." };
  try {
    const current = await db.numberScheme.findUnique({ where: { docType_scope: { docType, scope: "ALL" } } });
    // Moving a live sequence backwards would re-issue numbers that already exist (spec §15.2 collision rule).
    if (current && current.prefix === prefix && nextValue < current.nextValue)
      return { error: `Next number cannot go back below ${current.nextValue} while the prefix stays ${prefix}.` };
    await db.numberScheme.upsert({
      where: { docType_scope: { docType, scope: "ALL" } },
      create: { docType, scope: "ALL", prefix, nextValue, digits, includeYear: f.get("includeYear") === "on" },
      update: { prefix, nextValue, digits, includeYear: f.get("includeYear") === "on" },
    });
    await db.auditEvent.create({ data: { actorId: user.personId, action: "NUMBERING_CHANGED", subjectType: "NumberScheme", subjectId: docType, detail: { prefix, nextValue, digits } } });
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/settings/numbering");
  return { ok: `${docType.replace("_", " ").toLowerCase()} numbering saved.` };
}

export async function saveLayout(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("settings.manage");
  try {
    const layout = invoiceLayoutSchema.parse({
      headerText: str(f, "headerText") ?? "", footerText: str(f, "footerText") ?? "", paper: str(f, "paper") ?? "80mm",
      showLot: f.get("showLot") === "on", showWarranty: f.get("showWarranty") === "on", showImei: f.get("showImei") === "on",
      showCustomerDue: f.get("showCustomerDue") === "on", showBarcode: f.get("showBarcode") === "on",
    });
    await saveSetting("invoiceLayout", layout, user.personId);
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/settings/printing");
  return { ok: "Invoice layout saved. Already-issued invoices keep their numbers and values; reprints use this layout." };
}

export async function addPrinter(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("settings.manage");
  try {
    const p = printerSchema.parse({ id: crypto.randomUUID(), name: str(f, "name") ?? "", kind: str(f, "kind"), paper: str(f, "paper") ?? "80mm", locationId: str(f, "locationId"), notes: str(f, "notes") ?? "" });
    await saveSetting("printers", [...(await getPrinters()), p], user.personId);
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/settings/printing");
  return { ok: "Printer added." };
}

export async function removePrinter(f: FormData) {
  const user = await requirePermission("settings.manage");
  const id = String(f.get("id"));
  await saveSetting("printers", (await getPrinters()).filter((p) => p.id !== id), user.personId);
  revalidatePath("/settings/printing");
}

export async function saveLabelTemplate(_: FormState, f: FormData): Promise<FormState> {
  const user = await requirePermission("settings.manage");
  try {
    const t = labelTemplateSchema.parse({
      id: str(f, "id") ?? crypto.randomUUID(), name: str(f, "name") ?? "", widthMm: num(f, "widthMm"), heightMm: num(f, "heightMm"),
      columns: num(f, "columns") ?? 1, gapMm: num(f, "gapMm") ?? 2,
      showName: f.get("showName") === "on", showPrice: f.get("showPrice") === "on", showLot: f.get("showLot") === "on", showBusiness: f.get("showBusiness") === "on",
    });
    const all = await getLabelTemplates();
    await saveSetting("labelTemplates", all.some((x) => x.id === t.id) ? all.map((x) => (x.id === t.id ? t : x)) : [...all, t], user.personId);
  } catch (e) {
    return formError(e);
  }
  revalidatePath("/settings/labels");
  return { ok: "Label size saved." };
}

export async function listSchemes() {
  await requirePermission("settings.manage");
  const rows = await db.numberScheme.findMany({ where: { scope: "ALL" } });
  return DOC_TYPES.map((docType) => rows.find((r) => r.docType === docType) ?? { docType, prefix: null, nextValue: 1, digits: 4, includeYear: true });
}
