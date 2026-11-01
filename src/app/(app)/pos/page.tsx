import Link from "next/link";
import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { Pos, type DraftPrefill } from "./Pos";
import { productHits } from "../search";
import { customerPolicy, tiersFor } from "@/lib/pricing";

export const metadata = { title: "POS" };

export default async function PosPage({ searchParams }: { searchParams: Promise<{ customer?: string; draft?: string }> }) {
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

  const { customer: cParam, draft: draftParam } = await searchParams;
  const draft = draftParam ? await db.saleDraft.findFirst({ where: { id: draftParam, status: "OPEN" } }) : null;
  const customerId = cParam ?? draft?.customerId ?? undefined;
  let initialDraft: DraftPrefill | null = null;
  if (draft) {
    const lines = draft.lines as { productId: string; qty: number; unitPrice: number; discount: number }[];
    const hits = await productHits(lines.map((l) => l.productId));
    initialDraft = {
      id: draft.id, number: draft.number,
      lines: lines.flatMap((l) => { const h = hits.find((x) => x.id === l.productId); if (!h || h.tracked) return [];
        // The stored discount included any offer; re-apply today's offer and keep only the extra manual part.
        const offer = h.offer ? Number(h.offer.perUnit) * Number(l.qty) : 0;
        return [{ product: h, qty: Number(l.qty), price: String(l.unitPrice), discount: String(Math.max(0, Math.round((Number(l.discount) - offer) * 100) / 100) || "") }]; }),
    };
  }
  const [business, profiles, accounts, preset, credit, tiers, presetPolicy, recvAccounts] = await Promise.all([
    db.business.findFirstOrThrow(),
    db.commissionProfile.findMany({ where: { active: true, person: { active: true } }, include: { person: true }, orderBy: { person: { fullName: "asc" } } }),
    db.account.findMany({ where: { active: true, type: { in: ["CARD", "BANK"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
    customerId ? db.contact.findUnique({ where: { id: customerId }, select: { id: true, name: true, phone: true, code: true } }) : null,
    customerId ? db.storeCreditEntry.aggregate({ where: { contactId: customerId }, _sum: { amount: true } }) : null,
    tiersFor(user),
    customerPolicy(db, customerId ?? null),
    // Accounts a debt payment may land in (the server re-checks type, location and permission).
    db.account.findMany({ where: { active: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, type: true, locationId: true } }),
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
        initialDraft={initialDraft}
        initialCustomer={preset ? { ...preset, storeCredit: Number(credit?._sum.amount ?? 0), pricing: presetPolicy } : null}
        tiers={tiers}
        canOverrideTier={can(user, "settings.manage") || can(user, "pricing.tier_override")}
        locationId={loc!.id}
        recvAccounts={recvAccounts}
        debtPerms={{ view: can(user, "debt.view"), receive: can(user, "debt.view") && can(user, "debt.receive"), allocate: can(user, "debt.allocate"), account: can(user, "debt.account"), backdate: can(user, "debt.backdate") }}
      />
    </div>
  );
}
