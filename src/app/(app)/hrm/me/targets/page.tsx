import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { money, fmtDate } from "@/lib/money";
import { targetResult } from "@/lib/targets";
import { bandText, MODE_LABEL, nextBand, type Band } from "@/lib/target-calc";
import * as H from "@/lib/hr";
import { PageHead, DataTable, Badge, Stat } from "@/components/ui";
import { DaysDetail, type Day } from "../../targets/DaysDetail";
import { CreditCommission } from "./CreditCommission";

export const metadata = { title: "My targets" };

type Snapshot = { achieved: string; earning: string; categories?: string[] | null; days?: Day[] };

const plain = (n: number) => new Intl.NumberFormat("en-LK", { maximumFractionDigits: 2 }).format(n);

// The signed-in person's own sales targets and bonuses (§9.3). No extra permission needed, and never anyone else's.
// Until the owner approves a target the figures are live and can still drop (returns, voided sales).
export default async function MyTargets() {
  const user = await requireUser();
  const [targets, categories] = await Promise.all([
    db.salesTarget.findMany({
      where: { personId: user.personId }, orderBy: [{ periodStart: "desc" }, { createdAt: "asc" }], take: 40,
      include: { payslip: { select: { id: true, run: { select: { number: true } } } } },
    }),
    db.category.findMany({ select: { id: true, name: true } }),
  ]);
  if (!targets.length) {
    return (
      <div className="stack">
        <PageHead eyebrow="HRM" title="My targets" />
        <p className="note" style={{ maxWidth: 600 }}>You don&apos;t have a sales target yet. When the owner sets one under HRM → Sales targets, it shows here with your progress.</p>
        <CreditCommission personId={user.personId} />
      </div>
    );
  }

  const today = H.todayYmd();
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const rows = await Promise.all(targets.map(async (t) => {
    const snap = t.snapshot as Snapshot | null;
    const start = H.dateOnlyYmd(t.periodStart), end = H.dateOnlyYmd(t.periodEnd);
    const upcoming = start > today;
    let achieved = "0", bonus = "0", days: Day[] | null = null;
    if (snap) {
      achieved = snap.achieved; bonus = snap.earning; days = snap.days ?? null;
    } else if (!upcoming) {
      const r = await targetResult(t);
      achieved = r.value.toString(); bonus = r.earning.toString();
      days = r.days?.map((d) => ({ day: d.day, value: d.value.toString(), earning: d.earning.toString() })) ?? null;
    }
    const cats = snap?.categories !== undefined ? snap.categories : t.categoryIds.length ? t.categoryIds.map((id) => catName.get(id) ?? "deleted category") : null;
    const status = t.payslip ? "PAID" : t.approvedAt ? "APPROVED" : upcoming ? "UPCOMING" : end >= today ? "RUNNING" : "ENDED";
    return { t, achieved, bonus, days, cats, status, bands: t.bands as Band[] };
  }));

  const sum = (s: string[]) => rows.filter((r) => s.includes(r.status)).reduce((a, r) => a + Number(r.bonus), 0);
  const running = rows.filter((r) => r.status === "RUNNING");
  const upcoming = rows.filter((r) => r.status === "UPCOMING");
  const past = rows.filter((r) => !["RUNNING", "UPCOMING"].includes(r.status));

  return (
    <div className="stack">
      <PageHead eyebrow="HRM" title="My targets" />
      <p className="small muted" style={{ margin: 0 }}>
        Target bonuses are separate from your <Link href="/hrm/me/commission">sales commission</Link>. Only items in the target&apos;s categories count, after discounts and returns; reloads never count.
        Until the owner approves a target, its figures are <strong>so far, not final</strong>: a later return can still lower them. Approved bonuses are paid in the next payroll.
      </p>

      <div className="stats">
        <Stat label="Bonus so far" value={money(sum(["RUNNING", "ENDED"]))} basis="Not final until approved" />
        <Stat label="Approved" value={money(sum(["APPROVED"]))} basis="Paid in the next payroll" />
        <Stat label="Paid" value={money(sum(["PAID"]))} basis="Through payroll" />
      </div>

      {running.length > 0 && (
        <section className="stack">
          <h2 style={{ margin: 0 }}>Running now</h2>
          {running.map((r) => {
            const daily = r.t.cadence === "DAILY";
            const todays = daily ? r.days?.find((d) => d.day === today) ?? { day: today, value: "0", earning: "0" } : null;
            const current = todays ? todays.value : r.achieved;
            const next = nextBand(current, r.bands);
            return (
              <section key={r.t.id} className="panel stack" style={{ gap: 10 }}>
                <TargetHead t={r.t} cats={r.cats} bands={r.bands} />
                <div className="stats" style={{ borderBottom: 0, paddingBottom: 0 }}>
                  {todays && <Stat label="Sold today" value={money(todays.value)} basis={Number(todays.earning) > 0 ? `Bonus today ${money(todays.earning)}` : "No bonus yet today"} />}
                  <Stat label={daily ? "Sold this period" : "Sold so far"} value={money(r.achieved)} basis={`${fmtDate(r.t.periodStart)} – ${fmtDate(r.t.periodEnd)}`} />
                  <Stat label="Bonus so far" value={money(r.bonus)} basis="Not final" />
                </div>
                <p className={`note${next ? "" : " note-ok"}`} style={{ margin: 0 }}>
                  {next
                    ? <>{next.more.gt(0) ? <>Sell <strong>{money(next.more)}</strong> more{daily ? " today" : ""}</> : <>Make a sale{daily ? " today" : ""}</>} to {r.t.mode === "FIXED" ? <>earn <strong>{money(next.band.amount ?? 0)}</strong></> : <>reach the <strong>{next.band.percent ?? 0}%</strong> band</>}.</>
                    : <>Top band reached{daily ? " today" : ""}.</>}
                </p>
                {r.days?.length ? <DaysDetail days={r.days} /> : null}
              </section>
            );
          })}
        </section>
      )}

      {upcoming.length > 0 && (
        <section className="stack">
          <h2 style={{ margin: 0 }}>Coming up</h2>
          {upcoming.map((r) => (
            <section key={r.t.id} className="panel stack" style={{ gap: 6 }}>
              <TargetHead t={r.t} cats={r.cats} bands={r.bands} />
              <span className="small muted">Starts {fmtDate(r.t.periodStart)}, ends {fmtDate(r.t.periodEnd)}.</span>
            </section>
          ))}
        </section>
      )}

      <CreditCommission personId={user.personId} />

      {past.length > 0 && (
        <section>
          <h2>Past targets</h2>
          <DataTable rows={past} rowKey={(r) => r.t.id}
            columns={[
              { label: "Period", primary: true, render: (r) => `${fmtDate(r.t.periodStart)} – ${fmtDate(r.t.periodEnd)}` },
              { label: "Target", render: (r) => <TargetHead t={r.t} cats={r.cats} bands={r.bands} small /> },
              { label: "Sold", num: true, render: (r) => <div style={{ display: "grid", gap: 2 }}><span>{money(r.achieved)}</span>{r.days?.length ? <DaysDetail days={r.days} /> : null}</div> },
              { label: "Bonus", num: true, render: (r) => money(r.bonus) },
              {
                label: "", render: (r) => r.t.payslip ? <Link href={`/hrm/payslips/${r.t.payslip.id}`}><Badge tone="ok">Paid · {r.t.payslip.run.number}</Badge></Link>
                  : r.status === "APPROVED" ? <Badge tone="warn">Approved — next payroll</Badge>
                  : <Badge>Waiting for approval</Badge>,
              },
            ]} />
        </section>
      )}
    </div>
  );
}

function TargetHead({ t, cats, bands, small }: { t: { cadence: string; mode: string }; cats: string[] | null | undefined; bands: Band[]; small?: boolean }) {
  return (
    <div className="small" style={{ display: "grid", gap: 2 }}>
      <span>{small ? <strong>{t.cadence === "DAILY" ? "Daily" : "Whole period"}</strong> : <strong style={{ fontSize: 15 }}>{t.cadence === "DAILY" ? "Daily target" : "Whole-period target"}</strong>} · {MODE_LABEL[t.mode] ?? t.mode.toLowerCase()}</span>
      <span className="muted">{cats?.length ? cats.join(", ") : "All categories"}</span>
      <span>{bands.map((b) => bandText(b, t.mode, plain)).join(" · ")}</span>
    </div>
  );
}
