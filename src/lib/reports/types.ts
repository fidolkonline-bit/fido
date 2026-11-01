import type { Prisma } from "@prisma/client";
import type { CurrentUser } from "../auth";
import type { Permission } from "../permissions";

export type Cell = string | number | Prisma.Decimal | Date | null | undefined;
export type Col = { key: string; label: string; kind?: "money" | "qty" | "date" | "datetime" | "text" | "pct"; cost?: boolean };
export type Row = Record<string, Cell> & { _href?: string; _tone?: "err" | "warn" | "ok" };
export type Result = {
  columns: Col[];
  rows: Row[];
  totals?: Record<string, Cell>;
  summary?: { label: string; value: Cell; kind?: Col["kind"]; note?: string }[];
  notes?: string[];
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

export type ParamDef = { key: string; label: string; options: [string, string][] };

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
};
