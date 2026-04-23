import { NextRequest, NextResponse } from "next/server";
import {
  sendNewAssignmentMails,
  sendDueReminders,
  sendOverdueMails,
} from "@/lib/notifications/dispatcher";
import { markOverdue } from "@/lib/scheduler/assignments";

export const runtime = "nodejs";
// Vercel Cron / harici scheduler tarafından tetiklenir. Secret header ile korunur.

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    // Vercel cron: "Bearer <CRON_SECRET>"
    const provided = auth?.replace(/^Bearer\s+/i, "").trim();
    if (provided !== expected) {
      return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
    }
  }
  const started = Date.now();
  const overdueResult = await markOverdue();
  await sendNewAssignmentMails();
  await sendDueReminders();
  await sendOverdueMails();
  return NextResponse.json({
    ok: true,
    ms: Date.now() - started,
    ...overdueResult,
  });
}
