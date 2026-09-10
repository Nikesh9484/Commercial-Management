import { Presentation, FileDown } from "lucide-react";

/** "PowerPoint / PDF slides" – the monthly cost report as a short, animated, fully editable presentation (see /api/export?section=deck). */
export function DeckButtons({ size = "sm", periodId }: { size?: "sm" | "md"; periodId?: number }) {
  const cls = size === "sm" ? "btn btn-sm" : "btn";
  const pid = periodId ? `&period=${periodId}` : "";
  return (
    <span className="inline-flex items-center gap-1.5">
      <a className={`${cls} btn-ppt`} href={`/api/export?section=deck&format=pptx${pid}`} title="Cost report presentation as an animated, fully editable PowerPoint: native charts, tables and text">
        <Presentation size={14} /> PowerPoint
      </a>
      <a className={`${cls} btn-pdf`} href={`/api/export?section=deck&format=pdf${pid}`} title="The same presentation as a PDF (16:9 slides)">
        <FileDown size={14} /> PDF slides
      </a>
    </span>
  );
}
