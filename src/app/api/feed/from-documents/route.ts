import { fromDocumentsRoute } from "@/lib/from-docs-route";
import { feedDocuments } from "@/lib/feed";

/** POST /api/feed/from-documents – any files or folders: each is sorted to the register it belongs to (changes, bonds & insurance, payments). */
export const POST = fromDocumentsRoute({ dir: "feed", refuse: (u) => (["admin", "editor", "contributor", "reporter"].includes(u.role) ? null : "Your role cannot feed documents."), run: feedDocuments });
