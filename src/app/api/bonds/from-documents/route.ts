import { fromDocumentsRoute } from "@/lib/from-docs-route";
import { addBondsFromDocuments } from "@/lib/bonds/from-docs";

/** POST /api/bonds/from-documents – a bond or insurance entry from its schedule, certificate or guarantee; the admin, the editors and the user account. */
export const POST = fromDocumentsRoute({ dir: "bonds", refuse: (u) => (["admin", "editor", "contributor", "reporter"].includes(u.role) ? null : "Your role cannot upload bonds and insurance documents."), run: addBondsFromDocuments });
