"use client";
import { GlobalDrop } from "@/components/layout/GlobalDrop";
import { CopyTables } from "@/components/layout/CopyTables";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ToastProvider } from "@/components/ui/Toast";
import { ScopeProvider } from "./ScopeContext";
import type { AppContext } from "@/lib/context";
import type { UserInfo } from "@/lib/registers/types";

export function AppShell({ context, user, children }: { context: AppContext; user: UserInfo; children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <ToastProvider>
      <div className="flex min-h-screen">
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} role={user.role} project={context.programme ? (context.asset && context.asset.code.startsWith(`${context.programme.code}.`) ? context.asset.name : context.programme.name) : null} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar context={context} user={user} onMenu={() => setMenuOpen(true)} />
          <main className="flex-1 p-4 sm:p-6">
            <ScopeProvider value={`${context.programme?.id ?? ""}:${context.asset?.id ?? ""}:${context.period?.id ?? ""}`}>{children}</ScopeProvider>
            <CopyTables />
            <GlobalDrop enabled={["admin", "editor", "contributor", "reporter"].includes(user.role) && !!context.programme} />
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
