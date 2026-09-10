import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { reporterAllowed } from "@/lib/registers/types";
import { getAppContext } from "@/lib/context";
import { AppShell } from "@/components/layout/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "reporter") {
    // the role in the database wins over the one in the login token: a re-assigned account is limited at once
    const path = (await headers()).get("x-pathname") ?? "";
    if (path && !reporterAllowed(path)) redirect("/reports");
  }
  const context = getAppContext();
  return (
    <AppShell context={context} user={user}>
      {children}
    </AppShell>
  );
}
