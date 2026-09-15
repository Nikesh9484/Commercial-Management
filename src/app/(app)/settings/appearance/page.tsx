import { PageHeader } from "@/components/ui/PageHeader";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";

export const metadata = { title: "Appearance" };

export default function AppearancePage() {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Settings"
        title="Appearance"
        subtitle="How the dashboard looks on this computer: the theme, the colour, whether buttons stand off the page, and the colour and size of the writing. The change happens as you pick it."
      />
      <AppearanceSettings />
    </div>
  );
}
