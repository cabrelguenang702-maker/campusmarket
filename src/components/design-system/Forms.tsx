import { useState } from "react";
import { fr } from "date-fns/locale";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarDays, Mail, Store } from "@/components/icons";
import { FileDropzone, Field, IconInput, OtpField, PasswordField, PasswordStrength, PhoneField, SearchField, SelectableCard } from "@/components/cm/forms";
import { countries, formatFcfa } from "@/lib/mock-data";
import { Block } from "./Block";

export function FormsSection() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("123");
  const [pwd, setPwd] = useState("Campus2");
  const [price, setPrice] = useState([150000]);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [choice, setChoice] = useState("mtn");
  return (
    <div>
      <Block title="Champs de saisie" description="Hauteur 44 px, focus visible, erreur sous le champ avec icône (jamais la couleur seule).">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Nom de l'annonce" htmlFor="ds-name" hint="60 caractères maximum"><IconInput id="ds-name" icon={Store} placeholder="Ex. MacBook Air M2" /></Field>
          <Field label="E-mail" htmlFor="ds-mail" error="Saisissez une adresse e-mail valide."><IconInput id="ds-mail" icon={Mail} invalid defaultValue="jean@" /></Field>
          <Field label="Recherche"><SearchField placeholder="Rechercher…" /></Field>
          <Field label="Champ désactivé"><IconInput disabled defaultValue="Non modifiable" /></Field>
          <Field label="Catégorie">
            <Select defaultValue="pc">
              <SelectTrigger className="h-11 bg-card"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="pc">Ordinateurs</SelectItem><SelectItem value="tel">Téléphones</SelectItem><SelectItem value="livres">Livres et cours</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Date de l'événement">
            <Popover>
              <PopoverTrigger asChild><Button variant="outline" className="h-11 w-full justify-start font-normal"><CalendarDays />{date ? format(date, "PPP", { locale: fr }) : "Choisir une date"}</Button></PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={date} onSelect={setDate} locale={fr} /></PopoverContent>
            </Popover>
          </Field>
          <Field label="Description" className="sm:col-span-2"><Textarea placeholder="Décrivez l'état, les accessoires inclus, la raison de la vente…" /></Field>
        </div>
      </Block>

      <Block title="Téléphone, code OTP et mot de passe">
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Téléphone"><PhoneField country={countries[0]!} value={phone} onChange={setPhone} /></Field>
          <Field label="Téléphone (erreur)" error="Numéro invalide."><PhoneField country={countries[1]!} value="12" onChange={() => {}} invalid /></Field>
          <div><Label className="mb-2 block text-[13px] font-semibold">Code OTP</Label><OtpField value={otp} onChange={setOtp} /></div>
          <div><Label className="mb-2 block text-[13px] font-semibold">Code OTP (incorrect)</Label><OtpField value="000000" onChange={() => {}} invalid /></div>
          <div className="space-y-3"><Field label="Mot de passe"><PasswordField value={pwd} onChange={(e) => setPwd(e.target.value)} /></Field><PasswordStrength value={pwd} /></div>
        </div>
      </Block>

      <Block title="Choix : case, radio, interrupteur, curseur, carte sélectionnable">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="flex items-center gap-2"><Checkbox id="ds-c1" defaultChecked /><Label htmlFor="ds-c1">Accepter les conditions</Label></div>
            <div className="flex items-center gap-2"><Checkbox id="ds-c2" /><Label htmlFor="ds-c2">Recevoir la newsletter</Label></div>
            <RadioGroup defaultValue="neuf" className="pt-2">
              {[["neuf", "Neuf"], ["bon", "Bon état"], ["occ", "Occasion"]].map(([v, l]) => <div key={v} className="flex items-center gap-2"><RadioGroupItem value={v!} id={`ds-r-${v}`} /><Label htmlFor={`ds-r-${v}`}>{l}</Label></div>)}
            </RadioGroup>
            <div className="flex items-center justify-between rounded-md border border-border p-3"><Label htmlFor="ds-sw">Notifications de messages</Label><Switch id="ds-sw" defaultChecked /></div>
            <div><div className="mb-3 flex justify-between text-sm"><Label>Prix maximum</Label><span className="font-semibold text-primary">{formatFcfa(price[0] ?? 0)}</span></div><Slider value={price} onValueChange={setPrice} min={0} max={500000} step={5000} /></div>
          </div>
          <div className="space-y-2.5" role="radiogroup" aria-label="Moyen de paiement">
            <SelectableCard selected={choice === "mtn"} onSelect={() => setChoice("mtn")} title="MTN Mobile Money" description="Paiement instantané" />
            <SelectableCard selected={choice === "om"} onSelect={() => setChoice("om")} title="Orange Money" description="Paiement instantané" />
            <SelectableCard selected={false} onSelect={() => {}} title="Carte bancaire" description="Bientôt disponible" disabled />
          </div>
        </div>
      </Block>

      <Block title="Envoi de fichiers" description="Zone de dépôt, envoi en cours, terminé et erreur.">
        <div className="grid gap-3 sm:grid-cols-2">
          <FileDropzone label="Ajouter des photos" hint="JPG ou PNG — 5 Mo max" />
          <FileDropzone state="uploading" progress={62} fileName="macbook-face.jpg" />
          <FileDropzone state="done" fileName="carte-etudiante.pdf" kind="file" />
          <FileDropzone state="error" fileName="ordinateur-arriere.png" errorText="Fichier trop lourd (8 Mo). Maximum : 5 Mo." />
        </div>
      </Block>
    </div>
  );
}
