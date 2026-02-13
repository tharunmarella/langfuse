/**
 * PostgreSQL-only mode: This module provides stub implementations
 * of the ClickHouse client exports. All actual database operations
 * go through the PostgreSQL adapter in repositories/clickhouse.ts.
 */

export type ClickhouseClientType = any;

export type PreferredClickhouseService =
  | "ReadWrite"
  | "ReadOnly"
  | "EventsReadOnly";

/**
 * ClickHouseClientManager - stub for PostgreSQL-only mode.
 * The actual client is never used; all queries go through Prisma.
 */
export class ClickHouseClientManager {
  private static instance: ClickHouseClientManager;

  private constructor() {}

  public static getInstance(): ClickHouseClientManager {
    if (!ClickHouseClientManager.instance) {
      ClickHouseClientManager.instance = new ClickHouseClientManager();
    }
    return ClickHouseClientManager.instance;
  }

  public getClient(): any {
    // In PostgreSQL-only mode, return a stub that returns empty results.
    // Direct ClickHouse client usage by the IngestionService and queues
    // will get empty results, causing them to treat records as new.
    return {
      query: async () => ({
        json: async () => [],
        stream: async function* () {},
        query_id: "pg-mode-stub",
        response_headers: {},
      }),
      insert: async () => ({
        query_id: "pg-mode-stub",
        response_headers: {},
      }),
      command: async () => ({
        query_id: "pg-mode-stub",
        response_headers: {},
      }),
      close: async () => {},
    };
  }

  public closeAllConnections(): Promise<void[]> {
    return Promise.resolve([]);
  }
}

export const clickhouseClient = (
  _opts?: any,
  _preferredClickhouseService: PreferredClickhouseService = "ReadWrite",
): any => {
  return ClickHouseClientManager.getInstance().getClient();
};

/**
 * Accepts a JavaScript date and returns the DateTime in format YYYY-MM-DD HH:MM:SS.mmm
 * Kept for compatibility with code that formats dates for record types.
 */
export const convertDateToClickhouseDateTime = (date: Date): string => {
  return date.toISOString().replace("T", " ").replace("Z", "");
};
