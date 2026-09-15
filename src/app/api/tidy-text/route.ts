import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getAppContext } from "@/lib/context";
import { previewTidy, tidyRegisters } from "@/lib/text/tidy-registers";

/** GET → what the tidy would change. POST → change it. */
export const GET = withUser(async () => {
  const app = getAppContext();
  return NextResponse.json({ changes: previewTidy(getDb(), app.programme?.id ?? null) });
});

export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (user.role !== "admin" && user.role !== "editor") {
      return NextResponse.json({ error: "Only an Admin or Editor can tidy the wording." }, { status: 403 });
    }
    const app = getAppContext();
    return NextResponse.json(tidyRegisters(getDb(), app.programme?.id ?? null, user));
  })(req, ctx);
}
