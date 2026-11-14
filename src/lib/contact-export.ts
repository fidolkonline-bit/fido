import "server-only";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import type { Prisma } from "@prisma/client";
import { D, money, fmtDate, fmtDateTime } from "@/lib/money";
import { statsOf, openingDue, type ContactStats, type ListedContact } from "@/lib/contact-list";

type Dec = Prisma.Decimal;
type Cell = string | number | Date | null;
type Col = { header: string; kind: "text" | "money" | "int" | "date"; width: number; pdf?: number; noTotal?: boolean; get: (c: ListedContact, s: ContactStats, due: Dec) => Dec | string | number | Date | null };

// Detailed columns; `pdf` marks the ones that fit on a landscape A4 page (and its relative width).
function columns(supplier: boolean): Col[] {
  const docs = supplier ? "Purchases" : "Sales";
  return [
    { header: "Code", kind: "text", width: 12, pdf: 9, get: (c) => c.code },
    { header: supplier ? "Supplier" : "Customer", kind: "text", width: 28, pdf: 26, get: (c) => c.name },
    { header: "Business name", kind: "text", width: 24, ...(supplier ? { pdf: 20 } : {}), get: (c) => c.company },
    { header: "Mobile", kind: "text", width: 14, pdf: 14, get: (c) => c.phone },
    { header: "Email", kind: "text", width: 24, get: (c) => c.email },
    { header: "Address", kind: "text", width: 30, get: (c) => c.address },
    { header: "Tax number", kind: "text", width: 14, get: (c) => c.taxNumber },
    ...(supplier ? [] : [
      { header: "Group", kind: "text", width: 14, pdf: 11, get: (c: ListedContact) => c.group?.name ?? null } as Col,
      { header: "Credit limit", kind: "money", width: 14, pdf: 12, noTotal: true, get: (c: ListedContact) => c.creditLimit } as Col,
    ]),
    { header: "Pay term (days)", kind: "int", width: 10, get: (c) => c.payTermDays },
    { header: "Opening balance due", kind: "money", width: 14, get: (c) => openingDue(c, supplier) },
    { header: `${docs} (count)`, kind: "int", width: 10, pdf: 7, get: (_c, s) => s.docCount },
    { header: `Total ${docs.toLowerCase()}`, kind: "money", width: 15, pdf: 13, get: (_c, s) => s.docTotal },
    { header: "Paid", kind: "money", width: 15, pdf: 13, get: (_c, s) => s.docPaid },
    { header: supplier ? "Claim credits" : "Returns credited", kind: "money", width: 14, get: (_c, s) => s.docCredited },
    ...(supplier ? [] : [{ header: "Store credit", kind: "money", width: 13, pdf: 11, get: (_c: ListedContact, s: ContactStats) => s.storeCredit } as Col]),
    { header: supplier ? "We owe" : "Due", kind: "money", width: 15, pdf: 13, get: (_c, _s, due) => due },
    { header: supplier ? "Last purchase" : "Last sale", kind: "date", width: 13, pdf: 11, get: (_c, s) => s.last },
    { header: "Added on", kind: "date", width: 13, get: (c) => c.createdAt },
  ];
}

export type ExportInput = {
  supplier: boolean;
  contacts: ListedContact[];
  stats: Map<string, ContactStats>;
  dueOf: (c: ListedContact) => Dec;
  business: string;
  filters: string;
  by: string;
  at: Date;
};

const title = (supplier: boolean) => (supplier ? "Suppliers report" : "Customers report");

// Excel stores dates without a zone: shift to the shop's day (Asia/Colombo, UTC+05:30) so the cell shows the local date.
const excelDate = (d: Date) => { const x = new Date(d.getTime() + 330 * 60_000); x.setUTCHours(0, 0, 0, 0); return x; };

