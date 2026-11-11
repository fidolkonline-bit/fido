import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHead } from "@/components/ui";
import { SwitchForm } from "./SwitchForm";

export const metadata = { title: "Switch cashier" };

export default async function SwitchCashier() {
  const user = await requireUser();
  const loc = user.location;
  const accounts = await db.loginAccount.findMany({
    where: {
      pinHash: { not: null }, allowLogin: true, person: { active: true }, id: { not: user.accountId },
      OR: [{ role: { permissions: { has: "settings.manage" } } }, ...(loc ? [{ locations: { some: { locationId: loc.id } } }] : [])],
    },
    include: { person: true, role: true },
    orderBy: { person: { fullName: "asc" } },
  });
  return (
    <div className="stack">
      <PageHead eyebrow={loc?.name ?? "No location"} title="Switch cashier" />
      {accounts.length ? (
        <SwitchForm people={accounts.map((a) => ({ accountId: a.id, name: a.person.fullName, role: a.role.name }))} />
      ) : (
        <p className="note">Nobody else at this location has a PIN yet. Each person sets their own under Settings › My PIN.</p>
      )}
      <p className="small muted">Signed in now: {user.name}. Switching signs this person out of this device. A switched session ends after 16 hours.</p>
    </div>
  );
}
