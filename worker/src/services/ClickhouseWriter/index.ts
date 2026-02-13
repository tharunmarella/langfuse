import {
  ClickhouseClientType,
  BlobStorageFileLogInsertType,
  getCurrentSpan,
  ObservationRecordInsertType,
  ObservationBatchStagingRecordInsertType,
  recordGauge,
  recordHistogram,
  recordIncrement,
  ScoreRecordInsertType,
  TraceRecordInsertType,
  TraceNullRecordInsertType,
  DatasetRunItemRecordInsertType,
  EventRecordInsertType,
} from "@langfuse/shared/src/server";
import { prisma } from "@langfuse/shared/src/db";

import { env } from "../../env";
import { logger } from "@langfuse/shared/src/server";
import { instrumentAsync } from "@langfuse/shared/src/server";
import { backOff } from "exponential-backoff";

export class ClickhouseWriter {
  private static instance: ClickhouseWriter | null = null;
  private static client: ClickhouseClientType | null = null;
  batchSize: number;
  writeInterval: number;
  maxAttempts: number;
  queue: ClickhouseQueue;

  isIntervalFlushInProgress: boolean;
  intervalId: NodeJS.Timeout | null = null;

  private constructor() {
    this.batchSize = env.LANGFUSE_INGESTION_CLICKHOUSE_WRITE_BATCH_SIZE;
    this.writeInterval = env.LANGFUSE_INGESTION_CLICKHOUSE_WRITE_INTERVAL_MS;
    this.maxAttempts = env.LANGFUSE_INGESTION_CLICKHOUSE_MAX_ATTEMPTS;

    this.isIntervalFlushInProgress = false;

    this.queue = {
      [TableName.Traces]: [],
      [TableName.TracesNull]: [],
      [TableName.Scores]: [],
      [TableName.Observations]: [],
      [TableName.ObservationsBatchStaging]: [],
      [TableName.BlobStorageFileLog]: [],
      [TableName.DatasetRunItems]: [],
      [TableName.Events]: [],
    };

    this.start();
  }

  /**
   * Get the singleton instance of ClickhouseWriter.
   * Client parameter is only used for testing.
   */
  public static getInstance(clickhouseClient?: ClickhouseClientType) {
    if (clickhouseClient) {
      ClickhouseWriter.client = clickhouseClient;
    }

    if (!ClickhouseWriter.instance) {
      ClickhouseWriter.instance = new ClickhouseWriter();
    }

    return ClickhouseWriter.instance;
  }

  private start() {
    logger.info(
      `Starting ClickhouseWriter. Max interval: ${this.writeInterval} ms, Max batch size: ${this.batchSize}`,
    );

    this.intervalId = setInterval(() => {
      if (this.isIntervalFlushInProgress) return;

      this.isIntervalFlushInProgress = true;

      logger.debug("Flush interval elapsed, flushing all queues...");

      this.flushAll().finally(() => {
        this.isIntervalFlushInProgress = false;
      });
    }, this.writeInterval);
  }

  public async shutdown(): Promise<void> {
    logger.info("Shutting down ClickhouseWriter...");

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    await this.flushAll(true);

    logger.info("ClickhouseWriter shutdown complete.");
  }

  private async flushAll(fullQueue = false) {
    return instrumentAsync(
      {
        name: "write-to-clickhouse",
      },
      async () => {
        recordIncrement("langfuse.queue.clickhouse_writer.request");
        await Promise.all([
          this.flush(TableName.Traces, fullQueue),
          this.flush(TableName.TracesNull, fullQueue),
          this.flush(TableName.Scores, fullQueue),
          this.flush(TableName.Observations, fullQueue),
          this.flush(TableName.ObservationsBatchStaging, fullQueue),
          this.flush(TableName.BlobStorageFileLog, fullQueue),
          this.flush(TableName.DatasetRunItems, fullQueue),
          this.flush(TableName.Events, fullQueue),
        ]).catch((err) => {
          logger.error("ClickhouseWriter.flushAll", err);
        });
      },
    );
  }

  private isRetryableError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;

    const errorMessage = (error as Error).message?.toLowerCase() || "";