export async function contactsXlsx(x: ExportInput) {
  const cols = columns(x.supplier);
  const wb = new ExcelJS.Workbook();
  wb.creator = x.business;
  wb.created = x.at;
  const ws = wb.addWorksheet(x.supplier ? "Suppliers" : "Customers", { views: [{ state: "frozen", ySplit: 5 }] });
  ws.columns = cols.map((c) => ({ width: c.width }));

  ws.addRow([`${x.business} — ${title(x.supplier)}`]).font = { bold: true, size: 14 };
  ws.addRow([`Filters: ${x.filters}`]);
  ws.addRow([`Generated ${fmtDateTime(x.at)} by ${x.by} · ${x.contacts.length} ${x.supplier ? "suppliers" : "customers"} · amounts in LKR`]);
  ws.addRow([]);
  const head = ws.addRow(cols.map((c) => c.header));
  head.font = { bold: true };
  head.alignment = { wrapText: true, vertical: "middle" };
  head.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E4DC" } }; cell.border = { bottom: { style: "thin" } }; });
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: cols.length } };

  const sums = cols.map(() => D(0));
  for (const c of x.contacts) {
    const s = statsOf(x.stats, c.id);
    const due = x.dueOf(c);
    const values: Cell[] = cols.map((col, i) => {
      const v = col.get(c, s, due);
      if (v == null || v === "") return null;
      if (col.kind === "money") { sums[i] = sums[i].plus(v as Dec); return Number(D(v as Dec).toFixed(2)); }
      if (col.kind === "int") { if (col.header.endsWith("(count)")) sums[i] = sums[i].plus(v as number); return Number(v); }
      if (col.kind === "date") return excelDate(v as Date);
      return String(v);
    });
    const row = ws.addRow(values);
    if (due.gt(0)) row.getCell(cols.findIndex((c) => c.header === (x.supplier ? "We owe" : "Due")) + 1).font = { color: { argb: "FFB3261E" }, bold: true };
  }
  const total = ws.addRow(cols.map((col, i) => (i === 0 ? "Total" : (col.kind === "money" && !col.noTotal) || col.header.endsWith("(count)") ? Number(sums[i].toFixed(2)) : null)));
  total.font = { bold: true };
  total.eachCell((cell) => { cell.border = { top: { style: "thin" } }; });

  cols.forEach((col, i) => {
    const column = ws.getColumn(i + 1);
    if (col.kind === "money") column.numFmt = "#,##0.00;[Red]-#,##0.00";
    if (col.kind === "date") column.numFmt = "dd mmm yyyy";
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// jsPDF's built-in fonts cover Latin text only; anything else (e.g. Sinhala) is shown as "?" rather than garbage.
const latin = (s: string) => s.replace(/[^ -ÿ–—‘’“”•]/g, "?");

export function contactsPdf(x: ExportInput) {
  const cols = columns(x.supplier).filter((c) => c.pdf);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const usable = pageW - 20;
  const weight = cols.reduce((a, c) => a + c.pdf!, 0);

  doc.setFont("helvetica", "bold").setFontSize(15).text(latin(`${x.business} — ${title(x.supplier)}`), 10, 14);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
  doc.text(latin(`Filters: ${x.filters}`), 10, 20);
  doc.text(latin(`Generated ${fmtDateTime(x.at)} by ${x.by} · ${x.contacts.length} ${x.supplier ? "suppliers" : "customers"} · amounts in LKR`), 10, 25);
  doc.setTextColor(0);

  const sums = cols.map(() => D(0));
  const dueIdx = cols.findIndex((c) => c.header === (x.supplier ? "We owe" : "Due"));
  const body = x.contacts.map((c) => {
    const s = statsOf(x.stats, c.id);
    const due = x.dueOf(c);
    return cols.map((col, i) => {
      const v = col.get(c, s, due);
      if (col.kind === "money") { if (v != null) sums[i] = sums[i].plus(v as Dec); return v == null ? "—" : money(v as Dec); }
      if (col.kind === "int") { sums[i] = sums[i].plus((v as number) ?? 0); return String(v ?? 0); }
      if (col.kind === "date") return fmtDate(v as Date | null);
      return v ? latin(String(v)) : "—";
    });
  });
  const foot = [cols.map((col, i) => (i === 0 ? "Total" : col.kind === "money" ? (col.noTotal ? "" : money(sums[i])) : col.kind === "int" ? sums[i].toString() : ""))];

  autoTable(doc, {
    startY: 30,
    head: [cols.map((c) => c.header)],
    body,
    foot,
    showFoot: "lastPage",
    theme: "striped",
    margin: { left: 10, right: 10, bottom: 14 },
    styles: { font: "helvetica", fontSize: 8, cellPadding: 1.6, overflow: "linebreak" },
    headStyles: { fillColor: [38, 36, 33], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [232, 228, 220], textColor: 0, fontStyle: "bold" },
    columnStyles: Object.fromEntries(cols.map((c, i) => [i, { cellWidth: (usable * c.pdf!) / weight, halign: c.kind === "money" || c.kind === "int" ? "right" : "left" }])),
    didParseCell: (d) => {
      if (cols[d.column.index].kind === "money" || cols[d.column.index].kind === "int") d.cell.styles.halign = "right";
      if (d.section === "body" && d.column.index === dueIdx && !String(d.cell.raw).startsWith("-") && d.cell.raw !== "0.00") {
        d.cell.styles.textColor = [179, 38, 30];
        d.cell.styles.fontStyle = "bold";
      }
    },
    didDrawPage: () => {
      const n = doc.getNumberOfPages();
      doc.setFontSize(8).setTextColor(120);
      doc.text(`${title(x.supplier)} · page ${n}`, pageW - 10, doc.internal.pageSize.getHeight() - 6, { align: "right" });
      doc.setTextColor(0);
    },
  });
  return Buffer.from(doc.output("arraybuffer"));
}
