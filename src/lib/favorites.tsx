import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "./auth";
import { addFavorite, fetchFavoriteIds, removeFavorite } from "./api/products";
import { getSupabase, requireSupabase } from "./supabase";

/* Favoris de l'utilisateur connecté (table product_favorites, RLS : chacun ne voit que les siens).
 * Les mises à jour sont optimistes : le cœur change tout de suite, et revient en arrière si la base refuse. */

type FavoritesContextValue = {
  ids: string[];
  loading: boolean;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
};

const FavoritesContext = createContext<FavoritesContextValue | null>(null);
const EMPTY: string[] = [];

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const qc = useQueryClient();
  const key = useMemo(() => ["favorites", userId] as const, [userId]);

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchFavoriteIds(userId!),
    enabled: userId !== null && getSupabase() !== null,
    staleTime: 60_000,
  });
  const ids = query.data ?? EMPTY;

  const refreshLists = useCallback(() => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["favorite-products"] });
  }, [qc, key]);

  const setFavorite = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => {
      if (!userId) throw new Error("not-authenticated");
      if (on) await addFavorite(userId, id);
      else await removeFavorite(userId, id);
    },
    onMutate: async ({ id, on }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<string[]>(key) ?? EMPTY;
      qc.setQueryData<string[]>(key, on ? [id, ...previous.filter((x) => x !== id)] : previous.filter((x) => x !== id));
      return { previous };
    },
    onError: (_error, _vars, ctx) => {
      if (ctx) qc.setQueryData(key, ctx.previous);
      toast.error("Impossible de mettre à jour vos favoris. Réessayez dans un instant.");
    },
    onSettled: refreshLists,
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("not-authenticated");
      const { error } = await requireSupabase().from("product_favorites").delete().eq("user_id", userId);
      if (error) throw error;
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<string[]>(key) ?? EMPTY;
      qc.setQueryData<string[]>(key, []);
      return { previous };
    },
    onError: (_error, _vars, ctx) => {
      if (ctx) qc.setQueryData(key, ctx.previous);
      toast.error("Impossible de vider vos favoris. Réessayez dans un instant.");
    },
    onSettled: refreshLists,
  });

  const requireUser = useCallback(() => {
    if (userId) return true;
    toast.error("Connectez-vous pour utiliser vos favoris.");
    return false;
  }, [userId]);

  const add = useCallback(
    (id: string) => { if (requireUser()) setFavorite.mutate({ id, on: true }); },
    [requireUser, setFavorite],
  );

  const remove = useCallback(
    (id: string) => {
      if (!requireUser()) return;
      setFavorite.mutate({ id, on: false });
      toast("Retiré des favoris", { action: { label: "Annuler", onClick: () => add(id) } });
    },
    [requireUser, setFavorite, add],
  );

  const toggle = useCallback(
    (id: string) => {
      if (ids.includes(id)) remove(id);
      else { add(id); toast.success("Ajouté aux favoris"); }
    },
    [ids, add, remove],
  );

  const clear = useCallback(() => { if (requireUser()) clearAll.mutate(); }, [requireUser, clearAll]);

  const value = useMemo<FavoritesContextValue>(
    () => ({ ids, loading: query.isLoading, has: (id: string) => ids.includes(id), toggle, remove, clear }),
    [ids, query.isLoading, toggle, remove, clear],
  );
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error("useFavorites doit être utilisé dans <FavoritesProvider>");
  return ctx;
}
