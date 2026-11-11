import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getLoyalty } from "@/lib/loyalty";
import { PageHead, DataTable, RowLink, Stat } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { saveLoyalty } from "./actions";

export const metadata = { title: "Loyalty points" };

export default async function Loyalty() {
  await requirePermission("settings.manage");
  const [s, top, total] = await Promise.all([
    getLoyalty(),
    db.loyaltyEntry.groupBy({ by: ["contactId"], _sum: { points: true }, orderBy: { _sum: { points: "desc" } }, take: 20 }),
    db.loyaltyEntry.aggregate({ _sum: { points: true } }),
  ]);
  const names = new Map((await db.contact.findMany({ where: { id: { in: top.map((t) => t.contactId) } }, select: { id: true, name: true, phone: true } })).map((c) => [c.id, c]));
  const outstanding = total._sum.points ?? 0;
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <PageHead eyebrow="Settings" title="Loyalty points" />
      <ActionForm action={saveLoyalty} className="panel stack">
        <label className="check"><input type="checkbox" name="enabled" defaultChecked={s.enabled} /> Give loyalty points on sales to named customers</label>
        <div className="grid3">
          <label className="field"><span>Rs. spent for 1 point</span><input name="earnPer" type="number" min="1" step="1" defaultValue={s.earnPer} inputMode="numeric" /></label>
          <label className="field"><span>1 point is worth Rs.</span><input name="pointValue" type="number" min="0.01" step="0.01" defaultValue={s.pointValue} inputMode="decimal" /></label>
          <label className="field"><span>Smallest conversion (points)</span><input name="minRedeem" type="number" min="1" step="1" defaultValue={s.minRedeem} inputMode="numeric" /></label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          With these numbers a customer gets back {((s.pointValue / s.earnPer) * 100).toFixed(2)}% of what they spend. Points are converted to store credit on the
          customer&apos;s page and spent at the POS with the Store credit payment method. Points earned on returned goods are taken back. Walk-in sales earn nothing.
        </p>
        <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton>Save</SubmitButton></div>
      </ActionForm>
      <div className="stats">
        <Stat label="Points outstanding" value={outstanding.toLocaleString("en-LK")} basis={`Worth Rs. ${(outstanding * s.pointValue).toLocaleString("en-LK")} if all were converted`} />
      </div>
      <DataTable rows={top.filter((t) => (t._sum.points ?? 0) > 0)} rowKey={(t) => t.contactId} empty="No points earned yet."
        columns={[
          { label: "Customer", primary: true, render: (t) => <RowLink href={`/contacts/${t.contactId}`}>{names.get(t.contactId)?.name ?? "—"}</RowLink> },
          { label: "Mobile", render: (t) => names.get(t.contactId)?.phone ?? "—" },
          { label: "Points", num: true, render: (t) => (t._sum.points ?? 0).toLocaleString("en-LK") },
        ]} />
    </div>
  );
}
