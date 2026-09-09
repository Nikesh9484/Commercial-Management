"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ToastProvider } from "@/components/ui/Toast";
import type { AppContext } from "@/lib/context";
import type { UserInfo } from "@/lib/registers/types";

export function AppShell({ context, user, children }: { context: AppContext; user: UserInfo; children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <ToastProvider>
      <div className="flex min-h-screen">
        <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} role={user.role} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar context={context} user={user} onMenu={() => setMenuOpen(true)} />
          <main className="flex-1 p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
