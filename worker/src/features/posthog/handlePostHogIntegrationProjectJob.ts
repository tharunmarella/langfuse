/**
 * PostHog Integration - stubbed for PostgreSQL-only mode.
 * Analytics integrations require full ClickHouse functionality.
 */

import { Job } from "bullmq";
import { logger } from "@langfuse/shared/src/server";

export const handlePostHogIntegrationProjectJob = async (job: Job) => {
  logger.info("PostHog integration skipped in PostgreSQL-only mode");
  return;
};
