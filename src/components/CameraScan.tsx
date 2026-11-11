"use client";

import { useEffect, useRef, useState } from "react";

// Scan a barcode / IMEI label with the phone's camera. Uses the browser's own detector where it exists (Android
// Chrome) and a bundled reader everywhere else (iPhone Safari), loaded only when the scanner is opened.
type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
const FORMATS = ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "qr_code"];

export function ScanButton({ onCode, label = "Scan", className = "btn" }: { onCode: (code: string) => void; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label={label} title={label}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 8v8M11 8v8M14 8v8M17 8v8" /></svg>
      </button>
      {open && <CameraScanner onClose={() => setOpen(false)} onCode={(c) => { setOpen(false); onCode(c); }} />}
    </>
  );
}

export function CameraScanner({ onCode, onClose, keepOpen = false }: { onCode: (code: string) => void; onClose: () => void; keepOpen?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let stopReader: (() => void) | null = null;
    let lastCode = "";
    let lastAt = 0;
    const hit = (code: string) => {
      const now = Date.now();
      // The same label stays in view for many frames: report it once, and again only after a pause.
      if (!code || (code === lastCode && now - lastAt < 2500)) return;
      lastCode = code; lastAt = now;
      setLast(code);
      if (navigator.vibrate) navigator.vibrate(60);
      cb.current(code);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setError("This browser cannot use the camera. Type the code instead."); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
      } catch {
        setError("Camera permission was refused. Allow the camera for this site in the browser settings, or type the code.");
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const el = video.current!;
      el.srcObject = stream;
      await el.play().catch(() => {});

      const Native = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
      if (Native) {
        const supported = (await Native.getSupportedFormats?.().catch(() => FORMATS)) ?? FORMATS;
        const detector = new Native({ formats: FORMATS.filter((f) => supported.includes(f)) });
        const tick = async () => {
          if (stopped) return;
          try { const found = await detector.detect(el); if (found[0]) hit(found[0].rawValue.trim()); } catch { /* frame not ready */ }
          setTimeout(tick, 180);
        };
        tick();
      } else {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (stopped) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromStream(stream, el, (result) => { if (result) hit(result.getText().trim()); });
        stopReader = () => controls.stop();
      }
    })();

    return () => {
      stopped = true;
      stopReader?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-label="Scan a barcode" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 16 }}>
      <div style={{ position: "relative", width: "100%", maxWidth: 520 }}>
        <video ref={video} playsInline muted style={{ width: "100%", borderRadius: 12, background: "#000", maxHeight: "60vh", objectFit: "cover" }} />
        <div aria-hidden="true" style={{ position: "absolute", left: "8%", right: "8%", top: "50%", height: 2, background: "rgba(255,80,80,.9)" }} />
      </div>
      <p style={{ color: "#fff", margin: 0, textAlign: "center" }}>{error ?? (last && keepOpen ? `Read ${last}` : "Hold the barcode on the red line")}</p>
      <button type="button" className="btn" onClick={onClose}>{keepOpen ? "Done" : "Cancel"}</button>
    </div>
  );
}
