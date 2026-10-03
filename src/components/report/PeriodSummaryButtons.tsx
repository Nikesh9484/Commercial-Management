import Link from "next/link";
import { Sparkles, FileDown, FileSpreadsheet } from "lucide-react";

/**
 * One click to the Period Summary – the month's key movements as the directors get them:
 * on screen (interactive), as a PDF or as an Excel sheet. Follows the project and period in the top bar.
 */
export function PeriodSummaryButtons({ periodId, compact = false }: { periodId?: number; compact?: boolean }) {
  const pid = periodId ? `&period=${periodId}` : "";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Link href="/reports/period-summary" className="btn btn-sm btn-summary" title="The month's summary: projected cost to complete, budget position, forecast movement analysis and the items behind each movement">
        <Sparkles size={14} /> Period Summary
      </Link>
      <a className="btn btn-sm btn-pdf" href={`/api/export?section=period_summary&format=pdf${pid}`} title="Period Summary as a print-ready PDF">
        <FileDown size={14} /> Period Summary PDF
      </a>
      {!compact && (
        <a className="btn btn-sm btn-excel" href={`/api/export?section=period_summary&format=xlsx${pid}`} title="Period Summary as a formatted Excel sheet">
          <FileSpreadsheet size={14} /> Period Summary Excel
        </a>
      )}
    </span>
  );
}
