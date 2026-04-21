import { NextResponse } from "next/server";
import { issueSliderToken } from "@/lib/captcha";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json({ token: issueSliderToken() });
}
