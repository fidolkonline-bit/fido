import "server-only";
import { db, type Tx } from "./db";
import { can } from "./permissions";
import type { CurrentUser } from "./auth";
import type { Policy, PriceInfo } from "./price-rules";

export class PricingError extends Error {}

// Tier prices for products in one query: usable prices by tier, plus tiers whose stored price is an unverified 0.
export async function priceInfo(client: Tx | typeof db, products: { id: string; sellPrice: { toFixed(n: number): string } }[]) {
  const rows = await client.productPrice.findMany({ where: { productId: { in: products.map((p) => p.id) }, priceGroup: { active: true } } });
  const out = new Map<string, PriceInfo>();
  for (const p of products) out.set(p.id, { price: p.sellPrice.toFixed(2), tierPrices: {}, zeroUnverified: [] });
  for (const r of rows) {
    const info = out.get(r.productId)!;
    if (r.price.isZero() && !r.zeroConfirmed) info.zeroUnverified.push(r.priceGroupId);
    else info.tierPrices[r.priceGroupId] = r.price.toFixed(2);
  }
  return out;
}

// The customer's group policy. An inactive tier is ignored (default price), never silently swapped for another.
export async function customerPolicy(client: Tx | typeof db, customerId: string | null): Promise<Policy> {
  if (!customerId) return { tier: null, adjustmentPct: null, groupName: null };
  const c = await client.contact.findUnique({ where: { id: customerId }, include: { group: { include: { priceGroup: true } } } });
  const g = c?.group;
  if (!g) return { tier: null, adjustmentPct: null, groupName: null };
  const tier = g.priceGroup?.active ? { id: g.priceGroup.id, name: g.priceGroup.name } : null;
  return { tier, adjustmentPct: tier ? null : g.adjustmentPct ? Number(g.adjustmentPct) : null, groupName: g.name };
}

// Tiers this user may pick by hand. Owners (settings.manage) may pick any; others need the override permission and role access.
export async function tiersFor(user: CurrentUser) {
  const groups = await db.priceGroup.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { access: true } });
  const owner = can(user, "settings.manage");
  const override = owner || can(user, "pricing.tier_override");
  return groups.map((g) => ({ id: g.id, name: g.name, allowed: override && (owner || g.access.some((a) => a.roleId === user.roleId)) }));
}

// Final pricing policy for a sale: the customer's, or a checked manual override (undefined = follow the customer).
export async function salePolicy(tx: Tx, user: CurrentUser, customerId: string | null, tierOverride: string | null | undefined) {
  const policy = await customerPolicy(tx, customerId);
  const described = (p: Policy) => p.tier ? `${p.groupName ? `Customer group ${p.groupName}: ` : ""}${p.tier.name}` : p.adjustmentPct ? `Customer group ${p.groupName}: ${p.adjustmentPct > 0 ? "+" : ""}${p.adjustmentPct}%` : "Default price";
  if (tierOverride === undefined || tierOverride === (policy.tier?.id ?? null) && !policy.adjustmentPct) return { policy, basis: described(policy) };
  if (tierOverride === null) {
    if (!can(user, "settings.manage") && !can(user, "pricing.tier_override")) throw new PricingError("You are not allowed to change the price tier.");
    return { policy: { tier: null, adjustmentPct: null, groupName: null }, basis: `Default price (override by ${user.name})` };
  }
  const allowed = (await tiersFor(user)).find((t) => t.id === tierOverride);
  if (!allowed) throw new PricingError("That price tier is no longer active.");
  if (!allowed.allowed) throw new PricingError(`You are not allowed to sell at ${allowed.name}.`);
  return { policy: { tier: { id: allowed.id, name: allowed.name }, adjustmentPct: null, groupName: null }, basis: `${allowed.name} (override by ${user.name})` };
}
