/**
 * PostgreSQL adapter that replaces ClickHouse query functions.
 *
 * This module provides drop-in replacements for:
 * - queryClickhouse -> queryPostgres
 * - queryClickhouseStream -> queryPostgresStream
 * - commandClickhouse -> commandPostgres (no-op for DDL commands)
 * - upsertClickhouse -> upsertPostgres
 * - parseClickhouseUTCDateTimeFormat -> parsePostgresDateTimeFormat
 *
 * Used when running Langfuse in PostgreSQL-only mode (no ClickHouse).
 */

import { prisma } from "../../db";
import { logger } from "../logger";
import { instrumentAsync } from "../instrumentation";
import { SpanKind } from "@opentelemetry/api";
import { env } from "../../env";

/**
 * Execute a SELECT query against PostgreSQL and return typed results.
 *
 * This replaces `queryClickhouse`. The SQL should be written in PostgreSQL syntax.
 * Parameters use $1, $2, etc. (PostgreSQL style) instead of {param: Type} (ClickHouse style).
 */
export async function queryPostgres<T>(opts: {
  query: string;
  params?: unknown[];
  tags?: Record<string, string>;
}): Promise<T[]> {
  return await instrumentAsync(
    { name: "postgres-query", spanKind: SpanKind.CLIENT },
    async (span) => {
      span.setAttribute("db.system", "postgresql");
      span.setAttribute("db.query.text", opts.query);
      span.setAttribute("db.operation.name", "SELECT");

      if (env.NODE_ENV === "development") {
        logger.info(`postgres:query ${opts.query}`);
      }

      const result = await prisma.$queryRawUnsafe<T[]>(
        opts.query,
        ...(opts.params ?? []),
      );

      return result;
    },
  );
}

/**
 * Execute a SELECT query against PostgreSQL and yield results one by one.
 *
 * This replaces `queryClickhouseStream`. Since Prisma doesn't support
 * true streaming, we use cursor-based pagination internally.
 */
