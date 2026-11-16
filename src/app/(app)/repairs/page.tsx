import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDateTime } from "@/lib/money";
import { REPAIR_STATUS } from "@/lib/repairs";
import { PageHead, DataTable, RowLink, Badge, Tabs } from "@/components/ui";

export const metadata = { title: "Repairs" };

const OPEN = ["RECEIVED", "DIAGNOSIS", "AWAITING_APPROVAL", "AWAITING_PARTS", "IN_PROGRESS", "OUTSOURCED", "TESTING"];
const ROUTE_FILTER: Record<string, Prisma.RepairJobWhereInput> = { in_house: { route: "IN_HOUSE" }, outsourced: { route: "OUTSOURCED" }, undecided: { route: null } };

export default async function Repairs({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; route?: string }> }) {
  const user = await requirePermission("repairs.view");
  const { tab = "open", q, route = "" } = await searchParams;
  const term = q?.trim();
  const where: Prisma.RepairJobWhereInput = {
    ...(user.location ? { locationId: user.location.id } : {}),
    ...(tab === "open" ? { status: { in: OPEN } } : tab === "ready" ? { status: "READY" } : tab === "outside" ? { status: "OUTSOURCED" } : tab === "mine" ? { technicianId: user.personId, status: { in: OPEN } } : {}),
    ...(ROUTE_FILTER[route] ?? {}),
    ...(term ? { OR: [{ number: { contains: term, mode: "insensitive" } }, { imei: { contains: term } }, { deviceModel: { contains: term, mode: "insensitive" } }, { customer: { phone: { contains: term } } }, { customer: { name: { contains: term, mode: "insensitive" } } }] } : {}),
  };
  const jobs = await db.repairJob.findMany({ where, orderBy: [{ promisedAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: 150, include: { customer: true, technician: true, outsources: { where: { returnedAt: null }, include: { vendor: { select: { name: true } } }, take: 1 } } });
  const outside = await db.repairJob.count({ where: { ...(user.location ? { locationId: user.location.id } : {}), status: "OUTSOURCED" } });
  const qs = (t: string) => `/repairs?tab=${t}${route ? `&route=${route}` : ""}`;
  const now = new Date();
  return (
    <div>
      <PageHead eyebrow={`Repair / ${user.location?.name ?? ""}`} title="Repair queue" actions={can(user, "repairs.manage") && <Link className="btn btn-primary" href="/repairs/new">New job</Link>} />
      <Tabs items={[
        { label: "In progress", href: qs("open"), active: tab === "open" },
        { label: "My jobs", href: qs("mine"), active: tab === "mine" },
        { label: outside ? `At outside shop (${outside})` : "At outside shop", href: qs("outside"), active: tab === "outside" },
        { label: "Ready to collect", href: qs("ready"), active: tab === "ready" },
        { label: "All", href: qs("all"), active: tab === "all" },
      ]} />
      <form className="toolbar" role="search">
        <input type="hidden" name="tab" value={tab} />
        <select name="route" defaultValue={route} aria-label="Repair route" style={{ width: "auto" }}>
          <option value="">In-house and outsourced</option><option value="in_house">In-house only</option><option value="outsourced">Outsourced only</option><option value="undecided">Route not decided</option>
        </select>
        <input name="q" defaultValue={q} placeholder="Scan job sticker, IMEI, model, customer or mobile" aria-label="Search repairs" autoFocus />
        <button className="btn">Search</button>
      </form>
      <DataTable rows={jobs} rowKey={(j) => j.id} empty={term ? `No job matches “${term}”.` : "No jobs here."}
        columns={[
          { label: "Job", primary: true, render: (j) => <RowLink href={`/repairs/${j.id}`}>{j.number}</RowLink> },
          { label: "Device / issue", render: (j) => <>{[j.deviceBrand, j.deviceModel].filter(Boolean).join(" ")}<br /><span className="small muted">{j.problem.slice(0, 60)}</span></> },
          { label: "Customer", render: (j) => j.customer.name },
          { label: "Technician", render: (j) => j.technician?.fullName ?? "—" },
          { label: "Route", render: (j) => j.route === "OUTSOURCED" ? <>Outsourced{j.outsources[0] && <><br /><span className="small muted">at {j.outsources[0].vendor.name}</span></>}</> : j.route === "IN_HOUSE" ? "In-house" : <span className="muted">—</span> },
          { label: "Promised", render: (j) => { const late = j.promisedAt && j.promisedAt < now && OPEN.includes(j.status); return <span style={{ color: late ? "var(--err)" : undefined }}>{j.promisedAt ? fmtDateTime(j.promisedAt) : "—"}{late ? " · overdue" : ""}</span>; } },
          { label: "Due", num: true, render: (j) => { const d = D(j.total).minus(j.paid); return d.gt(0) ? money(d) : "—"; } },
          { label: "Status", render: (j) => j.outcome === "NOT_REPAIRED" && (j.status === "READY" || j.status === "COLLECTED")
            ? <Badge tone={j.status === "READY" ? "err" : "muted"}>{REPAIR_STATUS[j.status]?.label} · not repaired</Badge>
            : <Badge tone={REPAIR_STATUS[j.status]?.tone ?? "muted"}>{REPAIR_STATUS[j.status]?.label ?? j.status}</Badge> },
        ]} />
    </div>
  );
}
