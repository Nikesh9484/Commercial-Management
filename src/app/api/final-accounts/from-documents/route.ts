import { fromDocumentsRoute } from "@/lib/from-docs-route";
import { addFinalAccountsFromDocuments } from "@/lib/final-accounts/from-docs";

/** POST /api/final-accounts/from-documents – the final account statement and its transmittals close the contract on the Final Account Status and in Payment Tracking, and are filed in the Contract Library. */
export const POST = fromDocumentsRoute({ dir: "final-accounts", refuse: (u) => (["admin", "editor", "contributor", "reporter"].includes(u.role) ? null : "Your role cannot upload final account documents."), run: addFinalAccountsFromDocuments });