    // Check for socket hang up and other network-related errors
    return errorMessage.includes("socket hang up");
  }

  private isSizeError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;

    const errorMessage = (error as Error).message?.toLowerCase() || "";

    return (
      // Check for ClickHouse size errors
      errorMessage.includes("size of json object") &&
      errorMessage.includes("extremely large") &&
      errorMessage.includes("expected not greater than")
    );
  }

  private isStringLengthError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;

    const errorMessage = (error as Error).message?.toLowerCase() || "";

    // Node.js string size errors
    return errorMessage.includes("invalid string length");
  }

  /**
   * handleStringLength takes the queueItems and splits the queue in half.
   * It returns to lists, one items that are to be retried (first half), and a list that
   * should be re-added to the queue (second half).
   * That way, we should eventually avoid the JS string length error that happens due to the
   * concatenation.
   */
  private handleStringLengthError<T extends TableName>(
    tableName: T,
    queueItems: ClickhouseWriterQueueItem<T>[],
  ): {
    retryItems: ClickhouseWriterQueueItem<T>[];
    requeueItems: ClickhouseWriterQueueItem<T>[];
  } {
    // If batch size is 1, fallback to truncation to prevent infinite loops
    if (queueItems.length === 1) {
      const truncatedRecord = this.truncateOversizedRecord(
        tableName,
        queueItems[0].data,
      );
      logger.warn(
        `String length error with single record for ${tableName}, falling back to truncation`,
        {
          recordId: queueItems[0].data.id,
        },
      );
      return {
        retryItems: [{ ...queueItems[0], data: truncatedRecord }],
        requeueItems: [],
      };
    }

    const splitPoint = Math.floor(queueItems.length / 2);
    const retryItems = queueItems.slice(0, splitPoint);
    const requeueItems = queueItems.slice(splitPoint);

    logger.info(
      `Splitting batch for ${tableName} due to string length error. Retrying ${retryItems.length}, requeueing ${requeueItems.length}`,
    );

    return { retryItems, requeueItems };
  }

  private truncateOversizedRecord<T extends TableName>(
    tableName: T,
    record: RecordInsertType<T>,
  ): RecordInsertType<T> {
    const maxFieldSize = 1024 * 1024; // 1MB per field as safety margin
    const truncationMessage = "[TRUNCATED: Field exceeded size limit]";

    // Helper function to safely truncate string fields
    const truncateField = (value: string | null | undefined): string | null => {
      if (!value) return value || null;
      if (value.length > maxFieldSize) {
        return (
          // Keep the first 500KB and append a truncation message
          value.substring(0, 500 * 1024) + truncationMessage
        );
      }
      return value;
    };

    // Truncate input field if present
    if (
      "input" in record &&
      record.input &&
      record.input.length > maxFieldSize
    ) {
      record.input = truncateField(record.input);
      logger.info(
        `Truncated oversized input field for record ${record.id} of type ${tableName}`,
        {
          projectId: record.project_id,
        },
      );
    }

    // Truncate output field if present
    if (
      "output" in record &&
      record.output &&
      record.output.length > maxFieldSize
    ) {
      record.output = truncateField(record.output);
      logger.info(
        `Truncated oversized output field for record ${record.id} of type ${tableName}`,
        {
          projectId: record.project_id,
        },
      );
    }

    // Truncate metadata field if present
    if ("metadata" in record && record.metadata) {
      const metadata = record.metadata;
      const truncatedMetadata: Record<string, string> = {};
      for (const [key, value] of Object.entries(metadata)) {
        if (value && value.length > maxFieldSize) {
          truncatedMetadata[key] = truncateField(value) || "";
          logger.info(
            `Truncated oversized metadata for record ${record.id} of type ${tableName} and key ${key}`,
            {
              projectId: record.project_id,
            },
          );
        } else {
          truncatedMetadata[key] = value;
        }
      }
      record.metadata = truncatedMetadata;
    }

    return record;
  }

  private async flush<T extends TableName>(tableName: T, fullQueue = false) {
    const entityQueue = this.queue[tableName];
    if (entityQueue.length === 0) return;

    let queueItems = entityQueue.splice(
      0,
      fullQueue ? entityQueue.length : this.batchSize,
    );

    // Log wait time
    queueItems.forEach((item) => {
      const waitTime = Date.now() - item.createdAt;
      recordHistogram("langfuse.queue.clickhouse_writer.wait_time", waitTime, {
        unit: "milliseconds",
      });
    });

    const currentSpan = getCurrentSpan();
    if (currentSpan) {
      currentSpan.setAttributes({
        [`${tableName}-length`]: queueItems.length,
      });
    }

    try {
      const processingStartTime = Date.now();

      let recordsToWrite = queueItems.map((item) => item.data);
      let hasBeenTruncated = false;

      await backOff(
        async () =>
          this.writeToClickhouse({
            table: tableName,
            records: recordsToWrite,
          }),
        {
          numOfAttempts: env.LANGFUSE_INGESTION_CLICKHOUSE_MAX_ATTEMPTS,
          retry: (error: Error, attemptNumber: number) => {
            const isRetryable = this.isRetryableError(error);
            const isSizeError = this.isSizeError(error);
            const isStringLengthError = this.isStringLengthError(error);

            if (isRetryable) {
              logger.warn(
                `ClickHouse Writer failed with retryable error for ${tableName} (attempt ${attemptNumber}/${env.LANGFUSE_INGESTION_CLICKHOUSE_MAX_ATTEMPTS}): ${error.message}`,
                {
                  error: error.message,
                  attemptNumber,
                },
              );
              currentSpan?.addEvent("clickhouse-query-retry", {
                "retry.attempt": attemptNumber,
                "retry.error": error.message,
              });
              return true;
            } else if (isStringLengthError) {
              logger.warn(
                `ClickHouse Writer failed with string length error for ${tableName} (attempt ${attemptNumber}/${env.LANGFUSE_INGESTION_CLICKHOUSE_MAX_ATTEMPTS}): Splitting batch and retrying`,
                {
                  error: error.message,
                  attemptNumber,
                  batchSize: queueItems.length,
                },
              );

              const { retryItems, requeueItems } = this.handleStringLengthError(
                tableName,
                queueItems,
              );

              // Update records to write with only the retry items
              recordsToWrite = retryItems.map((item) => item.data);
              queueItems = retryItems;

              // Prepend requeue items to the front of the queue to maintain order as much as possible with parallel execution.
              if (requeueItems.length > 0) {
                entityQueue.unshift(...requeueItems);
              }

              currentSpan?.addEvent("clickhouse-query-split-retry", {
                "retry.attempt": attemptNumber,
                "retry.error": error.message,
                "split.retry_count": retryItems.length,
                "split.requeue_count": requeueItems.length,
              });
              return true;
            } else if (isSizeError && !hasBeenTruncated) {
              logger.warn(
                `ClickHouse Writer failed with size error for ${tableName} (attempt ${attemptNumber}/${env.LANGFUSE_INGESTION_CLICKHOUSE_MAX_ATTEMPTS}): Truncating oversized records and retrying`,
                {
                  error: error.message,
                  attemptNumber,
                },
              );

              // Truncate oversized records
              recordsToWrite = recordsToWrite.map((record) =>
                this.truncateOversizedRecord(tableName, record),
              );
              hasBeenTruncated = true;

              currentSpan?.addEvent("clickhouse-query-truncate-retry", {
                "retry.attempt": attemptNumber,
                "retry.error": error.message,
                truncated: true,
              });
              return true;
            } else {
              logger.error(
                `ClickHouse query failed with non-retryable error: ${error.message}`,
                {
                  error: error.message,
                },
              );
              return false;
            }
          },
          startingDelay: 100,
          timeMultiple: 1,
          maxDelay: 100,
        },
      );

      // Log processing time
      recordHistogram(
        "langfuse.queue.clickhouse_writer.processing_time",
        Date.now() - processingStartTime,
        {
          unit: "milliseconds",
        },
      );

      logger.debug(
        `Flushed ${queueItems.length} records to Clickhouse ${tableName}. New queue length: ${entityQueue.length}`,
      );

      recordGauge(
        "ingestion_clickhouse_insert_queue_length",
        entityQueue.length,
        {
          unit: "records",
          entityType: tableName,
        },
      );
    } catch (err) {
      logger.error(`ClickhouseWriter.flush ${tableName}`, err);

      // Re-add the records to the queue with incremented attempts
      let droppedCount = 0;
      queueItems.forEach((item) => {
        if (item.attempts < this.maxAttempts) {
          entityQueue.push({
            ...item,
            attempts: item.attempts + 1,
          });
        } else {
          // TODO - Add to a dead letter queue in Redis rather than dropping
          recordIncrement("langfuse.queue.clickhouse_writer.error");
          droppedCount++;
        }
      });

      if (droppedCount > 0) {
        logger.error(
          `ClickhouseWriter: Max attempts reached, dropped ${droppedCount} ${tableName} record(s)`,
        );
      }
    }
  }

  public addToQueue<T extends TableName>(
    tableName: T,
    data: RecordInsertType<T>,
  ) {
    const entityQueue = this.queue[tableName];
    entityQueue.push({
      createdAt: Date.now(),
      attempts: 1,
      data,
    });

    if (entityQueue.length >= this.batchSize) {
      logger.debug(`Queue is full. Flushing ${tableName}...`);

      this.flush(tableName).catch((err) => {
        logger.error("ClickhouseWriter.addToQueue flush", err);
      });
    }
  }

  private async writeToClickhouse<T extends TableName>(params: {
    table: T;
    records: RecordInsertType<T>[];
  }): Promise<void> {
    const startTime = Date.now();

    // PostgreSQL-only mode: write records using Prisma upserts
    for (const record of params.records) {
      try {
        await this.writeRecordToPostgres(params.table, record as any);
      } catch (err) {
        logger.error(`PostgresWriter.writeRecord ${params.table}: ${err}`);
        throw err;
      }
    }

    logger.debug(`PostgresWriter.write: ${Date.now() - startTime} ms`);

    recordGauge("ingestion_clickhouse_insert", params.records.length);
  }

  private async writeRecordToPostgres(
    table: TableName,
    record: any,
  ): Promise<void> {
    switch (table) {
      case TableName.Traces: {
        const r = record as TraceRecordInsertType;
        await prisma.pgTrace.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            name: r.name ?? null,
            userId: r.user_id ?? null,
            metadata: (r.metadata as any) ?? undefined,
            release: r.release ?? null,
            version: r.version ?? null,
            projectId: r.project_id,
            public: r.public ?? false,
            bookmarked: r.bookmarked ?? false,
            tags: r.tags ?? [],
            input: r.input ? safeJsonParse(r.input) : undefined,
            output: r.output ? safeJsonParse(r.output) : undefined,
            sessionId: r.session_id ?? null,
            environment: r.environment ?? "default",
            timestamp: r.timestamp ? new Date(r.timestamp) : new Date(),
          },
          update: {
            name: r.name ?? undefined,
            userId: r.user_id ?? undefined,
            metadata: (r.metadata as any) ?? undefined,
            release: r.release ?? undefined,
            version: r.version ?? undefined,
            public: r.public ?? undefined,
            bookmarked: r.bookmarked ?? undefined,
            tags: r.tags ?? undefined,
            input: r.input ? safeJsonParse(r.input) : undefined,
            output: r.output ? safeJsonParse(r.output) : undefined,
            sessionId: r.session_id ?? undefined,
            environment: r.environment ?? undefined,
          },
        });
        break;
      }
      case TableName.Observations: {
        const r = record as ObservationRecordInsertType;
        await prisma.pgObservation.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            traceId: r.trace_id ?? null,
            projectId: r.project_id,
            type: (r.type as any) ?? "SPAN",
            startTime: r.start_time ? new Date(r.start_time) : new Date(),
            endTime: r.end_time ? new Date(r.end_time) : null,
            name: r.name ?? null,
            metadata: (r.metadata as any) ?? undefined,
            parentObservationId: r.parent_observation_id ?? null,
            level: (r.level as any) ?? "DEFAULT",
            statusMessage: r.status_message ?? null,
            version: r.version ?? null,
            model: r.provided_model_name ?? null,
            internalModelId: r.internal_model_id ?? null,
            modelParameters: r.model_parameters
              ? safeJsonParse(r.model_parameters)
              : undefined,
            input: r.input ? safeJsonParse(r.input) : undefined,
            output: r.output ? safeJsonParse(r.output) : undefined,
            completionStartTime: r.completion_start_time
              ? new Date(r.completion_start_time)
              : null,
            promptId: r.prompt_id ?? null,
            environment: r.environment ?? "default",
            promptName: r.prompt_name ?? null,
            promptVersion: r.prompt_version ?? null,
            usageDetails: (r.usage_details as any) ?? undefined,
            costDetails: (r.cost_details as any) ?? undefined,
            providedUsageDetails:
              (r.provided_usage_details as any) ?? undefined,
            providedCostDetails: (r.provided_cost_details as any) ?? undefined,
          },
          update: {
            traceId: r.trace_id ?? undefined,
            name: r.name ?? undefined,
            metadata: (r.metadata as any) ?? undefined,
            level: (r.level as any) ?? undefined,
            statusMessage: r.status_message ?? undefined,
            version: r.version ?? undefined,
            model: r.provided_model_name ?? undefined,
            internalModelId: r.internal_model_id ?? undefined,
            input: r.input ? safeJsonParse(r.input) : undefined,
            output: r.output ? safeJsonParse(r.output) : undefined,
            environment: r.environment ?? undefined,
            usageDetails: (r.usage_details as any) ?? undefined,
            costDetails: (r.cost_details as any) ?? undefined,
            providedUsageDetails:
              (r.provided_usage_details as any) ?? undefined,
            providedCostDetails: (r.provided_cost_details as any) ?? undefined,
          },
        });
        break;
      }
      case TableName.Scores: {
        const r = record as ScoreRecordInsertType;
        await prisma.pgScore.upsert({
          where: {
            id_projectId: { id: r.id, projectId: r.project_id },
          },
          create: {
            id: r.id,
            projectId: r.project_id,
            traceId: r.trace_id ?? "",
            observationId: r.observation_id ?? null,
            name: r.name ?? "",
            value: r.value ?? null,
            source: (r.source as any) ?? "API",
            comment: r.comment ?? null,
            authorUserId: r.author_user_id ?? null,
            configId: r.config_id ?? null,
            dataType: (r.data_type as any) ?? "NUMERIC",
            stringValue: r.string_value ?? null,
            queueId: r.queue_id ?? null,
            environment: r.environment ?? "default",
            metadata: (r.metadata as any) ?? undefined,
            timestamp: r.timestamp ? new Date(r.timestamp) : new Date(),
          },
          update: {
            name: r.name ?? undefined,
            value: r.value ?? undefined,
            source: (r.source as any) ?? undefined,
            comment: r.comment ?? undefined,
            authorUserId: r.author_user_id ?? undefined,
            dataType: (r.data_type as any) ?? undefined,
            stringValue: r.string_value ?? undefined,
            environment: r.environment ?? undefined,
            metadata: (r.metadata as any) ?? undefined,
          },
        });
        break;
      }
      // Skip ClickHouse-only tables in PostgreSQL mode
      case TableName.TracesNull:
      case TableName.ObservationsBatchStaging:
      case TableName.BlobStorageFileLog:
      case TableName.DatasetRunItems:
      case TableName.Events:
        // These are ClickHouse-specific tables; no-op in PostgreSQL-only mode
        break;
    }
  }
}

