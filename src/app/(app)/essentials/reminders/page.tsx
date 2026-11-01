import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { reminderForm, stopReminder } from "../actions";

export const metadata = { title: "Reminders" };

export default async function Reminders() {
  const user = await requireUser();
  const manage = can(user, "essentials.manage");
  const [reminders, staff] = await Promise.all([
    db.reminder.findMany({ where: manage ? {} : { OR: [{ createdById: user.personId }, { assignedToId: user.personId }] }, orderBy: [{ active: "desc" }, { nextAt: "asc" }], take: 100 }),
    manage ? db.person.findMany({ where: { active: true, login: { isNot: null } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }) : Promise.resolve([]),
  ]);
  const name = new Map(staff.map((s) => [s.id, s.fullName]));
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHead eyebrow="Essentials" title="Reminders" />
      <DataTable rows={reminders} rowKey={(r) => r.id} empty="No reminders."
        columns={[
          { label: "Reminder", primary: true, render: (r) => r.title },
          { label: "Next", render: (r) => (r.active ? fmtDateTime(r.nextAt) : "—") },
          { label: "Repeats", render: (r) => r.repeat.toLowerCase() },
          { label: "For", render: (r) => (r.assignedToId ? name.get(r.assignedToId) ?? (r.assignedToId === user.personId ? "Me" : "—") : "Anyone on shift") },
          { label: "", render: (r) => r.active ? <form action={stopReminder}><input type="hidden" name="id" value={r.id} /><button className="btn btn-sm">Stop</button></form> : <Badge>Done</Badge> },
        ]} />
      <ActionForm action={reminderForm} className="panel stack">
        <h2 style={{ margin: 0 }}>New reminder</h2>
        <div className="grid3">
          <label className="field" style={{ gridColumn: "span 2" }}><span>What</span><input name="title" required placeholder="Deposit cash to bank" /></label>
          <label className="field"><span>When</span><input type="datetime-local" name="at" required /></label>
          <label className="field"><span>Repeat</span><select name="repeat"><option value="NONE">Once</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></label>
          <label className="field"><span>For</span><select name="assignedToId"><option value={user.personId}>Me</option>{manage && <option value="">Anyone on shift</option>}{staff.filter((s) => s.id !== user.personId).map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</select></label>
          <label className="field"><span>Details</span><input name="details" /></label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>At that time the reminder rings as a staff task. Times are Sri Lanka time.</p>
        <div><SubmitButton>Set reminder</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
