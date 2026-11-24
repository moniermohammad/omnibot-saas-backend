-- AlterTable
ALTER TABLE "schedules" ADD COLUMN     "is_updated" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN     "last_status" VARCHAR(20),
ADD COLUMN     "outcome_data" JSONB NOT NULL DEFAULT '{}';
