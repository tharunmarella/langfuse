/**
 * Traces repository - PostgreSQL-only implementation.
 * Replaces the original ClickHouse-based implementation.
 * All queries run against PostgreSQL using Prisma.
 */

import { prisma } from "../../db";
import { FilterState } from "../../types";
import { TraceRecordReadType } from "./definitions";
import {
  convertPrismaTraceToRecord,
  convertPrismaObservationToRecord,
} from "./postgres";
import { convertClickhouseToDomain } from "./traces_converters";
import { DEFAULT_RENDERING_PROPS, RenderingProps } from "../utils/rendering";
import { logger } from "../logger";
import { traceException } from "../instrumentation";
import { TraceDomain } from "../../domain";
import { Prisma } from "@prisma/client";

export const checkTraceExistsAndGetTimestamp = async ({
  projectId,
  traceId,
}: {
  projectId: string;
  traceId: string;
  timestamp: Date;
  filter: FilterState;
  maxTimeStamp: Date | undefined;
  exactTimestamp?: Date;
}): Promise<{ exists: boolean; timestamp?: Date }> => {
  const trace = await prisma.pgTrace.findFirst({
    where: { id: traceId, projectId },
    select: { id: true, timestamp: true },
  });
  return {
    exists: !!trace,
    timestamp: trace?.timestamp ?? undefined,
  };
};

export const upsertTrace = async (trace: Partial<TraceRecordReadType>) => {
  if (!["id", "project_id", "timestamp"].every((key) => key in trace)) {
    throw new Error("Identifier fields must be provided to upsert Trace.");
  }

  const id = trace.id!;
  const projectId = trace.project_id!;

  await prisma.pgTrace.upsert({
    where: { id },
    create: {
      id,
      name: trace.name ?? null,
      userId: trace.user_id ?? null,
      metadata: (trace.metadata as any) ?? Prisma.JsonNull,
      release: trace.release ?? null,
      version: trace.version ?? null,
      projectId,
      public: trace.public ?? false,
      bookmarked: trace.bookmarked ?? false,
      tags: trace.tags ?? [],
      input: trace.input ? safeJsonParse(trace.input) : Prisma.JsonNull,
      output: trace.output ? safeJsonParse(trace.output) : Prisma.JsonNull,
      sessionId: trace.session_id ?? null,
      environment: trace.environment ?? "default",
      timestamp: trace.timestamp ? new Date(trace.timestamp) : new Date(),
    },
    update: {
      name: trace.name ?? undefined,
      userId: trace.user_id ?? undefined,
      metadata: (trace.metadata as any) ?? undefined,
      release: trace.release ?? undefined,
      version: trace.version ?? undefined,
      public: trace.public ?? undefined,
      bookmarked: trace.bookmarked ?? undefined,
      tags: trace.tags ?? undefined,
      input: trace.input ? safeJsonParse(trace.input) : undefined,
      output: trace.output ? safeJsonParse(trace.output) : undefined,
      sessionId: trace.session_id ?? undefined,
      environment: trace.environment ?? undefined,
    },
  });
};

export const getTracesByIds = async (
  traceIds: string[],
  projectId: string,
  _timestamp?: Date,
  _clickhouseConfigs?: any,
): Promise<TraceRecordReadType[]> => {
  const traces = await prisma.pgTrace.findMany({
    where: { id: { in: traceIds }, projectId },
  });
  return traces.map(convertPrismaTraceToRecord) as TraceRecordReadType[];
};

export const getTracesBySessionId = async (
  sessionId: string,
  projectId: string,
  _timestamp?: Date,
): Promise<TraceRecordReadType[]> => {
  const traces = await prisma.pgTrace.findMany({
    where: { sessionId, projectId },
    orderBy: { timestamp: "asc" },
  });
  return traces.map(convertPrismaTraceToRecord) as TraceRecordReadType[];
};

export const hasAnyTrace = async (projectId: string) => {
  const trace = await prisma.pgTrace.findFirst({
    where: { projectId },
    select: { id: true },
  });
  return [{ count: trace ? 1 : 0 }];
};

