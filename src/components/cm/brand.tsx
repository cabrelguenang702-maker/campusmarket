import { useEffect, useRef, useState } from "react";
import logoAsset from "@/assets/campusmarket-logo.jpg.asset.json";
import { cn } from "@/lib/utils";

/**
 * Logo CampusMarket. L'image du logo est servie par l'asset Lovable ;
 * si elle est introuvable (projet exécuté hors Lovable), on retombe sur /favicon.png.
 */
export function Logo({ className, showTagline = true, size = "md" }: { className?: string; showTagline?: boolean; size?: "sm" | "md" | "lg" }) {
  const [src, setSrc] = useState<string>(logoAsset.url);
  const ref = useRef<HTMLImageElement>(null);
  // L'erreur de chargement peut survenir avant l'hydratation : on revérifie au montage.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setSrc("/favicon.png");
  }, []);
  const box = size === "lg" ? "h-14 w-14" : size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const text = size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base";
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <img
        ref={ref}
        src={src}
        onError={() => setSrc("/favicon.png")}
        alt="Logo CampusMarket"
        className={cn("shrink-0 rounded-lg bg-secondary object-cover", box)}
      />
      <span className="text-left leading-tight">
        <span className={cn("block font-display font-bold", text)}>
          Campus<span className="text-primary">Market</span>
        </span>
        {showTagline && <span className="block text-[10px] text-muted-foreground">Le campus qui échange</span>}
      </span>
    </span>
  );
}
