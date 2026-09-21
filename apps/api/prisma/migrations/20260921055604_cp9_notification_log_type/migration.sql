-- AlterTable
ALTER TABLE "notification_logs" ADD COLUMN "type" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "notification_logs_visit_id_type_key" ON "notification_logs"("visit_id", "type");
