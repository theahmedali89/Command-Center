import { requireUser } from "@/lib/session";
import { db } from "@/lib/db";
import { getIntegrationStatuses } from "@/app/api/settings/integrations/route";
import SettingsForm from "./SettingsForm";
import { AgentKeysManager } from "./AgentKeysManager";

export default async function SettingsPage(): Promise<React.ReactElement> {
  const user = await requireUser();

  const settings = await db.userSettings.findUnique({
    where: { userId: user.id },
  });

  const integrations = getIntegrationStatuses();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Brand, AI defaults and publishing preferences. Integration status is
        read-only — secret values are never shown.
      </p>
      <SettingsForm
        initial={{
          brandName: settings?.brandName ?? "",
          websiteUrl: settings?.websiteUrl ?? "",
          brandDescription: settings?.brandDescription ?? "",
          defaultTone: settings?.defaultTone ?? "Friendly",
          defaultLanguage: settings?.defaultLanguage ?? "en",
          defaultCta: settings?.defaultCta ?? "",
          defaultTimezone: settings?.defaultTimezone ?? "Asia/Karachi",
          approvalRequired: settings?.approvalRequired ?? true,
        }}
        integrations={integrations}
      />
      <div className="mt-6">
        <AgentKeysManager />
      </div>
    </div>
  );
}
