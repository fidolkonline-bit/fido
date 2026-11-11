"use client";

import { useRef, useState, useTransition } from "react";
import { addRepairPhoto } from "./actions";

// Phone cameras produce 5–12 MB photos: shrink to 1600 px JPEG in the browser before sending.
async function shrink(file: File): Promise<Blob> {
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.8));
}

export function PhotoUpload({ jobId }: { jobId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("INTAKE");
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const [pending, start] = useTransition();

  const send = (files: FileList | null) => {
    if (!files?.length) return;
    start(async () => {
      setMsg(null);
      for (const file of Array.from(files).slice(0, 6)) {
        const blob = await shrink(file);
        const f = new FormData();
        f.set("jobId", jobId); f.set("kind", kind);
        f.set("photo", new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" }));
        const r = await addRepairPhoto(undefined, f);
        setMsg(r);
        if (r.error) break;
      }
      if (input.current) input.current.value = "";
    });
  };

  return (
    <div className="row no-print">
      <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Photo of"><option value="INTAKE">As received</option><option value="WORK">During work</option><option value="DONE">After repair</option></select>
      <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => send(e.target.files)} />
      <button type="button" className="btn" disabled={pending} onClick={() => input.current?.click()}>{pending ? "Uploading…" : "Add photo"}</button>
      {msg?.error && <span className="error-text" role="alert">{msg.error}</span>}
      {msg?.ok && <span className="small" style={{ color: "var(--ok)" }}>{msg.ok}</span>}
    </div>
  );
}
