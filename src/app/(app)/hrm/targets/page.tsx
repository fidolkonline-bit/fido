import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDate } from "@/lib/money";
import { targetResult } from "@/lib/targets";
import { bandText, MODE_LABEL, nextPeriod, type Band } from "@/lib/target-calc";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { newTargetForm, approveTargetForm, copyTargetsForm, deleteTargetForm } from "../actions";
import * as H from "@/lib/hr";
import { DaysDetail } from "./DaysDetail";

export const metadata = { title: "Sales targets" };

type Snapshot = { achieved: string; earning: string; categories?: string[] | null; days?: { day: string; value: string; earning: string }[] };

const plain = (n: number) => new Intl.NumberFormat("en-LK", { maximumFractionDigits: 2 }).format(n);

export default async function Targets() {
  await requirePermission("hr.payroll");
  const [targets, people, categories] = await Promise.all([
    db.salesTarget.findMany({ orderBy: [{ periodStart: "desc" }, { createdAt: "asc" }], take: 80, include: { person: true, payslip: { include: { run: true } } } }),
    db.person.findMany({ where: { active: true, employee: { isNot: null } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, parentId: true, active: true } }),
  ]);
  const live = await Promise.all(targets.map((t) => (t.snapshot ? Promise.resolve(null) : targetResult(t))));
  const result = (i: number) => {
    const snap = targets[i].snapshot as Snapshot | null;
    if (snap) return { achieved: snap.achieved, earning: snap.earning, days: snap.days ?? null };
    const r = live[i]!;
    return { achieved: r.value.toString(), earning: r.earning.toString(), days: r.days?.map((d) => ({ day: d.day, value: d.value.toString(), earning: d.earning.toString() })) ?? null };
  };
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  // Category tree, parents first, sub-categories indented under them.
  const tree: { id: string; name: string; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const c of categories.filter((x) => x.parentId === parentId && x.active)) { tree.push({ id: c.id, name: c.name, depth }); walk(c.id, depth + 1); }
  };
  walk(null, 0);
  const today = H.todayYmd();
  // Distinct periods, newest first, each with the period a copy would go to.
  const periods = [...new Map(targets.map((t) => [`${H.dateOnlyYmd(t.periodStart)}|${H.dateOnlyYmd(t.periodEnd)}`, t])).entries()].map(([key, t]) => {
    const n = nextPeriod(H.dateOnlyYmd(t.periodStart), H.dateOnlyYmd(t.periodEnd));
    const count = targets.filter((x) => x.periodStart.getTime() === t.periodStart.getTime() && x.periodEnd.getTime() === t.periodEnd.getTime()).length;
    const range = (a: Date, b: Date) => `${fmtDate(a)} – ${fmtDate(b)}`;
    return { key, label: `${range(t.periodStart, t.periodEnd)} (${count}) → ${range(H.dateOnly(n.start), H.dateOnly(n.end))}` };
  });

  return (
    <div className="stack">
      <PageHead eyebrow="HRM" title="Sales targets" />
      <p className="small muted" style={{ margin: 0 }}>
        A target bonus is separate from category commission and is never added to it automatically. Only items in the target&apos;s categories count (all categories if none are chosen), after discounts and returns; reloads never count.
        A daily target judges each day on its own and adds up the days that reached a band. Approve after the period ends; the bonus is then paid once through payroll.
      </p>
      <DataTable rows={targets.map((t, i) => ({ t, i }))} rowKey={({ t }) => t.id} empty="No targets set."
        columns={[
          { label: "Employee", primary: true, render: ({ t }) => t.person.fullName },
          { label: "Period", render: ({ t }) => `${fmtDate(t.periodStart)} – ${fmtDate(t.periodEnd)}` },
          {
            label: "Target", render: ({ t }) => {
              const snapCats = (t.snapshot as Snapshot | null)?.categories;
              const cats = snapCats !== undefined ? snapCats : t.categoryIds.length ? t.categoryIds.map((id) => catName.get(id) ?? "deleted category") : null;
              return (
                <div className="small" style={{ display: "grid", gap: 2 }}>
                  <span><strong>{t.cadence === "DAILY" ? "Daily" : "Whole period"}</strong> · {MODE_LABEL[t.mode] ?? t.mode.toLowerCase()}</span>
                  <span className="muted">{cats?.length ? cats.join(", ") : "All categories"}</span>
                  <span>{(t.bands as Band[]).map((b) => bandText(b, t.mode, plain)).join(" · ")}</span>
                </div>
              );
            },
          },
          {
            label: "Achieved", num: true, render: ({ i }) => {
              const r = result(i);
              return <div style={{ display: "grid", gap: 2 }}><span>{money(r.achieved)}</span>{r.days?.length ? <DaysDetail days={r.days} /> : null}</div>;
            },
          },
          { label: "Bonus", num: true, render: ({ i }) => money(result(i).earning) },
          {
            label: "", render: ({ t }) => t.payslip ? <Badge tone="ok">Paid · {t.payslip.run.number}</Badge> : t.approvedAt ? <Badge tone="warn">Approved — next payroll</Badge>
              : (
                <div className="row">
                  {H.dateOnlyYmd(t.periodEnd) < today
                    ? <form action={approveTargetForm}><input type="hidden" name="id" value={t.id} /><button className="btn btn-sm btn-primary">Approve bonus</button></form>
                    : <span className="small muted">In progress</span>}
                  <form action={deleteTargetForm}><input type="hidden" name="id" value={t.id} /><button className="btn btn-sm btn-ghost btn-danger">Delete</button></form>
                </div>
              ),
          },
        ]} />

      {periods.length > 0 && (
        <ActionForm action={copyTargetsForm} className="panel stack">
          <h2 style={{ margin: 0 }}>Repeat for the next period</h2>
          <label className="field"><span>Copy the targets of</span>
            <select name="period" defaultValue={periods[0].key}>
              {periods.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <span className="small muted">Same people, categories and bands. A whole month copies to the next month; anyone who already has a target starting then is skipped.</span>
          <div><SubmitButton className="btn">Copy targets</SubmitButton></div>
        </ActionForm>
      )}

      <ActionForm action={newTargetForm} className="panel stack">
        <h2 style={{ margin: 0 }}>New target</h2>
        <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, gap: 4, columnGap: 16 }}>
          <legend className="small muted" style={{ marginBottom: 4 }}>Employees (each gets their own target)</legend>
          {people.map((p) => <label key={p.id} className="check"><input type="checkbox" name="personIds" value={p.id} /> {p.fullName}</label>)}
        </fieldset>
        <div className="grid3">
          <label className="field"><span>From</span><input type="date" name="periodStart" required /></label>
          <label className="field"><span>To</span><input type="date" name="periodEnd" required /></label>
          <label className="field"><span>Judged</span>
            <select name="cadence" defaultValue="DAILY"><option value="DAILY">Each day on its own</option><option value="PERIOD">Whole period total</option></select>
          </label>
          <label className="field"><span>Bonus</span>
            <select name="mode" defaultValue="FIXED">
              <option value="FIXED">Fixed amount (Rs) at the band reached</option>
              <option value="FLAT">% of sales at the band reached</option>
              <option value="PROGRESSIVE">% of each slice at its own band</option>
            </select>
          </label>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small muted" style={{ marginBottom: 4 }}>Categories that count (sub-categories included). Leave all unticked to count every category.</legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", columnGap: 16 }}>
            {tree.map((c) => <label key={c.id} className="check" style={{ paddingLeft: c.depth * 18 }}><input type="checkbox" name="categoryIds" value={c.id} /> {c.name}</label>)}
          </div>
        </fieldset>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="row" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ width: 140 }}><span>Sales from</span><input name={`from${i}`} inputMode="decimal" placeholder={i === 0 ? "20000" : i === 1 ? "40000" : ""} /></label>
            <label className="field" style={{ width: 140 }}><span>to (blank = no top)</span><input name={`to${i}`} inputMode="decimal" placeholder={i === 0 ? "40000" : ""} /></label>
            <label className="field" style={{ width: 120 }}><span>Bonus (Rs or %)</span><input name={`bonus${i}`} inputMode="decimal" placeholder={i === 0 ? "500" : i === 1 ? "1200" : ""} /></label>
          </div>
        ))}
        <div><SubmitButton>Save target</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
