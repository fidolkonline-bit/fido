import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, RowLink, Badge, Pager, PAGE_SIZE, pageOf } from "@/components/ui";

export const metadata = { title: "Trade-ins" };

export default async function TradeIns({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await requirePermission("purchases.view");
  const { q, page: pageParam } = await searchParams;
  const page = pageOf(pageParam);
  const where: Prisma.TradeInWhereInput = {
    ...(user.location ? { locationId: user.location.id } : {}),
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { imei1: { contains: q } }, { serial: { contains: q, mode: "insensitive" } }, { sellerIdNumber: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const found = await db.tradeIn.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1, include: { customer: true, product: true, device: true } });
  const rows = found.slice(0, PAGE_SIZE);
  const state: Record<string, [string, "ok" | "warn" | "muted" | "err"]> = { SALEABLE: ["On sale", "ok"], HELD: ["Held for checking", "warn"], SOLD: ["Sold", "muted"], WRITTEN_OFF: ["Written off", "err"], IN_TRANSIT: ["In transit", "muted"] };
  return (
    <div>
      <PageHead eyebrow="Purchases" title="Trade-ins / used phones bought" actions={can(user, "tradein.create") && <Link className="btn btn-primary" href="/trade-ins/new">Buy a used phone</Link>} />
      <form className="toolbar" role="search"><input name="q" defaultValue={q} placeholder="Number, IMEI, seller name or ID number" aria-label="Search trade-ins" /><button className="btn">Search</button></form>
      <DataTable rows={rows} rowKey={(t) => t.id} empty="No trade-ins yet."
        columns={[
          { label: "Number", primary: true, render: (t) => <RowLink href={`/trade-ins/${t.id}`}>{t.number}</RowLink> },
          { label: "Date", render: (t) => fmtDateTime(t.createdAt) },
          { label: "Phone", render: (t) => <>{t.product.name}<br /><span className="small muted">{t.imei1 ?? t.serial} · grade {t.grade}</span></> },
          { label: "Seller", render: (t) => <>{t.customer.name}<br /><span className="small muted">{t.sellerIdType} {t.sellerIdNumber}</span></> },
          { label: "Value", num: true, render: (t) => (can(user, "cost.view") ? money(t.value) : "—") },
          { label: "Paid by", render: (t) => ({ CASH: "Cash", BANK_TRANSFER: "Bank", STORE_CREDIT: "Store credit" } as Record<string, string>)[t.settlement] },
          { label: "Now", render: (t) => { const s = state[t.device?.state ?? ""] ?? ["—", "muted"]; return <Badge tone={s[1]}>{s[0]}</Badge>; } },
        ]} />
      <Pager page={page} hasNext={found.length > PAGE_SIZE} query={{ q }} shown={rows.length} noun="trade-ins" />
    </div>
  );
}
