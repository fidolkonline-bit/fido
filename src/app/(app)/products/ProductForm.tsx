"use client";

import { useActionState } from "react";
import Link from "next/link";
import { saveProduct } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

type Opt = { id: string; name: string };
type Product = {
  id: string; sku: string; name: string; barcode: string | null; categoryId: string | null; brandId: string | null;
  unitId: string | null; warrantyId: string | null; sellPrice: string; minSellPrice: string | null; defaultCost: string;
  alertQty: string; stockManaged: boolean; trackDevices: boolean; notForSale: boolean; description: string | null;
};

export function ProductForm({ product, categories, brands, units, warranties, showCost }: {
  product?: Product; categories: Opt[]; brands: Opt[]; units: Opt[]; warranties: Opt[]; showCost: boolean;
}) {
  const [state, action] = useActionState(saveProduct, undefined);
  const p = product;
  return (
    <form action={action} className="panel stack">
      {p && <input type="hidden" name="id" value={p.id} />}
      <h2 style={{ margin: 0 }}>Essentials</h2>
      <div className="grid2">
        <label className="field"><span>Product name *</span><input name="name" defaultValue={p?.name} required /></label>
        <label className="field"><span>SKU *</span><input name="sku" defaultValue={p?.sku} required autoCapitalize="characters" /></label>
        <label className="field"><span>Barcode</span><input name="barcode" defaultValue={p?.barcode ?? ""} inputMode="numeric" /></label>
        <label className="field"><span>Category</span>
          <select name="categoryId" defaultValue={p?.categoryId ?? ""}><option value="">— None —</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className="field"><span>Brand</span>
          <select name="brandId" defaultValue={p?.brandId ?? ""}><option value="">— None —</option>{brands.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
        <label className="field"><span>Unit</span>
          <select name="unitId" defaultValue={p?.unitId ?? ""}><option value="">— None —</option>{units.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
      </div>

      <h2 style={{ margin: "6px 0 0" }}>Pricing</h2>
      <div className="grid3">
        <label className="field"><span>Selling price (Rs.)</span><input name="sellPrice" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={p?.sellPrice ?? "0"} /></label>
        <label className="field"><span>Minimum selling price</span><input name="minSellPrice" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={p?.minSellPrice ?? ""} /></label>
        {showCost ? (
          <label className="field"><span>Default purchase cost</span><input name="defaultCost" type="number" step="0.0001" min="0" inputMode="decimal" defaultValue={p?.defaultCost ?? "0"} /></label>
        ) : (
          <input type="hidden" name="defaultCost" value={p?.defaultCost ?? "0"} />
        )}
      </div>

      <h2 style={{ margin: "6px 0 0" }}>Stock & warranty</h2>
      <div className="grid3">
        <label className="field"><span>Alert quantity</span><input name="alertQty" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={p?.alertQty ?? "0"} /></label>
        <label className="field"><span>Warranty</span>
          <select name="warrantyId" defaultValue={p?.warrantyId ?? ""}><option value="">— None —</option>{warranties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </label>
      </div>
      <div className="row" style={{ gap: 18 }}>
        <label className="check"><input type="checkbox" name="stockManaged" defaultChecked={p?.stockManaged ?? true} /> Manage stock</label>
        <label className="check"><input type="checkbox" name="trackDevices" defaultChecked={p?.trackDevices ?? false} /> Track IMEI / serial</label>
        <label className="check"><input type="checkbox" name="notForSale" defaultChecked={p?.notForSale ?? false} /> Not for selling</label>
      </div>
      <details>
        <summary className="small" style={{ cursor: "pointer", padding: "6px 0" }}>Advanced: description</summary>
        <label className="field" style={{ marginTop: 8 }}><span>Description</span><textarea name="description" defaultValue={p?.description ?? ""} /></label>
      </details>

      {state?.error && <p className="note note-err" role="alert">{state.error}</p>}
      <div className="form-actions" style={{ marginTop: 0 }}>
        <Link className="btn" href={p ? `/products/${p.id}` : "/products"}>Cancel</Link>
        <SubmitButton>{p ? "Save changes" : "Create product"}</SubmitButton>
      </div>
    </form>
  );
}