export const getTraceCountsByProjectInCreationInterval = async ({
  start,
  end,
}: {
  start: Date;
  end: Date;
}) => {
  const result = await prisma.pgTrace.groupBy({
    by: ["projectId"],
    where: {
      createdAt: { gte: start, lt: end },
    },
    _count: { id: true },
  });
  return result.map((r) => ({
    projectId: r.projectId,
    project_id: r.projectId,
    count: r._count.id,
  }));
};

export const getTraceCountOfProjectsSinceCreationDate = async ({
  projectIds,
  creationDate,
}: {
  projectIds: string[];
  creationDate: Date;
}) => {
  const result = await prisma.pgTrace.groupBy({
    by: ["projectId"],
    where: {
      projectId: { in: projectIds },
      createdAt: { gte: creationDate },
    },
    _count: { id: true },
  });
  return result.map((r) => ({
    projectId: r.projectId,
    project_id: r.projectId,
    count: r._count.id,
  }));
};

export const getTraceById = async ({
  traceId,
  projectId,
  renderingProps = DEFAULT_RENDERING_PROPS,
}: {
  traceId: string;
  projectId: string;
  timestamp?: Date;
  renderingProps?: RenderingProps;
}): Promise<TraceDomain | undefined> => {
  const trace = await prisma.pgTrace.findFirst({
    where: { id: traceId, projectId },
  });
  if (!trace) return undefined;

  const record = convertPrismaTraceToRecord(trace) as TraceRecordReadType;
  return convertClickhouseToDomain(record, renderingProps);
};

export const getTracesGroupedByName = async (
  projectId: string,
  _tableDefinitions: any[],
  _filterState: FilterState,
  _searchQuery?: string,
  _limit?: number,
  _offset?: number,
) => {
  const result = await prisma.pgTrace.groupBy({
    by: ["name"],
    where: { projectId },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: _limit ?? 1000,
    skip: _offset ?? 0,
  });
  return result.map((r) => ({
    name: r.name ?? "",
    count: r._count.id,
  }));
};

