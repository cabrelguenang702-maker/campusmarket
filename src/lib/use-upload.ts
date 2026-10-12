import { useCallback, useEffect, useRef, useState } from "react";
import type { UploadState } from "@/components/cm/forms";

export type UploadSlot = { state: UploadState; name?: string | undefined; progress: number; url?: string | undefined; error?: string | undefined };

/** Simule l'envoi d'un fichier (progression, terminé, erreur) — à remplacer par le vrai upload. */
export function useUpload(maxMb = 5) {
  const [slot, setSlot] = useState<UploadSlot>({ state: "idle", progress: 0 });
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const pick = useCallback((file: File) => {
    timers.current.forEach((t) => window.clearTimeout(t));
    if (file.size > maxMb * 1024 * 1024) {
      setSlot({ state: "error", name: file.name, progress: 0, error: `Fichier trop lourd (${(file.size / 1024 / 1024).toFixed(1).replace(".", ",")} Mo). Maximum : ${maxMb} Mo.` });
      return;
    }
    const url = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
    setSlot({ state: "uploading", name: file.name, progress: 15, url });
    timers.current = [
      window.setTimeout(() => setSlot((s) => ({ ...s, progress: 60 })), 450),
      window.setTimeout(() => setSlot((s) => ({ ...s, progress: 100, state: "done" })), 1000),
    ];
  }, [maxMb]);

  const remove = useCallback(() => setSlot({ state: "idle", progress: 0 }), []);
  const seed = useCallback((name: string) => setSlot((s) => (s.state === "done" ? s : { state: "done", name, progress: 100 })), []);
  return { slot, pick, remove, seed };
}
