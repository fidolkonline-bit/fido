import "server-only";
import { Prisma } from "@prisma/client";
import { can } from "../permissions";
import type { CurrentUser } from "../auth";
import { dayStart, todayYmd } from "../hr";
import type { Ctx, ReportDef, Result, Cell, Col } from "./types";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Period presets resolve to Asia/Colombo business dates; the upper bound is the next local midnight (exclusive).
export function resolvePeriod(p: Record<string, string | undefined>) {
  const today = todayYmd();
  const [y, m] = today.split("-").map(Number);
  let from = p.from, to = p.to;
  const preset = p.period ?? (from || to ? "custom" : "month");
  if (preset === "today") from = to = today;
  else if (preset === "7") { from = ymd(new Date(Date.parse(today) - 6 * 86_400_000)); to = today; }
  else if (preset === "30") { from = ymd(new Date(Date.parse(today) - 29 * 86_400_000)); to = today; }
  else if (preset === "month") { from = `${today.slice(0, 7)}-01`; to = today; }
  else if (preset === "lastmonth") { from = ymd(new Date(Date.UTC(y, m - 2, 1))); to = ymd(new Date(Date.UTC(y, m - 1, 0))); }
  else if (preset === "year") { from = `${y}-01-01`; to = today; }
  from = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : today;
  to = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : today;
  if (to < from) [from, to] = [to, from];
  return { preset, from, to };
}

export function allowed(user: CurrentUser, def: ReportDef) {
  return can(user, "reports.view") && (!def.perm || can(user, def.perm));
}

export async function runReport(user: CurrentUser, def: ReportDef, sp: Record<string, string | undefined>) {
  if (!allowed(user, def)) throw new Error(`You don't have permission for this action (${def.perm ?? "reports.view"}).`);
  const { preset, from, to } = resolvePeriod(sp);
  const permitted = user.locations.map((l) => l.id);
  const locationIds = sp.loc === "all" ? permitted : sp.loc && permitted.includes(sp.loc) ? [sp.loc] : user.location ? [user.location.id] : permitted;
  const params = Object.fromEntries((def.params ?? []).map((p) => [p.key, sp[p.key] && p.options.some(([v]) => v === sp[p.key]) ? sp[p.key]! : p.options[0][0]]));
  const ctx: Ctx = { user, from: dayStart(from), to: new Date(dayStart(to).getTime() + 86_400_000), fromYmd: from, toYmd: to, locationIds, showCost: can(user, "cost.view"), params };
  const result = await def.run(ctx);
  // Hidden cost fields never leave the server, on screen or in exports (spec §17).
  if (!ctx.showCost) {
    const hidden = new Set(result.columns.filter((c) => c.cost).map((c) => c.key));
    result.columns = result.columns.filter((c) => !c.cost);
    result.rows = result.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !hidden.has(k))) as typeof r);
    if (result.totals) result.totals = Object.fromEntries(Object.entries(result.totals).filter(([k]) => !hidden.has(k)));
  }
  return { result, ctx, preset, scope: sp.loc === "all" ? "All permitted locations" : user.locations.find((l) => l.id === locationIds[0])?.name ?? "" };
}

export function fmtCell(v: Cell, kind?: Col["kind"], forCsv = false): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) {
    const local = new Date(v.getTime() + 330 * 60_000).toISOString();
    return kind === "datetime" ? `${local.slice(0, 10)} ${local.slice(11, 16)}` : (kind === "date" && v.getUTCHours() === 0 ? v.toISOString() : local).slice(0, 10);
  }
  if (kind === "money" || kind === "qty" || kind === "pct" || v instanceof Prisma.Decimal || typeof v === "number") {
    const n = Number(v instanceof Prisma.Decimal ? v.toString() : v);
    if (!Number.isFinite(n)) return String(v);
    if (kind === "money") return forCsv ? n.toFixed(2) : n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (kind === "pct") return forCsv ? n.toFixed(1) : `${n.toFixed(1)}%`;
    return forCsv ? String(n) : n.toLocaleString("en-LK", { maximumFractionDigits: 2 });
  }
  return String(v);
}

export function toCsv(result: Result) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [result.columns.map((c) => esc(c.label)).join(",")];
  for (const r of result.rows) lines.push(result.columns.map((c) => esc(fmtCell(r[c.key], c.kind, true))).join(","));
  if (result.totals) lines.push(result.columns.map((c, i) => esc(i === 0 ? "Total (all filtered rows)" : c.key in result.totals! ? fmtCell(result.totals![c.key], c.kind, true) : "")).join(","));
  return "﻿" + lines.join("\r\n"); // BOM so Excel reads UTF-8 (Sinhala/Tamil names)
}
