"use client";

import { createContext, useContext } from "react";

/**
 * What the top bar has selected – project, asset and report – as one string that changes whenever
 * any of them does. Client components that fetch their own rows (the register tables) re-fetch on it,
 * so switching the project in the top bar refreshes every table on the page, not only the parts the
 * server renders.
 */
const ScopeContext = createContext("");

export function ScopeProvider({ value, children }: { value: string; children: React.ReactNode }) {
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScopeKey(): string {
  return useContext(ScopeContext);
}
