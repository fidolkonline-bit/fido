import { code128 } from "@/lib/barcode";
import type { LabelFields } from "@/lib/label-fields";

// Sizes in mm. Everything on a label is laid out from these so a print job never overflows and gets clipped.
export const PAD = 1.2;
const GAP = 0.5;
const SMALL_LINE = 2.7; // 6.5pt shop name / SKU / lot / barcode digits
const PRICE_LINE = 4.2; // 10pt bold price
const BARCODE_MIN = 6; // shorter than this and handheld scanners start to miss it
const MIN_BAR_MM = 0.17; // narrowest bar most scanners read reliably
const PT = 0.3528;

export type LabelSize = { widthMm: number; heightMm: number; dpi: number };

export type BarcodeFit = {
  path: string; modules: number; widthMm: number;
  // "ok", "thin" (prints at 1 printer dot per bar: may not scan) or "long" (does not fit at all).
  quality: "ok" | "thin" | "long";
};

export type LabelLayout = {
  nameFontPt: number; nameLineMm: number; nameLines: number;
  barcode: BarcodeFit | null; barcodeError: string | null;
  crowded: boolean; // the barcode is squeezed below a scannable height
};

// Bars are drawn at a whole number of printer dots each, as wide as fits with a 10-bar quiet zone each side.
export function fitBarcode(value: string, t: LabelSize): BarcodeFit {
  const { path, width: modules } = code128(value, 0);
  const dotsPerMm = t.dpi / 25.4;
  const room = t.widthMm - 1; // stay 0.5 mm clear of the die-cut edge
  for (let dots = 4; dots >= 1; dots--) {
    const x = dots / dotsPerMm;
    if ((modules + 20) * x <= room) return { path, modules, widthMm: modules * x, quality: x >= MIN_BAR_MM ? "ok" : "thin" };
  }
  return { path, modules, widthMm: t.widthMm - 2 * PAD, quality: "long" };
}

export function layoutLabel(t: LabelSize, f: LabelFields, value: string): LabelLayout {
  const nameFontPt = t.heightMm >= 30 ? 9 : 8;
  const nameLineMm = nameFontPt * PT * 1.15;
  let barcode: BarcodeFit | null = null;
  let barcodeError: string | null = null;
  if (f.barcode) {
    try { barcode = fitBarcode(value, t); } catch (e) { barcodeError = e instanceof Error ? e.message : "This code cannot be printed as a barcode."; }
  }
  const top = f.business || f.sku;
  // With a barcode, the lot sits centred under the barcode digits; without one it goes on the bottom row.
  const lotUnder = !!barcode && f.lot;
  const bottom = f.price || (f.lot && !lotUnder);
  const rows = [top, f.name, !!barcode, bottom].filter(Boolean).length;
  const underBarcode = (f.barcodeText ? SMALL_LINE : 0) + (lotUnder ? SMALL_LINE : 0);
  const fixed = (top ? SMALL_LINE : 0) + (bottom ? (f.price ? PRICE_LINE : SMALL_LINE) : 0) + (barcode ? underBarcode : 0) + GAP * Math.max(0, rows - 1);
  const free = t.heightMm - 2 * PAD - fixed;
  if (!barcode) {
    return { nameFontPt, nameLineMm, nameLines: f.name ? Math.max(1, Math.min(4, Math.floor(free / nameLineMm))) : 0, barcode, barcodeError, crowded: false };
  }
  const nameLines = !f.name ? 0 : free - 2 * nameLineMm >= BARCODE_MIN ? 2 : 1;
  return { nameFontPt, nameLineMm, nameLines, barcode, barcodeError, crowded: free - nameLines * nameLineMm < BARCODE_MIN };
}

// Plain-language problems shown next to a product before printing.
export function labelWarnings(l: LabelLayout): string[] {
  const w: string[] = [];
  if (l.barcodeError) w.push(l.barcodeError);
  if (l.barcode?.quality === "long") w.push("Barcode is too long for this label width and will not scan. Use a wider label.");
  if (l.barcode?.quality === "thin") w.push("Barcode bars are very thin on this width and may not scan. A wider label is safer.");
  if (l.crowded) w.push("Too much on this label for the barcode to scan. Turn off a field.");
  return w;
}
