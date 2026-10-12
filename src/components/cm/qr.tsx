import { useMemo } from "react";
import { qrMatrix } from "@/lib/qr";

/** Vrai QR code (voir lib/qr.ts), dessiné en SVG avec une marge blanche de 4 modules, lisible par n'importe quel lecteur. */
export function QrCode({ value, size = 200, label = "QR code", className }: { value: string; size?: number; label?: string; className?: string }) {
  const model = useMemo(() => {
    try {
      const m = qrMatrix(value);
      const n = m.length;
      let d = "";
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y]![x]) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      return { n, d };
    } catch {
      return null;
    }
  }, [value]);
  if (!model) return <div role="img" aria-label="QR code indisponible" className={className} style={{ width: size, height: size }} />;
  const total = model.n + 8;
  return (
    <svg viewBox={`0 0 ${total} ${total}`} width={size} height={size} className={className} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={total} height={total} fill="#fff" />
      <path d={model.d} fill="#0b1220" />
    </svg>
  );
}