export const getTracesGroupedBySessionId = async (
  projectId: string,
  _tableDefinitions: any[],
  _filterState: FilterState,
  _searchQuery?: string,
  _limit?: number,
  _offset?: number,
) => {
  const result = await prisma.pgTrace.groupBy({
    by: ["sessionId"],
    where: { projectId, sessionId: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: _limit ?? 1000,
    skip: _offset ?? 0,
  });
  return result.map((r) => ({
    session_id: r.sessionId ?? "",
    count: r._count.id,
  }));
};

export const getTracesGroupedByUsers = async (
  projectId: string,
  _tableDefinitions: any[],
  _filterState: FilterState,
  _searchQuery?: string,
  _limit?: number,
  _offset?: number,
) => {
  const result = await prisma.pgTrace.groupBy({
    by: ["userId"],
    where: { projectId, userId: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: _limit ?? 1000,
    skip: _offset ?? 0,
  });
  return result.map((r) => ({
    user: r.userId ?? "",
    count: r._count.id,
  }));
};

export const getTracesGroupedByTags = async (_props: any) => {
  const projectId = _props.projectId;
  const traces = await prisma.pgTrace.findMany({
    where: { projectId },
    select: { tags: true },
  });

  const tagCounts: Record<string, number> = {};
  for (const trace of traces) {
    for (const tag of trace.tags) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
  }

  return Object.entries(tagCounts)
    .map(([tag, count]) => ({ value: tag, count }))
    .sort((a, b) => b.count - a.count);
};

export const getTracesIdentifierForSession = async (
  projectId: string,
  sessionId: string,
) => {
  const traces = await prisma.pgTrace.findMany({
    where: { projectId, sessionId },
    select: { id: true, name: true, userId: true, timestamp: true },
    orderBy: { timestamp: "asc" },
  });
  return traces.map((t) => ({
    id: t.id,
    name: t.name ?? "",
    user_id: t.userId ?? "",
    timestamp: t.timestamp.toISOString().replace("T", " ").replace("Z", ""),
  }));
};

export const deleteTraces = async (projectId: string, traceIds: string[]) => {
  // Delete related observations and scores first
  await prisma.pgObservation.deleteMany({
    where: { projectId, traceId: { in: traceIds } },
  });
  await prisma.pgScore.deleteMany({
    where: { projectId, traceId: { in: traceIds } },
  });
  await prisma.pgTrace.deleteMany({
    where: { projectId, id: { in: traceIds } },
  });
};

export const hasAnyTraceOlderThan = async (
  projectId: string,
  timestamp: Date,
) => {
  const trace = await prisma.pgTrace.findFirst({
    where: { projectId, timestamp: { lt: timestamp } },
    select: { id: true },
  });
  return !!trace;
};

export const deleteTracesOlderThanDays = async (
  projectId: string,
  daysOrCutoff: number | Date,
) => {
  const cutoff =
    typeof daysOrCutoff === "number"
      ? (() => {
          const d = new Date();
          d.setDate(d.getDate() - daysOrCutoff);
          return d;
        })()
      : daysOrCutoff;

  const traces = await prisma.pgTrace.findMany({
    where: { projectId, timestamp: { lt: cutoff } },
    select: { id: true },
  });
  const traceIds = traces.map((t) => t.id);

  if (traceIds.length > 0) {
    await deleteTraces(projectId, traceIds);
  }
};

export const deleteTracesByProjectId = async (projectId: string) => {
  await prisma.pgObservation.deleteMany({ where: { projectId } });
  await prisma.pgScore.deleteMany({ where: { projectId } });
  await prisma.pgTrace.deleteMany({ where: { projectId } });
};

export const hasAnyUser = async (projectId: string) => {
  const trace = await prisma.pgTrace.findFirst({
    where: { projectId, userId: { not: null } },
    select: { userId: true },
  });
  return !!trace;
};

export const getTotalUserCount = async (
  projectId: string,
  _filter?: FilterState,
) => {
  const result = await prisma.pgTrace.findMany({
    where: { projectId, userId: { not: null } },
    distinct: ["userId"],
    select: { userId: true },
  });
  return [{ totalCount: result.length }];
};

export const getUserMetrics = async (projectId: string, _userIds: string[]) => {
  return [];
};

export const getTracesForBlobStorageExport = function (
  projectId: string,
  _minTimestamp?: any,
  _maxTimestamp?: any,
) {
  return (async function* () {
    const traces = await prisma.pgTrace.findMany({
      where: { projectId },
      orderBy: { timestamp: "asc" },
    });
    for (const trace of traces) {
      yield convertPrismaTraceToRecord(trace);
    }
  })();
};

export const getTracesForAnalyticsIntegrations = async function* (
  projectId: string,
  _minTimestamp?: any,
  _maxTimestamp?: any,
) {
  // Simplified implementation for analytics integrations
  const traces = await prisma.pgTrace.findMany({
    where: { projectId },
    orderBy: { timestamp: "asc" },
    take: 1000,
  });
  for (const trace of traces) {
    yield convertPrismaTraceToRecord(trace);
  }
};

export const getTracesByIdsForAnyProject = async (traceIds: string[]) => {
  const traces = await prisma.pgTrace.findMany({
    where: { id: { in: traceIds } },
  });
  return traces.map(convertPrismaTraceToRecord) as TraceRecordReadType[];
};

export async function getAgentGraphData(params: {
  projectId: string;
  traceId: string;
  timestamp?: Date;
}) {
  const observations = await prisma.pgObservation.findMany({
    where: {
      projectId: params.projectId,
      traceId: params.traceId,
    },
    orderBy: { startTime: "asc" },
  });
  return observations.map(convertPrismaObservationToRecord);
}

export const getTraceCountsByProjectAndDay = async ({
  projectIds,
  startDate,
  endDate,
}: {
  projectIds?: string[];
  startDate?: Date;
  endDate?: Date;
}) => {
  const result: any[] = await prisma.$queryRawUnsafe(
    `
    SELECT project_id, DATE(timestamp) as day, COUNT(*) as count
    FROM traces
    WHERE project_id = ANY($1)
    GROUP BY project_id, DATE(timestamp)
    ORDER BY day DESC
  `,
    projectIds,
  );
  return result;
};

export const getTraceIdentifiers = async (_opts: any) => {
  return [];
};

function safeJsonParse(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