export enum TableName {
  Traces = "traces",
  TracesNull = "traces_null",
  Scores = "scores",
  Observations = "observations",
  ObservationsBatchStaging = "observations_batch_staging",
  BlobStorageFileLog = "blob_storage_file_log",
  DatasetRunItems = "dataset_run_items_rmt",
  Events = "events",
}

type RecordInsertType<T extends TableName> = T extends TableName.Scores
  ? ScoreRecordInsertType
  : T extends TableName.Observations
    ? ObservationRecordInsertType
    : T extends TableName.ObservationsBatchStaging
      ? ObservationBatchStagingRecordInsertType
      : T extends TableName.Traces
        ? TraceRecordInsertType
        : T extends TableName.TracesNull
          ? TraceNullRecordInsertType
          : T extends TableName.BlobStorageFileLog
            ? BlobStorageFileLogInsertType
            : T extends TableName.DatasetRunItems
              ? DatasetRunItemRecordInsertType
              : T extends TableName.Events
                ? EventRecordInsertType
                : never;

type ClickhouseQueue = {
  [T in TableName]: ClickhouseWriterQueueItem<T>[];
};

type ClickhouseWriterQueueItem<T extends TableName> = {
  createdAt: number;
  attempts: number;
  data: RecordInsertType<T>;
};

function safeJsonParse(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
