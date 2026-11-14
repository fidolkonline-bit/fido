import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { D, money, fmtDateTime, colomboDayStart } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge, Pager, PAGE_SIZE, pageOf } from "@/components/ui";
import { SALE_CHANNELS, CHANNEL_LABEL, channelLabel, isSaleChannel } from "@/lib/sale-channels";

const DAY = 86_400_000;
const IST = 330 * 60_000;
const ymdOk = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const colomboDate = (ymd: string) => new Date(`${ymd}T00:00:00+05:30`);

// Period → [from, to) in Asia/Colombo. "week" starts Monday; "custom" uses from/to dates (both inclusive).
function period(range: string, from?: string, to?: string): { gte?: Date; lt?: Date } {
  const today = colomboDayStart();
  if (range === "today") return { gte: today };
  if (range === "week") return { gte: new Date(today.getTime() - ((new Date(today.getTime() + IST).getUTCDay() + 6) % 7) * DAY) };
  if (range === "month") { const l = new Date(today.getTime() + IST); l.setUTCDate(1); return { gte: new Date(l.getTime() - IST) }; }
  if (range === "custom") return { ...(ymdOk(from) ? { gte: colomboDate(from!) } : {}), ...(ymdOk(to) ? { lt: new Date(colomboDate(to!).getTime() + DAY) } : {}) };
  if (range === "all") return {};
  const days = Number(range);
  return { gte: new Date(Date.now() - (Number.isFinite(days) && days > 0 ? days : 30) * DAY) };
}

export const metadata = { title: "All sales" };

export default async function Sales({ searchParams }: { searchParams: Promise<{ q?: string; pay?: string; type?: string; range?: string; from?: string; to?: string; page?: string }> }) {
  const user = await requirePermission("sales.view");
  const { q, pay, type, range = "30", from, to, page: pageParam } = await searchParams;
  const page = pageOf(pageParam);
  const when = period(range, from, to);
  const where: Prisma.SaleWhereInput = {
    stage: "FINAL",
    ...(user.location ? { locationId: user.location.id } : {}),
    ...(when.gte || when.lt ? { soldAt: when } : {}),
    ...(isSaleChannel(type) ? { channel: type } : {}),
    ...(pay === "due" ? { paymentState: { not: "PAID" } } : pay === "paid" ? { paymentState: "PAID" } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { customer: { phone: { contains: q } } }] } : {}),
  };
  const [found, agg] = await Promise.all([
    db.sale.findMany({ where, orderBy: [{ soldAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1, include: { customer: true, createdBy: true } }),
    db.sale.aggregate({ where, _sum: { total: true, paid: true, credited: true }, _count: true }),
  ]);

  const sales = found.slice(0, PAGE_SIZE);

  return (
    <div>
      <PageHead eyebrow={`Sell / ${user.location?.name ?? ""}`} title="All sales" actions={can(user, "sales.create") && <Link className="btn btn-primary" href="/pos">New sale</Link>} />
      <form className="toolbar" role="search">
        <input name="q" defaultValue={q} placeholder="Invoice, customer name or mobile" aria-label="Search sales" />
        <select name="range" defaultValue={range} aria-label="Period">
          <option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option><option value="custom">Custom dates…</option>
        </select>
        {range === "custom" && <><input type="date" name="from" defaultValue={from} aria-label="From date" /><input type="date" name="to" defaultValue={to} aria-label="To date" /></>}
        <select name="type" defaultValue={isSaleChannel(type) ? type : ""} aria-label="Sale type"><option value="">Any type</option>{SALE_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}</select>
        <select name="pay" defaultValue={pay ?? ""} aria-label="Payment state"><option value="">Any payment</option><option value="due">Due / part paid</option><option value="paid">Paid</option></select>
        <button className="btn">Filter</button>
      </form>
      <DataTable
        rows={sales}
        rowKey={(s) => s.id}
        empty="No sales match these filters."
        columns={[
          { label: "Invoice", primary: true, render: (s) => <RowLink href={`/sales/${s.id}`}>{s.number}</RowLink> },
          { label: "Date", render: (s) => fmtDateTime(s.soldAt) },
          { label: "Customer", render: (s) => s.customer?.name ?? "Walk-in" },
          { label: "Type", render: (s) => (s.channel === "IN_STORE" ? <span className="muted">In store</span> : <><Badge tone="muted">{channelLabel(s.channel)}</Badge>{s.channelRef && <div className="small muted">{s.channelRef}</div>}</>) },
          { label: "Staff", render: (s) => s.createdBy.fullName },
          { label: "Total", num: true, render: (s) => money(s.total) },
          { label: "Paid", num: true, render: (s) => money(s.paid) },
          { label: "Returned", num: true, render: (s) => (D(s.credited).gt(0) ? money(s.credited) : "—") },
          { label: "Due", num: true, render: (s) => { const d = D(s.total).minus(s.paid).minus(s.credited); return d.gt(0) ? <span style={{ color: "var(--err)" }}>{money(d)}</span> : "—"; } },
          { label: "Payment", render: (s) => <Badge tone={s.paymentState === "PAID" ? "ok" : "warn"}>{s.paymentState === "PAID" ? "Paid" : s.paymentState === "PARTIAL" ? "Part paid" : "Due"}</Badge> },
        ]}
        footer={
          <tr>
            <td data-label="Filtered totals">All filtered ({agg._count})</td><td /><td /><td /><td />
            <td className="num" data-label="Total">{money(agg._sum.total)}</td>
            <td className="num" data-label="Paid">{money(agg._sum.paid)}</td>
            <td className="num" data-label="Returned">{money(agg._sum.credited)}</td>
            <td className="num" data-label="Due">{money(D(agg._sum.total).minus(D(agg._sum.paid)).minus(D(agg._sum.credited)))}</td><td />
          </tr>
        }
      />
      <Pager page={page} hasNext={found.length > PAGE_SIZE} query={{ q, pay, type, range, from: range === "custom" ? from : undefined, to: range === "custom" ? to : undefined }} shown={sales.length} noun="sales" />
    </div>
  );
}
