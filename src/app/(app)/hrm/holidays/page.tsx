import { requirePermission, can } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/money";
import * as H from "@/lib/hr";
import { PageHead, DataTable } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { addHoliday, removeHoliday } from "../actions";

export const metadata = { title: "Holidays" };

export default async function Holidays({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const user = await requirePermission("hr.view");
  const { year = H.todayYmd().slice(0, 4) } = await searchParams;
  const [holidays, locations] = await Promise.all([
    db.holiday.findMany({ where: { startDate: { gte: H.dateOnly(`${year}-01-01`), lte: H.dateOnly(`${year}-12-31`) } }, orderBy: { startDate: "asc" }, include: { location: true } }),
    db.location.findMany({ where: { active: true } }),
  ]);
  const today = H.todayYmd();
  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <PageHead eyebrow="HRM" title={`Holidays ${year}`} actions={<><a className="btn btn-sm" href={`?year=${Number(year) - 1}`}>{Number(year) - 1}</a><a className="btn btn-sm" href={`?year=${Number(year) + 1}`}>{Number(year) + 1}</a></>} />
      <p className="small muted" style={{ margin: 0 }}>Enter each public / Poya holiday the shop observes — nothing is assumed. Holidays are not counted as working days or as leave taken.</p>
      <DataTable rows={holidays} rowKey={(h) => h.id} empty="No holidays entered for this year."
        columns={[
          { label: "Holiday", primary: true, render: (h) => h.name },
          { label: "Date", render: (h) => `${fmtDate(h.startDate)}${h.endDate.getTime() !== h.startDate.getTime() ? ` – ${fmtDate(h.endDate)}` : ""}` },
          { label: "Locations", render: (h) => h.location?.name ?? "All" },
          { label: "Note", render: (h) => h.note ?? "" },
          { label: "", render: (h) => can(user, "hr.manage") && H.dateOnlyYmd(h.startDate) > today ? <form action={removeHoliday}><input type="hidden" name="id" value={h.id} /><button className="btn btn-sm btn-ghost btn-danger">Remove</button></form> : null },
        ]} />
      {can(user, "hr.manage") && (
        <section className="panel">
          <h2>Add holiday</h2>
          <ActionForm action={addHoliday}>
            <div className="grid3">
              <label className="field"><span>Name</span><input name="name" required placeholder="Il Full Moon Poya Day" /></label>
              <label className="field"><span>From</span><input type="date" name="startDate" required /></label>
              <label className="field"><span>To (if more than one day)</span><input type="date" name="endDate" /></label>
              <label className="field"><span>Location</span><select name="locationId"><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
              <label className="field" style={{ gridColumn: "span 2" }}><span>Note</span><input name="note" /></label>
            </div>
            <div><SubmitButton>Add holiday</SubmitButton></div>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
