import { Mail } from "lucide-react";

/** Downloads a ready-to-send notice email (.eml) for one expiry category of the Bonds & Insurance register – every contractor in it, or one. */
export function BondNoticeButton({ bucket, contractor = "", size = "sm", label }: { bucket: "expired" | "d30" | "d60"; contractor?: string; size?: "xs" | "sm"; label?: string }) {
  const q = `format=eml&kind=bonds&bucket=${bucket}${contractor ? `&contractor=${encodeURIComponent(contractor)}` : ""}`;
  const what = bucket === "expired" ? "expired bonds and policies" : bucket === "d30" ? "bonds and policies expiring within 30 days" : "bonds and policies expiring within 60 days";
  const title = contractor
    ? `Download a ready-to-send notice email (.eml) to ${contractor} for its ${what}: every item's reference, type, policy number, issuer, contract, cover, dates and what is required by when, with its bonds report attached`
    : `Download one notice email per contractor (a zip of .eml drafts) for the ${what}: every item's reference, type, policy number, issuer, contract, cover, dates and what is required by when, each with that contractor's bonds report attached`;
  return (
    <a className={`btn btn-${size} btn-secondary`} href={`/api/email-report?${q}`} title={title}>
      <Mail size={size === "xs" ? 12 : 14} /> {label ?? (contractor ? "Email notice" : "Email notices (one per contractor)")}
    </a>
  );
}
