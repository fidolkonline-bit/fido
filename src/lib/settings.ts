import "server-only";
import { z } from "zod";
import { db } from "./db";

export const invoiceLayoutSchema = z.object({
  headerText: z.string().max(300).default(""),
  footerText: z.string().max(500).default("Thank you. Reprints keep the same invoice number."),
  showLot: z.boolean().default(true),
  showWarranty: z.boolean().default(true),
  showImei: z.boolean().default(true),
  showCustomerDue: z.boolean().default(false),
  showBarcode: z.boolean().default(true),
  paper: z.enum(["A4", "80mm", "58mm"]).default("80mm"),
});
export type InvoiceLayout = z.infer<typeof invoiceLayoutSchema>;

export const printerSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  kind: z.enum(["RECEIPT", "LABEL", "A4"]),
  paper: z.enum(["A4", "80mm", "58mm"]).default("80mm"),
  locationId: z.string().nullable().default(null),
  notes: z.string().max(200).default(""),
});
export type PrinterProfile = z.infer<typeof printerSchema>;

export const labelTemplateSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(60),
  widthMm: z.number().min(15).max(210),
  heightMm: z.number().min(10).max(297),
  columns: z.number().int().min(1).max(6).default(1),
  gapMm: z.number().min(0).max(10).default(2),
  showName: z.boolean().default(true),
  showPrice: z.boolean().default(true),
  showLot: z.boolean().default(false),
  showBusiness: z.boolean().default(false),
});
export type LabelTemplate = z.infer<typeof labelTemplateSchema>;

const DEFAULT_LABELS: LabelTemplate[] = [
  { id: "roll-50x25", name: "Roll 50 × 25 mm", widthMm: 50, heightMm: 25, columns: 1, gapMm: 2, showName: true, showPrice: true, showLot: false, showBusiness: false },
  { id: "roll-38x25", name: "Roll 38 × 25 mm", widthMm: 38, heightMm: 25, columns: 1, gapMm: 2, showName: true, showPrice: true, showLot: false, showBusiness: false },
  { id: "a4-3x8", name: "A4 sheet 3 × 8 (64 × 34 mm)", widthMm: 64, heightMm: 34, columns: 3, gapMm: 2, showName: true, showPrice: true, showLot: true, showBusiness: true },
];

async function read<T>(key: string, parse: (v: unknown) => T, fallback: T): Promise<T> {
  const row = await db.appSetting.findUnique({ where: { key } });
  if (!row) return fallback;
  try { return parse(row.value); } catch { return fallback; }
}

export const getInvoiceLayout = () => read("invoiceLayout", (v) => invoiceLayoutSchema.parse(v), invoiceLayoutSchema.parse({}));
export const getPrinters = () => read("printers", (v) => z.array(printerSchema).parse(v), [] as PrinterProfile[]);
export const getLabelTemplates = () => read("labelTemplates", (v) => z.array(labelTemplateSchema).parse(v), DEFAULT_LABELS);

export async function saveSetting(key: string, value: unknown, personId: string) {
  await db.appSetting.upsert({ where: { key }, create: { key, value: value as object, updatedBy: personId }, update: { value: value as object, updatedBy: personId } });
  await db.auditEvent.create({ data: { actorId: personId, action: "SETTING_CHANGED", subjectType: "AppSetting", subjectId: key, detail: value as object } });
}

// Receipt paper for a location: its receipt printer profile if one exists, else the layout default.
export async function receiptPaper(locationId: string | null) {
  const [layout, printers] = await Promise.all([getInvoiceLayout(), getPrinters()]);
  return printers.find((p) => p.kind === "RECEIPT" && p.locationId === locationId)?.paper ?? layout.paper;
}
