import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold text-ink">Page not found</h1>
      <p className="text-sm text-muted">That page does not exist.</p>
      <Link href="/" className="btn btn-primary">
        Back to home
      </Link>
    </div>
  );
}
