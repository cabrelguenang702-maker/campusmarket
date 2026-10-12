import { useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { AlertCircle, Check, CheckCircle, ChevronDown, Eye, EyeOff, File, ImageIcon, Search, Upload, X, type IconType } from "@/components/icons";
import type { Country } from "@/lib/mock-data";
import { Spinner } from "./feedback";

/* ---------- Champ générique : label + aide + erreur ---------- */
export function Field({ label, hint, error, htmlFor, children, className }: { label: string; hint?: string | undefined; error?: string | undefined; htmlFor?: string | undefined; children: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-[13px] font-semibold">{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-destructive"><AlertCircle className="size-3.5 shrink-0" />{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

type IconInputProps = InputHTMLAttributes<HTMLInputElement> & { icon?: IconType | undefined; invalid?: boolean | undefined; trailing?: ReactNode };

/** Input avec icône à gauche et zone optionnelle à droite. */
export function IconInput({ icon: Icon, invalid, trailing, className, ...props }: IconInputProps) {
  return (
    <div className="relative">
      {Icon && <Icon className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />}
      <Input aria-invalid={invalid ? true : undefined} className={cn(Icon && "pl-10", trailing ? "pr-11" : "", className)} {...props} />
      {trailing && <div className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailing}</div>}
    </div>
  );
}

export function SearchField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <IconInput icon={Search} type="search" className={cn("h-10 bg-secondary", className)} {...props} />;
}

export function PasswordField({ invalid, ...props }: Omit<IconInputProps, "type" | "icon" | "trailing">) {
  const [visible, setVisible] = useState(false);
  return (
    <IconInput
      {...props}
      invalid={invalid}
      type={visible ? "text" : "password"}
      autoComplete={props.autoComplete ?? "current-password"}
      trailing={
        <button type="button" onClick={() => setVisible((v) => !v)} aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
          {visible ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
        </button>
      }
    />
  );
}

/** Indicateur de robustesse du mot de passe (design uniquement — règles à aligner sur le backend). */
export function PasswordStrength({ value }: { value: string }) {
  const checks = [value.length >= 8, /[A-Z]/.test(value), /[0-9]/.test(value), /[^A-Za-z0-9]/.test(value)];
  const score = checks.filter(Boolean).length;
  const labels = ["Trop court", "Faible", "Moyen", "Bon", "Excellent"];
  const colors = ["bg-muted", "bg-destructive", "bg-warning", "bg-info", "bg-success"];
  return (
    <div className="space-y-1.5" aria-live="polite">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i < score ? colors[score] : "bg-muted")} />)}
      </div>
      <p className="text-xs text-muted-foreground">Robustesse : <span className="font-semibold text-foreground">{value ? labels[score] : "—"}</span></p>
    </div>
  );
}

/* ---------- Téléphone ---------- */
export function PhoneField({ country, value, onChange, onCountryClick, invalid, id }: { country: Country; value: string; onChange: (v: string) => void; onCountryClick?: (() => void) | undefined; invalid?: boolean | undefined; id?: string | undefined }) {
  return (
    <div className={cn("flex h-11 overflow-hidden rounded-md border border-input bg-card transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25", invalid && "border-destructive ring-2 ring-destructive/20")}>
      <button type="button" onClick={onCountryClick} className="flex shrink-0 items-center gap-2 border-r border-input bg-secondary/60 px-3 text-sm font-semibold hover:bg-accent" aria-label={`Indicatif ${country.name}`}>
        <span className="grid h-5 w-7 place-items-center rounded bg-accent text-[10px] font-bold text-accent-foreground">{country.code}</span>
        {country.dial}
        <ChevronDown className="size-4 text-muted-foreground" />
      </button>
      <input
        id={id}
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="6 XX XX XX XX"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d ]/g, ""))}
        aria-invalid={invalid ? true : undefined}
        className="min-w-0 flex-1 bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground md:text-sm"
      />
    </div>
  );
}

/* ---------- Code OTP ---------- */
export function OtpField({ length = 6, value, onChange, invalid, disabled, onComplete }: { length?: number; value: string; onChange: (v: string) => void; invalid?: boolean | undefined; disabled?: boolean | undefined; onComplete?: ((v: string) => void) | undefined }) {
  return (
    <InputOTP maxLength={length} value={value} onChange={onChange} disabled={disabled ?? false} onComplete={onComplete ?? (() => {})} containerClassName="justify-center gap-2" inputMode="numeric" autoComplete="one-time-code">
      <InputOTPGroup className="gap-2">
        {Array.from({ length }).map((_, i) => (
          <InputOTPSlot
            key={i}
            index={i}
            className={cn(
              "h-14 w-11 rounded-md border bg-card text-xl font-display font-bold first:rounded-l-md last:rounded-r-md sm:w-12",
              invalid ? "border-destructive text-destructive" : "border-input",
            )}
          />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

/* ---------- Carte sélectionnable (radio visuel) ---------- */
export function SelectableCard({ selected, onSelect, icon: Icon, iconClassName, title, description, trailing, disabled }: { selected: boolean; onSelect: () => void; icon?: IconType | undefined; iconClassName?: string | undefined; title: string; description?: string | undefined; trailing?: ReactNode; disabled?: boolean | undefined }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border bg-card p-3.5 text-left transition disabled:opacity-50",
        selected ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-primary/40",
      )}
    >
      {Icon && <span className={cn("grid size-11 shrink-0 place-items-center rounded-md bg-accent text-primary", iconClassName)}><Icon className="size-5" /></span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        {description && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>}
      </span>
      {trailing}
      <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2", selected ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
        {selected && <Check className="size-3.5" />}
      </span>
    </button>
  );
}

/* ---------- Envoi de fichier / image ---------- */
export type UploadState = "idle" | "uploading" | "done" | "error";

export function FileDropzone({ label = "Ajouter un fichier", hint = "PNG, JPG ou PDF — 5 Mo maximum", state = "idle", fileName, progress = 0, kind = "image", onPick, onRemove, errorText = "L'envoi a échoué. Réessayez." }: {
  label?: string; hint?: string; state?: UploadState; fileName?: string | undefined; progress?: number; kind?: "image" | "file"; onPick?: (file: File) => void; onRemove?: () => void; errorText?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const Icon = kind === "image" ? ImageIcon : File;
  if (state === "idle") {
    return (
      <label htmlFor={id} className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input bg-card px-4 py-8 text-center transition hover:border-primary/60 hover:bg-primary/5">
        <span className="grid size-12 place-items-center rounded-full bg-accent text-primary"><Upload className="size-6" /></span>
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
        <input ref={inputRef} id={id} type="file" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick?.(f); }} />
      </label>
    );
  }
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border bg-card p-3.5", state === "error" ? "border-destructive/50" : "border-border")}>
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-md", state === "error" ? "bg-destructive/12 text-destructive" : state === "done" ? "bg-success/15 text-success" : "bg-accent text-primary")}>
        {state === "uploading" ? <Spinner /> : state === "done" ? <CheckCircle className="size-6" /> : state === "error" ? <AlertCircle className="size-6" /> : <Icon className="size-6" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{fileName ?? "document.pdf"}</p>
        {state === "uploading" && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
            <span className="text-[11px] font-semibold text-muted-foreground">{progress}%</span>
          </div>
        )}
        {state === "done" && <p className="text-xs text-success">Envoi terminé</p>}
        {state === "error" && <p className="text-xs text-destructive">{errorText}</p>}
      </div>
      <button type="button" onClick={onRemove} aria-label="Retirer le fichier" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent"><X className="size-4" /></button>
    </div>
  );
}
