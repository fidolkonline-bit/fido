// What can go on a stock label. Shared by the label-size settings and the print page (client safe).
export const LABEL_FIELDS = [
  { key: "business", flag: "showBusiness", label: "Shop name" },
  { key: "name", flag: "showName", label: "Product name" },
  { key: "sku", flag: "showSku", label: "SKU" },
  { key: "barcode", flag: "showBarcode", label: "Barcode" },
  { key: "barcodeText", flag: "showBarcodeText", label: "Barcode digits" },
  { key: "price", flag: "showPrice", label: "Price" },
  { key: "lot", flag: "showLot", label: "Lot" },
] as const;

export type LabelField = (typeof LABEL_FIELDS)[number]["key"];
export type LabelFlag = (typeof LABEL_FIELDS)[number]["flag"];
export type LabelFields = Record<LabelField, boolean>;

export const fieldsOf = (t: Record<LabelFlag, boolean>): LabelFields =>
  Object.fromEntries(LABEL_FIELDS.map((f) => [f.key, t[f.flag]])) as LabelFields;

export const flagsOf = (fields: LabelFields): Record<LabelFlag, boolean> =>
  Object.fromEntries(LABEL_FIELDS.map((f) => [f.flag, fields[f.key]])) as Record<LabelFlag, boolean>;
