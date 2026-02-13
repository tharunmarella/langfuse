/**
 * Scores repository - PostgreSQL-only implementation.
 * Replaces the original ClickHouse-based implementation.
 */

import { prisma } from "../../db";
import { FilterState } from "../../types";
import { ScoreRecordReadType } from "./definitions";
import { convertPrismaScoreToRecord } from "./postgres";
import { Prisma } from "@prisma/client";

export const searchExistingAnnotationScore = async (
  projectId: string,
  traceId: string,
  observationId: string | null,
  name: string | null,
  configId: string | null,
  _timestamp?: Date,
) => {
  const where: any = {
    projectId,
    traceId,
    source: "ANNOTATION",
  };
  if (observationId) where.observationId = observationId;
  if (name) where.name = name;
  if (configId) where.configId = configId;

  const scores = await prisma.pgScore.findMany({ where });
  return scores.map(convertPrismaScoreToRecord) as ScoreRecordReadType[];
};

export const getScoreById = async ({
  projectId,
  scoreId,
}: {
  projectId: string;
  scoreId: string;
  timestamp?: Date;
}) => {
  const score = await prisma.pgScore.findFirst({
    where: { id: scoreId, projectId },
  });
  if (!score) return undefined;
  return convertPrismaScoreToRecord(score) as ScoreRecordReadType;
};

export const getScoresByIds = async (
  projectId: string,
  scoreIds: string[],
  _timestamp?: Date,
) => {
  const scores = await prisma.pgScore.findMany({
    where: { id: { in: scoreIds }, projectId },
  });
  return scores.map(convertPrismaScoreToRecord) as ScoreRecordReadType[];
};

export const upsertScore = async (score: Partial<ScoreRecordReadType>) => {
  if (!["id", "project_id", "trace_id"].every((key) => key in score)) {
    throw new Error("Identifier fields must be provided to upsert Score.");
  }

  const id = score.id!;
  const projectId = score.project_id!;

  await prisma.pgScore.upsert({
    where: { id_projectId: { id, projectId } },
    create: {
      id,
      projectId,
      traceId: score.trace_id!,
      observationId: score.observation_id ?? null,
      name: score.name ?? "",
      value: score.value ?? null,
      source: (score.source as any) ?? "API",
      comment: score.comment ?? null,
      authorUserId: score.author_user_id ?? null,
      configId: score.config_id ?? null,
      dataType: (score.data_type as any) ?? "NUMERIC",
      stringValue: score.string_value ?? null,
      queueId: score.queue_id ?? null,
      environment: score.environment ?? "default",
      metadata: (score.metadata as any) ?? Prisma.JsonNull,
      timestamp: score.timestamp ? new Date(score.timestamp) : new Date(),
    },
    update: {
      name: score.name ?? undefined,
      value: score.value ?? undefined,
      source: (score.source as any) ?? undefined,
      comment: score.comment ?? undefined,
      authorUserId: score.author_user_id ?? undefined,
      dataType: (score.data_type as any) ?? undefined,
      stringValue: score.string_value ?? undefined,
      environment: score.environment ?? undefined,
      metadata: (score.metadata as any) ?? undefined,
    },
  });
};

export const getScoresForSessions = async <
  IncludeStringValue extends boolean = true,
>(
  projectId: string,
  sessionIds: string[],
  _opts?: {
    includeStringValue?: IncludeStringValue;
  },
) => {
  // Get trace IDs for these sessions
  const traces = await prisma.pgTrace.findMany({
    where: { projectId, sessionId: { in: sessionIds } },
    select: { id: true, sessionId: true },
  });
  const traceIds = traces.map((t) => t.id);

  if (traceIds.length === 0) return [];

  const scores = await prisma.pgScore.findMany({
    where: { projectId, traceId: { in: traceIds } },
  });

  const traceToSession = new Map(traces.map((t) => [t.id, t.sessionId]));
  return scores.map((s) => ({
    ...convertPrismaScoreToRecord(s),
    session_id: traceToSession.get(s.traceId) ?? null,
  }));
};

export const getScoresForDatasetRuns = async <
  IncludeStringValue extends boolean = true,
