import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";

export const GET = withUser(async (user) => NextResponse.json({ user }));
