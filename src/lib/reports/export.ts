import "server-only";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { Prisma } from "@prisma/client";
import { fmtCell, flatColumns } from "./run";
import type { Cell, Col, Result } from "./types";

// What every exported report says about itself, above the table.
export type ExportMeta = {
  title: string; // e.g. "Sales Representative Report - Fido.lk"
  lines: string[]; // period, location, filters, who generated it
};

const NUMERIC = new Set<Col["kind"]>(["money", "qty", "pct"]);
const HEAD: [number, number, number] = [44, 62, 80]; // dark slate header and totals, as on the old Clicky reports

// Excel stores times without a zone: show the shop's local time (Asia/Colombo, UTC+05:30).
const local = (d: Date) => new Date(d.getTime() + 330 * 60_000);

function excelValue(v: Cell, kind: Col["kind"]): ExcelJS.CellValue {
  if (v == null || v === "") return null;
  if (v instanceof Date) return kind === "date" && v.getUTCHours() === 0 ? v : local(v);
  if (NUMERIC.has(kind) || v instanceof Prisma.Decimal || typeof v === "number") {
    const n = Number(v instanceof Prisma.Decimal ? v.toString() : v);
    return Number.isFinite(n) ? (kind === "money" ? Number(n.toFixed(2)) : n) : String(v);
  }
  return String(v);
}

