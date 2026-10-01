import { fromDocumentsRoute } from "@/lib/from-docs-route";
import { addPaymentsFromDocuments } from "@/lib/payments/from-docs";

/** POST /api/payments/from-documents – a payment application / IPC entry from its transmittal, certificate letter or payment certificate; the admin, the editors and the user account. */
export const POST = fromDocumentsRoute({ dir: "payments", refuse: (u) => (["admin", "editor", "contributor", "reporter"].includes(u.role) ? null : "Your role cannot upload payment documents."), run: addPaymentsFromDocuments });
