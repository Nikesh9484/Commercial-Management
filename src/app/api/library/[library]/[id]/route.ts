import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { assertLibrary, getDoc, updateDoc, removeDoc, applyReading, docText } from "@/lib/library/store";
import { readDocument } from "@/lib/library/read";

type Ctx = { params: Promise<{ library: string; id: string }> };

/** PATCH { contractor_id?, contract_id?, doc_type?, title?, reference?, doc_date?, claim_ref?, summary?, … } or { reread: true }. */
export async function PATCH(req: Request, ctx: Ctx) {
  return withUser<Ctx>(async (user, { params }) => {
    const { library, id } = await params;
    assertLibrary(library);
    const body = await readJson(req);
    const cur = getDoc(Number(id));
    if (!cur) return NextResponse.json({ error: "Document not found." }, { status: 404 });
    if (body.reread === true) {
      const reading = await readDocument(cur.programme_id, cur.library, cur.name, docText(cur.id));
      return NextResponse.json({ doc: applyReading(cur.id, reading, user) });
    }
    return NextResponse.json({ doc: updateDoc(cur.id, body, user) });
  })(req, ctx);
}

export const DELETE = withUser<Ctx>(async (user, { params }) => {
  const { library, id } = await params;
  assertLibrary(library);
  removeDoc(Number(id), user);
  return NextResponse.json({ ok: true });
});
