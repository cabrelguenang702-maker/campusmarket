import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsCard } from "@/components/cm/setting-row";
import { PushSettings } from "@/components/settings/PushSettings";
import { toneSolidIcon } from "@/components/cm/badges";
import { InlineAlert, Spinner } from "@/components/cm/feedback";
import { categoryMeta } from "@/lib/notification-meta";
import { defaultPrefs, notifCategories, useNotifPrefs, useSaveNotifPrefs, type NotifCategory, type NotifPrefs } from "@/lib/api/notifications";
import { friendlyError } from "@/lib/api/errors";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** Préférences de notification par catégorie : dans l'application et par e-mail. La catégorie Sécurité reste toujours active. */
export function NotificationPreferences() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const query = useNotifPrefs(userId);
  const save = useSaveNotifPrefs(userId);
  const [prefs, setPrefs] = useState<NotifPrefs>(defaultPrefs);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (query.data && !dirty) setPrefs(query.data); }, [query.data, dirty]);

  const set = (c: NotifCategory, channel: "inApp" | "email", v: boolean) => { setDirty(true); setPrefs((p) => ({ ...p, [c]: { ...p[c], [channel]: v } })); };

  if (query.isLoading) return <div className="grid place-items-center py-10"><Spinner /></div>;
  if (query.isError) return <InlineAlert tone="danger" title="Impossible de charger vos préférences">Rechargez la page ou réessayez dans un instant.</InlineAlert>;

  return (
    <div className="space-y-5">
      <PushSettings />
      <SettingsCard title="Types de notifications" description="Choisissez comment être prévenu pour chaque type d'activité.">
        <div className="mt-1 hidden grid-cols-[1fr_84px_64px] gap-3 border-b border-border pb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground sm:grid"><span /><span className="text-center">Dans l'app</span><span className="text-center">E-mail</span></div>
        <ul className="divide-y divide-border">
          {notifCategories.map((c) => {
            const { label, icon: Icon, tone } = categoryMeta[c];
            const locked = c === "securite";
            return (
              <li key={c} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-3 sm:grid-cols-[1fr_84px_64px]">
                <span className="flex min-w-0 items-center gap-3"><span className={cn("grid size-9 shrink-0 place-items-center rounded-md", toneSolidIcon[tone])}><Icon className="size-[18px]" /></span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{label}</span>{locked && <span className="block text-[11px] text-muted-foreground">Toujours activée pour protéger votre compte</span>}</span></span>
                <span className="flex flex-col items-center gap-1 sm:block sm:text-center"><span className="text-[10px] font-semibold text-muted-foreground sm:hidden">Dans l'app</span><Switch aria-label={`${label} — dans l'application`} checked={prefs[c].inApp} disabled={locked} onCheckedChange={(v) => set(c, "inApp", v)} /></span>
                <span className="flex flex-col items-center gap-1 sm:block sm:text-center"><span className="text-[10px] font-semibold text-muted-foreground sm:hidden">E-mail</span><Switch aria-label={`${label} — e-mail`} checked={prefs[c].email} disabled={locked} onCheckedChange={(v) => set(c, "email", v)} /></span>
              </li>
            );
          })}
        </ul>
      </SettingsCard>
      <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(prefs, { onSuccess: () => { setDirty(false); toast.success("Préférences enregistrées"); }, onError: (e) => toast.error(friendlyError(e, "Impossible d'enregistrer vos préférences.")) })}>{save.isPending ? "Enregistrement…" : "Enregistrer les préférences"}</Button>
    </div>
  );
}
