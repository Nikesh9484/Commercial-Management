import { FileDown, FileSpreadsheet } from "lucide-react";

/** "Download PDF / Excel" for one section of the monthly report (see /api/export). */
export function ExportButtons({ section, size = "sm", label }: { section: string; size?: "sm" | "md"; label?: string }) {
  const cls = size === "sm" ? "btn btn-sm" : "btn";
  return (
    <span className="inline-flex items-center gap-1.5">
      {label && <span className="text-xs font-semibold text-muted">{label}</span>}
      <a className={`${cls} btn-pdf`} href={`/api/export?section=${encodeURIComponent(section)}&format=pdf`} title={label ? `${label} – print-ready PDF` : "Download this page as a print-ready PDF"}>
        <FileDown size={14} /> PDF
      </a>
      <a className={`${cls} btn-excel`} href={`/api/export?section=${encodeURIComponent(section)}&format=xlsx`} title={label ? `${label} – formatted Excel` : "Download this page as a formatted Excel file"}>
        <FileSpreadsheet size={14} /> Excel
      </a>
    </span>
  );
}
