import { redirect } from "next/navigation";

/** The monthly workbook import moved to the "Stand-alone imports" menu. */
export default function LegacyImportPage() {
  redirect("/imports/monthly");
}
