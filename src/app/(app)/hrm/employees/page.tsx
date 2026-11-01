import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDate } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge } from "@/components/ui";

export const metadata = { title: "Employees" };

export default async function Employees() {
  const user = await requirePermission("hr.view");
  const people = await db.person.findMany({
    where: { active: true, OR: [{ employee: { isNot: null } }, { login: { isNot: null } }] },
    orderBy: { fullName: "asc" },
    include: { employee: { include: { department: true, designation: true, location: true, salaries: { orderBy: { effectiveFrom: "desc" }, take: 1 } } }, login: { include: { role: true } } },
  });
  const pay = can(user, "hr.payroll");
  return (
    <div>
      <PageHead eyebrow="HRM" title="Employees" />
      <p className="small muted">Everyone with a login is listed. Add an employee profile to include someone in attendance, leave and payroll. Referral agents without a profile are paid commission only.</p>
      <DataTable rows={people} rowKey={(p) => p.id}
        columns={[
          { label: "Person", primary: true, render: (p) => <RowLink href={`/hrm/employees/${p.id}`}>{p.fullName}</RowLink> },
          { label: "Role", render: (p) => p.login?.role.name ?? "—" },
          { label: "Department", render: (p) => [p.employee?.department?.name, p.employee?.designation?.name].filter(Boolean).join(" · ") || "—" },
          { label: "Location", render: (p) => p.employee?.location?.name ?? "—" },
          { label: "Joined", render: (p) => fmtDate(p.employee?.joinedOn) },
          ...(pay ? [{ label: "Salary", num: true, render: (p: (typeof people)[number]) => { const s = p.employee?.salaries[0]; return s ? `${money(s.amount)} / ${s.payPeriod.toLowerCase()}` : "—"; } }] : []),
          { label: "Status", render: (p) => (!p.employee ? <Badge>No profile</Badge> : p.employee.status === "LEFT" ? <Badge tone="muted">Left</Badge> : <Badge tone="ok">Employee</Badge>) },
        ]} />
    </div>
  );
}