export async function* queryPostgresStream<T extends { id?: string }>(opts: {
  query: string;
  params?: unknown[];
  tags?: Record<string, string>;
}): AsyncGenerator<T> {
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const paginatedQuery = `${opts.query} LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
    const results = await queryPostgres<T>({
      query: paginatedQuery,
      params: opts.params,
      tags: opts.tags,
    });

    for (const row of results) {
      yield row;
    }

    if (results.length < PAGE_SIZE) {
      hasMore = false;
    }
    offset += PAGE_SIZE;
  }
}

/**
 * Execute a command (INSERT, UPDATE, DELETE) against PostgreSQL.
 *
 * This replaces `commandClickhouse`. For DDL commands that are ClickHouse-specific
 * (like creating MergeTree tables), this is a no-op.
 */
export async function commandPostgres(opts: {
  query: string;
  params?: unknown[];
  tags?: Record<string, string>;
}): Promise<void> {
  return await instrumentAsync(
    { name: "postgres-command", spanKind: SpanKind.CLIENT },
    async (span) => {
      span.setAttribute("db.system", "postgresql");
      span.setAttribute("db.query.text", opts.query);
      span.setAttribute("db.operation.name", "COMMAND");

      if (env.NODE_ENV === "development") {
        logger.info(`postgres:command ${opts.query}`);
      }

      await prisma.$executeRawUnsafe(opts.query, ...(opts.params ?? []));
    },
  );
}

/**
 * Upsert records into PostgreSQL.
 *
 * This replaces `upsertClickhouse`. Uses PostgreSQL's ON CONFLICT DO UPDATE.
 */
export async function upsertPostgres<T extends Record<string, unknown>>(opts: {
  table: "scores" | "traces" | "observations";
  records: T[];
  eventBodyMapper: (body: T) => Record<string, unknown>;
  tags?: Record<string, string>;
}): Promise<void> {
  return await instrumentAsync(
    { name: "postgres-upsert", spanKind: SpanKind.CLIENT },
    async (span) => {
      span.setAttribute("db.system", "postgresql");
      span.setAttribute("db.operation.name", "UPSERT");

      for (const record of opts.records) {
        const body = opts.eventBodyMapper(record);

        if (opts.table === "traces") {
          await prisma.pgTrace.upsert({
            where: { id: body.id as string },
            create: {
              id: body.id as string,
              name: body.name as string | null,
              userId: body.user_id as string | null,
              metadata: body.metadata as any,
              release: body.release as string | null,
              version: body.version as string | null,
              projectId: body.project_id as string,
              public: (body.public as boolean) ?? false,
              bookmarked: (body.bookmarked as boolean) ?? false,
              tags: (body.tags as string[]) ?? [],
              input: body.input ? JSON.parse(body.input as string) : null,
              output: body.output ? JSON.parse(body.output as string) : null,
              sessionId: body.session_id as string | null,
              environment: (body.environment as string) ?? "default",
              timestamp: body.timestamp
                ? new Date(body.timestamp as number)
                : new Date(),
            },
            update: {
              name: body.name as string | null,
              userId: body.user_id as string | null,
              metadata: body.metadata as any,
              release: body.release as string | null,
              version: body.version as string | null,
              public: body.public as boolean,
              bookmarked: body.bookmarked as boolean,
              tags: (body.tags as string[]) ?? [],
              input: body.input ? JSON.parse(body.input as string) : null,
              output: body.output ? JSON.parse(body.output as string) : null,
              sessionId: body.session_id as string | null,
              environment: (body.environment as string) ?? "default",
            },
          });
        } else if (opts.table === "observations") {
          await prisma.pgObservation.upsert({
            where: { id: body.id as string },
            create: {
              id: body.id as string,
              traceId: body.trace_id as string | null,
              projectId: body.project_id as string,
              type: body.type as any,
              startTime: body.start_time
                ? new Date(body.start_time as number)
                : new Date(),
              endTime: body.end_time ? new Date(body.end_time as number) : null,
              name: body.name as string | null,
              metadata: body.metadata as any,
              parentObservationId: body.parent_observation_id as string | null,
              level: (body.level as any) ?? "DEFAULT",
              statusMessage: body.status_message as string | null,
              version: body.version as string | null,
              model: body.provided_model_name as string | null,
              internalModelId: body.internal_model_id as string | null,
              modelParameters: body.model_parameters
                ? JSON.parse(body.model_parameters as string)
                : null,
              input: body.input ? JSON.parse(body.input as string) : null,
              output: body.output ? JSON.parse(body.output as string) : null,
              completionStartTime: body.completion_start_time
                ? new Date(body.completion_start_time as number)
                : null,
              promptId: body.prompt_id as string | null,
              environment: (body.environment as string) ?? "default",
              promptName: body.prompt_name as string | null,
              promptVersion: body.prompt_version as number | null,
              usageDetails: body.usage_details as any,
              costDetails: body.cost_details as any,
              providedUsageDetails: body.provided_usage_details as any,
              providedCostDetails: body.provided_cost_details as any,
            },
            update: {
              traceId: body.trace_id as string | null,
              name: body.name as string | null,
              metadata: body.metadata as any,
              level: body.level as any,
              statusMessage: body.status_message as string | null,
              version: body.version as string | null,
              model: body.provided_model_name as string | null,
              internalModelId: body.internal_model_id as string | null,
              input: body.input ? JSON.parse(body.input as string) : null,
              output: body.output ? JSON.parse(body.output as string) : null,
              environment: (body.environment as string) ?? "default",
              usageDetails: body.usage_details as any,
              costDetails: body.cost_details as any,
              providedUsageDetails: body.provided_usage_details as any,
              providedCostDetails: body.provided_cost_details as any,
            },
          });
        } else if (opts.table === "scores") {
          await prisma.pgScore.upsert({
            where: {
              id_projectId: {
                id: body.id as string,
                projectId: body.project_id as string,
              },
            },
            create: {
              id: body.id as string,
              projectId: body.project_id as string,
              traceId: body.trace_id as string,
              observationId: body.observation_id as string | null,
              name: body.name as string,
              value: body.value as number | null,
              source: body.source as any,
              comment: body.comment as string | null,
              authorUserId: body.author_user_id as string | null,
              configId: body.config_id as string | null,
              dataType: body.data_type as any,
              stringValue: body.string_value as string | null,
              queueId: body.queue_id as string | null,
              environment: (body.environment as string) ?? "default",
              metadata: body.metadata as any,
              timestamp: body.timestamp
                ? new Date(body.timestamp as number)
                : new Date(),
            },
            update: {
              name: body.name as string,
              value: body.value as number | null,
              source: body.source as any,
              comment: body.comment as string | null,
              authorUserId: body.author_user_id as string | null,
              dataType: body.data_type as any,
              stringValue: body.string_value as string | null,
              environment: (body.environment as string) ?? "default",
              metadata: body.metadata as any,
            },
          });
        }
      }
    },
  );
}

/**
 * Parse a PostgreSQL datetime string to a Date object.
 * PostgreSQL returns ISO 8601 format natively.
 */
export function parsePostgresDateTimeFormat(dateStr: string): Date {
  return new Date(dateStr);
}

/**
 * Format a Date to PostgreSQL-compatible UTC datetime string.
 * Returns format like '2024-05-23 18:33:41.602000' for ClickHouse compatibility.
 */
export function formatDateForPostgres(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Convert a Prisma result row to the ClickHouse-compatible record format
 * used throughout the codebase. This converts camelCase Prisma fields
 * to snake_case ClickHouse fields and formats dates.
 */
export function convertPrismaTraceToRecord(trace: any): Record<string, any> {
  return {
    id: trace.id,
    timestamp: formatDateForCHCompat(trace.timestamp),
    name: trace.name,
    user_id: trace.userId,
    metadata: convertMetadataToRecord(trace.metadata),
    release: trace.release,
    version: trace.version,
    project_id: trace.projectId,
    environment: trace.environment ?? "default",
    public: trace.public ?? false,
    bookmarked: trace.bookmarked ?? false,
    tags: trace.tags ?? [],
    input: trace.input ? JSON.stringify(trace.input) : null,
    output: trace.output ? JSON.stringify(trace.output) : null,
    session_id: trace.sessionId,
    created_at: formatDateForCHCompat(trace.createdAt),
    updated_at: formatDateForCHCompat(trace.updatedAt),
    event_ts: formatDateForCHCompat(trace.updatedAt),
    is_deleted: 0,
  };
}

export function convertPrismaObservationToRecord(
  obs: any,
): Record<string, any> {
  return {
    id: obs.id,
    trace_id: obs.traceId,
    project_id: obs.projectId,
    type: obs.type,
    parent_observation_id: obs.parentObservationId,
    environment: obs.environment ?? "default",
    start_time: formatDateForCHCompat(obs.startTime),
    end_time: obs.endTime ? formatDateForCHCompat(obs.endTime) : null,
    name: obs.name,
    metadata: convertMetadataToRecord(obs.metadata),
    level: obs.level,
    status_message: obs.statusMessage,
    version: obs.version,
    input: obs.input ? JSON.stringify(obs.input) : null,
    output: obs.output ? JSON.stringify(obs.output) : null,
    provided_model_name: obs.model,
    internal_model_id: obs.internalModelId,
    model_parameters: obs.modelParameters
      ? JSON.stringify(obs.modelParameters)
      : null,
    provided_usage_details: obs.providedUsageDetails ?? {
      input: obs.promptTokens > 0 ? obs.promptTokens : null,
      output: obs.completionTokens > 0 ? obs.completionTokens : null,
      total: obs.totalTokens > 0 ? obs.totalTokens : null,
    },
    usage_details: obs.usageDetails ?? {
      input: obs.promptTokens > 0 ? obs.promptTokens : null,
      output: obs.completionTokens > 0 ? obs.completionTokens : null,
      total: obs.totalTokens > 0 ? obs.totalTokens : null,
    },
    provided_cost_details: obs.providedCostDetails ?? {
      input: obs.inputCost ? Number(obs.inputCost) : null,
      output: obs.outputCost ? Number(obs.outputCost) : null,
      total: obs.totalCost ? Number(obs.totalCost) : null,
    },
    cost_details: obs.costDetails ?? {
      input: obs.calculatedInputCost ? Number(obs.calculatedInputCost) : null,
      output: obs.calculatedOutputCost
        ? Number(obs.calculatedOutputCost)
        : null,
      total: obs.calculatedTotalCost ? Number(obs.calculatedTotalCost) : null,
    },
    total_cost: obs.calculatedTotalCost
      ? Number(obs.calculatedTotalCost)
      : null,
    completion_start_time: obs.completionStartTime
      ? formatDateForCHCompat(obs.completionStartTime)
      : null,
    prompt_id: obs.promptId,
    prompt_name: obs.promptName,
    prompt_version: obs.promptVersion,
    usage_pricing_tier_id: null,
    usage_pricing_tier_name: null,
    tool_definitions: undefined,
    tool_calls: undefined,
    tool_call_names: undefined,
    created_at: formatDateForCHCompat(obs.createdAt),
    updated_at: formatDateForCHCompat(obs.updatedAt),
    event_ts: formatDateForCHCompat(obs.updatedAt),
    is_deleted: 0,
  };
}

export function convertPrismaScoreToRecord(score: any): Record<string, any> {
  return {
    id: score.id,
    timestamp: formatDateForCHCompat(score.timestamp),
    project_id: score.projectId,
    trace_id: score.traceId,
    session_id: null,
    dataset_run_id: null,
    observation_id: score.observationId,
    environment: score.environment ?? "default",
    name: score.name,
    value: score.value,
    source: score.source,
    comment: score.comment,
    metadata: convertMetadataToRecord(score.metadata),
    author_user_id: score.authorUserId,
    config_id: score.configId,
    data_type: score.dataType,
    string_value: score.stringValue,
    long_string_value: "",
    queue_id: score.queueId,
    execution_trace_id: null,
    created_at: formatDateForCHCompat(score.createdAt),
    updated_at: formatDateForCHCompat(score.updatedAt),
    event_ts: formatDateForCHCompat(score.updatedAt),
    is_deleted: 0,
  };
}

/**
 * Format a Date to ClickHouse-compatible string format.
 * Returns: '2024-05-23 18:33:41.602000'
 * This is needed because the record schemas expect this format.
 */
function formatDateForCHCompat(date: Date | string | null): string {
  if (!date) return new Date().toISOString().replace("T", " ").replace("Z", "");
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Convert JSON metadata to Record<string, string> format
 * expected by the ClickHouse record types.
 */
function convertMetadataToRecord(metadata: any): Record<string, string> {
  if (!metadata) return {};
  if (typeof metadata === "string") return { metadata };
  if (Array.isArray(metadata)) return { metadata: JSON.stringify(metadata) };
  if (typeof metadata === "object") {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      result[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
    return result;
  }
  return {};
}
