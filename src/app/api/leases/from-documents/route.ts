import { fromDocumentsRoute } from "@/lib/from-docs-route";
import { addLeasesFromDocuments } from "@/lib/leases/from-docs";

/** POST /api/leases/from-documents – a lease agreement or an amendment onto the accommodation lease tracker; the admin, the editors and the user account. */
export const POST = fromDocumentsRoute({ dir: "leases", refuse: (u) => (["admin", "editor", "contributor", "reporter"].includes(u.role) ? null : "Your role cannot upload lease agreements."), run: addLeasesFromDocuments });
