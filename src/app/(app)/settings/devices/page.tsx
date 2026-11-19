import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentDevice, getAttendanceSettings } from "@/lib/shop-device";
import { fmtDateTime } from "@/lib/money";
import { PageHead, DataTable, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { registerThisDevice, saveAttendance, unregisterDeviceForm } from "./actions";

export const metadata = { title: "Shop devices" };

export default async function ShopDevices() {
  const user = await requirePermission("settings.manage");
  const [here, settings, devices, locations] = await Promise.all([
    currentDevice(),
    getAttendanceSettings(),
    db.shopDevice.findMany({ orderBy: [{ revokedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }], include: { location: true, registeredBy: true } }),
    db.location.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <PageHead eyebrow="Settings" title="Shop devices" />
      <p className="muted" style={{ margin: 0 }}>
        Register the computers and tablets that stay in a shop. Signing in on one clocks an employee in and opens the start-of-day screen, and everyone is
        signed out every night at the cutoff, so staff sign in again each morning. Phones and computers at home are not registered: signing in there never
        clocks anyone in, and keeps the normal sign-in.
      </p>

      <section className="panel stack">
        <h2 style={{ margin: 0 }}>This device</h2>
        {here ? (
          <>
            <p style={{ margin: 0 }}>
              Registered as <strong>{here.name}</strong> at {here.location.name}. Your sign-in here ends {fmtDateTime(user.expiresAt)}.
            </p>
            <ActionForm action={unregisterDeviceForm} className="row">
              <input type="hidden" name="id" value={here.id} />
              <SubmitButton className="btn" pendingText="Unregistering…">Unregister this device</SubmitButton>
            </ActionForm>
          </>
        ) : (
          <ActionForm action={registerThisDevice} className="stack">
            <p className="small muted" style={{ margin: 0 }}>This browser is not a shop device. Register it only if it stays in the shop.</p>
            <div className="grid2">
              <label className="field"><span>Name</span><input name="name" required maxLength={60} placeholder="e.g. Main shop till" /></label>
              <label className="field"><span>Shop</span>
                <select name="locationId" defaultValue={user.location?.id ?? locations[0]?.id} required>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            </div>
            <p className="small muted" style={{ margin: 0 }}>Your own sign-in on this browser will also end at the next cutoff ({settings.dayCutoff}).</p>
            <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton pendingText="Registering…">Register this device</SubmitButton></div>
          </ActionForm>
        )}
      </section>

      <section className="stack">
        <h2 style={{ margin: 0 }}>All shop devices</h2>
        <DataTable rows={devices} rowKey={(d) => d.id} empty="No shop devices yet. Open this page on the shop computer and register it."
          columns={[
            { label: "Device", primary: true, render: (d) => <>{d.name}{d.id === here?.id && <> <Badge tone="ok">This one</Badge></>}</> },
            { label: "Shop", render: (d) => d.location.name },
            { label: "Registered", render: (d) => `${fmtDateTime(d.createdAt)} by ${d.registeredBy.fullName}` },
            { label: "Last sign-in", render: (d) => fmtDateTime(d.lastSeenAt) },
            { label: "Status", render: (d) => (d.revokedAt ? <Badge>Unregistered {fmtDateTime(d.revokedAt)}</Badge> : <Badge tone="ok">Active</Badge>) },
            {
              label: "Action", render: (d) => d.revokedAt ? "—" : (
                <ActionForm action={unregisterDeviceForm} className="row">
                  <input type="hidden" name="id" value={d.id} />
                  <SubmitButton className="btn btn-sm" pendingText="…">Unregister</SubmitButton>
                </ActionForm>
              ),
            },
          ]} />
      </section>

      <ActionForm action={saveAttendance} className="panel stack" style={{ maxWidth: 560 }}>
        <h2 style={{ margin: 0 }}>Attendance and nightly sign-out</h2>
        <label className="check"><input type="checkbox" name="autoClockIn" defaultChecked={settings.autoClockIn} /> Signing in on a shop device clocks the employee in</label>
        <label className="field"><span>Shop devices sign out at</span><input name="dayCutoff" type="time" defaultValue={settings.dayCutoff} required /></label>
        <p className="small muted" style={{ margin: 0 }}>
          Pick a time after the shop closes and before anyone starts, for example 02:00. It applies to new sign-ins; people already signed in keep the time they got.
          With clock-in off, staff use the Clock in button on the start-of-day screen instead.
        </p>
        <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton>Save</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
