/**
 * Dataset delete processor - stubbed for PostgreSQL-only mode.
 * ClickHouse-specific dataset operations not needed.
 */

import { logger } from "@langfuse/shared/src/server";

export const processClickhouseDatasetDelete = async (_payload: any) => {
  logger.info("ClickHouse dataset delete skipped in PostgreSQL-only mode");
  return;
};
