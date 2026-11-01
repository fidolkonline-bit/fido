import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { money as fmtMoney, D } from "@/lib/money";
import { balances } from "@/lib/reports/money";
import type { Ctx } from "@/lib/reports/types";
import { PageHead, Badge, Stat } from "@/components/ui";

export const metadata = { title: "Cutover checklist" };

type Check = { label: string; detail: string; tone: "ok" | "warn" | "err" | "muted"; href?: string };

// Spec §22: reconcile before the move from Clicky, and preserve evidence instead of inventing corrections.
export default async function Cutover() {
  const user = await requirePermission("imports.run");
  const locations = await db.location.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const ctx = { user, from: new Date(0), to: new Date(), fromYmd: "1970-01-01", toYmd: "2999-12-31", locationIds: locations.map((l) => l.id), showCost: true, params: {} } as unknown as Ctx;
  const [b, people, logins, customers, suppliers, cats, products, uncategorised, negLayers, devices, unlinked, schemes, batches, stockByLoc] = await Promise.all([
    balances(ctx),
    db.person.count({ where: { active: true } }),
    db.loginAccount.count({ where: { allowLogin: true } }),
    db.contact.aggregate({ where: { isCustomer: true }, _count: true, _sum: { openingBalance: true } }),
    db.contact.aggregate({ where: { isSupplier: true }, _count: true, _sum: { openingBalance: true } }),
    db.category.findMany({ where: { active: true }, select: { name: true, userShare: true, agentShare: true, legacyId: true } }),
    db.product.count({ where: { active: true } }),
    db.product.count({ where: { active: true, categoryId: null } }),
    db.costLayer.count({ where: { qtyRemaining: { lt: 0 } } }),
    db.deviceIdentity.groupBy({ by: ["state"], _count: true }),
    db.payment.count({ where: { accountId: null, method: { notIn: ["CREDIT", "STORE_CREDIT"] } } }),
    db.numberScheme.findMany({ orderBy: { docType: "asc" } }),
    db.importBatch.groupBy({ by: ["kind", "status"], _count: true }),
    db.costLayer.groupBy({ by: ["locationId"], where: { qtyRemaining: { gt: 0 }, bucket: { not: "WRITTEN_OFF" } }, _sum: { qtyRemaining: true } }),
  ]);
  const oddShares = cats.filter((c) => { const t = D(c.userShare).plus(c.agentShare); return t.gt(0) && t.minus(1).abs().gt(0.0001); });
  const committed = (k: string) => batches.filter((x) => x.kind === k && x.status === "COMMITTED").reduce((a, x) => a + x._count, 0);
  const deviceCount = (s: string) => devices.find((d) => d.state === s)?._count ?? 0;

  const loaded: Check[] = [
    { label: "People & logins", detail: `${people} active people · ${logins} can sign in`, tone: people > 1 ? "ok" : "warn", href: "/users" },
    { label: "Customers", detail: `${customers._count} · opening balances ${fmtMoney(customers._sum.openingBalance)}`, tone: committed("CONTACTS") ? "ok" : "warn" },
    { label: "Suppliers", detail: `${suppliers._count} · opening balances ${fmtMoney(suppliers._sum.openingBalance)}`, tone: committed("CONTACTS") ? "ok" : "warn" },
    { label: "Categories & commission rates", detail: `${cats.length} categories · ${cats.filter((c) => c.legacyId).length} carry a legacy id (spec expects 120 rate rows)`, tone: committed("CATEGORIES") ? "ok" : "warn" },
    { label: "Products", detail: `${products} active · ${uncategorised} without a category`, tone: products && !uncategorised ? "ok" : "warn", href: "/products" },
    { label: "Opening stock by lot", detail: `${committed("OPENING_STOCK")} committed import(s)`, tone: committed("OPENING_STOCK") ? "ok" : "warn" },
    { label: "Account opening balances", detail: `${b.acct.length} accounts`, tone: b.acct.length ? "ok" : "warn", href: "/accounts" },
  ];
  const investigate: Check[] = [
    { label: "Negative lot balances", detail: negLayers ? `${negLayers} cost layer(s) below zero` : "None", tone: negLayers ? "err" : "ok" },
    { label: "Share totals not 100%", detail: oddShares.length ? oddShares.slice(0, 6).map((c) => `${c.name} (${D(c.userShare).plus(c.agentShare).mul(100).toFixed(2)}%)`).join(", ") + (oddShares.length > 6 ? ` +${oddShares.length - 6} more` : "") : "None", tone: oddShares.length ? "warn" : "ok" },
    { label: "Payments not linked to an account", detail: unlinked ? `${unlinked} payment(s)` : "None", tone: unlinked ? "warn" : "ok" },
    { label: "Products without a category", detail: uncategorised ? `${uncategorised} — no commission until fixed` : "None", tone: uncategorised ? "warn" : "ok" },
  ];
  const gates = [
    "Supported export or read-only database access from Clicky obtained (needed for full sales/purchase history).",
    "Rehearsal import done on a copy and the reconciliation above matched the old system's reports.",
    "Backup taken and a restore actually tested (a backup without a restore check does not count).",
    "Numbering continues from the old system's last numbers (section 4).",
    "Old system kept read-only for history lookups; writes frozen or a final delta captured.",
    "Reversal plan agreed: who decides, and how to fall back to the old system.",
  ];
  const tone: Record<Check["tone"], string> = { ok: "Ready", warn: "Check", err: "Investigate", muted: "—" };
  const list = (items: Check[]) => (
    <ul className="checklist">
      {items.map((c) => (
        <li key={c.label}>
          <Badge tone={c.tone}>{tone[c.tone]}</Badge>
          <div><strong>{c.href ? <Link href={c.href}>{c.label}</Link> : c.label}</strong><div className="muted">{c.detail}</div></div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="stack">
      <PageHead eyebrow="Products / Imports" title="Cutover checklist" actions={<Link className="btn" href="/products/imports">Imports</Link>} />
      <p className="muted">Compare every figure here with the same figure in Clicky on the cut-over date. Where they differ, record why; don&apos;t adjust to force a match.</p>

      <section className="panel stack"><h2>1. Data loaded</h2>{list(loaded)}</section>

      <section className="panel stack">
        <h2>2. Reconcile against the old system</h2>
        <div className="stats">
          <Stat label="Stock value (FIFO cost)" value={can(user, "cost.view") ? fmtMoney(b.stock) : "Hidden"} basis="Open cost layers, saleable and held" />
          <Stat label="Customer receivables" value={fmtMoney(b.receivables)} basis="Openings + unpaid invoices" />
          <Stat label="Supplier payables" value={fmtMoney(b.payables)} basis="Openings + unpaid receipts − claim credits" />
          <Stat label="Unpaid commission" value={fmtMoney(b.commission)} />
          <Stat label="Unpaid payroll" value={fmtMoney(b.payroll)} />
          <Stat label="Phones in stock" value={String(deviceCount("SALEABLE") + deviceCount("HELD"))} basis={`${deviceCount("SOLD")} sold · ${deviceCount("IN_TRANSIT")} in transit`} />
        </div>
        <ul className="checklist">
          {stockByLoc.map((s) => <li key={s.locationId}><Badge tone="muted">Units</Badge><div><strong>{locations.find((l) => l.id === s.locationId)?.name ?? s.locationId}</strong><div className="muted">{D(s._sum.qtyRemaining).toFixed(0)} units on hand</div></div></li>)}
          {b.acct.map((a) => <li key={a.name}><Badge tone="muted">{a.type.toLowerCase().replaceAll("_", " ")}</Badge><div><strong>{a.name}</strong><div className="muted">{fmtMoney(a.balance)}</div></div></li>)}
        </ul>
        <p className="muted">Detail: <Link href="/reports/stock">Stock</Link> · <Link href="/reports/lots">Lots</Link> · <Link href="/reports/customers-suppliers">Customers / Suppliers</Link> · <Link href="/reports/balances">Balances</Link> · <Link href="/reports/trial-balance">Trial balance</Link></p>
      </section>

      <section className="panel stack"><h2>3. Investigate before go-live</h2>{list(investigate)}</section>

      <section className="panel stack">
        <h2>4. Numbering continuity</h2>
        <ul className="checklist">
          {schemes.map((s) => <li key={s.id}><Badge tone="muted">{s.docType.toLowerCase().replaceAll("_", " ")}</Badge><div><strong>{s.prefix}{String(s.nextValue).padStart(s.digits, "0")}</strong><div className="muted">next number{s.scope !== "ALL" ? ` · ${locations.find((l) => l.id === s.scope)?.name ?? s.scope}` : ""}</div></div></li>)}
        </ul>
        <p className="muted"><Link href="/settings/numbering">Set the next numbers</Link> to follow on from Clicky.</p>
      </section>

      <section className="panel stack">
        <h2>5. Go-live gates</h2>
        <p className="muted">These are confirmed outside the system. Tick them off with the owner.</p>
        <ul className="checklist">{gates.map((g) => <li key={g}><input type="checkbox" aria-label={g} /><div>{g}</div></li>)}</ul>
      </section>

      <section className="panel stack">
        <h2>Waiting on a Clicky export</h2>
        <p className="muted">Full history (past sales with their lot allocations, receipts, returns, payments, commissions, repairs, payroll) needs a real export or read-only database access from Clicky. Once a sample file is available the import mapping can be built against it. Until then, the fallback is opening stock per lot plus opening balances, with read-only access to the old system for history.</p>
      </section>
    </div>
  );
}
