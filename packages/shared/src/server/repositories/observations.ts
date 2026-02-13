/**
 * Observations repository - PostgreSQL-only implementation.
 * Replaces the original ClickHouse-based implementation.
 */

import { prisma } from "../../db";
import { FilterState } from "../../types";
import {
  ObservationRecordReadType,
  ObservationRecordInsertType,
} from "./definitions";
import { convertPrismaObservationToRecord } from "./postgres";
import { DEFAULT_RENDERING_PROPS, RenderingProps } from "../utils/rendering";
import { Prisma } from "@prisma/client";
import { ObservationDomain, ObservationType } from "../../domain";
import { parseMetadataCHRecordToDomain } from "../utils/metadata_conversion";
import { applyInputOutputRendering } from "../utils/rendering";

type ObsRecord = Record<string, any>;

function convertToRecord(obs: any): ObsRecord {
  return convertPrismaObservationToRecord(obs);
}

function convertToDomain(
  record: ObsRecord,
  renderingProps: RenderingProps = DEFAULT_RENDERING_PROPS,
): ObservationDomain {
  return {
    id: record.id,
    traceId: record.trace_id ?? null,
    projectId: record.project_id,
    type: record.type as ObservationType,
    parentObservationId: record.parent_observation_id ?? null,
    startTime: new Date(record.start_time),
    endTime: record.end_time ? new Date(record.end_time) : null,
    name: record.name ?? null,
    metadata: parseMetadataCHRecordToDomain(record.metadata ?? {}),
    level: record.level ?? "DEFAULT",
    statusMessage: record.status_message ?? null,
    version: record.version ?? null,
    model: record.provided_model_name ?? null,
    modelParameters: record.model_parameters
      ? JSON.parse(record.model_parameters)
      : null,
    input: applyInputOutputRendering(record.input, renderingProps),
    output: applyInputOutputRendering(record.output, renderingProps),
    environment: record.environment ?? "default",
    completionStartTime: record.completion_start_time
      ? new Date(record.completion_start_time)
      : null,
    promptId: record.prompt_id ?? null,
    promptName: record.prompt_name ?? null,
    promptVersion: record.prompt_version ?? null,
    modelId: record.internal_model_id ?? null,
    usageDetails: record.usage_details ?? {},
    costDetails: record.cost_details ?? {},
    providedUsageDetails: record.provided_usage_details ?? {},
    providedCostDetails: record.provided_cost_details ?? {},
    totalCost: record.total_cost ?? null,
    createdAt: new Date(record.created_at),
    updatedAt: new Date(record.updated_at),
  } as any;
}

export const checkObservationExists = async (
  projectId: string,
  observationId: string,
  _traceId?: string,
  _startTime?: Date,
) => {
  const obs = await prisma.pgObservation.findFirst({
    where: { id: observationId, projectId },
    select: { id: true, startTime: true },
  });
  return {
    exists: !!obs,
    startTime: obs?.startTime ?? undefined,
  };
};

export const upsertObservation = async (
  obs: Partial<ObservationRecordReadType>,
) => {
  if (!["id", "project_id", "start_time"].every((key) => key in obs)) {
    throw new Error(
      "Identifier fields must be provided to upsert Observation.",
    );
  }

  const id = obs.id!;
  const projectId = obs.project_id!;

  await prisma.pgObservation.upsert({
    where: { id },
    create: {
      id,
      traceId: obs.trace_id ?? null,
      projectId,
      type: (obs.type as any) ?? "SPAN",
      startTime: obs.start_time ? new Date(obs.start_time) : new Date(),
      endTime: obs.end_time ? new Date(obs.end_time) : null,
      name: obs.name ?? null,
      metadata: (obs.metadata as any) ?? Prisma.JsonNull,
      parentObservationId: obs.parent_observation_id ?? null,
      level: (obs.level as any) ?? "DEFAULT",
      statusMessage: obs.status_message ?? null,
      version: obs.version ?? null,
      model: obs.provided_model_name ?? null,
      internalModelId: obs.internal_model_id ?? null,
      modelParameters: obs.model_parameters
        ? safeJsonParse(obs.model_parameters)
        : Prisma.JsonNull,
      input: obs.input ? safeJsonParse(obs.input) : Prisma.JsonNull,
      output: obs.output ? safeJsonParse(obs.output) : Prisma.JsonNull,
      completionStartTime: obs.completion_start_time
        ? new Date(obs.completion_start_time)
        : null,
      promptId: obs.prompt_id ?? null,
      environment: obs.environment ?? "default",
      promptName: obs.prompt_name ?? null,
      promptVersion: obs.prompt_version ?? null,
      usageDetails: (obs.usage_details as any) ?? Prisma.JsonNull,
      costDetails: (obs.cost_details as any) ?? Prisma.JsonNull,
      providedUsageDetails:
        (obs.provided_usage_details as any) ?? Prisma.JsonNull,
      providedCostDetails:
        (obs.provided_cost_details as any) ?? Prisma.JsonNull,
    },
    update: {
      traceId: obs.trace_id ?? undefined,
      name: obs.name ?? undefined,
      metadata: (obs.metadata as any) ?? undefined,
      level: (obs.level as any) ?? undefined,
      statusMessage: obs.status_message ?? undefined,
      version: obs.version ?? undefined,
      model: obs.provided_model_name ?? undefined,
      internalModelId: obs.internal_model_id ?? undefined,
      input: obs.input ? safeJsonParse(obs.input) : undefined,
      output: obs.output ? safeJsonParse(obs.output) : undefined,
      environment: obs.environment ?? undefined,
      usageDetails: (obs.usage_details as any) ?? undefined,
      costDetails: (obs.cost_details as any) ?? undefined,
      providedUsageDetails: (obs.provided_usage_details as any) ?? undefined,
      providedCostDetails: (obs.provided_cost_details as any) ?? undefined,
    },
  });
};

