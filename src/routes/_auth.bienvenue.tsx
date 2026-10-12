import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, GraduationCap, ShoppingBag, Users } from "@/components/icons";
import heroImage from "@/assets/campus-market-hero.jpg";
import { AppLink } from "@/components/cm/app-link";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_auth/bienvenue")({
  head: () => ({ meta: [{ title: "Bienvenue — CampusMarket" }] }),
  component: WelcomePage,
});

const features = [
  { icon: ShoppingBag, title: "Achetez et vendez", text: "Des milliers d'annonces d'étudiants, près de votre campus." },
  { icon: GraduationCap, title: "Apprenez", text: "Formations, certificats et cours gratuits ou payants." },
  { icon: Users, title: "Rejoignez votre campus", text: "Communautés, groupes et événements de votre université." },
];

function WelcomePage() {
  const [lang, setLang] = useState<"fr" | "en">("fr");
  return (
    <div className="fade-up flex flex-1 flex-col">
      <div className="dark relative overflow-hidden rounded-2xl lg:hidden">
        <img src={heroImage} alt="" className="h-44 w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
      </div>

      <p className="section-kicker mt-6 lg:mt-0">Bienvenue</p>
      <h1 className="font-display text-3xl font-bold leading-tight">Votre campus, dans votre poche.</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">Rejoignez la plateforme des étudiants africains pour acheter, vendre, apprendre et échanger en toute confiance.</p>

      <ul className="mt-6 space-y-3">
        {features.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3 rounded-lg border border-border bg-card p-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-accent text-primary"><Icon className="size-5" /></span>
            <span><span className="block text-sm font-semibold">{title}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{text}</span></span>
          </li>
        ))}
      </ul>

      <div className="mt-8 space-y-3">
        <Button asChild size="lg" className="w-full"><AppLink to="/inscription/pays">Créer mon compte <ArrowRight /></AppLink></Button>
        <Button asChild size="lg" variant="outline" className="w-full"><AppLink to="/connexion">J'ai déjà un compte</AppLink></Button>
        <Button asChild variant="ghost" className="w-full text-muted-foreground"><AppLink to="/">Découvrir sans compte</AppLink></Button>
      </div>

      <div className="mt-8 flex justify-center gap-1 rounded-full border border-border bg-card p-1 text-xs font-semibold" role="group" aria-label="Langue" style={{ alignSelf: "center" }}>
        {([["fr", "Français"], ["en", "English"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setLang(id)} aria-pressed={lang === id} className={cn("rounded-full px-4 py-1.5 transition", lang === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</button>
        ))}
      </div>
    </div>
  );
}
