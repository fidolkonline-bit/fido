import { code128 } from "@/lib/barcode";

// Renders a Code 128 barcode with the human-readable text underneath.
export function Barcode({ value, height = 40, showText = true, className }: { value: string; height?: number; showText?: boolean; className?: string }) {
  let bc: { path: string; width: number };
  try { bc = code128(value); } catch { return <span className="small">{value}</span>; }
  return (
    <span className={className} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", maxWidth: "100%" }}>
      <svg viewBox={`0 0 ${bc.width} 1`} preserveAspectRatio="none" style={{ width: "100%", maxWidth: bc.width * 2, height, display: "block" }} role="img" aria-label={`Barcode ${value}`}>
        <rect width={bc.width} height="1" fill="#fff" />
        <path d={bc.path} fill="#000" />
      </svg>
      {showText && <span style={{ fontSize: 10, letterSpacing: 1, fontVariantNumeric: "tabular-nums" }}>{value}</span>}
    </span>
  );
}