export const getObservationsForTrace = async <IncludeIO extends boolean>(
  traceId: string,
  projectId: string,
  opts?: {
    includeIO?: IncludeIO;
    renderingProps?: RenderingProps;
    traceTimestamp?: Date;
  },
) => {
  const observations = await prisma.pgObservation.findMany({
    where: { traceId, projectId },
    orderBy: { startTime: "asc" },
  });
  return observations.map(convertToRecord) as ObservationRecordReadType[];
};

export const getObservationForTraceIdByName = async ({
  traceId,
  projectId,
  name,
}: {
  traceId: string;
  projectId: string;
  name: string;
  traceTimestamp?: Date;
}) => {
  const obs = await prisma.pgObservation.findFirst({
    where: { traceId, projectId, name },
    orderBy: { startTime: "desc" },
  });
  if (!obs) return null;
  return convertToRecord(obs) as ObservationRecordReadType;
};

export const getObservationById = async ({
  observationId,
  projectId,
  renderingProps = DEFAULT_RENDERING_PROPS,
}: {
  observationId: string;
  projectId: string;
  traceTimestamp?: Date;
  startTime?: Date;
  renderingProps?: RenderingProps;
}) => {
  const obs = await prisma.pgObservation.findFirst({
    where: { id: observationId, projectId },
  });
  if (!obs) return undefined;
  return convertToDomain(convertToRecord(obs), renderingProps);
};

export const getObservationsById = async (
  observationIds: string[],
  projectId: string,
  _opts?: any,
) => {
  const observations = await prisma.pgObservation.findMany({
    where: { id: { in: observationIds }, projectId },
  });
  return observations.map(convertToRecord) as ObservationRecordReadType[];
};

export const getObservationsTableCount = async (_opts: any) => {
  const projectId = _opts.projectId;
  const count = await prisma.pgObservation.count({
    where: { projectId },
  });
  return count;
};

export const getObservationsTableWithModelData = async (_opts: any) => {
  const projectId = _opts.projectId;
  const limit = _opts.limit ?? 50;
  const offset = _opts.offset ?? _opts.page ?? 0;

  const observations = await prisma.pgObservation.findMany({
    where: { projectId },
    orderBy: { startTime: "desc" },
    take: limit,
    skip: offset * limit,
  });

  return observations.map(convertToRecord);
};

export const getObservationsGroupedByModel = async (
  projectId: string,
  _tableDefinitions?: any[],
  _filterState?: FilterState,
) => {
  const result = await prisma.pgObservation.groupBy({
    by: ["model"],
    where: { projectId },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });
  return result.map((r) => ({
    model: r.model ?? "",
    count: r._count.id,
  }));
};

export const getObservationsGroupedByModelId = async (
  projectId: string,
  _tableDefinitions?: any[],
  _filterState?: FilterState,
) => {
  const result = await prisma.pgObservation.groupBy({
    by: ["internalModelId"],
    where: { projectId },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });
  return result.map((r) => ({
    internal_model_id: r.internalModelId ?? "",
    count: r._count.id,
  }));
};

export const getObservationsGroupedByName = async (
  projectId: string,
  _tableDefinitions?: any[],
  _filterState?: FilterState,
) => {
  const result = await prisma.pgObservation.groupBy({
    by: ["name"],
    where: { projectId },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });
  return result.map((r) => ({
    name: r.name ?? "",
    count: r._count.id,
  }));
};

export const getObservationsGroupedByToolName = async (
  projectId: string,
  _tableDefinitions?: any[],
  _filterState?: FilterState,
) => {
  return [];
};

export const getObservationsGroupedByCalledToolName = async (
  projectId: string,
  _tableDefinitions?: any[],
  _filterState?: FilterState,
) => {
  return [];
};

