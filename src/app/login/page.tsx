import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Log in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-dark bg-[radial-gradient(ellipse_at_top,_#1d4470_0%,_#0a1f38_60%)] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-accent text-lg font-bold">CD</div>
          <h1 className="text-2xl font-semibold">Commercial Dashboard</h1>
          <p className="mt-1 text-sm text-blue-200/80">Monthly commercial reporting</p>
        </div>
        <div className="card p-6">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
