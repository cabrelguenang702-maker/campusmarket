import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, ArrowLeft, Block, Clock, Ghost, Heart, Inbox, Lock, RefreshCw, Search, Sad, WifiOff, Filter,
} from "@/components/icons";
import { AppLink } from "./app-link";
import { StateScreen } from "./feedback";

type Compact = { compact?: boolean | undefined };

export function NotFoundScreen({ compact }: Compact) {
  return (
    <StateScreen compact={!!compact} icon={Ghost} tone="primary" title="Page introuvable" description="Cette page n'existe pas ou a été déplacée. Vérifiez l'adresse ou retournez à l'accueil."
      actions={<><Button asChild size="lg"><AppLink to="/">Retour à l'accueil</AppLink></Button><Button asChild size="lg" variant="outline"><AppLink to="/marketplace">Parcourir la marketplace</AppLink></Button></>} />
  );
}

export function ForbiddenScreen({ compact }: Compact) {
  return (
    <StateScreen compact={!!compact} icon={Lock} tone="warning" title="Accès refusé" description="Vous n'avez pas les droits nécessaires pour consulter cette page. Si vous pensez qu'il s'agit d'une erreur, contactez le support."
      actions={<><Button asChild size="lg"><AppLink to="/">Retour à l'accueil</AppLink></Button><Button asChild size="lg" variant="outline"><AppLink to="/aide">Contacter le support</AppLink></Button></>} />
  );
}

export function ServerErrorScreen({ compact, onRetry }: Compact & { onRetry?: () => void }) {
  return (
    <StateScreen compact={!!compact} icon={AlertTriangle} tone="danger" title="Une erreur est survenue" description="Nos serveurs rencontrent un problème. Ce n'est pas de votre faute — réessayez dans quelques instants."
      actions={<><Button size="lg" onClick={onRetry}><RefreshCw /> Réessayer</Button><Button asChild size="lg" variant="outline"><AppLink to="/">Accueil</AppLink></Button></>} />
  );
}

export function NetworkErrorScreen({ compact, onRetry }: Compact & { onRetry?: () => void }) {
  return (
    <StateScreen compact={!!compact} icon={WifiOff} tone="warning" title="Connexion impossible" description="Impossible de joindre CampusMarket. Vérifiez votre connexion Internet puis réessayez."
      actions={<Button size="lg" onClick={onRetry}><RefreshCw /> Réessayer</Button>} />
  );
}

export function OfflineScreen({ compact }: Compact) {
  return (
    <StateScreen compact={!!compact} icon={WifiOff} tone="neutral" title="Vous êtes hors connexion" description="Vos brouillons sont conservés. Les nouveautés et les messages reviendront dès que le réseau sera rétabli." />
  );
}

export function SessionExpiredScreen({ compact }: Compact) {
  return (
    <StateScreen compact={!!compact} icon={Clock} tone="warning" title="Session expirée" description="Pour votre sécurité, vous avez été déconnecté après une longue inactivité. Reconnectez-vous pour continuer."
      actions={<Button asChild size="lg"><AppLink to="/connexion">Se reconnecter</AppLink></Button>} />
  );
}

export function EmptyScreen({ compact, title = "Rien à afficher pour l'instant", description = "Les éléments apparaîtront ici dès qu'il y en aura.", actions }: Compact & { title?: string; description?: string; actions?: ReactNode }) {
  return <StateScreen compact={!!compact} icon={Inbox} tone="primary" title={title} description={description} actions={actions} />;
}

export function NoResultsScreen({ compact, query, filtered }: Compact & { query?: string | undefined; filtered?: boolean | undefined }) {
  return (
    <StateScreen compact={!!compact} icon={filtered ? Filter : Search} tone="neutral"
      title={filtered ? "Aucun résultat avec ces filtres" : "Aucun résultat"}
      description={query ? `Nous n'avons rien trouvé pour « ${query} ». Essayez un autre mot-clé ou élargissez votre recherche.` : "Essayez d'élargir votre recherche ou de retirer certains filtres."}
      actions={<Button variant="outline">{filtered ? "Réinitialiser les filtres" : "Effacer la recherche"}</Button>} />
  );
}

export function EmptyFavoritesScreen({ compact }: Compact) {
  return (
    <StateScreen compact={!!compact} icon={Heart} tone="danger" title="Aucun favori pour le moment" description="Touchez le cœur d'une annonce pour la retrouver facilement ici."
      actions={<Button asChild size="lg"><AppLink to="/marketplace">Découvrir les annonces</AppLink></Button>} />
  );
}

export function UnavailableScreen({ compact }: Compact) {
  return (
    <StateScreen compact={!!compact} icon={Block} tone="danger" title="Contenu indisponible" description="Ce contenu a été supprimé ou n'est plus accessible."
      actions={<Button asChild variant="outline" size="lg"><AppLink to="/"><ArrowLeft /> Retour</AppLink></Button>} />
  );
}

export function SadScreen({ compact, title, description }: Compact & { title: string; description: string }) {
  return <StateScreen compact={!!compact} icon={Sad} tone="neutral" title={title} description={description} />;
}