>(
  projectId: string,
  _datasetRunIds: string[],
  _opts?: any,
) => {
  return [];
};

export const getTraceScoresForDatasetRuns = async (
  _projectId: string,
  _datasetRunIds: string[],
  _opts?: any,
) => {
  return [];
};

export const getScoresForTraces = async (opts: {
  projectId: string;
  traceIds: string[];
  clickhouseConfigs?: any;
}) => {
  const { projectId, traceIds } = opts;
  if (traceIds.length === 0) return [];
  const scores = await prisma.pgScore.findMany({
    where: { projectId, traceId: { in: traceIds } },
  });
  return scores.map(convertPrismaScoreToRecord) as ScoreRecordReadType[];
};

export const getScoresAndCorrectionsForTraces = async (opts: {
  projectId: string;
  traceIds: string[];
  clickhouseConfigs?: any;
}) => {
  return getScoresForTraces(opts);
};

export const getScoresForObservations = async (opts: {
  projectId: string;
  observationIds: string[];
  clickhouseConfigs?: any;
}) => {
  const { projectId, observationIds } = opts;
  if (observationIds.length === 0) return [];
  const scores = await prisma.pgScore.findMany({
    where: { projectId, observationId: { in: observationIds } },
  });
  return scores.map(convertPrismaScoreToRecord) as ScoreRecordReadType[];
};

export const getScoresGroupedByNameSourceType = async ({
  projectId,
}: {
  projectId: string;
  cutoffCreatedAt?: Date;
}) => {
  const result = await prisma.pgScore.groupBy({
    by: ["name", "source", "dataType"],
    where: { projectId },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });
  return result.map((r) => ({
    name: r.name,
    source: r.source,
    data_type: r.dataType,
    count: r._count.id,
  }));
};

export const getNumericScoresGroupedByName = async (
  projectId: string,
  _filterState?: FilterState,
  _limit?: number,
  _offset?: number,
) => {
  const result = await prisma.pgScore.groupBy({
    by: ["name"],
    where: { projectId, dataType: "NUMERIC" },
    _count: { id: true },
    _avg: { value: true },
    orderBy: { _count: { id: "desc" } },
  });
  return result.map((r) => ({
    name: r.name,
    count: r._count.id,
    avg_value: r._avg.value,
  }));
};

export const getCategoricalScoresGroupedByName = async (
  projectId: string,
  _filterState?: FilterState,
  _limit?: number,
  _offset?: number,
) => {
  const result = await prisma.pgScore.groupBy({
    by: ["name", "stringValue"],
    where: { projectId, dataType: "CATEGORICAL" },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });
  return result.map((r) => ({
    name: r.name,
    string_value: r.stringValue,
    count: r._count.id,
  }));
};

export const getScoresUiCount = async (props: {
  projectId: string;
  filterState?: FilterState;
  searchQuery?: string;
}) => {
  const count = await prisma.pgScore.count({
    where: { projectId: props.projectId },
  });
  return count;
};

export async function getScoresUiTable<
  IncludeStringValue extends boolean = true,
>(props: {
  projectId: string;
  filter?: FilterState;
  filterState?: FilterState;
  searchQuery?: string;
  orderBy?: any;
  limit?: number;
  page?: number;
  offset?: number;
  includeStringValue?: IncludeStringValue;
  clickhouseConfigs?: any;
}) {
  const limit = props.limit ?? 50;
  const page = props.page ?? 0;

  const scores = await prisma.pgScore.findMany({
    where: { projectId: props.projectId },
    orderBy: { timestamp: "desc" },
    take: limit,
    skip: page * limit,
  });

  return scores.map(convertPrismaScoreToRecord);
}

export const getScoreNames = async (
  projectId: string,
  _filterState?: FilterState,
  _limit?: number,
  _offset?: number,
) => {
  const result = await prisma.pgScore.findMany({
    where: { projectId },
    distinct: ["name"],
    select: { name: true },
  });
  return result.map((r) => ({ name: r.name }));
};

