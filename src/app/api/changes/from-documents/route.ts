import { fromDocumentsRoute } from "@/lib/from-docs-route";
import { addChangesFromDocuments } from "@/lib/changes/from-docs";

/** POST /api/changes/from-documents – a change entry from its RFC / PVO / EVO / EI / RFA / DVO; an Admin's job. */
export const POST = fromDocumentsRoute({ dir: "changes", refuse: (u) => (u.role === "admin" ? null : "Only an Admin can add changes from documents."), run: addChangesFromDocuments });
