"use client";

import { useActionState } from "react";
import { saveLayout, addPrinter } from "../printing-actions";
import { SubmitButton } from "@/components/SubmitButton";

type Layout = { headerText: string; footerText: string; showLot: boolean; showWarranty: boolean; showImei: boolean; showCustomerDue: boolean; showBarcode: boolean; paper: string };

export function LayoutForm({ layout }: { layout: Layout }) {
  const [state, action] = useActionState(saveLayout, undefined);
  return (
    <form action={action} className="panel stack">
      <h2 style={{ margin: 0 }}>Invoice & receipt layout</h2>
      <div className="grid2">
        <label className="field"><span>Header line (address, hotline, reg. no.)</span><textarea name="headerText" defaultValue={layout.headerText} rows={2} /></label>
        <label className="field"><span>Footer (terms, warranty policy, thanks)</span><textarea name="footerText" defaultValue={layout.footerText} rows={2} /></label>
        <label className="field"><span>Default paper</span>
          <select name="paper" defaultValue={layout.paper}><option value="80mm">80 mm thermal</option><option value="58mm">58 mm thermal</option><option value="A4">A4 / PDF</option></select>
        </label>
      </div>
      <div className="row" style={{ gap: 16 }}>
        <label className="check"><input type="checkbox" name="showLot" defaultChecked={layout.showLot} /> Lot numbers</label>
        <label className="check"><input type="checkbox" name="showWarranty" defaultChecked={layout.showWarranty} /> Warranty</label>
        <label className="check"><input type="checkbox" name="showImei" defaultChecked={layout.showImei} /> IMEI / serial</label>
        <label className="check"><input type="checkbox" name="showCustomerDue" defaultChecked={layout.showCustomerDue} /> Customer&apos;s total due</label>
        <label className="check"><input type="checkbox" name="showBarcode" defaultChecked={layout.showBarcode} /> Invoice barcode</label>
      </div>
      {state?.error && <p className="note note-err">{state.error}</p>}
      {state?.ok && <p className="note note-ok">{state.ok}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton>Save layout</SubmitButton></div>
    </form>
  );
}

export function PrinterForm({ locations }: { locations: { id: string; name: string }[] }) {
  const [state, action] = useActionState(addPrinter, undefined);
  return (
    <form action={action} className="panel stack">
      <h2 style={{ margin: 0 }}>Add printer</h2>
      <div className="grid3">
        <label className="field"><span>Name</span><input name="name" required placeholder="Counter receipt printer" /></label>
        <label className="field"><span>Used for</span><select name="kind"><option value="RECEIPT">Receipts / invoices</option><option value="LABEL">Labels</option><option value="A4">A4 documents</option></select></label>
        <label className="field"><span>Paper</span><select name="paper"><option value="80mm">80 mm</option><option value="58mm">58 mm</option><option value="A4">A4</option></select></label>
        <label className="field"><span>Location</span><select name="locationId"><option value="">All locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="field" style={{ gridColumn: "span 2" }}><span>Notes (model, how it is connected)</span><input name="notes" /></label>
      </div>
      {state?.error && <p className="note note-err">{state.error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}><SubmitButton>Add printer</SubmitButton></div>
    </form>
  );
}