export const getScoreStringValues = async (
  projectId: string,
  scoreName: string,
  _filterState?: FilterState,
  _limit?: number,
  _offset?: number,
) => {
  const result = await prisma.pgScore.findMany({
    where: { projectId, name: scoreName, stringValue: { not: null } },
    distinct: ["stringValue"],
    select: { stringValue: true },
  });
  return result.map((r) => ({ value: r.stringValue ?? "" }));
};

export const deleteScores = async (projectId: string, scoreIds: string[]) => {
  await prisma.pgScore.deleteMany({
    where: { projectId, id: { in: scoreIds } },
  });
};

export const deleteScoresByTraceIds = async (
  projectId: string,
  traceIds: string[],
) => {
  await prisma.pgScore.deleteMany({
    where: { projectId, traceId: { in: traceIds } },
  });
};

export const deleteScoresByProjectId = async (projectId: string) => {
  await prisma.pgScore.deleteMany({ where: { projectId } });
};

export const hasAnyScoreOlderThan = async (
  projectId: string,
  timestamp: Date,
) => {
  const score = await prisma.pgScore.findFirst({
    where: { projectId, timestamp: { lt: timestamp } },
    select: { id: true },
  });
  return !!score;
};

export const deleteScoresOlderThanDays = async (
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
  await prisma.pgScore.deleteMany({
    where: { projectId, timestamp: { lt: cutoff } },
  });
};

export const getNumericScoreHistogram = async (
  _projectId: string,
  _scoreName: string,
  _opts?: any,
) => {
  return [];
};

export const getAggregatedScoresForPrompts = async (
  _projectId: string,
  _promptIds: string[],
) => {
  return [];
};

export const getScoreCountsByProjectInCreationInterval = async ({
  start,
  end,
}: {
  start: Date;
  end: Date;
}) => {
  const result = await prisma.pgScore.groupBy({
    by: ["projectId"],
    where: { createdAt: { gte: start, lt: end } },
    _count: { id: true },
  });
  return result.map((r) => ({
    projectId: r.projectId,
    project_id: r.projectId,
    count: r._count.id,
  }));
};

export const getScoreCountOfProjectsSinceCreationDate = async ({
  projectIds,
  creationDate,
}: {
  projectIds: string[];
  creationDate: Date;
}) => {
  const result = await prisma.pgScore.groupBy({
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

export const getDistinctScoreNames = async (p: {
  projectId: string;
  cutoffCreatedAt?: Date;
  filter?: any;
  isTimestampFilter?: boolean | ((filter: any) => boolean);
  clickhouseConfigs?: any;
}) => {
  const result = await prisma.pgScore.findMany({
    where: { projectId: p.projectId },
    distinct: ["name"],
    select: { name: true, source: true, dataType: true },
  });
  return result.map((r) => ({
    name: r.name,
    source: r.source,
    data_type: r.dataType,
  }));
};

export const getScoresForBlobStorageExport = function (
  projectId: string,
  _minTimestamp?: any,
  _maxTimestamp?: any,
) {
  return (async function* () {
    const scores = await prisma.pgScore.findMany({
      where: { projectId },
      orderBy: { timestamp: "asc" },
    });
    for (const score of scores) {
      yield convertPrismaScoreToRecord(score);
    }
  })();
};

export const getScoresForAnalyticsIntegrations = async function* (
  projectId: string,
  _minTimestamp?: any,
  _maxTimestamp?: any,
) {
  const scores = await prisma.pgScore.findMany({
    where: { projectId },
    orderBy: { timestamp: "asc" },
    take: 1000,
  });
  for (const score of scores) {
    yield convertPrismaScoreToRecord(score);
  }
};

export const hasAnyScore = async (projectId: string) => {
  const score = await prisma.pgScore.findFirst({
    where: { projectId },
    select: { id: true },
  });
  return [{ count: score ? 1 : 0 }];
};

export const getScoreMetadataById = async (
  _projectId: string,
  _scoreId: string,
) => {
  return null;
};

export const getScoreCountsByProjectAndDay = async ({
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
    FROM scores
    WHERE project_id = ANY($1)
    GROUP BY project_id, DATE(timestamp)
    ORDER BY day DESC
  `,
    projectIds,
  );
  return result;
};
