import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ArrowRight, Buildings, Search } from "@/components/icons";
import { AuthPage, IconBadge } from "@/components/auth/AuthPage";
import { Field, IconInput, SearchField, SelectableCard } from "@/components/cm/forms";
import { InlineAlert, LoadingButtonLabel, StateScreen } from "@/components/cm/feedback";
import { NetworkErrorScreen } from "@/components/cm/screens";
import { suggestUniversity, useUniversities, type University } from "@/lib/api/geo";
import { setOwnUniversity } from "@/lib/api/profile";
import { RequireSession, useAuth } from "@/lib/auth";
import { fetchMyRegistration } from "@/lib/api/registration";
import { useOnboarding } from "@/lib/onboarding";

export const Route = createFileRoute("/_auth/inscription/universite")({
  head: () => ({ meta: [{ title: "Votre université — CampusMarket" }] }),
  component: () => (
    <RequireSession>
      <UniversityPage />
    </RequireSession>
  ),
});

function UniversityPage() {
  const navigate = useNavigate();
  const { session, refreshAccount } = useAuth();
  const { country, university, setUniversity } = useOnboarding();
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const { data, isPending, isError, refetch } = useUniversities(country.code);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter(
      (u) =>
        !q ||
        u.name.toLowerCase().includes(q) ||
        u.short.toLowerCase().includes(q) ||
        u.city.toLowerCase().includes(q),
    );
  }, [data, query]);

  const userId = session?.user.id;

  const next = async () => {
    if (!university || !userId || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      await setOwnUniversity(userId, university);
      await refreshAccount();
      // C'est la base qui décide : paiement demandé seulement si l'inscription payante est active et que ce compte doit payer.
      const registration = await fetchMyRegistration().catch(() => null);
      void navigate({ to: registration?.status === "pending_payment" ? "/inscription/paiement" : "/inscription/compte-cree" });
    } catch (error) {
      console.error("Enregistrement de l'université impossible", error);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthPage
      step={4}
      back="/inscription/telephone"
      title="Où étudiez-vous ?"
      description={`Choisissez votre université (${country.name}) pour voir les annonces, formations et événements de votre campus.`}
      icon={<IconBadge icon={Buildings} />}
    >
      <SearchField
        placeholder="Rechercher par nom, sigle ou ville"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Rechercher une université"
      />
      <div className="mt-4" role="radiogroup" aria-label="Universités">
        {isPending ? (
          <div className="space-y-2.5" aria-busy>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-[68px] animate-pulse rounded-lg bg-foreground/10" />
            ))}
          </div>
        ) : isError ? (
          <NetworkErrorScreen compact onRetry={() => void refetch()} />
        ) : list.length === 0 ? (
          <StateScreen
            compact
            icon={Search}
            tone="neutral"
            title="Université introuvable"
            description="Nous ne trouvons pas cet établissement. Signalez-le-nous et nous l'ajouterons rapidement."
            actions={
              userId ? (
                <SuggestForm userId={userId} countryCode={country.code} initialName={query} />
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {list.length} établissement{list.length > 1 ? "s" : ""} · {country.name}
            </p>
            <div className="max-h-[42vh] space-y-2.5 overflow-y-auto pr-1">
              {list.map((u: University) => (
                <SelectableCard
                  key={u.id}
                  selected={university?.id === u.id}
                  onSelect={() => setUniversity(u)}
                  title={u.name}
                  description={`${u.short} · ${u.city} · ${u.students}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
      {saveError && (
        <div className="mt-4" aria-live="polite">
          <InlineAlert tone="danger" title="Enregistrement impossible">
            Votre université n'a pas pu être enregistrée. Réessayez dans un instant.
          </InlineAlert>
        </div>
      )}
      <Button
        size="lg"
        className="mt-6 w-full"
        disabled={!university || saving}
        onClick={() => void next()}
      >
        <LoadingButtonLabel loading={saving} loadingText="Enregistrement…">
          Continuer <ArrowRight />
        </LoadingButtonLabel>
      </Button>
      {!university && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Sélectionnez votre université pour continuer.
        </p>
      )}
    </AuthPage>
  );
}

/** Suggestion d'une université absente de la liste : alimente la file de validation de l'admin (0018). */
function SuggestForm({
  userId,
  countryCode,
  initialName,
}: {
  userId: string;
  countryCode: string;
  initialName: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [city, setCity] = useState("");
  const [sending, setSending] = useState(false);

  if (!open)
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        Suggérer mon université
      </Button>
    );

  const send = async () => {
    if (name.trim().length < 3 || city.trim().length < 2 || sending) return;
    setSending(true);
    try {
      await suggestUniversity({ userId, name, city, countryCode });
      toast.success("Merci ! Nous étudions votre demande d'ajout.");
      setOpen(false);
    } catch (error) {
      // P0429 : limite de débit (5 suggestions par jour).
      const limited = (error as { code?: string } | null)?.code === "P0429";
      toast.error(
        limited
          ? "Trop de suggestions aujourd'hui. Réessayez demain."
          : "La suggestion n'a pas pu être envoyée.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="w-full space-y-3 text-left">
      <Field label="Nom de l'université" htmlFor="suggest-name">
        <IconInput
          id="suggest-name"
          icon={Buildings}
          value={name}
          maxLength={150}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Ville" htmlFor="suggest-city">
        <IconInput
          id="suggest-city"
          icon={Buildings}
          value={city}
          maxLength={100}
          onChange={(e) => setCity(e.target.value)}
        />
      </Field>
      <Button
        className="w-full"
        disabled={sending || name.trim().length < 3 || city.trim().length < 2}
        onClick={() => void send()}
      >
        <LoadingButtonLabel loading={sending} loadingText="Envoi…">
          Envoyer la suggestion
        </LoadingButtonLabel>
      </Button>
    </div>
  );
}
