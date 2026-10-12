import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ChevronDown, HelpCircle, Lock, Plus, Search, X } from "@/components/icons";
import { AppLink } from "@/components/cm/app-link";
import { EmptyScreen, NoResultsScreen, ServerErrorScreen } from "@/components/cm/screens";
import { StateScreen } from "@/components/cm/feedback";
import { NewTicketDialog } from "@/components/support/NewTicketDialog";
import { TicketRow } from "@/components/support/TicketRow";
import { categoryIcon } from "@/components/support/category-icon";
import { PageHeader } from "@/components/layout/PageHeader";
import { useAuth } from "@/lib/auth";
import { useFaq, useTickets } from "@/lib/api/support";
import { cn } from "@/lib/utils";

export type AideSearch = { onglet?: "faq" | "tickets" | undefined; q?: string | undefined; categorie?: string | undefined };

export const Route = createFileRoute("/_app/aide/")({
  validateSearch: (s: Record<string, unknown>): AideSearch => ({
    onglet: s["onglet"] === "tickets" ? "tickets" : undefined,
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    categorie: typeof s["categorie"] === "string" && s["categorie"] ? s["categorie"] : undefined,
  }),
  head: () => ({ meta: [{ title: "Centre d'aide — CampusMarket" }] }),
  component: HelpCenterPage,
});

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function HelpCenterPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { session } = useAuth();
  const userId = session?.user.id;
  const faq = useFaq();
  const tickets = useTickets(userId);
  const [qInput, setQInput] = useState(search.q ?? "");
  const [openFaq, setOpenFaq] = useState<string | null>(null);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const setSearch = (patch: Partial<AideSearch>) => void navigate({ search: (prev) => ({ ...prev, ...patch }) });

  const tab = search.onglet === "tickets" ? "tickets" : "faq";
  const categories = faq.data?.categories ?? [];
  const activeCategory = categories.find((c) => c.slug === search.categorie)?.slug;
  const q = search.q ? normalize(search.q) : "";
  const faqResults = (faq.data?.items ?? []).filter((f) => (!activeCategory || f.category === activeCategory) && (!q || normalize(`${f.question} ${f.answer}`).includes(q)));
  const ticketCount = tickets.data?.length ?? 0;

  const goTab = (t: "faq" | "tickets") => setSearch({ onglet: t === "tickets" ? "tickets" : undefined });
  const skeleton = <div className="space-y-3" aria-busy>{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-foreground/10" />)}</div>;

  return (
    <div>
      <PageHeader kicker="Support" title="Centre d'aide" description="Trouvez une réponse rapide ou contactez notre équipe." breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Aide" }]}
        actions={<Button size="lg" onClick={() => setNewTicketOpen(true)}><Plus /> Nouveau ticket</Button>} />

      <div role="tablist" className="mb-6 inline-flex rounded-lg border border-border bg-secondary p-1">
        <button role="tab" aria-selected={tab === "faq"} onClick={() => goTab("faq")} className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", tab === "faq" ? "bg-card shadow-soft" : "text-muted-foreground")}>Questions fréquentes</button>
        <button role="tab" aria-selected={tab === "tickets"} onClick={() => goTab("tickets")} className={cn("rounded-md px-4 py-1.5 text-sm font-semibold", tab === "tickets" ? "bg-card shadow-soft" : "text-muted-foreground")}>Mes tickets {ticketCount > 0 && `(${ticketCount})`}</button>
      </div>

      {tab === "tickets" ? (
        !session ? (
          <StateScreen compact icon={Lock} title="Connectez-vous pour voir vos tickets" description="Vos échanges avec notre équipe sont rattachés à votre compte." actions={<Button asChild size="lg"><AppLink to="/connexion">Se connecter</AppLink></Button>} />
        ) : tickets.isLoading ? skeleton : tickets.isError ? (
          <ServerErrorScreen compact onRetry={() => void tickets.refetch()} />
        ) : ticketCount === 0 ? (
          <EmptyScreen compact title="Aucun ticket pour l'instant" description="Vos échanges avec notre équipe de support apparaîtront ici." actions={<Button onClick={() => setNewTicketOpen(true)}><Plus /> Ouvrir un ticket</Button>} />
        ) : (
          <div className="space-y-2.5">{(tickets.data ?? []).map((t) => <TicketRow key={t.id} ticket={t} />)}</div>
        )
      ) : (
        <div>
          <form role="search" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch({ q: qInput.trim() || undefined }); }}>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
              <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Rechercher dans l'aide…" aria-label="Rechercher dans l'aide" className="h-12 w-full rounded-lg border border-input bg-card pl-11 pr-10 text-base outline-none transition placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 md:text-sm" />
              {qInput && <button type="button" aria-label="Effacer la recherche" onClick={() => { setQInput(""); setSearch({ q: undefined }); }} className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button>}
            </div>
            <Button type="submit" size="lg" className="h-12 px-4 sm:px-5" aria-label="Rechercher"><Search className="sm:hidden" /><span className="hidden sm:inline">Rechercher</span></Button>
          </form>

          {categories.length > 0 && (
            <div className="no-scrollbar -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0" role="group" aria-label="Catégories">
              <button aria-pressed={!activeCategory} onClick={() => setSearch({ categorie: undefined })} className={cn("shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition", !activeCategory ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>Toutes</button>
              {categories.map((c) => { const Icon = categoryIcon(c.slug); return <button key={c.slug} aria-pressed={activeCategory === c.slug} onClick={() => setSearch({ categorie: c.slug })} className={cn("flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition", activeCategory === c.slug ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}><Icon className="size-4" />{c.name}</button>; })}
            </div>
          )}

          <div className="mt-5">
            {faq.isLoading ? skeleton : faq.isError ? (
              <ServerErrorScreen compact onRetry={() => void faq.refetch()} />
            ) : faqResults.length === 0 ? (
              <NoResultsScreen compact query={search.q} filtered={!!activeCategory} />
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border bg-card">
                {faqResults.map((f) => {
                  const isOpen = openFaq === f.id;
                  return (
                    <div key={f.id}>
                      <button className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left" aria-expanded={isOpen} onClick={() => setOpenFaq(isOpen ? null : f.id)}>
                        <span className="flex items-center gap-2.5 text-sm font-semibold"><HelpCircle className="size-4 shrink-0 text-primary" />{f.question}</span>
                        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                      </button>
                      {isOpen && <p className="px-4 pb-4 pl-10 text-sm leading-6 text-muted-foreground">{f.answer}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-8 flex items-center gap-3 rounded-xl border border-dashed border-border p-4">
            <p className="flex-1 text-sm text-muted-foreground">Vous ne trouvez pas de réponse ?</p>
            <Button variant="outline" onClick={() => setNewTicketOpen(true)}><Plus /> Contacter le support</Button>
          </div>
        </div>
      )}

      <NewTicketDialog open={newTicketOpen} onOpenChange={setNewTicketOpen} defaultCategory={activeCategory} />
    </div>
  );
}