export const getObservationsGroupedByPromptName = async (
  projectId: string,
  _tableDefinitions?: any[],
  _filterState?: FilterState,
  _limit?: number,
  _offset?: number,
) => {
  const result = await prisma.pgObservation.groupBy({
    by: ["promptId"],
    where: { projectId, promptId: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  });
  return result.map((r) => ({
    prompt_id: r.promptId ?? "",
    count: r._count.id,
  }));
};

export const getCostForTraces = async (
  projectId: string,
  traceIds: string[],
  _timestamp?: Date,
) => {
  const result = await prisma.pgObservation.groupBy({
    by: ["traceId"],
    where: { projectId, traceId: { in: traceIds } },
    _sum: {
      calculatedTotalCost: true,
    },
  });
  return result.map((r) => ({
    trace_id: r.traceId,
    total_cost: r._sum.calculatedTotalCost
      ? Number(r._sum.calculatedTotalCost)
      : 0,
  }));
};

export const deleteObservationsByTraceIds = async (
  projectId: string,
  traceIds: string[],
) => {
  await prisma.pgObservation.deleteMany({
    where: { projectId, traceId: { in: traceIds } },
  });
};

export const hasAnyObservation = async (projectId: string) => {
  const obs = await prisma.pgObservation.findFirst({
    where: { projectId },
    select: { id: true },
  });
  return [{ count: obs ? 1 : 0 }];
};

export const deleteObservationsByProjectId = async (projectId: string) => {
  await prisma.pgObservation.deleteMany({ where: { projectId } });
};

export const hasAnyObservationOlderThan = async (
  projectId: string,
  timestamp: Date,
) => {
  const obs = await prisma.pgObservation.findFirst({
    where: { projectId, startTime: { lt: timestamp } },
    select: { id: true },
  });
  return !!obs;
};

export const deleteObservationsOlderThanDays = async (
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
  await prisma.pgObservation.deleteMany({
    where: { projectId, startTime: { lt: cutoff } },
  });
};

export const getObservationsWithPromptName = async (
  projectId: string,
  _opts: any,
) => {
  return [];
};

export const getObservationMetricsForPrompts = async (
  _projectId: string,
  _opts: any,
) => {
  return [];
};

export const getLatencyAndTotalCostForObservations = async (
  _projectId: string,
  _observationIds: string[],
) => {
  return [];
};

export const getLatencyAndTotalCostForObservationsByTraces = async (
  _projectId: string,
  _traceIds: string[],
  _opts?: any,
) => {
  return [];
};

export const getObservationsGroupedByTraceId = async (
  projectId: string,
  traceIds: string[],
  _opts?: any,
) => {
  const result = await prisma.pgObservation.groupBy({
    by: ["traceId"],
    where: { projectId, traceId: { in: traceIds } },
    _count: { id: true },
    _sum: { calculatedTotalCost: true },
  });
  return result.map((r) => ({
    trace_id: r.traceId,
    obs_count: r._count.id,
    total_cost: r._sum.calculatedTotalCost
      ? Number(r._sum.calculatedTotalCost)
      : 0,
  }));
};

export const getObservationCountsByProjectInCreationInterval = async ({
  start,
  end,
}: {
  start: Date;
  end: Date;
}) => {
  const result = await prisma.pgObservation.groupBy({
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

export const getObservationCountOfProjectsSinceCreationDate = async ({
  projectIds,
  creationDate,
}: {
  projectIds: string[];
  creationDate: Date;
}) => {
  const result = await prisma.pgObservation.groupBy({
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

export const getTraceIdsForObservations = async (
  projectId: string,
  observationIds: string[],
) => {
  const result = await prisma.pgObservation.findMany({
    where: { projectId, id: { in: observationIds } },
    select: { id: true, traceId: true },
  });
  return result.map((r) => ({
    id: r.id,
    trace_id: r.traceId,
  }));
};

export const getObservationsForBlobStorageExport = function (
  projectId: string,
  _minTimestamp?: any,
  _maxTimestamp?: any,
) {
  return (async function* () {
    const observations = await prisma.pgObservation.findMany({
      where: { projectId },
      orderBy: { startTime: "asc" },
    });
    for (const obs of observations) {
      yield convertToRecord(obs);
    }
  })();
};

export const getGenerationsForAnalyticsIntegrations = async function* (
  projectId: string,
  _opts: any,
) {
  const observations = await prisma.pgObservation.findMany({
    where: { projectId, type: "GENERATION" },
    orderBy: { startTime: "asc" },
    take: 1000,
  });
  for (const obs of observations) {
    yield convertToRecord(obs);
  }
};

export const getObservationCountsByProjectAndDay = async ({
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
    SELECT project_id, DATE(start_time) as day, COUNT(*) as count
    FROM observations
    WHERE project_id = ANY($1)
    GROUP BY project_id, DATE(start_time)
    ORDER BY day DESC
  `,
    projectIds,
  );
  return result;
};

export const getCostByEvaluatorIds = async (
  _projectId: string,
  _evaluatorIds: string[],
) => {
  return [];
};

function safeJsonParse(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
