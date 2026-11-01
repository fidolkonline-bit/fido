import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDateTime } from "@/lib/money";
import { REPAIR_STATUS } from "@/lib/repairs";
import { PageHead, DataTable, RowLink, Badge, Tabs } from "@/components/ui";

export const metadata = { title: "Repairs" };

const OPEN = ["RECEIVED", "DIAGNOSIS", "AWAITING_APPROVAL", "AWAITING_PARTS", "IN_PROGRESS", "TESTING"];

export default async function Repairs({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const user = await requirePermission("repairs.view");
  const { tab = "open", q } = await searchParams;
  const term = q?.trim();
  const where: Prisma.RepairJobWhereInput = {
    ...(user.location ? { locationId: user.location.id } : {}),
    ...(tab === "open" ? { status: { in: OPEN } } : tab === "ready" ? { status: "READY" } : tab === "mine" ? { technicianId: user.personId, status: { in: OPEN } } : {}),
    ...(term ? { OR: [{ number: { contains: term, mode: "insensitive" } }, { imei: { contains: term } }, { deviceModel: { contains: term, mode: "insensitive" } }, { customer: { phone: { contains: term } } }, { customer: { name: { contains: term, mode: "insensitive" } } }] } : {}),
  };
  const jobs = await db.repairJob.findMany({ where, orderBy: [{ promisedAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: 150, include: { customer: true, technician: true } });
  const now = new Date();
  return (
    <div>
      <PageHead eyebrow={`Repair / ${user.location?.name ?? ""}`} title="Repair queue" actions={can(user, "repairs.manage") && <Link className="btn btn-primary" href="/repairs/new">New job</Link>} />
      <Tabs items={[
        { label: "In progress", href: "/repairs?tab=open", active: tab === "open" },
        { label: "My jobs", href: "/repairs?tab=mine", active: tab === "mine" },
        { label: "Ready to collect", href: "/repairs?tab=ready", active: tab === "ready" },
        { label: "All", href: "/repairs?tab=all", active: tab === "all" },
      ]} />
      <form className="toolbar" role="search">
        <input type="hidden" name="tab" value={tab} />
        <input name="q" defaultValue={q} placeholder="Scan job sticker, IMEI, model, customer or mobile" aria-label="Search repairs" autoFocus />
        <button className="btn">Search</button>
      </form>
      <DataTable rows={jobs} rowKey={(j) => j.id} empty={term ? `No job matches “${term}”.` : "No jobs here."}
        columns={[
          { label: "Job", primary: true, render: (j) => <RowLink href={`/repairs/${j.id}`}>{j.number}</RowLink> },
          { label: "Device / issue", render: (j) => <>{[j.deviceBrand, j.deviceModel].filter(Boolean).join(" ")}<br /><span className="small muted">{j.problem.slice(0, 60)}</span></> },
          { label: "Customer", render: (j) => j.customer.name },
          { label: "Technician", render: (j) => j.technician?.fullName ?? "—" },
          { label: "Promised", render: (j) => { const late = j.promisedAt && j.promisedAt < now && OPEN.includes(j.status); return <span style={{ color: late ? "var(--err)" : undefined }}>{j.promisedAt ? fmtDateTime(j.promisedAt) : "—"}{late ? " · overdue" : ""}</span>; } },
          { label: "Due", num: true, render: (j) => { const d = D(j.total).minus(j.paid); return d.gt(0) ? money(d) : "—"; } },
          { label: "Status", render: (j) => <Badge tone={REPAIR_STATUS[j.status]?.tone ?? "muted"}>{REPAIR_STATUS[j.status]?.label ?? j.status}</Badge> },
        ]} />
    </div>
  );
}
