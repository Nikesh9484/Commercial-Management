"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

type Toast = { id: number; kind: "success" | "error"; text: string };
const Ctx = createContext<{ toast: (text: string, kind?: Toast["kind"]) => void }>({ toast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((text: string, kind: Toast["kind"] = "success") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 8000 : 4000);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-lg items-start gap-2 rounded-lg px-4 py-3 text-sm shadow-lg ${
              t.kind === "error" ? "bg-red-600 text-white" : "bg-navy text-white"
            }`}
          >
            {t.kind === "error" ? <AlertCircle size={18} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0" />}
            <span>{t.text}</span>
            <button className="ml-2 opacity-70 hover:opacity-100" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))} aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx).toast;
}
