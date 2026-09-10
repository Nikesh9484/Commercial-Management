import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { PasswordForm } from "@/components/account/PasswordForm";

export const metadata = { title: "Change password" };

export default async function PasswordPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const user = (await getCurrentUser())!;
  const { first } = await searchParams;
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title="Change password" subtitle={`Signed in as ${user.email}`} />
      {(first || user.mustChangePassword) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Please choose your own password before you continue.</b> Your account was set up with a starting password that other people know. Once you save a new one, nobody else knows it, and the rest of the dashboard opens.
        </div>
      )}
      <PasswordForm />
    </div>
  );
}
