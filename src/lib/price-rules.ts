// Which price applies to a product in a sale, and why. Pure, so the POS shows exactly what the server will post.
// Shared by the browser and the server; no server-only imports here.

export type Tier = { id: string; name: string };
// The pricing policy in force for a sale: a tier, a % adjustment of the default price, or the default price.
export type Policy = { tier: Tier | null; adjustmentPct: number | null; groupName: string | null };
// Per product: default price, configured tier prices (usable ones only) and tiers whose price is an unverified 0.
export type PriceInfo = { price: string; tierPrices: Record<string, string>; zeroUnverified: string[] };
export type Resolved = { price: number; rule: string; tierId: string | null; tierName: string | null; fallback: boolean };

const r2 = (v: number) => Math.round(v * 100) / 100;

export function resolvePrice(p: PriceInfo, policy: Policy): Resolved {
  const base = Number(p.price);
  const { tier } = policy;
  if (tier) {
    const tp = p.tierPrices[tier.id];
    if (tp !== undefined) return { price: Number(tp), rule: tier.name, tierId: tier.id, tierName: tier.name, fallback: false };
    // An unset (or unverified 0) tier price never means free: sell at the default price and say so.
    const why = p.zeroUnverified.includes(tier.id) ? `${tier.name} price is 0 and not verified` : `no ${tier.name} price set`;
    return { price: base, rule: `Default price (${why})`, tierId: tier.id, tierName: tier.name, fallback: true };
  }
  if (policy.adjustmentPct) {
    const pct = policy.adjustmentPct;
    return { price: r2(base * (1 + pct / 100)), rule: `Default price ${pct > 0 ? "+" : ""}${pct}% (${policy.groupName ?? "customer group"})`, tierId: null, tierName: null, fallback: false };
  }
  return { price: base, rule: "Default price", tierId: null, tierName: null, fallback: false };
}
