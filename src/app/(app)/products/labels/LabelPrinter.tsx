"use client";

import { useState } from "react";
import { listLayers, type LayerHit, type ProductHit } from "../../search";
import { ProductSearch } from "@/components/ProductSearch";
import { Barcode } from "@/components/Barcode";

type Template = { id: string; name: string; widthMm: number; heightMm: number; columns: number; gapMm: number; showName: boolean; showPrice: boolean; showLot: boolean; showBusiness: boolean };
type Row = { key: string; product: ProductHit; layers: LayerHit[]; lot: string; copies: number };

export function LabelPrinter({ templates, business }: { templates: Template[]; business: string }) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>([]);
  const t = templates.find((x) => x.id === templateId) ?? templates[0];
  const update = (k: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
  const add = async (p: ProductHit) => {
    const key = crypto.randomUUID();
    const available = Math.max(1, Math.min(100, Math.floor(Number(p.available ?? 1)) || 1));
    setRows((rs) => [...rs, { key, product: p, layers: [], lot: "", copies: available }]);
    const layers = await listLayers(p.id);
    update(key, { layers, lot: layers[0]?.lotCode ?? "" });
  };
  const labels = rows.flatMap((r) => Array.from({ length: Math.max(0, Math.min(500, r.copies)) }, (_, i) => ({ ...r, i })));

  return (
    <div className="stack">
      <section className="panel stack label-controls">
        <div className="grid2">
          <label className="field"><span>Label size</span>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>{templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          </label>
          <div className="field"><span>Add products</span><ProductSearch onPick={add} /></div>
        </div>
        {rows.map((r) => (
          <div key={r.key} className="row" style={{ borderTop: "1px solid var(--rule)", paddingTop: 8 }}>
            <span style={{ flex: "1 1 200px" }}>{r.product.sku} · {r.product.name}</span>
            {t?.showLot && (
              <select style={{ width: 170 }} value={r.lot} onChange={(e) => update(r.key, { lot: e.target.value })} aria-label="Lot">
                <option value="">No lot</option>{r.layers.map((l) => <option key={l.id} value={l.lotCode ?? ""}>{l.lotCode ?? "No lot"} · {Number(l.qtyRemaining)}</option>)}
              </select>
            )}
            <input style={{ width: 90 }} type="number" min={0} max={500} value={r.copies} onChange={(e) => update(r.key, { copies: Number(e.target.value) || 0 })} aria-label="Copies" />
            <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>Remove</button>
          </div>
        ))}
        <div className="row">
          <span className="small muted">{labels.length} label(s). Barcode = product barcode, or SKU if it has none. Test one label first on a new printer or roll.</span>
          <div className="spacer" />
          <button className="btn btn-primary" disabled={!labels.length} onClick={() => window.print()}>Print labels</button>
        </div>
      </section>

      {t && labels.length > 0 && (
        <>
          <style>{`@page { size: ${t.columns === 1 ? `${t.widthMm}mm ${t.heightMm}mm` : "A4"}; margin: ${t.columns === 1 ? 0 : "8mm"}; }`}</style>
          <div className="label-sheet" style={{ gridTemplateColumns: `repeat(${t.columns}, ${t.widthMm}mm)`, gap: `${t.gapMm}mm` }}>
            {labels.map((l) => (
              <div key={`${l.key}-${l.i}`} className="label" style={{ width: `${t.widthMm}mm`, height: `${t.heightMm}mm`, breakInside: "avoid" }}>
                {t.showBusiness && <div className="l-meta">{business}</div>}
                {t.showName && <div className="l-name">{l.product.name}</div>}
                <Barcode value={l.product.barcode || l.product.sku} height={Math.max(18, t.heightMm * 1.3)} />
                <div className="row" style={{ gap: 6, justifyContent: "center" }}>
                  {t.showPrice && <span className="l-price">Rs. {Number(l.product.price).toLocaleString("en-LK")}</span>}
                  {t.showLot && l.lot && <span className="l-meta">Lot {l.lot}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
