import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/money";
import { getRepairSettings } from "@/lib/repairs";
import { PageHead } from "@/components/ui";
import { IntakeForm, type IntakePrefill } from "../IntakeForm";

export const metadata = { title: "Repair intake" };

export default async function NewRepair({ searchParams }: { searchParams: Promise<{ claim?: string; device?: string }> }) {
  const user = await requirePermission("repairs.manage");
  const { claim, device } = await searchParams;
  const [technicians, settings, line] = await Promise.all([
    db.person.findMany({ where: { active: true, login: { role: { permissions: { has: "repairs.manage" } } } }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    getRepairSettings(),
    claim ? db.saleLine.findUnique({ where: { id: claim }, include: { sale: { include: { customer: true } }, devices: true } }) : null,
  ]);
  // Opened from Warranty lookup: the customer, device and the link to the original sale are filled in.
  let prefill: IntakePrefill | undefined;
  if (line) {
    const d = device ? line.devices.find((x) => x.id === device) ?? null : null;
    const until = d?.warrantyUntil ?? line.warrantyUntil;
    const c = line.sale.customer;
    prefill = {
      customer: c ? { id: c.id, name: c.name, phone: c.phone } : null, deviceModel: line.nameSnapshot.slice(0, 100), imei: d?.imei1 ?? "", serial: d?.serial ?? "",
      claim: { saleLineId: line.id, deviceId: d?.id ?? null, inWarranty: !!until && until.getTime() >= Date.now(), label: `sold on ${line.sale.number}, ${fmtDate(line.sale.soldAt)}${until ? `, warranty until ${fmtDate(until)}` : ", no warranty"}` },
    };
  }
  return (
    <div style={{ maxWidth: 900 }}>
      <PageHead eyebrow={`Repair / ${user.location?.name ?? ""}`} title={prefill?.claim?.inWarranty ? "Warranty claim intake" : "Repair intake"} />
      <IntakeForm technicians={technicians.map((t) => ({ id: t.id, name: t.fullName }))} terms={settings.terms} prefill={prefill} />
    </div>
  );
}
