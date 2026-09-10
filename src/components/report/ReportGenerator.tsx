"use client";

import { useState } from "react";
import { FileDown, FileSpreadsheet, Lock, Unlock } from "lucide-react";
import { Chip } from "@/components/ui/Chip";

export interface PeriodOption {
  id: number;
  label: string;
  status: string;
  locked_at: string | null;
}

export function ReportGenerator({ periods, currentId }: { periods: PeriodOption[]; currentId: number | null }) {
  const [periodId, setPeriodId] = useState<number | null>(currentId ?? periods[0]?.id ?? null);
  const period = periods.find((p) => p.id === periodId);
  return (
    <div className="card p-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Reporting period
          <select className="input" value={periodId ?? ""} onChange={(e) => setPeriodId(Number(e.target.value))}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} · {p.status}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-primary" href={`/api/report?period=${periodId}&format=pdf`}>
            <FileDown size={16} /> Generate PDF
          </a>
          <a className="btn btn-secondary" href={`/api/report?period=${periodId}&format=xlsx`}>
            <FileSpreadsheet size={16} /> Generate Excel
          </a>
        </div>
      </div>
      {period && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          {period.status === "Locked" ? (
            <Chip tone="green">
              <Lock size={11} className="mr-1" /> Locked – report uses the stored snapshot
            </Chip>
          ) : (
            <Chip tone="amber">
              <Unlock size={11} className="mr-1" /> Open – report is a DRAFT from live data
            </Chip>
          )}
          <span>Lock the period under Settings → Reporting Periods (or on Project Setup) to freeze the figures before issuing.</span>
        </div>
      )}
    </div>
  );
}
