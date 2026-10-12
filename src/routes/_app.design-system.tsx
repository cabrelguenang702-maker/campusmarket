import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/layout/PageHeader";
import { Foundations } from "@/components/design-system/Foundations";
import { ComponentsSection } from "@/components/design-system/Components";
import { FormsSection } from "@/components/design-system/Forms";
import { FeedbackSection } from "@/components/design-system/Feedback";
import { ProgressSection } from "@/components/design-system/Progress";

export const Route = createFileRoute("/_app/design-system")({
  head: () => ({ meta: [{ title: "Design system — CampusMarket" }] }),
  component: DesignSystemPage,
});

const tabs = [
  { id: "fondations", label: "Fondations", node: <Foundations /> },
  { id: "composants", label: "Composants", node: <ComponentsSection /> },
  { id: "formulaires", label: "Formulaires", node: <FormsSection /> },
  { id: "retours", label: "Retours et états", node: <FeedbackSection /> },
  { id: "avancement", label: "Avancement", node: <ProgressSection /> },
];

function DesignSystemPage() {
  return (
    <div>
      <PageHeader kicker="Phase 1" title="Design system" description="Couleurs, typographie, composants et états partagés par tous les écrans de CampusMarket, en thème clair et sombre." breadcrumbs={[{ label: "Accueil", to: "/" }, { label: "Design system" }]} />
      <Tabs defaultValue="fondations">
        <TabsList className="no-scrollbar mb-6 h-auto w-full justify-start gap-1 overflow-x-auto p-1">
          {tabs.map((t) => <TabsTrigger key={t.id} value={t.id} className="shrink-0 px-4 py-2">{t.label}</TabsTrigger>)}
        </TabsList>
        {tabs.map((t) => <TabsContent key={t.id} value={t.id}>{t.node}</TabsContent>)}
      </Tabs>
    </div>
  );
}
