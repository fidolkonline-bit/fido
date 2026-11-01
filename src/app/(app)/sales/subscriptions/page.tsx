import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/money";
import { generateSubscriptions, type DraftLine } from "@/lib/drafts";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { SubscriptionForm } from "./SubscriptionForm";
import { stopSubscription } from "../drafts/actions";

export const metadata = { title: "Subscriptions" };

export default async function Subscriptions() {
  await requirePermission("sales.create");
  await generateSubscriptions();
  const subs = await db.subscription.findMany({ orderBy: { createdAt: "desc" }, include: { customer: true, _count: { select: { drafts: true } } } });
  return (
    <div className="stack">
      <PageHead eyebrow="Sell" title="Subscriptions" />
      <DataTable rows={subs} rowKey={(s) => s.id} empty="No subscriptions."
        columns={[
          { label: "Subscription", primary: true, render: (s) => s.name },
          { label: "Customer", render: (s) => s.customer.name },
          { label: "Items", render: (s) => (s.lines as DraftLine[]).map((l) => `${l.name} × ${l.qty}`).join(", ") },
          { label: "Every", render: (s) => s.interval.toLowerCase() },
          { label: "Next", render: (s) => (s.active ? fmtDate(s.nextDate) : "—") },
          { label: "Invoices made", num: true, render: (s) => s._count.drafts },
          { label: "", render: (s) => s.active ? <form action={stopSubscription}><input type="hidden" name="id" value={s.id} /><button className="btn btn-sm">Stop</button></form> : <Badge>Stopped</Badge> },
        ]} />
      <SubscriptionForm />
    </div>
  );
}
