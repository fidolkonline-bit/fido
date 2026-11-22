import "server-only";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { Prisma } from "@prisma/client";
import { fmtCell, flatColumns } from "./run";
import type { Cell, Col, Result, Sheet, SheetItem } from "./types";

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
  if (result.sheet) return sheetXlsx(result.sheet, meta);
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
  if (result.sheet) return sheetPdf(result.sheet, meta);
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

// ───────────── Statement layout (Profit / Loss as the old Clicky page) ─────────────

const MONEY_FMT = '"Rs "#,##0.00;[Red]-"Rs "#,##0.00';
const rs = (v: Cell) => { const s = fmtCell(v ?? 0, "money") || "0.00"; return s.startsWith("-") ? `-Rs ${s.slice(1)}` : `Rs ${s}`; };

async function sheetXlsx(sheet: Sheet, meta: ExportMeta) {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet("Profit Loss", { pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }, views: [{ showGridLines: false }] });
  ws.columns = [{ width: 34 }, { width: 18 }, { width: 4 }, { width: 34 }, { width: 18 }];
  ws.addRow([meta.title]).font = { size: 18 };
  for (const l of meta.lines) ws.addRow([l]).font = { size: 9, color: { argb: "FF666666" } };
  ws.addRow([]);

  const thin = { style: "thin" as const, color: { argb: "FFE3E3E3" } };
  const label = (i: SheetItem): ExcelJS.CellValue => (i.sub
    ? { richText: [{ text: `${i.label}\n`, font: { bold: true, size: 11 } }, { text: i.sub, font: { bold: true, size: 8 } }] }
    : i.label);
  const n = Math.max(sheet.left.length, sheet.right.length);
  for (let k = 0; k < n; k++) {
    const a = sheet.left[k], b = sheet.right[k];
    const row = ws.addRow([a ? label(a) : null, a ? excelValue(a.value ?? 0, "money") : null, null, b ? label(b) : null, b ? excelValue(b.value ?? 0, "money") : null]);
    row.alignment = { vertical: "top", wrapText: true };
    if (a?.sub || b?.sub) row.height = 30;
    for (const [c, item] of [[1, a], [2, a], [4, b], [5, b]] as const) {
      if (!item) continue;
      const cell = row.getCell(c);
      if (c === 1 || c === 4) cell.font = { bold: true };
      else cell.numFmt = MONEY_FMT;
      if (k > 0) cell.border = { top: thin };
    }
  }

  if (sheet.results.length) ws.addRow([]);
  for (const r of sheet.results) {
    ws.addRow([]);
    const head = ws.addRow([`${r.label}:`, excelValue(r.value ?? 0, "money")]);
    head.font = { size: 16 };
    head.getCell(2).numFmt = MONEY_FMT;
    const note = ws.addRow([r.note]);
    ws.mergeCells(note.number, 1, note.number, 5);
    note.font = { size: 8 };
    note.alignment = { wrapText: true, vertical: "top" };
    note.height = r.note.length > 120 ? 48 : 14;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function sheetPdf(sheet: Sheet, meta: ExportMeta) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
  const M = 13, GAP = 6, boxW = (pageW - 2 * M - GAP) / 2, PAD = 5;

  doc.setFont("helvetica", "normal").setFontSize(20).text(latin(meta.title), M, 22);
  doc.setFontSize(8).setTextColor(110);
  meta.lines.forEach((l, i) => doc.text(latin(l), M, 28 + i * 4));
  doc.setTextColor(0);
  const top = 30 + meta.lines.length * 4;

  const rowH = (i: SheetItem) => (i.sub ? 10.5 : 7.8);
  const boxH = (items: SheetItem[]) => items.reduce((a, i) => a + rowH(i), 0) + 2 * PAD;
  const box = (x: number, y: number, w: number, h: number) => {
    doc.setDrawColor(236).setLineWidth(0.6).rect(x + 0.4, y + 0.6, w, h); // soft edge, like the page's card shadow
    doc.setDrawColor(226).setLineWidth(0.2).setFillColor(255, 255, 255).rect(x, y, w, h, "FD");
  };
  const drawBox = (items: SheetItem[], x: number) => {
    box(x, top, boxW, boxH(items));
    let y = top + PAD;
    items.forEach((i, k) => {
      if (k > 0) doc.setDrawColor(232).setLineWidth(0.2).line(x + PAD, y, x + boxW - PAD, y);
      doc.setFont("helvetica", "bold").setFontSize(8.2).text(latin(i.label), x + PAD, y + 5);
      if (i.sub) doc.setFontSize(6.4).text(latin(i.sub), x + PAD, y + 8.6);
      doc.setFont("helvetica", "normal").setFontSize(8.2).text(rs(i.value), x + boxW * 0.63, y + 5);
      y += rowH(i);
    });
  };
  drawBox(sheet.left, M);
  drawBox(sheet.right, M + boxW + GAP);

  if (sheet.results.length) {
    const fullW = pageW - 2 * M;
    // Keep the note's own line breaks (the formula starts its "- ( … )" part on a new line, as on the old page).
    const notes = sheet.results.map((r) => r.note.split("\n").flatMap((part) => doc.setFontSize(6.8).splitTextToSize(latin(part), fullW - 2 * PAD - 4) as string[]));
    const h = sheet.results.reduce((a, _r, k) => a + 12 + notes[k].length * 3, 0) + 2 * PAD + 4;
    const y0 = top + Math.max(boxH(sheet.left), boxH(sheet.right)) + 10;
    box(M, y0, fullW, h);
    let y = y0 + PAD + 9;
    sheet.results.forEach((r, k) => {
      doc.setFont("helvetica", "normal").setFontSize(17).text(`${r.label}: ${rs(r.value)}`, M + PAD + 2, y);
      doc.setFontSize(6.8).text(notes[k], M + PAD + 2, y + 4.5);
      y += 12 + notes[k].length * 3;
    });
  }

  doc.setFontSize(7).setTextColor(130);
  doc.text("Page 1 of 1", pageW - M, pageH - 8, { align: "right" });
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
