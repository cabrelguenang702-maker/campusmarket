import { Minus, Plus } from "@/components/icons";
import { ProductVisual } from "@/components/cm/commerce";
import { LocationBadge } from "@/components/cm/badges";
import { formatFcfa, type Product } from "@/lib/domain";

/** Frais de service : 2 % du sous-total. Miroir d'affichage de public.order_service_fee (migration 0034) — la base fait foi. */
export const serviceFee = (subtotal: number) => Math.round(subtotal * 0.02);

export function QuantityStepper({ value, max, onChange }: { value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="inline-flex items-center rounded-md border border-input bg-card" role="group" aria-label="Quantité">
      <button type="button" aria-label="Diminuer la quantité" disabled={value <= 1} onClick={() => onChange(value - 1)} className="grid size-9 place-items-center rounded-l-md text-muted-foreground hover:bg-accent disabled:opacity-40"><Minus className="size-4" /></button>
      <span className="w-9 text-center text-sm font-bold tabular-nums" aria-live="polite">{value}</span>
      <button type="button" aria-label="Augmenter la quantité" disabled={value >= max} onClick={() => onChange(value + 1)} className="grid size-9 place-items-center rounded-r-md text-muted-foreground hover:bg-accent disabled:opacity-40"><Plus className="size-4" /></button>
    </div>
  );
}

/** Récapitulatif de commande (colonne de droite du checkout, ou bloc de synthèse). */
export function OrderSummary({ product, unitPrice, fee: feeOverride, qty = 1, title = "Votre commande", extraLines = [] }: { product: Pick<Product, "name" | "icon" | "tone" | "images" | "price" | "sellerName" | "campus" | "city">; unitPrice?: number | undefined; fee?: number | undefined; qty?: number; title?: string; extraLines?: [string, string][] }) {
  const unit = unitPrice ?? product.price;
  const subtotal = unit * qty;
  const fee = feeOverride ?? serviceFee(subtotal);
  return (
    <aside className="rounded-xl border border-border bg-card p-4">
      <h2 className="font-display text-base font-bold">{title}</h2>
      <div className="mt-4 flex gap-3">
        <ProductVisual product={product} className="size-20 shrink-0 rounded-lg [&_svg]:size-9" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{product.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">Vendu par {product.sellerName}</p>
          <LocationBadge campus={product.campus} city={product.city} className="mt-1" />
        </div>
      </div>
      <dl className="mt-4 space-y-2.5 border-t border-border pt-4 text-sm">
        <div className="flex justify-between"><dt className="text-muted-foreground">Article{qty > 1 ? ` × ${qty}` : ""}</dt><dd className="font-semibold">{formatFcfa(subtotal)}</dd></div>
        {extraLines.map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-muted-foreground">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
        <div className="flex justify-between"><dt className="text-muted-foreground">Frais de service</dt><dd className="font-semibold">{formatFcfa(fee)}</dd></div>
        <div className="flex items-baseline justify-between border-t border-border pt-3"><dt className="font-semibold">Total à payer</dt><dd className="font-display text-xl font-bold text-primary">{formatFcfa(subtotal + fee)}</dd></div>
      </dl>
    </aside>
  );
}
