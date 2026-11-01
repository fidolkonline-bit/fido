"use client";

import { useActionState, useState, useTransition } from "react";
import { newGeneralTask, submitParcel, parcelStep } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

type Opt = { id: string; name: string };

export function GeneralTaskForm({ staff }: { staff: Opt[] }) {
  const [state, action] = useActionState(newGeneralTask, undefined);
  return (
    <form action={action} className="panel stack">
      <h2 style={{ margin: 0 }}>Send a task</h2>
      <div className="grid3">
        <label className="field" style={{ gridColumn: "span 2" }}><span>What needs doing</span><input name="title" required /></label>
        <label className="field"><span>To</span><select name="assignedToId"><option value="">Anyone on shift</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="field" style={{ gridColumn: "span 2" }}><span>Details</span><input name="details" /></label>
        <label className="field"><span>Due</span><input name="dueAt" type="datetime-local" /></label>
      </div>
      <div className="row"><label className="check"><input type="checkbox" name="urgent" /> Urgent</label><div className="spacer" /><SubmitButton>Send task</SubmitButton></div>
      {state?.error && <p className="error-text">{state.error}</p>}
      {state?.ok && <p className="small" style={{ color: "var(--ok)" }}>{state.ok}</p>}
    </form>
  );
}

export function ParcelForm({ staff, locations, defaultLocationId }: { staff: Opt[]; locations: Opt[]; defaultLocationId: string }) {
  const [key] = useState(() => crypto.randomUUID());
  const [f, setF] = useState({ sender: "", contents: "", packages: "1", busNumber: "", route: "", crewPhone: "", departureAt: "", etaAt: "", pickupStop: "", charges: "", locationId: defaultLocationId, assignedToId: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="panel stack">
      <div className="grid3">
        <label className="field"><span>Sender / supplier *</span><input value={f.sender} onChange={set("sender")} /></label>
        <label className="field" style={{ gridColumn: "span 2" }}><span>Contents *</span><input value={f.contents} onChange={set("contents")} placeholder="2 boxes — chargers and covers" /></label>
        <label className="field"><span>Bus number</span><input value={f.busNumber} onChange={set("busNumber")} placeholder="NB-1234" autoCapitalize="characters" /></label>
        <label className="field"><span>Route</span><input value={f.route} onChange={set("route")} placeholder="Colombo – Kandy" /></label>
        <label className="field"><span>Driver / conductor mobile</span><input value={f.crewPhone} onChange={set("crewPhone")} type="tel" inputMode="tel" /></label>
        <label className="field"><span>Left at</span><input value={f.departureAt} onChange={set("departureAt")} type="datetime-local" /></label>
        <label className="field"><span>Expected arrival (ETA)</span><input value={f.etaAt} onChange={set("etaAt")} type="datetime-local" /></label>
        <label className="field"><span>Pickup stop</span><input value={f.pickupStop} onChange={set("pickupStop")} /></label>
        <label className="field"><span>Packages</span><input value={f.packages} onChange={set("packages")} inputMode="numeric" /></label>
        <label className="field"><span>Bus charge (Rs.)</span><input value={f.charges} onChange={set("charges")} inputMode="decimal" /></label>
        <label className="field"><span>Shop</span><select value={f.locationId} onChange={set("locationId")}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="field"><span>Who collects</span><select value={f.assignedToId} onChange={set("assignedToId")}><option value="">Anyone on shift</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      </div>
      <label className="field"><span>Notes</span><input value={f.notes} onChange={set("notes")} /></label>
      <p className="small muted" style={{ margin: 0 }}>The staff member is alerted now, reminded before the ETA, and you are told if nobody acknowledges within 5 minutes.</p>
      {error && <p className="note note-err" role="alert">{error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" disabled={pending || !f.sender || !f.contents} onClick={() => start(async () => {
          setError(null);
          const r = await submitParcel({
            idempotencyKey: key, ...f, packages: Number(f.packages) || 1, charges: Number(f.charges) || 0,
            departureAt: f.departureAt ? new Date(f.departureAt) : null, etaAt: f.etaAt ? new Date(f.etaAt) : null,
            busNumber: f.busNumber || null, route: f.route || null, crewPhone: f.crewPhone || null, pickupStop: f.pickupStop || null,
            assignedToId: f.assignedToId || null, notes: f.notes || null,
          });
          if (r?.error) setError(r.error);
        })}>{pending ? "Sending…" : "Send to staff"}</button>
      </div>
    </section>
  );
}

export function ParcelStep({ parcelId, step, label, primary, withCheck }: { parcelId: string; step: string; label: string; primary?: boolean; withCheck?: boolean }) {
  const [state, action] = useActionState(parcelStep, undefined);
  const [ok, setOk] = useState("yes");
  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <input type="hidden" name="parcelId" value={parcelId} /><input type="hidden" name="step" value={step} />
      {withCheck && (
        <>
          <div className="row">
            <label className="check"><input type="radio" name="ok" value="yes" checked={ok === "yes"} onChange={() => setOk("yes")} /> Everything is there and OK</label>
            <label className="check"><input type="radio" name="ok" value="no" checked={ok === "no"} onChange={() => setOk("no")} /> Something is missing / damaged</label>
          </div>
          <input name="notes" placeholder={ok === "no" ? "What is missing or damaged? (required)" : "Note (optional)"} />
        </>
      )}
      <div><SubmitButton className={primary ? "btn btn-primary" : step === "cancel" ? "btn btn-danger" : "btn"}>{label}</SubmitButton></div>
      {state?.error && <p className="error-text" style={{ margin: 0 }}>{state.error}</p>}
    </form>
  );
}
