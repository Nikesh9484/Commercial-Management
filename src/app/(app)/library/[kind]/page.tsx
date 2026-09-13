import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getDb } from "@/lib/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { LIBRARIES, LIBRARY_INFO, listDocs, canManageLibrary, type LibraryKey } from "@/lib/library/store";
import { readerConfigured } from "@/lib/library/read";
import { DocumentLibrary } from "@/components/library/DocumentLibrary";

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return { title: LIBRARY_INFO[kind as LibraryKey]?.short ?? "Library" };
}

export default async function LibraryPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(LIBRARIES as readonly string[]).includes(kind)) notFound();
  const key = kind as LibraryKey;
  const info = LIBRARY_INFO[key];
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  const db = getDb();
  const docs = ctx.programme ? listDocs(ctx.programme.id, key) : [];
  const contracts = ctx.programme
    ? (db
        .prepare("SELECT c.id, c.title, COALESCE(c.reef_po_no,'') AS po, COALESCE(c.acc_ref,'') AS acc, c.contractor_id, COALESCE((SELECT name FROM contractors WHERE id = c.contractor_id),'') AS contractor FROM contracts c WHERE c.programme_id = ? ORDER BY c.sr_no, c.id")
        .all(ctx.programme.id) as { id: number; title: string; po: string; acc: string; contractor_id: number | null; contractor: string }[])
    : [];
  const contractors = (db.prepare("SELECT id, name FROM contractors WHERE active = 1 OR active IS NULL ORDER BY name COLLATE NOCASE").all() as { id: number; name: string }[]);
  return (
    <div className="space-y-4">
      <PageHeader eyebrow={`Libraries · ${ctx.programme?.name ?? ""}`} title={info.title} subtitle={info.subtitle} />
      {!ctx.programme ? (
        <div className="card flex items-center gap-2 p-5 text-sm text-muted">
          <AlertTriangle size={16} /> Select a project in the top bar first.
        </div>
      ) : (
        <DocumentLibrary library={key} info={{ short: info.short, types: info.types, hint: info.hint }} docs={docs} contracts={contracts} contractors={contractors} canManage={canManageLibrary(user)} engine={readerConfigured()} />
      )}
    </div>
  );
}
