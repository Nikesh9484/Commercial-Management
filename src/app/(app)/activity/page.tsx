import { getDb } from "@/lib/db";
import { getRecentActivity } from "@/lib/audit";
import { PageHeader } from "@/components/ui/PageHeader";
import { HistoryList } from "@/components/register/HistoryPanel";

export const metadata = { title: "Change history" };

export default function ActivityPage() {
  const entries = getRecentActivity(getDb(), 300);
  return (
    <div>
      <PageHeader title="Change history" subtitle="The latest 300 changes across every register: who changed what, and when." />
      <div className="card px-5">
        <HistoryList entries={entries} showRegister />
      </div>
    </div>
  );
}
