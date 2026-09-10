import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { importWorkbook, type ImportRequest } from "@/lib/workbook/import";

export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    const body = (await readJson(req)) as unknown as ImportRequest;
    const result = await importWorkbook(body, user);
    return NextResponse.json(result);
  })(req, ctx);
}
