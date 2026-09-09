import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { AppShell } from "@/components/layout/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const context = getAppContext();
  return (
    <AppShell context={context} user={user}>
      {children}
    </AppShell>
  );
}
