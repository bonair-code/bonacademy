-- Add index on Notification.sentAt to support periodic cleanup of old dedup rows.
CREATE INDEX IF NOT EXISTS "Notification_sentAt_idx" ON "Notification"("sentAt");
