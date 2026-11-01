import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, Badge, RowLink, Tabs } from "@/components/ui";
import { ackTaskForm, finishTask } from "./actions";
import { GeneralTaskForm } from "./TaskForms";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata = { title: "Staff tasks" };

const KIND: Record<string, string> = { BUS_PARCEL: "Bus parcel", RELOAD: "Reload", GENERAL: "Task" };
const href = (t: { reloadRequestId: string | null; parcelId: string | null }) => (t.reloadRequestId ? `/reloads/${t.reloadRequestId}` : t.parcelId ? `/tasks/parcels/${t.parcelId}` : null);

export default async function Tasks({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const manage = can(user, "tasks.manage");
  const { tab = "mine" } = await searchParams;
  const locs = user.locations.map((l) => l.id);
  const mine: Prisma.StaffTaskWhereInput = { OR: [{ assignedToId: user.personId }, { assignedToId: null, locationId: { in: locs } }] };
  const where: Prisma.StaffTaskWhereInput =
    tab === "all" && manage ? { locationId: { in: locs }, status: { in: ["PENDING", "ACKNOWLEDGED"] } }
    : tab === "done" ? { ...mine, status: { in: ["DONE", "CANCELLED"] } }
    : { ...mine, status: { in: ["PENDING", "ACKNOWLEDGED"] } };
  const [tasks, parcels, staff] = await Promise.all([
    tab === "parcels" ? Promise.resolve([]) : db.staffTask.findMany({ where, orderBy: [{ status: "desc" }, { createdAt: "desc" }], take: 100, include: { assignedTo: true } }),
    tab === "parcels" ? db.busParcel.findMany({ where: { locationId: { in: locs } }, orderBy: { createdAt: "desc" }, take: 100 }) : Promise.resolve([]),
    manage ? db.person.findMany({ where: { active: true, login: { isNot: null } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }) : Promise.resolve([]),
  ]);

  return (
    <div className="stack">
      <PageHead eyebrow="Staff Tasks" title="Task inbox" actions={manage && <Link className="btn btn-primary" href="/tasks/parcels/new">New bus parcel</Link>} />
      <Tabs items={[
        { label: "My tasks", href: "/tasks", active: tab === "mine" },
        ...(manage ? [{ label: "Everyone (open)", href: "/tasks?tab=all", active: tab === "all" }] : []),
        { label: "Bus parcels", href: "/tasks?tab=parcels", active: tab === "parcels" },
        { label: "Done", href: "/tasks?tab=done", active: tab === "done" },
      ]} />
      {tab === "parcels" ? (
        <DataTable rows={parcels} rowKey={(p) => p.id} empty="No bus parcels yet."
          columns={[
            { label: "Parcel", primary: true, render: (p) => <RowLink href={`/tasks/parcels/${p.id}`}>{p.number}</RowLink> },
            { label: "From / contents", render: (p) => <>{p.sender}<br /><span className="small muted">{p.contents}</span></> },
            { label: "Bus", render: (p) => [p.busNumber, p.route].filter(Boolean).join(" · ") || "—" },
            { label: "ETA", render: (p) => fmtDateTime(p.etaAt) },
            { label: "State", render: (p) => <Badge tone={p.status === "CLOSED" || p.status === "CHECKED" ? "ok" : p.status === "EXCEPTION" ? "err" : "warn"}>{p.status.toLowerCase()}</Badge> },
          ]} />
      ) : (
        <DataTable rows={tasks} rowKey={(t) => t.id} empty="Nothing waiting for you."
          columns={[
            { label: "Task", primary: true, render: (t) => { const h = href(t); return <>{t.priority === "URGENT" && <Badge tone="err">Urgent</Badge>} {h ? <RowLink href={h}>{t.title}</RowLink> : t.title}</>; } },
            { label: "Type", render: (t) => KIND[t.kind] ?? t.kind },
            { label: "Assigned", render: (t) => t.assignedTo?.fullName ?? "Anyone" },
            { label: "Sent", render: (t) => fmtDateTime(t.createdAt) },
            { label: "Due", render: (t) => fmtDateTime(t.dueAt) },
            { label: "State", render: (t) => <Badge tone={t.status === "PENDING" ? (t.escalatedAt ? "err" : "warn") : t.status === "DONE" ? "ok" : "muted"}>{t.status === "PENDING" ? (t.escalatedAt ? "Not acknowledged — escalated" : "Not acknowledged") : t.status.toLowerCase()}</Badge> },
            {
              label: "", render: (t) => t.status === "PENDING" ? (
                <form action={ackTaskForm}><input type="hidden" name="taskId" value={t.id} /><SubmitButton className="btn btn-sm btn-primary">Acknowledge</SubmitButton></form>
              ) : t.status === "ACKNOWLEDGED" && t.kind === "GENERAL" ? (
                <form action={finishTask}><input type="hidden" name="taskId" value={t.id} /><SubmitButton className="btn btn-sm">Mark done</SubmitButton></form>
              ) : null,
            },
          ]} />
      )}
      {manage && tab !== "parcels" && <GeneralTaskForm staff={staff.map((s) => ({ id: s.id, name: s.fullName }))} />}
      <p className="small muted">Keep the app open on the shop phone and tap “Enable alarm sound” at the start of each shift. Sound cannot play while the phone is muted, offline or the browser is closed.</p>
    </div>
  );
}
