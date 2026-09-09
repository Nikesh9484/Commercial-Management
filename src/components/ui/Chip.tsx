import type { ChipTone } from "@/lib/registers/types";
import { statusTone } from "@/lib/registers/types";

const TONES: Record<ChipTone, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  grey: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function Chip({ children, tone, className = "" }: { children: React.ReactNode; tone?: ChipTone; className?: string }) {
  const t = tone ?? statusTone(typeof children === "string" ? children : "");
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[t]} ${className}`}>
      {children}
    </span>
  );
}
