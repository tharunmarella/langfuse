/**
 * PostgreSQL-only mode: This module redirects all ClickHouse operations
 * to PostgreSQL. The original ClickHouse implementation has been replaced.
 *
 * All repository files import from this module, so redirecting here
 * provides a single point of change for the entire codebase.
 */

import { prisma } from "../../db";
import { logger } from "../logger";
import { instrumentAsync } from "../instrumentation";
import { SpanKind } from "@opentelemetry/api";
import { env } from "../../env";

/**
 * Custom error class for resource-related errors (kept for API compatibility)
 */
const ERROR_TYPE_CONFIG: Record<
  "MEMORY_LIMIT" | "OVERCOMMIT" | "TIMEOUT",
  {
    discriminators: string[];
  }
> = {
  MEMORY_LIMIT: {
    discriminators: ["memory limit exceeded"],
  },
  OVERCOMMIT: {
    discriminators: ["OvercommitTracker"],
  },
  TIMEOUT: {
    discriminators: ["Timeout", "timeout", "timed out", "statement timeout"],
  },
};

type ErrorType = keyof typeof ERROR_TYPE_CONFIG;

export class ClickHouseResourceError extends Error {
  static ERROR_ADVICE_MESSAGE = [
    "Your query could not be completed because it required too many resources.",
    "Please narrow your request by adding more specific filters (e.g., a shorter date range).",
  ].join(" ");

  public readonly errorType: ErrorType;

  constructor(errType: ErrorType, originalError: Error) {
    super(originalError.message, { cause: originalError });
    this.name = "ClickHouseResourceError";
    this.errorType = errType;
    if (originalError.stack) {
      this.stack = originalError.stack;
    }
  }

  static wrapIfResourceError(originalError: Error): Error {
    const errorMessage = originalError.message || "";

    for (const [type, config] of Object.entries(ERROR_TYPE_CONFIG) as Array<
      [
        keyof typeof ERROR_TYPE_CONFIG,
        (typeof ERROR_TYPE_CONFIG)[keyof typeof ERROR_TYPE_CONFIG],
      ]
    >) {
      const hasDiscriminator = config.discriminators.some((discriminator) =>
        errorMessage.includes(discriminator),
      );

      if (hasDiscriminator) {
        return new ClickHouseResourceError(type, originalError);
      }
    }

    return originalError;
  }
}

/**
 * Execute a query against PostgreSQL. This replaces the ClickHouse queryClickhouse function.
 *
 * IMPORTANT: The SQL passed here should be PostgreSQL-compatible SQL.
 * Repository files need to be updated to use PostgreSQL syntax.
 *
 * For backward compatibility during migration, this function accepts the same
 * options shape as the original queryClickhouse.
 */
export async function queryClickhouse<T>(opts: {
  query: string;
  params?: Record<string, unknown> | undefined;
  clickhouseConfigs?: any;
  tags?: Record<string, string>;
  preferredClickhouseService?: any;
  clickhouseSettings?: any;
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

      // Convert ClickHouse-style named parameters {paramName: Type} to PostgreSQL $N parameters
      const { query: pgQuery, paramValues } = convertClickhouseParamsToPostgres(
        opts.query,
        opts.params,
      );

      try {
        const result = await prisma.$queryRawUnsafe<T[]>(
          pgQuery,
          ...paramValues,
        );
        return result;
      } catch (error) {
        throw ClickHouseResourceError.wrapIfResourceError(error as Error);
      }
    },
  );
}

/**
 * Stream query results from PostgreSQL.
 * Uses cursor-based pagination since Prisma doesn't support true streaming.
 */
