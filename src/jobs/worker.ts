/**
 * Runs as a separate process: `npm run jobs:worker`
 * Responsibilities:
 *   - Roll forward recurring assignments (daily)
 *   - Mark overdue assignments (daily)
 *   - Send reminder & assignment notifications (hourly)
 */
import PgBoss from "pg-boss";
import {
  rollForwardRecurringAssignments,
  markOverdue,
} from "@/lib/scheduler/assignments";
import { sendDueReminders, sendNewAssignmentMails } from "@/lib/notifications/dispatcher";

async function main() {
  const boss = new PgBoss(process.env.DATABASE_URL!);
  await boss.start();

  await boss.schedule("daily-recurrence", "0 2 * * *");
  await boss.schedule("daily-overdue", "0 3 * * *");
  await boss.schedule("hourly-notifications", "0 * * * *");

  await boss.work("daily-recurrence", async () => {
    const r = await rollForwardRecurringAssignments();
    console.log("recurrence:", r);
  });
  await boss.work("daily-overdue", async () => {
    const r = await markOverdue();
    console.log("overdue:", r);
  });
  await boss.work("hourly-notifications", async () => {
    await sendNewAssignmentMails();
    await sendDueReminders();
  });

  console.log("Worker başlatıldı.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
