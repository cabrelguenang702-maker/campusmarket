import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Fullscreen, ImageIcon, X } from "@/components/icons";
import { ProductVisual } from "@/components/cm/commerce";
import type { Product } from "@/lib/domain";

type Props = { product: Product; open?: boolean | undefined; onOpenChange?: ((open: boolean) => void) | undefined; dimmed?: boolean | undefined; className?: string | undefined };

/** Galerie photo du produit : image principale, vignettes, plein écran. Sans photo, le visuel de la catégorie. */
export function ProductGallery({ product, open, onOpenChange, dimmed, className }: Props) {
  const [index, setIndex] = useState(0);
  const [internalOpen, setInternalOpen] = useState(false);
  const fullscreen = open ?? internalOpen;
  const setFullscreen = (v: boolean) => { setInternalOpen(v); onOpenChange?.(v); };

  const photos = product.images;
  const total = Math.max(photos.length, 1);
  const hasPhotos = photos.length > 0;
  useEffect(() => { setIndex(0); }, [product.id]);

  const go = (delta: number) => setIndex((i) => (i + delta + total) % total);
  const slideOf = (i: number) => ({ ...product, images: hasPhotos && photos[i] ? [photos[i]!] : [] });
  const slide = slideOf(index);
  const label = hasPhotos ? `Photo ${index + 1}` : "Visuel de la catégorie";

  return (
    <div className={className}>
      <div className="group relative overflow-hidden rounded-xl border border-border">
        <ProductVisual product={slide} className={cn("aspect-[16/11] w-full sm:aspect-[4/3] [&_svg]:size-24", dimmed && "opacity-50 grayscale")} />
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-semibold backdrop-blur"><ImageIcon className="size-3.5 text-primary" />{label}</span>
        {hasPhotos && <span className="absolute bottom-3 left-3 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-bold tabular-nums backdrop-blur">{index + 1} / {total}</span>}
        {hasPhotos && <button onClick={() => setFullscreen(true)} aria-label="Afficher en plein écran" className="absolute bottom-3 right-3 grid size-9 place-items-center rounded-full bg-background/85 backdrop-blur hover:bg-background"><Fullscreen className="size-4" /></button>}
        {total > 1 && (
          <>
            <button onClick={() => go(-1)} aria-label="Photo précédente" className="absolute left-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-background/85 backdrop-blur hover:bg-background"><ChevronLeft className="size-5" /></button>
            <button onClick={() => go(1)} aria-label="Photo suivante" className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-background/85 backdrop-blur hover:bg-background"><ChevronRight className="size-5" /></button>
          </>
        )}
      </div>
      {total > 1 && (
        <div className="mt-3 hidden grid-cols-4 gap-2.5 sm:grid">
          {photos.map((url, i) => (
            <button key={url} onClick={() => setIndex(i)} aria-label={`Voir la photo ${i + 1}`} aria-current={i === index} className={cn("overflow-hidden rounded-lg border-2 transition", i === index ? "border-primary" : "border-transparent opacity-70 hover:opacity-100")}>
              <ProductVisual product={slideOf(i)} className="aspect-square w-full [&_svg]:size-8" />
            </button>
          ))}
        </div>
      )}

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="max-w-3xl gap-3 p-3 sm:p-4 [&>button]:hidden">
          <DialogTitle className="sr-only">Galerie — {product.name}</DialogTitle>
          <DialogDescription className="sr-only">Photo {index + 1} sur {total}</DialogDescription>
          <div className="relative overflow-hidden rounded-lg">
            <ProductVisual product={slide} className="aspect-[4/3] w-full [&_svg]:size-32" />
            <button onClick={() => setFullscreen(false)} aria-label="Fermer la galerie" className="absolute right-3 top-3 grid size-10 place-items-center rounded-full bg-background/90 hover:bg-background"><X className="size-5" /></button>
            {total > 1 && (
              <>
                <button onClick={() => go(-1)} aria-label="Photo précédente" className="absolute left-3 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-background/90"><ChevronLeft className="size-5" /></button>
                <button onClick={() => go(1)} aria-label="Photo suivante" className="absolute right-3 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-background/90"><ChevronRight className="size-5" /></button>
              </>
            )}
          </div>
          <p className="text-center text-sm font-semibold">{label} <span className="text-muted-foreground">· {index + 1} / {total}</span></p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
