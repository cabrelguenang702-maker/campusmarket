import { useEffect, useRef, useState } from "react";
import { Camera } from "@/components/icons";
import { cn } from "@/lib/utils";

/* Lecture de QR code par la caméra : API BarcodeDetector du navigateur (Chrome, Edge, Android, Safari récent), sans dépendance.
 * Si le navigateur ne la fournit pas, on le dit clairement et l'organisateur utilise la saisie manuelle ou la liste. */

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type DetectorCtor = { new (opts?: { formats?: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

const detectorCtor = (): DetectorCtor | undefined => (typeof window === "undefined" ? undefined : (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector);

export const canScanWithCamera = () => !!detectorCtor() && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** Viseur caméra. `onScan` reçoit le texte lu ; un même texte n'est renvoyé qu'une fois toutes les 3 secondes. */
export function ScannerFrame({ onScan, paused = false, className }: { onScan: (text: string) => void; paused?: boolean; className?: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"demarrage" | "actif" | "refuse" | "indisponible">(canScanWithCamera() ? "demarrage" : "indisponible");
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const Ctor = detectorCtor();
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const last = { text: "", at: 0 };
    void (async () => {
      try {
        const detector = new Ctor({ formats: ["qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const el = video.current;
        if (!el) return;
        el.srcObject = stream;
        await el.play();
        setState("actif");
        const tick = async () => {
          if (stopped) return;
          if (!pausedRef.current && el.readyState >= 2) {
            try {
              const found = await detector.detect(el);
              const text = found[0]?.rawValue;
              if (text && (text !== last.text || Date.now() - last.at > 3000)) { last.text = text; last.at = Date.now(); onScanRef.current(text); }
            } catch { /* image illisible : on réessaie au prochain passage */ }
          }
          timer = window.setTimeout(() => void tick(), 250);
        };
        void tick();
      } catch (e) {
        setState(e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "refuse" : "indisponible");
      }
    })();
    return () => { stopped = true; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);

  return (
    <div className={cn("relative aspect-square w-full overflow-hidden rounded-2xl bg-[#0b1220]", className)}>
      <video ref={video} muted playsInline className={cn("absolute inset-0 size-full object-cover", state !== "actif" && "hidden")} />
      {state === "actif" && (
        <>
          <div className="absolute inset-8 rounded-xl border-2 border-dashed border-white/40" />
          {(["top-6 left-6 border-t-4 border-l-4 rounded-tl-lg", "top-6 right-6 border-t-4 border-r-4 rounded-tr-lg", "bottom-6 left-6 border-b-4 border-l-4 rounded-bl-lg", "bottom-6 right-6 border-b-4 border-r-4 rounded-br-lg"] as const).map((pos) => <span key={pos} className={cn("absolute size-10 border-primary", pos)} />)}
          <p className="absolute inset-x-0 bottom-3 text-center text-xs font-medium text-white/80">{paused ? "Lecture en pause" : "Cadrez le code QR du billet"}</p>
        </>
      )}
      {state !== "actif" && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div>
            <Camera className="mx-auto size-10 text-white/30" />
            <p className="mt-3 text-sm font-medium text-white/80">
              {state === "demarrage" ? "Démarrage de la caméra…" : state === "refuse" ? "Accès à la caméra refusé. Autorisez-le dans les réglages du navigateur, ou utilisez la saisie manuelle." : "La lecture par caméra n'est pas disponible sur cet appareil ou ce navigateur. Utilisez la saisie manuelle ou la liste des participants."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
