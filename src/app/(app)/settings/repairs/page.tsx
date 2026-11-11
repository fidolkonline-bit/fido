import { requirePermission } from "@/lib/auth";
import { getRepairSettings } from "@/lib/repairs";
import { PageHead } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { saveRepairSettings } from "../../repairs/actions";

export const metadata = { title: "Repair settings" };

export default async function RepairSettings() {
  await requirePermission("settings.manage");
  const s = await getRepairSettings();
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <PageHead eyebrow="Settings" title="Repair terms & technician commission" />
      <ActionForm action={saveRepairSettings} className="panel stack">
        <label className="field"><span>Terms the customer accepts at intake (shown on screen, saved with each job, printed on the bill)</span>
          <textarea name="terms" rows={9} defaultValue={s.terms} maxLength={3000} />
        </label>
        <label className="field" style={{ maxWidth: 280 }}><span>Technician commission (% of labour charged)</span>
          <input name="commissionPct" type="number" min="0" max="100" step="0.01" defaultValue={s.commissionPct} inputMode="decimal" />
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          The commission is earned by the assigned technician when the customer collects the device, on labour less any discount (parts are not included).
          It appears under HRM › Commission payout with sales commission and is approved and paid the same way. 0 switches it off.
        </p>
        <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton>Save</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
