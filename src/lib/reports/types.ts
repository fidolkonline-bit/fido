import type { Prisma } from "@prisma/client";
import type { CurrentUser } from "../auth";
import type { Permission } from "../permissions";

export type Cell = string | number | Prisma.Decimal | Date | null | undefined;
// `lead` puts a text cell in front of the value in the same column (e.g. "Mr Maleesha Dilshan Rs 84.00");
// spreadsheet exports split it into its own column, named `lead.label`.
export type Col = { key: string; label: string; kind?: "money" | "qty" | "date" | "datetime" | "text" | "pct"; cost?: boolean; lead?: { key: string; label: string } };
export type Row = Record<string, Cell> & { _href?: string; _tone?: "err" | "warn" | "ok" };
// A statement laid out as two boxes of label / amount pairs with headline results under them (the old Clicky P&L page).
export type SheetItem = { label: string; sub?: string; value: Cell };
export type Sheet = { left: SheetItem[]; right: SheetItem[]; results: { label: string; value: Cell; note: string }[] };

export type Result = {
  title?: string; // heading for PDF / Excel when it differs from the report's name
  sheet?: Sheet; // shown, printed and exported in the statement layout instead of a table; rows still feed the CSV
  columns: Col[];
  rows: Row[];
  totals?: Record<string, Cell>;
  summary?: { label: string; value: Cell; kind?: Col["kind"]; note?: string }[];
  notes?: string[];
  alerts?: string[]; // shown above the result, e.g. profit that is not final yet
};

export type Ctx = {
  user: CurrentUser;
  from: Date; // instant of local midnight on the first day
  to: Date; // exclusive instant (local midnight after the last day) — spec §17.1
  fromYmd: string;
  toYmd: string;
  locationIds: string[];
  showCost: boolean;
  params: Record<string, string>;
};

export type ParamOptions = [string, string][];
// Options are fixed, or loaded when the report opens (e.g. the people who earned commission). The first option is the default.
// `search` shows a type-to-search picker instead of a dropdown (long lists such as people); its first option is "none".
export type ParamDef = { key: string; label: string; options: ParamOptions | (() => Promise<ParamOptions>); search?: boolean };
export type ResolvedParam = { key: string; label: string; options: ParamOptions; search?: boolean };

export type ReportDef = {
  id: string; // RP-01 …
  slug: string;
  title: string;
  group: "Profit & sales" | "Stock & purchasing" | "Money & balances" | "Operations" | "People";
  basis: string;
  perm?: Permission;
  asOf?: boolean; // single date instead of a period
  params?: ParamDef[];
  run: (ctx: Ctx) => Promise<Result>;
  // Tabs of tables under the main result (Profit / Loss: profit by product, category …), each exportable on its own.
  breakdown?: { tabs: [string, string][]; run: (ctx: Ctx, by: string) => Promise<Result> };
};
