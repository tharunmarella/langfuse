-- AlterTable
ALTER TABLE "observations" ADD COLUMN     "cost_details" JSONB,
ADD COLUMN     "environment" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN     "prompt_name" TEXT,
ADD COLUMN     "prompt_version" INTEGER,
ADD COLUMN     "provided_cost_details" JSONB,
ADD COLUMN     "provided_usage_details" JSONB,
ADD COLUMN     "usage_details" JSONB;

-- AlterTable
ALTER TABLE "scores" ADD COLUMN     "environment" TEXT NOT NULL DEFAULT 'default',
ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "traces" ADD COLUMN     "environment" TEXT NOT NULL DEFAULT 'default';

-- CreateIndex
CREATE INDEX "observations_project_id_environment_idx" ON "observations"("project_id", "environment");

-- CreateIndex
CREATE INDEX "scores_project_id_environment_idx" ON "scores"("project_id", "environment");

-- CreateIndex
CREATE INDEX "traces_project_id_environment_idx" ON "traces"("project_id", "environment");
