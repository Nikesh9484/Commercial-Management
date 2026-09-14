import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { aiEnabled, aiKeyPresent, setAiEnabled } from "@/lib/ai-switch";
import { isEditorRole } from "@/lib/registers/types";

/** The one on/off switch for everything that costs money to run. */

export const GET = withUser(async () => NextResponse.json({ enabled: aiEnabled(), keyPresent: aiKeyPresent() }));

export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (!isEditorRole(user.role)) return NextResponse.json({ error: "Only an admin or editor can change this." }, { status: 403 });
    const body = await readJson(req);
    setAiEnabled(body.enabled !== false);
    return NextResponse.json({ enabled: aiEnabled(), keyPresent: aiKeyPresent() });
  })(req, ctx);
}
