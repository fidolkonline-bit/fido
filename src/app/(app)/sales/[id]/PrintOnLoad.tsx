"use client";

import { useEffect } from "react";

export function PrintOnLoad({ enabled, label = "Print receipt" }: { enabled: boolean; label?: string }) {
  useEffect(() => { if (enabled) setTimeout(() => window.print(), 300); }, [enabled]);
  return <button className="btn no-print" onClick={() => window.print()}>{label}</button>;
}
