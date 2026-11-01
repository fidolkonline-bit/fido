import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, Badge, Tabs } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { decideLeaveForm, applyLeave } from "../actions";

export const metadata = { title: "Leave" };
const TONE: Record<string, "ok" | "warn" | "err" | "muted"> = { APPROVED: "ok", REQUESTED: "warn", REJECTED: "err", CANCELLED: "muted" };

export default async function Leave({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePermission("hr.view");
  const { tab = "pending" } = await searchParams;
  const [requests, employees, types] = await Promise.all([
    db.leaveRequest.findMany({
      where: tab === "pending" ? { status: "REQUESTED" } : {}, orderBy: { startDate: tab === "pending" ? "asc" : "desc" }, take: 150,
      include: { employee: { include: { person: true } }, leaveType: true, decidedBy: true },
    }),
    db.employeeProfile.findMany({ where: { status: "ACTIVE" }, include: { person: true }, orderBy: { person: { fullName: "asc" } } }),
    db.leaveType.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const approve = can(user, "leave.approve");
  return (
    <div className="stack">
      <PageHead eyebrow="HRM" title="Leave" />
      <Tabs items={[{ label: "Waiting for approval", href: "/hrm/leave", active: tab === "pending" }, { label: "All", href: "/hrm/leave?tab=all", active: tab !== "pending" }]} />
      <DataTable rows={requests} rowKey={(r) => r.id} empty={tab === "pending" ? "No leave waiting for approval." : "No leave yet."}
        columns={[
          { label: "Employee", primary: true, render: (r) => r.employee.person.fullName },
          { label: "Leave", render: (r) => `${r.leaveType.name} · ${r.days.toString()} day(s)${r.leaveType.paid ? "" : " · unpaid"}` },
          { label: "Dates", render: (r) => `${fmtDate(r.startDate)}${r.endDate.getTime() !== r.startDate.getTime() ? ` – ${fmtDate(r.endDate)}` : ""}${r.halfDay ? " (half)" : ""}` },
          { label: "Reason", render: (r) => r.reason ?? "" },
          { label: "Left when asked", render: (r) => r.balanceAtRequest?.toString() ?? "—" },
          {
            label: "Decision", render: (r) => r.status === "REQUESTED" && approve && r.employee.personId !== user.personId ? (
              <form action={decideLeaveForm} className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                <input type="hidden" name="id" value={r.id} />
                <input name="note" placeholder="Note" style={{ width: 110, minHeight: 32 }} />
                <button className="btn btn-sm btn-primary" name="decision" value="approve">Approve</button>
                <button className="btn btn-sm" name="decision" value="reject">Reject</button>
              </form>
            ) : <><Badge tone={TONE[r.status]}>{r.status.toLowerCase()}</Badge>{r.decidedBy && <div className="small muted">{r.decidedBy.fullName} · {fmtDateTime(r.decidedAt)}</div>}</>,
          },
        ]} />
      {approve && (
        <section className="panel">
          <h2>Record leave for an employee</h2>
          <ActionForm action={applyLeave}>
            <div className="grid3">
              <label className="field"><span>Employee</span><select name="employeeId">{employees.map((e) => <option key={e.id} value={e.id}>{e.person.fullName}</option>)}</select></label>
              <label className="field"><span>Type</span><select name="leaveTypeId">{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              <label className="field"><span>Reason</span><input name="reason" /></label>
              <label className="field"><span>From</span><input type="date" name="startDate" required /></label>
              <label className="field"><span>To</span><input type="date" name="endDate" /></label>
              <label className="check"><input type="checkbox" name="halfDay" /> Half day</label>
            </div>
            <div><SubmitButton>Record request</SubmitButton></div>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
