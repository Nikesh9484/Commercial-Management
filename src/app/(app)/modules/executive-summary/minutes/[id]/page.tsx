import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Users, Download } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getAppContext } from "@/lib/context";
import { getDb } from "@/lib/db";
import { getRegisterDef } from "@/lib/registers";
import { getRecord } from "@/lib/registers/engine";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { RegisterPage } from "@/components/register/RegisterPage";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = getRecord(getRegisterDef("meetings")!, Number(id));
  return { title: m ? `Minutes · ${m.meeting_no}` : "Minutes" };
}

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = (await getCurrentUser())!;
  const ctx = getAppContext();
  const m = getRecord(getRegisterDef("meetings")!, Number(id));
  if (!m || !ctx.programme || Number(m.programme_id) !== ctx.programme.id) notFound();
  const earlier = (getDb().prepare("SELECT id FROM meetings WHERE programme_id = ? AND (meeting_date < ? OR (meeting_date = ? AND id < ?))").all(ctx.programme.id, m.meeting_date, m.meeting_date, m.id) as { id: number }[]).map((r) => r.id);
  const isAdmin = user.role === "admin";
  const people = String(m.attendees ?? "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="space-y-5">
      <Link href="/modules/executive-summary/minutes" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft size={16} /> All meetings
      </Link>
      <PageHeader
        eyebrow={`Meeting ${m.meeting_no} · ${formatDate(m.meeting_date as string)}`}
        title={String(m.title)}
        subtitle={[m.period_id__label, m.venue, m.chair ? `Chair: ${m.chair}` : ""].filter(Boolean).join(" · ")}
        actions={
          // eslint-disable-next-line @next/next/no-html-link-for-pages -- file download, not a page
          <a className="btn btn-secondary btn-sm" href="/api/registers/actions/export">
            <Download size={14} /> Export all items (Excel)
          </a>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
            <Users size={16} className="text-navy" /> Attendees
          </h2>
          {people.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {people.map((p) => (
                <li key={p} className="rounded-full bg-page px-2.5 py-0.5 text-xs text-ink ring-1 ring-inset ring-line">
                  {p}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No attendees recorded. Edit the meeting on the meetings list to add them.</p>
          )}
          {m.apologies ? <p className="mt-2 text-xs text-muted">Apologies: {String(m.apologies)}</p> : null}
        </div>
        <div className="card p-5">
          <h2 className="mb-2 text-sm font-semibold text-ink">General notes</h2>
          <p className="whitespace-pre-wrap text-sm text-muted">{String(m.notes ?? "") || "—"}</p>
        </div>
      </div>

      {earlier.length > 0 && (
        <section>
          <h2 className="mb-1 text-base font-semibold text-ink">Carried forward</h2>
          <p className="mb-2 text-xs text-muted">Items from earlier meetings that are still open. Update the status or the latest update here; they drop off once closed.</p>
          <RegisterPage registerKey="actions" isAdmin={isAdmin} fixedFilter={{ meeting_id: { in: earlier }, status: { notIn: ["Closed"] } }} />
        </section>
      )}

      <section>
        <h2 className="mb-1 text-base font-semibold text-ink">Items raised at this meeting</h2>
        <p className="mb-2 text-xs text-muted">Item No, Topic, Discussion, Action, Owner, Due date and Status. Leave Item No blank to number automatically ({String(m.meeting_no)}-01, -02, …).</p>
        <RegisterPage registerKey="actions" isAdmin={isAdmin} fixedFilter={{ meeting_id: m.id }} hideFields={["meeting_id"]} />
      </section>
    </div>
  );
}
