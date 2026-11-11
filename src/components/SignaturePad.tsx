"use client";

import { useEffect, useRef, useState } from "react";

// Finger / stylus signature. Gives a small PNG data URL (dark ink, transparent paper) or null when empty.
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [signed, setSigned] = useState(false);

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1c2420";
  }, []);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!; const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = ref.current!.getContext("2d")!; const p = at(e);
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext("2d")!; const p = at(e);
    ctx.lineTo(p.x, p.y); ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setSigned(true);
    onChange(ref.current!.toDataURL("image/png"));
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setSigned(false);
    onChange(null);
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      <canvas ref={ref} width={520} height={160} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        aria-label="Customer signature" style={{ width: "100%", maxWidth: 520, height: 160, background: "#fff", border: "1px dashed var(--line, #999)", borderRadius: 8, touchAction: "none" }} />
      <div className="row"><span className="small muted">{signed ? "Signed" : "Customer signs here with a finger"}</span><div className="spacer" />{signed && <button type="button" className="btn btn-sm" onClick={clear}>Clear</button>}</div>
    </div>
  );
}
