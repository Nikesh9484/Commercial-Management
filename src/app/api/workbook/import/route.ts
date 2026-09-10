import { NextResponse } from "next/server";
import { withUser, readJson } from "@/lib/api";
import { importWorkbook, type ImportRequest } from "@/lib/workbook/import";
import { AuthError } from "@/lib/auth";

export async function POST(req: Request, ctx: unknown) {
  return withUser(async (user) => {
    if (user.role !== "admin" && user.role !== "editor") throw new AuthError("Only Editors and Admins can import a workbook.");
    const body = (await readJson(req)) as unknown as ImportRequest;
    const result = await importWorkbook(body, user);
    return NextResponse.json(result);
  })(req, ctx);
}
