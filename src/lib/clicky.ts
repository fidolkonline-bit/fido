// Converts the list exports from the old Clicky system into Fido's import templates (spec §22).
// Runs in the browser before upload. Nothing is corrected silently: anything doubtful travels with the row as a note.
import { parseCsv, toCsvText } from "./csv";

export type TargetKind = "PRODUCTS" | "OPENING_STOCK" | "CONTACTS" | "PEOPLE";
export type Converted = { source: string; kind: TargetKind; csv: string; rows: number; notes: string[] };
export class ClickyError extends Error {}

type R = Record<string, string>;
const amount = (v: string | undefined) => {
  const n = Number((v ?? "").replace(/[₨,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const tidy = (v: string | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
// Local mobiles lose their leading zero in Clicky ("771234567"); restore it, leave anything else as typed.
const phone = (v: string | undefined) => { const t = tidy(v).replace(/\s/g, ""); return /^7\d{8}$/.test(t) ? `0${t}` : t; };
const fmt = (n: number) => n.toLocaleString("en-LK", { maximumFractionDigits: 2 });
const isTotalRow = (r: R) => Object.values(r).some((v) => v === "Total:");

export function detect(rows: R[]): string | null {
  const k = rows[0] ? Object.keys(rows[0]) : [];
  if (k.includes("current_stock") && k.includes("unit_purchase_price")) return "products";
  if (k.includes("total_sale_due") && k.includes("contact_id")) return "customers";
  if (k.includes("total_purchase_due") && k.includes("contact_id")) return "suppliers";
  if (k.includes("commission_details") && k.includes("username")) return "users";
  if (k.includes("reference_no") && k.includes("purchase_status")) return "purchases";
  return null;
}

const RELOAD = /reload|mega ?pay|online trans/i;
const section = (loc: string | undefined) => `OPEN-${(tidy(loc).replace(/\s*by fido$/i, "") || "SHOP").toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`;

function products(rows: R[], want: "PRODUCTS" | "OPENING_STOCK"): Converted {
  const list = rows.filter((r) => tidy(r.product) && !/add to location/i.test(r.product));
  const notes: string[] = [];
  const reloads = list.filter((r) => tidy(r.category) === "Reloads" || RELOAD.test(r.product));
  if (reloads.length) {
    notes.push(`${reloads.length} reload / bill-payment items are wallet balances, not stock, and are left out: ` +
      reloads.map((r) => `${tidy(r.product)} ${fmt(amount(r.current_stock.split(" ")[0]))} @ ${fmt(amount(r.unit_purchase_price))}`).join("; ") +
      ". Enter them as reload wallet funding (Reloads › Wallets).");
  }
  // SKUs are unique here; Clicky reused a few across locations. Keep the first, suffix the next ones and say so.
  const seen = new Map<string, number>();
  const renamed: string[] = [];
  const items = list.filter((r) => !reloads.includes(r)).map((r) => {
    const n = (seen.get(r.sku) ?? 0) + 1;
    seen.set(r.sku, n);
    const sku = n === 1 ? r.sku : `${r.sku}-${n}`;
    if (n > 1) renamed.push(`${tidy(r.product)}: ${r.sku} → ${sku}`);
    return { r, sku };
  });
  if (renamed.length) notes.push(`${renamed.length} SKUs were used twice in Clicky; the second product gets a suffix: ${renamed.join("; ")}.`);

  if (want === "PRODUCTS") {
    const out = items.map(({ r, sku }) => {
      const stock = tidy(r.current_stock);
      return {
        sku, name: tidy(r.product), category: tidy(r.category).replace(/\s*--\s*/g, " > "), brand: tidy(r.brand),
        unit: stock.replace(/^[-\d.,]+\s*/, "") || "Pieces", sell_price: amount(r.selling_price), cost: amount(r.unit_purchase_price),
        stock_managed: stock === "--" ? "no" : "yes",
      };
    });
    const uncategorised = out.filter((p) => !p.category).length;
    if (uncategorised) notes.push(`${uncategorised} products have no category in Clicky; they earn no commission until one is set.`);
    const phones = out.filter((p) => /smartphones|button phones/i.test(p.category)).length;
    if (phones) notes.push(`${phones} phone products are imported without IMEI tracking because this export has no IMEIs. Turn tracking on and load IMEIs from Clicky's IMEI / serial report before cut-over.`);
    return { source: "Clicky products export", kind: "PRODUCTS", rows: out.length, notes, csv: toCsvText(out, ["sku", "name", "category", "brand", "unit", "sell_price", "cost", "stock_managed"]) };
  }

  const negative = items.filter(({ r }) => /^-\d/.test(tidy(r.current_stock)));
  if (negative.length) notes.push(`${negative.length} products show negative stock in Clicky and are not imported: ${negative.map(({ r }) => `${tidy(r.product)} (${tidy(r.current_stock)})`).join("; ")}. Investigate before cut-over.`);
  const out = items
    .filter(({ r }) => amount(r.current_stock.split(" ")[0]) > 0 && tidy(r.current_stock) !== "--")
    // Clicky's "locations" (Apple By Fido, Trendy By Fido, Wow Gifts By Fido) are sections of one shop, so stock goes to
    // the importer's location; the section stays visible in the lot code.
    .map(({ r, sku }) => ({ sku, qty: amount(r.current_stock.split(" ")[0]), unit_cost: amount(r.unit_purchase_price), lot: section(r.business_location) }));
  const value = out.reduce((a, x) => a + x.qty * x.unit_cost, 0);
  notes.push(`${out.length} products with stock, ${fmt(out.reduce((a, x) => a + x.qty, 0))} units, ${fmt(value)} at Clicky's purchase price. All of it goes to your current location; Clicky's section is kept in the lot code (one opening lot per product — Clicky's list has no lot detail).`);
  return { source: "Clicky products export (stock on hand)", kind: "OPENING_STOCK", rows: out.length, notes, csv: toCsvText(out, ["sku", "qty", "unit_cost", "lot"]) };
}

function contacts(rows: R[], type: "customer" | "supplier"): Converted {
  const notes: string[] = [];
  const keyed = new Map<string, R>();
  let identical = 0;
  const list: R[] = [];
  for (const r of rows.filter((x) => x.contact_id && !isTotalRow(x))) {
    const prev = keyed.get(r.contact_id);
    if (prev && JSON.stringify(prev) === JSON.stringify(r)) { identical++; continue; }
    keyed.set(r.contact_id, r);
    list.push(r);
  }
  if (identical) notes.push(`${identical} rows were exact repeats of the row above in the export and were dropped.`);
  const out = list.map((r) => {
    const flags: string[] = [];
    let name = tidy(r.name) || tidy(r.business_name);
    if (!name) { name = `Unnamed ${r.contact_id}`; flags.push("no name in Clicky"); }
    if (tidy(r.name) && tidy(r.business_name) && tidy(r.name) !== tidy(r.business_name)) name = `${tidy(r.business_name)} (${tidy(r.name)})`;
    let opening = 0, credit = 0;
    if (type === "customer") {
      const due = amount(r.total_sale_due), ret = amount(r.total_sell_return_due), adv = amount(r.advance_balance), ob = amount(r.opening_balance);
      opening = due + ob - ret;
      credit = adv;
      if (ret > 0) flags.push(`Clicky owes this customer ${fmt(ret)} for returns; netted into the opening balance`);
      if (ret < 0) flags.push(`negative sell-return due (${fmt(ret)}) in Clicky — check this customer's ledger`);
      if (adv) flags.push(`advance ${fmt(adv)} becomes store credit`);
    } else {
      opening = amount(r.total_purchase_due) + amount(r.opening_balance) - amount(r.total_purchase_return_due) - amount(r.advance_balance);
      if (opening < 0) flags.push(`supplier balance is negative (${fmt(opening)}): they owe us or we overpaid`);
    }
    if (opening < 0 && type === "customer") flags.push(`opening balance is negative (${fmt(opening)}): we owe this customer`);
    return {
      type, code: r.contact_id, name, phone: phone(r.mobile), email: tidy(r.email), address: tidy(r.address), group: tidy(r.customer_group),
      credit_limit: /^\d/.test(tidy(r.credit_limit)) ? amount(r.credit_limit) : "", pay_terms_days: "", opening_balance: Math.round(opening * 100) / 100,
      store_credit: credit || "", tax_number: tidy(r.tax_number), note: flags.join("; "),
    };
  });
  const sum = (f: (x: (typeof out)[number]) => number) => fmt(out.reduce((a, x) => a + f(x), 0));
  notes.push(type === "customer"
    ? `${out.length} customers. Owed to us ${sum((x) => Math.max(0, Number(x.opening_balance)))}, owed to customers ${sum((x) => Math.max(0, -Number(x.opening_balance)))}, advances to store credit ${sum((x) => Number(x.store_credit || 0))}.`
    : `${out.length} suppliers. We owe ${sum((x) => Math.max(0, Number(x.opening_balance)))}; suppliers owe us ${sum((x) => Math.max(0, -Number(x.opening_balance)))}.`);
  notes.push("Balances are Clicky's totals on the export date. Re-export on the cut-over day and import again with “Update” to refresh them.");
  return {
    source: `Clicky ${type}s export`, kind: "CONTACTS", rows: out.length, notes,
    csv: toCsvText(out, ["type", "code", "name", "phone", "email", "address", "group", "credit_limit", "pay_terms_days", "opening_balance", "store_credit", "tax_number", "note"]),
  };
}

function users(rows: R[]): Converted {
  const notes: string[] = [];
  const vendor = rows.filter((r) => /^(clicky|darimac)$/i.test(r.username));
  if (vendor.length) notes.push(`Left out ${vendor.map((r) => r.username).join(", ")}: the old system's vendor accounts.`);
  const parsed = rows.filter((r) => tidy(r.name) && !vendor.includes(r)).map((r) => {
    const id = /(Agent|User)ID:\s*([\d/]+)/.exec(r.commission_details);
    const pay = (label: string) => amount(new RegExp(`${label}:\\s*₨\\s*([-\\d,.]+)`).exec(r.commission_payment)?.[1]);
    return {
      r, name: tidy(r.name).replace(/\s*\(User\)$/i, ""), phone: phone(r.contact_no), code: id?.[2] ?? "",
      isAgent: id?.[1] === "Agent", login: r.username !== "Login not allowed" ? r.username : "",
      earned: pay("Total Commission"), paid: pay("Total Paid"), remaining: pay("Total Remaining"),
    };
  });
  // The same person often appears twice: as an agent and as a cashier login. Merge when name and phone both match.
  const out: Record<string, string>[] = [];
  for (const p of parsed) {
    const twin = out.find((o) => o.name.toLowerCase() === p.name.toLowerCase() && o.phone === p.phone);
    const flags: string[] = [];
    if (p.remaining) flags.push(`Clicky commission ${p.isAgent ? "as agent" : "as user"}: earned ${fmt(p.earned)}, paid ${fmt(p.paid)}, remaining ${fmt(p.remaining)} — not carried over; settle or record before cut-over`);
    if (/test/i.test(p.name)) flags.push("looks like a test record");
    if (p.login) flags.push(`had Clicky login “${p.login}” (${tidy(p.r.role)}); create a Fido login for them in Users`);
    if (twin) {
      twin.kind = "BOTH";
      if (p.isAgent) { twin.note = [twin.note, `user ID ${twin.code}`].filter(Boolean).join("; "); twin.code = p.code; }
      else twin.note = [twin.note, `user ID ${p.code}`].filter(Boolean).join("; ");
      twin.note = [twin.note, ...flags].filter(Boolean).join("; ");
      continue;
    }
    const samePhone = out.find((o) => o.phone && o.phone === p.phone);
    if (samePhone) flags.push(`same phone as ${samePhone.name} — check whether this is the same person`);
    out.push({ code: p.code, name: p.name, phone: p.phone, kind: p.code ? (p.isAgent ? "AGENT" : "USER") : "NONE", note: flags.join("; ") });
  }
  notes.push(`${out.length} people (${parsed.length - out.length} merged agent + user pairs). No logins or passwords are imported.`);
  return { source: "Clicky users export", kind: "PEOPLE", rows: out.length, notes, csv: toCsvText(out, ["code", "name", "phone", "kind", "note"]) };
}

// Returns null when the file is not a Clicky export (it is then imported as a Fido template).
export function fromClicky(text: string, want: TargetKind): Converted | null {
  const rows = parseCsv(text);
  const src = detect(rows);
  if (!src) return null;
  if (src === "purchases") throw new ClickyError("This is Clicky's purchase list: totals per purchase only, without items, lots or costs, so it can't become history. Supplier balances come from the suppliers export. For full history, Clicky's purchase lines (purchase report with products) are needed.");
  if (src === "products") return products(rows, want === "OPENING_STOCK" ? "OPENING_STOCK" : "PRODUCTS");
  if (src === "users") return users(rows);
  return contacts(rows, src === "customers" ? "customer" : "supplier");
}
