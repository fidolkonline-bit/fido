import Link from "next/link";
import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import * as H from "@/lib/hr";
import { PageHead, Stat } from "@/components/ui";

export const metadata = { title: "People desk" };

export default async function People() {
  const user = await requireUser();
  const today = H.todayYmd();
  const team = can(user, "hr.view");
  const [emps, pendingLeave, nextHoliday, draftRuns] = await Promise.all([
    team ? db.employeeProfile.findMany({ where: { status: "ACTIVE" } }) : Promise.resolve([]),
    team ? db.leaveRequest.count({ where: { status: "REQUESTED" } }) : 0,
    db.holiday.findFirst({ where: { startDate: { gte: H.dateOnly(today) } }, orderBy: { startDate: "asc" } }),
    can(user, "hr.payroll") ? db.payrollRun.count({ where: { status: { in: ["DRAFT", "APPROVED", "PART_PAID"] } } }) : 0,
  ]);
  const todays = team ? await Promise.all(emps.map((e) => H.attendance(e.id, today, today).then((a) => a[0]))) : [];
  const links: [string, string, boolean][] = [
    ["/hrm/me", "My attendance, leave & payslips", true],
    ["/hrm/attendance", "Team attendance & corrections", team],
    ["/hrm/leave", "Leave requests & approvals", team],
    ["/hrm/employees", "Employees & salaries", team],
    ["/hrm/holidays", "Holidays", team],
    ["/hrm/payroll", "Payroll", can(user, "hr.payroll")],
    ["/hrm/commissions", "Commission payout", can(user, "commissions.manage")],
    ["/hrm/setup", "HR setup (leave types, shifts, pay components)", can(user, "hr.manage")],
  ];
  return (
    <div className="stack">
      <PageHead eyebrow="HRM" title="People desk" actions={<Link className="btn btn-primary" href="/hrm/me">Clock in / out</Link>} />
      {team && (
        <div className="stats">
          <Stat label="In today" value={`${todays.filter((d) => d.firstIn).length} / ${todays.filter((d) => d.working).length}`} basis="Clocked in / scheduled" />
          <Stat label="Late today" value={todays.filter((d) => d.late).length} basis="After grace minutes" />
          <Stat label="Leave to approve" value={<span style={{ color: pendingLeave ? "var(--err)" : undefined }}>{pendingLeave}</span>} />
          <Stat label="Next holiday" value={nextHoliday ? H.dateOnlyYmd(nextHoliday.startDate).slice(5) : "—"} basis={nextHoliday?.name ?? "None entered"} />
        </div>
      )}
      {draftRuns > 0 && <p className="note">{draftRuns} payroll run(s) not finished. <Link href="/hrm/payroll">Open payroll</Link></p>}
      <div className="panel" style={{ padding: 0 }}>
        {links.filter(([, , ok]) => ok).map(([href, label]) => <Link key={href} href={href} className="pos-item" style={{ padding: "14px 16px", textDecoration: "none", color: "var(--ink)" }}><span>{label}</span><span className="muted">›</span></Link>)}
      </div>
    </div>
  );
}
