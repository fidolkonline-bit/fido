import { db } from "../db";
import { attendance, dateOnlyYmd } from "../hr";
import { targetResult } from "../targets";
import { SMS_EVENTS, type SmsEvent } from "../sms";
import type { PayLine } from "../payroll";
import type { ReportDef, Row } from "./types";
import { D, sum, inPeriod, locIn, totalsOf, groupSum, dateIn } from "./util";

const mins = (a: Date | null, b: Date | null) => (a && b ? Math.round((b.getTime() - a.getTime()) / 60_000) : null);

export const opsReports: ReportDef[] = [
  {
    id: "RP-29", slug: "repairs", title: "Repairs", group: "Operations", perm: "repairs.view",
    basis: "Jobs received in the period: status, technician, age, promised vs ready, income, parts and outside cost, payments and balance.",
    async run(ctx) {
      const jobs = await db.repairJob.findMany({ where: { createdAt: inPeriod(ctx), locationId: locIn(ctx) }, include: { customer: true, technician: true, parts: true }, orderBy: { createdAt: "asc" } });
      const now = Date.now();
      const rows: Row[] = jobs.map((j) => {
        const parts = sum(j.parts, (p) => p.costTotal);
        const open = !["COLLECTED", "CANCELLED"].includes(j.status);
        const late = j.promisedAt && ((j.readyAt ?? new Date(now)) > j.promisedAt);
        return {
          job: j.number, received: j.createdAt, device: [j.deviceBrand, j.deviceModel].filter(Boolean).join(" "), customer: j.customer.name, tech: j.technician?.fullName ?? "",
          status: j.status.toLowerCase().replace("_", " "), age: open ? Math.floor((now - j.createdAt.getTime()) / 86_400_000) : null, onTime: j.promisedAt ? (late ? "late" : "on time") : "",
          total: j.total, partsCost: parts, outside: j.externalCost, margin: D(j.total).minus(parts).minus(j.externalCost), paid: j.paid, due: D(j.total).minus(j.paid),
          _href: `/repairs/${j.id}`, _tone: late && open ? "warn" : undefined,
        };
      });
      return { columns: [{ key: "job", label: "Job" }, { key: "received", label: "Received", kind: "datetime" }, { key: "device", label: "Device" }, { key: "customer", label: "Customer" }, { key: "tech", label: "Technician" }, { key: "status", label: "Status" }, { key: "age", label: "Days open", kind: "qty" }, { key: "onTime", label: "Promise" }, { key: "total", label: "Bill", kind: "money" }, { key: "partsCost", label: "Parts cost", kind: "money", cost: true }, { key: "outside", label: "Outside cost", kind: "money", cost: true }, { key: "margin", label: "Margin", kind: "money", cost: true }, { key: "paid", label: "Paid", kind: "money" }, { key: "due", label: "Due", kind: "money" }], rows, totals: totalsOf(rows, ["total", "partsCost", "outside", "margin", "paid", "due"]) };
    },
  },
  {
    id: "RP-30", slug: "reloads", title: "Reloads / provider commission", group: "Operations", perm: "reloads.wallets",
    basis: "Per wallet: money paid for funding vs nominal credited, successful reloads (sales) and their cost at the wallet rate, and unresolved results.",
    async run(ctx) {
      const [wallets, moves, reqs] = await Promise.all([
        db.reloadWallet.findMany({ orderBy: { name: "asc" } }),
        db.walletMovement.findMany({ where: { createdAt: inPeriod(ctx) } }),
        db.reloadRequest.findMany({ where: { createdAt: inPeriod(ctx), locationId: locIn(ctx) } }),
      ]);
      const allBal = await db.walletMovement.groupBy({ by: ["walletId"], _sum: { nominal: true } });
      const rows: Row[] = wallets.map((w) => {
        const m = moves.filter((x) => x.walletId === w.id);
        const r = reqs.filter((x) => x.walletId === w.id);
        const ok = r.filter((x) => x.status === "SUCCESSFUL");
        const reloaded = sum(ok, (x) => x.amount);
        return {
          wallet: w.name, fundedMoney: sum(m.filter((x) => x.kind === "FUNDING"), (x) => x.money), fundedNominal: sum(m.filter((x) => x.kind === "FUNDING"), (x) => x.nominal),
          count: ok.length, reloaded, margin: reloaded.minus(reloaded.mul(w.costRate)), uncertain: r.filter((x) => x.status === "UNCERTAIN").length, failed: r.filter((x) => x.status === "FAILED").length,
          balance: D(allBal.find((b) => b.walletId === w.id)?._sum.nominal), _tone: r.some((x) => x.status === "UNCERTAIN") ? "err" : undefined,
        };
      });
      return { columns: [{ key: "wallet", label: "Wallet" }, { key: "fundedMoney", label: "Funding paid", kind: "money" }, { key: "fundedNominal", label: "Nominal credited", kind: "money" }, { key: "count", label: "Reloads", kind: "qty" }, { key: "reloaded", label: "Reloaded value", kind: "money" }, { key: "margin", label: "Margin at rate", kind: "money", cost: true }, { key: "uncertain", label: "Uncertain", kind: "qty" }, { key: "failed", label: "Failed", kind: "qty" }, { key: "balance", label: "Balance now", kind: "money" }], rows, totals: totalsOf(rows, ["fundedMoney", "fundedNominal", "count", "reloaded", "margin", "uncertain", "failed"]), notes: ["The funding discount is earned through the cost of each reload sale — it is not counted again as funding income."] };
    },
  },
  {
    id: "RP-31", slug: "staff-tasks", title: "Staff tasks / bus parcels", group: "Operations", perm: "tasks.manage",
    basis: "Tasks created in the period: time to acknowledge and finish, escalations; parcels with collection, check and GRN link.",
    async run(ctx) {
      const tasks = await db.staffTask.findMany({ where: { createdAt: inPeriod(ctx), locationId: locIn(ctx) }, include: { assignedTo: true, parcel: { include: { receipt: true } } }, orderBy: { createdAt: "asc" } });
      const rows: Row[] = tasks.map((t) => ({
        created: t.createdAt, kind: t.kind.toLowerCase().replace("_", " "), task: t.title, to: t.assignedTo?.fullName ?? "Anyone", ack: mins(t.createdAt, t.acknowledgedAt), done: mins(t.createdAt, t.completedAt),
        escalated: t.escalatedAt ? "yes" : "", status: t.status.toLowerCase(), parcel: t.parcel ? `${t.parcel.status.toLowerCase()}${t.parcel.discrepancy ? " · discrepancy" : ""}${t.parcel.receipt ? ` · ${t.parcel.receipt.number}` : ""}` : "",
        _href: t.parcelId ? `/tasks/parcels/${t.parcelId}` : t.reloadRequestId ? `/reloads/${t.reloadRequestId}` : undefined, _tone: t.escalatedAt ? "warn" : undefined,
      }));
      const acked = rows.filter((r) => r.ack != null).map((r) => Number(r.ack));
      return { columns: [{ key: "created", label: "Sent", kind: "datetime" }, { key: "kind", label: "Type" }, { key: "task", label: "Task" }, { key: "to", label: "Assigned" }, { key: "ack", label: "Min to acknowledge", kind: "qty" }, { key: "done", label: "Min to finish", kind: "qty" }, { key: "escalated", label: "Escalated" }, { key: "status", label: "Status" }, { key: "parcel", label: "Parcel" }], rows, summary: [{ label: "Tasks", value: rows.length, kind: "qty" }, { label: "Median minutes to acknowledge", value: acked.length ? acked.sort((a, b) => a - b)[Math.floor(acked.length / 2)] : null, kind: "qty" }, { label: "Escalated", value: rows.filter((r) => r.escalated).length, kind: "qty" }] };
    },
  },
  {
    id: "RP-32", slug: "attendance", title: "Attendance / shifts", group: "People", perm: "hr.view",
    basis: "From raw clock events (voided corrections excluded): days worked, hours, late, missing clock-out, absent and rest-day work. Flags only — no automatic penalty.",
    async run(ctx) {
      const emps = await db.employeeProfile.findMany({ where: { status: "ACTIVE" }, include: { person: true } });
      const rows: Row[] = [];
      for (const e of emps) {
        const days = await attendance(e.id, ctx.fromYmd, ctx.toYmd);
        const corrections = await db.clockEvent.count({ where: { employeeId: e.id, source: "MANUAL", at: inPeriod(ctx) } });
        rows.push({
          employee: e.person.fullName, working: days.filter((d) => d.working).length, worked: days.filter((d) => d.firstIn && d.working).length, hours: Math.round(days.reduce((a, d) => a + d.minutes, 0) / 6) / 10,
          late: days.filter((d) => d.late).length, missing: days.filter((d) => d.missingOut).length, absent: days.filter((d) => d.absent).length, leave: days.reduce((a, d) => a + (d.working ? d.leaveDays : 0), 0),
          offDay: days.filter((d) => d.offDayWork).length, corrections,
        });
      }
      return { columns: [{ key: "employee", label: "Employee" }, { key: "working", label: "Working days", kind: "qty" }, { key: "worked", label: "Worked", kind: "qty" }, { key: "hours", label: "Hours", kind: "qty" }, { key: "late", label: "Late", kind: "qty" }, { key: "missing", label: "No clock-out", kind: "qty" }, { key: "absent", label: "Absent", kind: "qty" }, { key: "leave", label: "Leave days", kind: "qty" }, { key: "offDay", label: "Rest-day work", kind: "qty" }, { key: "corrections", label: "Manual corrections", kind: "qty" }], rows };
    },
  },
  {
    id: "RP-33", slug: "leave", title: "Leave / holidays", group: "People", perm: "hr.view",
    basis: "Leave requests overlapping the period by type and status, and holidays in the period.",
    async run(ctx) {
      const [leave, holidays] = await Promise.all([
        db.leaveRequest.findMany({ where: { startDate: { lte: dateIn(ctx).lte }, endDate: { gte: dateIn(ctx).gte } }, include: { employee: { include: { person: true } }, leaveType: true, decidedBy: true }, orderBy: { startDate: "asc" } }),
        db.holiday.findMany({ where: { startDate: { lte: dateIn(ctx).lte }, endDate: { gte: dateIn(ctx).gte } }, include: { location: true }, orderBy: { startDate: "asc" } }),
      ]);
      const rows: Row[] = [
        ...leave.map((l) => ({ what: `${l.employee.person.fullName} · ${l.leaveType.name}${l.leaveType.paid ? "" : " (unpaid)"}`, from: l.startDate, to: l.endDate, days: l.days, status: l.status.toLowerCase(), by: l.decidedBy?.fullName ?? "" })),
        ...holidays.map((h) => ({ what: `Holiday · ${h.name}${h.location ? ` (${h.location.name})` : ""}`, from: h.startDate, to: h.endDate, days: null, status: "holiday", by: "" })),
      ];
      return { columns: [{ key: "what", label: "Leave / holiday" }, { key: "from", label: "From", kind: "date" }, { key: "to", label: "To", kind: "date" }, { key: "days", label: "Working days", kind: "qty" }, { key: "status", label: "Status" }, { key: "by", label: "Decided by" }], rows };
    },
  },
  {
    id: "RP-34", slug: "payroll", title: "Payroll / payslips", group: "People", perm: "hr.payroll",
    basis: "Payslips of payroll runs ending in the period: basic, components, commission and target lines, deductions, net, paid and outstanding.",
    async run(ctx) {
      const slips = await db.payslip.findMany({ where: { run: { periodEnd: dateIn(ctx), status: { not: "CANCELLED" } } }, include: { run: true, employee: { include: { person: true } } }, orderBy: { run: { periodStart: "asc" } } });
      const part = (p: (typeof slips)[number], src: string) => sum((p.lines as PayLine[]).filter((l) => l.source === src && l.kind === "EARNING"), (l) => l.amount);
      const rows: Row[] = slips.map((p) => ({ run: p.run.number, status: p.run.status.toLowerCase().replace("_", " "), employee: p.employee.person.fullName, basic: p.basicEarned, components: D(p.gross).minus(p.basicEarned).minus(part(p, "COMMISSION")).minus(part(p, "TARGET")), commission: part(p, "COMMISSION"), target: part(p, "TARGET"), gross: p.gross, deductions: p.deductions, net: p.net, paid: p.paid, outstanding: D(p.net).minus(p.paid), _href: `/hrm/payslips/${p.id}` }));
      return { columns: [{ key: "run", label: "Payroll" }, { key: "status", label: "Status" }, { key: "employee", label: "Employee" }, { key: "basic", label: "Basic", kind: "money" }, { key: "components", label: "Allowances & manual", kind: "money" }, { key: "commission", label: "Commission", kind: "money" }, { key: "target", label: "Target bonus", kind: "money" }, { key: "gross", label: "Gross", kind: "money" }, { key: "deductions", label: "Deductions", kind: "money" }, { key: "net", label: "Net", kind: "money" }, { key: "paid", label: "Paid", kind: "money" }, { key: "outstanding", label: "Outstanding", kind: "money" }], rows, totals: totalsOf(rows, ["basic", "components", "commission", "target", "gross", "deductions", "net", "paid", "outstanding"]), notes: ["Statutory employer contributions (EPF/ETF) appear only once configured as pay components."] };
    },
  },
  {
    id: "RP-35", slug: "targets", title: "Sales targets", group: "People", perm: "hr.payroll",
    basis: "Targets overlapping the period: bands, achieved net sales, bonus, and whether it was paid through payroll.",
    async run(ctx) {
      const targets = await db.salesTarget.findMany({ where: { periodStart: { lte: dateIn(ctx).lte }, periodEnd: { gte: dateIn(ctx).gte } }, include: { person: true, payslip: { include: { run: true } } } });
      const rows: Row[] = [];
      for (const t of targets) {
        const snap = t.snapshot as { achieved: string; earning: string } | null;
        const live = snap ? null : await targetResult(t);
        rows.push({ employee: t.person.fullName, from: t.periodStart, to: t.periodEnd, mode: t.mode.toLowerCase(), achieved: snap?.achieved ?? live!.value, bonus: snap?.earning ?? live!.earning, status: t.payslip ? `paid · ${t.payslip.run.number}` : t.approvedAt ? "approved" : dateOnlyYmd(t.periodEnd) < ctx.toYmd ? "not approved" : "in progress" });
      }
      return { columns: [{ key: "employee", label: "Employee" }, { key: "from", label: "From", kind: "date" }, { key: "to", label: "To", kind: "date" }, { key: "mode", label: "Bands" }, { key: "achieved", label: "Achieved", kind: "money" }, { key: "bonus", label: "Bonus", kind: "money" }, { key: "status", label: "Status" }], rows, totals: totalsOf(rows, ["achieved", "bonus"]) };
    },
  },
  {
    id: "RP-36", slug: "sms", title: "SMS / print operations", group: "Operations", perm: "notifications.manage",
    basis: "SMS created in the period by type and status. 'Sent to provider' is not proof of delivery or reading. Browser printing is not tracked.",
    async run(ctx) {
      const msgs = await db.notificationIntent.findMany({ where: { createdAt: inPeriod(ctx) } });
      const g = groupSum(msgs, (m) => `${m.event}|${m.status}`, { n: () => 1, attempts: (m) => m.attempts });
      const rows: Row[] = [...g.entries()].map(([k, v]) => { const [e, s] = k.split("|"); return { event: SMS_EVENTS[e as SmsEvent]?.label ?? e, status: s.toLowerCase().replace("_", " "), messages: v.n, attempts: v.attempts, _tone: ["FAILED", "UNKNOWN"].includes(s) ? "err" : undefined }; });
      return { columns: [{ key: "event", label: "Message type" }, { key: "status", label: "Status" }, { key: "messages", label: "Messages", kind: "qty" }, { key: "attempts", label: "Send attempts", kind: "qty" }], rows, totals: totalsOf(rows, ["messages", "attempts"]) };
    },
  },
];

