import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, Globe } from "@/components/icons";
import { AuthPage, IconBadge } from "@/components/auth/AuthPage";
import { SearchField, SelectableCard } from "@/components/cm/forms";
import { NetworkErrorScreen, NoResultsScreen } from "@/components/cm/screens";
import { useCountries } from "@/lib/api/geo";
import { useOnboarding } from "@/lib/onboarding";

export const Route = createFileRoute("/_auth/inscription/pays")({
  head: () => ({ meta: [{ title: "Choisissez votre pays — CampusMarket" }] }),
  component: CountryPage,
});

function CountryPage() {
  const navigate = useNavigate();
  const { country, setCountry } = useOnboarding();
  const [query, setQuery] = useState("");
  const { data, isPending, isError, refetch } = useCountries();

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q) || c.dial.includes(q));
  }, [data, query]);

  return (
    <AuthPage
      step={1}
      back="/bienvenue"
      title="Dans quel pays étudiez-vous ?"
      description="Nous adaptons les universités et les moyens de paiement à votre pays."
      icon={<IconBadge icon={Globe} />}
    >
      <SearchField
        placeholder="Rechercher un pays"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Rechercher un pays"
      />
      <div className="mt-4" role="radiogroup" aria-label="Pays">
        {isPending ? (
          <div className="space-y-2.5" aria-busy>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-[68px] animate-pulse rounded-lg bg-foreground/10" />
            ))}
          </div>
        ) : isError ? (
          <NetworkErrorScreen compact onRetry={() => void refetch()} />
        ) : list.length === 0 ? (
          <NoResultsScreen compact query={query || "ce pays"} />
        ) : (
          <div className="max-h-[46vh] space-y-2.5 overflow-y-auto pr-1">
            {list.map((c) => (
              <SelectableCard
                key={c.code}
                selected={country.code === c.code}
                onSelect={() => setCountry(c)}
                title={c.name}
                description={`${c.dial} · ${c.mobileMoney.length > 0 ? c.mobileMoney.join(", ") : "Paiement Mobile Money bientôt disponible"}`}
                trailing={
                  <span className="grid h-6 w-8 place-items-center rounded bg-accent text-lg leading-none" aria-label={c.code}>
                    {c.flag ?? c.code}
                  </span>
                }
              />
            ))}
          </div>
        )}
      </div>
      <Button
        size="lg"
        className="mt-6 w-full"
        disabled={isPending || isError}
        onClick={() => navigate({ to: "/inscription/email" })}
      >
        Continuer <ArrowRight />
      </Button>
    </AuthPage>
  );
}
