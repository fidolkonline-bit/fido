import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { NAV, PHASE_LABEL } from "@/lib/nav";
import { PageHead } from "@/components/ui";

// Honest status page for screen families that are specified but not yet built (spec §25).
const SCOPE: Record<string, string> = {
  repairs: "Jobs by status, technician, promised date and overdue state; intake, estimate, parts, ready/collected and customer updates.",
  "repair-intake": "Customer/device/IMEI, restricted PIN or pattern, SIM/card/accessory checklist, condition, photos, estimate and job sticker.",
  "repair-parts": "Reserve, issue and return parts by exact lot and cost; labour and external costs; issue once.",
  returns: "Find original sale, returnable quantities, reason, customer settlement (refund/credit/exchange) and item disposition.",
  transfers: "Source/destination with lot and cost lineage, dispatch, in-transit and receipt with discrepancies.",
  adjustments: "Product/lot quantity and cost, reason and disposition, recovered value and audit.",
  expenses: "Categories, contact/employee, dates, tax, recurrence, payment state and attachments.",
  "purchase-orders": "Draft/ordered/part received/received with remaining quantities and linked GRNs.",
  "supplier-returns": "Returns against original receipt lines, supplier claims and confirmed recovery.",
  wallets: "Provider/channel wallets, funding, nominal balance, cost-spread commission and reconciliation.",
  "reload-requests": "Owner request → staff acknowledge/claim → recorded provider outcome; uncertain results reconciled, never auto-retried.",
  inbox: "Durable staff task inbox with alarms, acknowledgement, escalation and connection state.",
  "bus-parcels": "Bus/route/ETA/stop, assigned worker, alert, collected, contents checked and linked GRN.",
  notifications: "Text.lk SMS adapter, templates, outbox with delivery states and controlled retry.",
};

export default async function Planned({ params }: { params: Promise<{ slug: string }> }) {
  await requireUser();
  const { slug } = await params;
  const group = NAV.find((g) => g.items.some((i) => i.href === `/planned/${slug}`));
  const item = group?.items.find((i) => i.href === `/planned/${slug}`);
  if (!group || !item) notFound();
  return (
    <div className="stack" style={{ maxWidth: 680 }}>
      <PageHead eyebrow={group.label} title={item.label} />
      <p className="note">Not built yet — scheduled for <strong>{PHASE_LABEL[item.phase!]}</strong>. No data is recorded from this screen.</p>
      {SCOPE[slug] && <p>{SCOPE[slug]}</p>}
      <div><Link className="btn" href="/">Back to home</Link></div>
    </div>
  );
}
