import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { duplicateContractors, mergeDuplicateContractors } from "@/lib/contractors/merge";

/** GET → the companies recorded twice, and what merging them would move. */
export const GET = withUser(async () => NextResponse.json({ groups: duplicateContractors(getDb()) }));

/** POST → merge them. Admins and editors only; the audit log keeps what went into what. */
export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (user.role !== "admin" && user.role !== "editor") {
      return NextResponse.json({ error: "Only an Admin or Editor can merge contractor records." }, { status: 403 });
    }
    const body = await readJson(req);
    const only = Array.isArray(body.keys) ? body.keys.map(String) : undefined;
    const result = mergeDuplicateContractors(getDb(), user, only);
    return NextResponse.json({ ...result, groups_left: duplicateContractors(getDb()).length });
  })(req, ctx);
}