export async function reportXlsx(result: Result, meta: ExportMeta) {
  const cols = flatColumns(result.columns);
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const top = meta.lines.length + 2; // title, lines, blank row, then the header row
  const ws = wb.addWorksheet("Report", { views: [{ state: "frozen", ySplit: top + 1 }], pageSetup: { orientation: cols.length > 7 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.addRow([meta.title]).font = { bold: true, size: 14 };
  for (const l of meta.lines) ws.addRow([l]).font = { color: { argb: "FF555555" } };
  ws.addRow([]);

  const head = ws.addRow(cols.map((c) => c.label));
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.alignment = { wrapText: true, vertical: "middle" };
  head.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2C3E50" } }; });
  ws.autoFilter = { from: { row: top + 1, column: 1 }, to: { row: top + 1, column: cols.length } };

  for (const r of result.rows) {
    const row = ws.addRow(cols.map((c) => excelValue(r[c.key], c.kind)));
    if (r._tone === "err") row.font = { color: { argb: "FFB3261E" } };
    else if (r._tone === "warn") row.font = { color: { argb: "FF9A6700" } };
  }
  if (result.totals) {
    const t = ws.addRow(cols.map((c, i) => (i === 0 ? "Total" : c.key in result.totals! ? excelValue(result.totals![c.key], c.kind) : null)));
    t.font = { bold: true, color: { argb: "FFFFFFFF" } };
    t.eachCell({ includeEmpty: true }, (cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2C3E50" } }; });
  }

  cols.forEach((c, i) => {
    const column = ws.getColumn(i + 1);
    const longest = Math.max(c.label.length, ...result.rows.slice(0, 500).map((r) => fmtCell(r[c.key], c.kind).length));
    column.width = Math.min(Math.max(longest + 2, 10), 45);
    if (c.kind === "money") column.numFmt = '"Rs "#,##0.00;[Red]-"Rs "#,##0.00';
    else if (c.kind === "qty") column.numFmt = "#,##0.##";
    else if (c.kind === "pct") column.numFmt = '0.0"%"';
    else if (c.kind === "datetime") column.numFmt = "dd/mm/yyyy hh:mm AM/PM";
    else if (c.kind === "date") column.numFmt = "dd/mm/yyyy";
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// jsPDF's built-in fonts cover Latin text only; anything else (e.g. Sinhala) is shown as "?" rather than garbage.
const latin = (s: string) => s.replace(/[^ -ÿ–—‘’“”•]/g, "?");

function pdfText(v: Cell, kind: Col["kind"]) {
  if (v == null || v === "") return "";
  if (v instanceof Date && kind === "datetime") {
    // "30/10/2026 03:21 PM" on two lines, like the old report.
    const d = local(v);
    const h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2, "0");
    const dd = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
    return `${dd}\n${String(h % 12 || 12).padStart(2, "0")}:${m} ${h < 12 ? "AM" : "PM"}`;
  }
  const s = fmtCell(v, kind);
  // Non-breaking space: "Rs 1,000.00" never splits over two lines.
  if (kind === "money") return s.startsWith("-") ? `-Rs\u00a0${s.slice(1)}` : `Rs\u00a0${s}`;
  return latin(s);
}

export function reportPdf(result: Result, meta: ExportMeta) {
  const cols = result.columns;
  const doc = new jsPDF({ orientation: cols.length > 8 ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();

  doc.setFont("helvetica", "normal").setFontSize(15).text(latin(meta.title), pageW / 2, 14, { align: "center" });
  doc.setFontSize(8.5).setTextColor(90);
  meta.lines.forEach((l, i) => doc.text(latin(l), pageW / 2, 20 + i * 4.5, { align: "center", maxWidth: pageW - 20 }));
  doc.setTextColor(0);

  const body = result.rows.map((r) => cols.map((c) => {
    const v = pdfText(r[c.key], c.kind);
    const lead = c.lead && r[c.lead.key] ? latin(String(r[c.lead.key])) : "";
    return lead ? `${lead} ${v}` : v;
  }));
  const foot = result.totals ? [cols.map((c, i) => (i === 0 ? "Total:" : c.key in result.totals! ? pdfText(result.totals![c.key], c.kind) : ""))] : undefined;
  const tones = result.rows.map((r) => r._tone);
  const widths: { minCellWidth?: number; cellWidth?: number }[] = cols.map((c) => (c.lead ? { minCellWidth: 42 } : c.kind === "money" ? { minCellWidth: 25 } : c.kind === "datetime" ? { cellWidth: 21 } : c.kind === "date" ? { cellWidth: 20 } : {}));
  const reserved = widths.reduce((a, w) => a + (w.minCellWidth ?? w.cellWidth ?? 18), 0);
  const fit = reserved <= pageW - 20; // wide reports (e.g. payroll) wrap instead of running off the page

  autoTable(doc, {
    startY: 22 + meta.lines.length * 4.5,
    head: [cols.map((c) => c.label)],
    body,
    foot,
    showFoot: "lastPage",
    showHead: "everyPage",
    theme: "striped",
    margin: { left: 10, right: 10, bottom: 14 },
    styles: { font: "helvetica", fontSize: fit ? 8.5 : 7, cellPadding: 1.6, overflow: "linebreak", valign: "top" },
    headStyles: { fillColor: HEAD, textColor: 255, fontStyle: "normal", halign: "center", valign: "middle" },
    footStyles: { fillColor: HEAD, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [242, 242, 242] },
    bodyStyles: { fillColor: [255, 255, 255] },
    // Amounts and dates keep to one line when the page has room; text columns (invoice, customer) share what is left.
    columnStyles: Object.fromEntries(cols.map((c, i) => [i, fit ? widths[i] : {}])),
    didParseCell: (d) => {
      const c = cols[d.column.index];
      if (d.section !== "head" && NUMERIC.has(c.kind) && !c.lead) d.cell.styles.halign = "right";
      if (d.section === "body") {
        const t = tones[d.row.index];
        if (t === "err") d.cell.styles.textColor = [179, 38, 30];
        else if (t === "warn") d.cell.styles.textColor = [154, 103, 0];
      }
    },
    didDrawPage: () => {
      doc.setFontSize(8).setTextColor(120);
      doc.text(`Page ${doc.getNumberOfPages()}`, pageW - 10, pageH - 6, { align: "right" });
      doc.setTextColor(0);
    },
  });
  return Buffer.from(doc.output("arraybuffer"));
}

const MIME = { csv: "text/csv; charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf" } as const;
export type ExportFormat = keyof typeof MIME;
export const exportFormat = (v: string | undefined): ExportFormat => (v === "xlsx" || v === "pdf" ? v : "csv");

// A file download that is never cached (reports carry money and customer names).
export function download(bytes: Uint8Array | string, format: ExportFormat, name: string) {
  return new Response(typeof bytes === "string" ? bytes : new Uint8Array(bytes), {
    headers: { "Content-Type": MIME[format], "Content-Disposition": `attachment; filename="${name}.${format}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export const generatedLine = (by: string) => `Generated ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Colombo" })} by ${by}`;
