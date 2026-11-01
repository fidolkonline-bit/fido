import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { Pos } from "./Pos";

export const metadata = { title: "POS" };

export default async function PosPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const user = await requirePermission("sales.create");
  const loc = user.location;
  const register = loc ? await db.registerSession.findFirst({ where: { locationId: loc.id, userId: user.personId, closedAt: null } }) : null;

  if (!register) {
    return (
      <div className="stack" style={{ maxWidth: 560 }}>
        <PageHead eyebrow={`Sell / ${loc?.name ?? ""}`} title="POS" />
        <p className="note">Your cash register at {loc?.name ?? "this location"} is closed. Open it with your starting cash before selling.</p>
        {can(user, "register.operate") && <div><Link className="btn btn-primary" href="/register">Open register</Link></div>}
      </div>
    );
  }

  const { customer: customerId } = await searchParams;
  const [business, profiles, accounts, preset, credit] = await Promise.all([
    db.business.findFirstOrThrow(),
    db.commissionProfile.findMany({ where: { active: true, person: { active: true } }, include: { person: true }, orderBy: { person: { fullName: "asc" } } }),
    db.account.findMany({ where: { active: true, type: { in: ["CARD", "BANK"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
    customerId ? db.contact.findUnique({ where: { id: customerId }, select: { id: true, name: true, phone: true } }) : null,
    customerId ? db.storeCreditEntry.aggregate({ where: { contactId: customerId }, _sum: { amount: true } }) : null,
  ]);

  return (
    <div>
      <Pos
        locationName={loc!.name}
        rounding={Number(business.saleRounding)}
        maxDiscountPct={can(user, "sales.override_price") ? 100 : Number(user.maxDiscountPct)}
        canQuickAdd={can(user, "contacts.manage")}
        salespeople={profiles.filter((p) => p.kind !== "AGENT").map((p) => ({ id: p.personId, name: p.person.fullName }))}
        agents={profiles.filter((p) => p.kind !== "USER").map((p) => ({ id: p.personId, name: p.person.fullName }))}
        accounts={accounts}
        selfId={user.personId}
        initialCustomer={preset ? { ...preset, storeCredit: Number(credit?._sum.amount ?? 0) } : null}
      />
    </div>
  );
}
