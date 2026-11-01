import { salesReports } from "./sales";
import { stockReports } from "./stock";
import { moneyReports } from "./money";
import { opsReports } from "./ops";
import type { ReportDef } from "./types";

// The full catalogue RP-01 … RP-36 (spec §17), in catalogue order.
export const REPORTS: ReportDef[] = [...salesReports, ...stockReports, ...moneyReports, ...opsReports].sort((a, b) => a.id.localeCompare(b.id));
export const reportBySlug = (slug: string) => REPORTS.find((r) => r.slug === slug) ?? null;
