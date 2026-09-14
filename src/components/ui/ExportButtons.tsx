import { FileDown, FileSpreadsheet } from "lucide-react";

/** "Download PDF / Excel" for one section of the monthly report (see /api/export). */
export function ExportButtons({ section, size = "sm", label, params, title }: { section: string; size?: "sm" | "md"; label?: string; /** Extra query string carried into the export, e.g. the page's own filter. */ params?: string; /** Overrides the hover text on both buttons. */ title?: string }) {
  const cls = size === "sm" ? "btn btn-sm" : "btn";
  const q = `section=${encodeURIComponent(section)}${params ? `&${params}` : ""}`;
  return (
    <span className="inline-flex items-center gap-1.5">
      {label && <span className="text-xs font-semibold text-muted">{label}</span>}
      <a className={`${cls} btn-pdf`} href={`/api/export?${q}&format=pdf`} title={title ? `${title} – print-ready PDF` : label ? `${label} – print-ready PDF` : "Download this page as a print-ready PDF"}>
        <FileDown size={14} /> PDF
      </a>
      <a className={`${cls} btn-excel`} href={`/api/export?${q}&format=xlsx`} title={title ? `${title} – formatted Excel` : label ? `${label} – formatted Excel` : "Download this page as a formatted Excel file"}>
        <FileSpreadsheet size={14} /> Excel
      </a>
    </span>
  );
}