export async function* queryClickhouseStream<T>(opts: {
  query: string;
  params?: Record<string, unknown> | undefined;
  clickhouseConfigs?: any;
  tags?: Record<string, string>;
  preferredClickhouseService?: any;
  clickhouseSettings?: any;
}): AsyncGenerator<T> {
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const paginatedQuery = `${opts.query} LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
    const results = await queryClickhouse<T>({
      ...opts,
      query: paginatedQuery,
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
 * Execute a command against PostgreSQL.
 * For DDL or DML operations.
 */
export async function commandClickhouse(opts: {
  query: string;
  params?: Record<string, unknown> | undefined;
  clickhouseConfigs?: any;
  tags?: Record<string, string>;
  clickhouseSettings?: any;
  abortSignal?: AbortSignal;
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

      const { query: pgQuery, paramValues } = convertClickhouseParamsToPostgres(
        opts.query,
        opts.params,
      );

      try {
        await prisma.$executeRawUnsafe(pgQuery, ...paramValues);
      } catch (error) {
        // Some ClickHouse-specific commands will fail on PostgreSQL (e.g., system queries)
        // We log and swallow those errors
        const errMsg = (error as Error).message || "";
        if (
          errMsg.includes("system.parts") ||
          errMsg.includes("TRUNCATE TABLE") ||
          errMsg.includes("ALTER TABLE") ||
          errMsg.includes("OPTIMIZE TABLE")
        ) {
          logger.debug(
            `Ignoring ClickHouse-specific command in PostgreSQL mode: ${opts.query}`,
          );
          return;
        }
        throw error;
      }
    },
  );
}

/**
 * Upsert records into PostgreSQL.
 * Replaces the ClickHouse upsert that wrote to ClickHouse + S3.
 * In PostgreSQL-only mode, we just do a standard upsert.
 */
export async function upsertClickhouse<
  T extends Record<string, unknown>,
>(opts: {
  table: "scores" | "traces" | "observations" | "traces_null";
  records: T[];
  eventBodyMapper: (body: T) => Record<string, unknown>;
  tags?: Record<string, string>;
}): Promise<void> {
  return await instrumentAsync(
    { name: "postgres-upsert", spanKind: SpanKind.CLIENT },
    async (span) => {
      span.setAttribute("db.system", "postgresql");
      span.setAttribute("db.operation.name", "UPSERT");

      // traces_null is a ClickHouse-specific concept, skip it
      if (opts.table === "traces_null") {
        return;
      }

      for (const record of opts.records) {
        const body = opts.eventBodyMapper(record);
        try {
          await upsertRecordToPostgres(opts.table, body);
        } catch (error) {
          logger.error(
            `Failed to upsert record to PostgreSQL table ${opts.table}`,
            error,
          );
        }
      }
    },
  );
}

async function upsertRecordToPostgres(
  table: "scores" | "traces" | "observations",
  body: Record<string, unknown>,
): Promise<void> {
  if (table === "traces") {
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
        input: body.input ? safeJsonParse(body.input as string) : null,
        output: body.output ? safeJsonParse(body.output as string) : null,
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
        input: body.input ? safeJsonParse(body.input as string) : null,
        output: body.output ? safeJsonParse(body.output as string) : null,
        sessionId: body.session_id as string | null,
        environment: (body.environment as string) ?? "default",
      },
    });
  } else if (table === "observations") {
    await prisma.pgObservation.upsert({
      where: { id: body.id as string },
      create: {
        id: body.id as string,
        traceId: body.trace_id as string | null,
        projectId: body.project_id as string,
        type: (body.type as any) ?? "SPAN",
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
          ? safeJsonParse(body.model_parameters as string)
          : null,
        input: body.input ? safeJsonParse(body.input as string) : null,
        output: body.output ? safeJsonParse(body.output as string) : null,
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
        input: body.input ? safeJsonParse(body.input as string) : null,
        output: body.output ? safeJsonParse(body.output as string) : null,
        environment: (body.environment as string) ?? "default",
        usageDetails: body.usage_details as any,
        costDetails: body.cost_details as any,
        providedUsageDetails: body.provided_usage_details as any,
        providedCostDetails: body.provided_cost_details as any,
      },
    });
  } else if (table === "scores") {
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

function safeJsonParse(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Convert ClickHouse-style named parameters to PostgreSQL $N parameters.
 *
 * ClickHouse uses: {paramName: Type} e.g. {projectId: String}
 * PostgreSQL uses: $1, $2, etc.
 *
 * This function extracts parameter names, maps them to $N placeholders,
 * and returns the ordered parameter values.
 */
function convertClickhouseParamsToPostgres(
  query: string,
  params?: Record<string, unknown>,
): { query: string; paramValues: unknown[] } {
  if (!params) {
    return { query, paramValues: [] };
  }

  const paramValues: unknown[] = [];
  let paramIndex = 0;

  // Match ClickHouse parameter syntax: {paramName: Type}
  const pgQuery = query.replace(
    /\{(\w+):\s*\w+(?:\(\d+\))?\}/g,
    (_match, paramName) => {
      paramIndex++;
      const value = params[paramName];
      paramValues.push(value);
      return `$${paramIndex}`;
    },
  );

  return { query: pgQuery, paramValues };
}

export function parseClickhouseUTCDateTimeFormat(dateStr: string): Date {
  // Handle both ClickHouse format ('2024-05-23 18:33:41.602000')
  // and ISO format ('2024-05-23T18:33:41.602Z')
  if (dateStr.includes("T")) {
    return new Date(dateStr);
  }
  return new Date(`${dateStr.replace(" ", "T")}Z`);
}

export function clickhouseCompliantRandomCharacters() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let result = "";
  const randomArray = new Uint8Array(5);
  crypto.getRandomValues(randomArray);
  randomArray.forEach((number) => {
    result += chars[number % chars.length];
  });
  return result;
}
