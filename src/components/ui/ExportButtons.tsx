import { FileDown, FileSpreadsheet } from "lucide-react";

/** "Download PDF / Excel" for one section of the monthly report (see /api/export). */
export function ExportButtons({ section, size = "sm" }: { section: string; size?: "sm" | "md" }) {
  const cls = size === "sm" ? "btn btn-sm" : "btn";
  return (
    <span className="inline-flex gap-1.5">
      <a className={`${cls} btn-pdf`} href={`/api/export?section=${encodeURIComponent(section)}&format=pdf`} title="Download this page as a print-ready PDF">
        <FileDown size={14} /> PDF
      </a>
      <a className={`${cls} btn-excel`} href={`/api/export?section=${encodeURIComponent(section)}&format=xlsx`} title="Download this page as a formatted Excel file">
        <FileSpreadsheet size={14} /> Excel
      </a>
    </span>
  );
}
