/**
 * Events repository - PostgreSQL-only implementation.
 * The events table is ClickHouse-specific. In PostgreSQL-only mode,
 * these functions delegate to the traces/observations/scores repositories
 * or return empty results for features that require the events table.
 */

import { prisma } from "../../db";
import { FilterState } from "../../types";
import {
  convertPrismaObservationToRecord,
  convertPrismaTraceToRecord,
} from "./postgres";
import { DEFAULT_RENDERING_PROPS, RenderingProps } from "../utils/rendering";
import { convertClickhouseToDomain } from "./traces_converters";
import { TraceRecordReadType } from "./definitions";

// Re-export types needed by consumers
export const OBSERVATION_FIELD_GROUPS = [
  "core",
  "model",
  "usage",
  "cost",
  "prompt",
  "tools",
  "metadata",
  "io",
  "timing",
] as const;

export const getObservationsCountFromEventsTable = async (_opts: any) => 0;

export const getObservationsWithModelDataFromEventsTable = async (
  _opts: any,
) => [];

export const getObservationByIdFromEventsTable = async (_opts: any) =>
  undefined;

export const getTraceByIdFromEventsTable = async (_opts: any) => undefined;

export const getObservationsFromEventsTableForPublicApi = async (
  _opts: any,
) => [];

export const getObservationsV2FromEventsTableForPublicApi = async (
  _opts: any,
) => [];

export const getObservationsCountFromEventsTableForPublicApi = async (
  _opts: any,
) => 0;

export const getTracesFromEventsTableForPublicApi = async (
  projectId: string,
  _opts: any,
) => {
  const traces = await prisma.pgTrace.findMany({
    where: { projectId },
    orderBy: { timestamp: "desc" },
    take: 50,
  });
  return traces.map(convertPrismaTraceToRecord);
};

export const getTracesCountFromEventsTableForPublicApi = async (
  projectId: string,
  _opts: any,
) => {
  return prisma.pgTrace.count({ where: { projectId } });
};

export const updateEvents = async (_opts: any) => {};

export const getEventsGroupedByModel = async (
  _projectId: string,
  ..._args: any[]
) => [];
export const getEventsGroupedByModelId = async (
  _projectId: string,
  ..._args: any[]
) => [];
export const getEventsGroupedByName = async (
  _projectId: string,
  ..._args: any[]
) => [];
export const getEventsGroupedByTraceName = async (
  _projectId: string,
  ..._args: any[]
) => [];
export const getEventsGroupedByTraceTags = async (
  _projectId: string,
  ..._args: any[]
) => [];
export const getEventsGroupedByPromptName = async (
  _projectId: string,
  ..._args: any[]
) => [];
export const getEventsGroupedByType = async (
  _projectId: string,
  ..._args: any[]
) => [];
export const getEventsGroupedByUserId = async (
  _projectId: string,
  ..._args: any[]
) => [];
export const getEventsGroupedByVersion = async (
  _projectId: string,
  ..._args: any[]
) => [];
export const getEventsGroupedBySessionId = async (
  _projectId: string,
  ..._args: any[]
) => [];
export const getEventsGroupedByLevel = async (
  _projectId: string,
  ..._args: any[]
) => [];
export const getEventsGroupedByEnvironment = async (
  _projectId: string,
  ..._args: any[]
) => [];
export const getEventsGroupedByExperimentDatasetId = async (
  _projectId: string,
  ..._args: any[]
) => [];
export const getEventsGroupedByExperimentId = async (
  _projectId: string,
  ..._args: any[]
) => [];
export const getEventsGroupedByExperimentName = async (
  _projectId: string,
  ..._args: any[]
) => [];

export const deleteEventsByTraceIds = async (
  _projectId: string,
  _traceIds: string[],
) => {};

export const hasAnyEvent = async (
  projectId: string,
  opts?: { cutoffCreatedAt?: Date },
) => {
  return [{ count: 0 }];
};

export const deleteEventsByProjectId = async (_projectId: string) => {};

export async function getAgentGraphDataFromEventsTable(_params: any) {
  return [];
}

export const hasAnyEventOlderThan = async (
  _projectId: string,
  _timestamp: Date,
) => false;

export const deleteEventsOlderThanDays = async (
  _projectId: string,
  _daysOrCutoff: number | Date,
) => {};

export const getObservationsBatchIOFromEventsTable = async (_opts: any) => [];

export const getUsersFromEventsTable = async (_opts: any) => [];
export const getUsersCountFromEventsTable = async (_opts: any) => [
  { totalCount: 0 },
];
export const getUserMetricsFromEventsTable = async (
  _projectId: string,
  _userIds: string[],
  _filter: any,
) =>
  [] as Array<{
    minTimestamp: Date;
    maxTimestamp: Date;
    traceCount: number;
    inputUsage: number;
    outputUsage: number;
    totalUsage: number;
    observationCount: number;
    totalCost: number;
  }>;
export const hasAnyUserFromEventsTable = async (_projectId: string) => false;

export const getEventsForBlobStorageExport = function (
  _projectId: string,
  _minTimestamp?: any,
  _maxTimestamp?: any,
) {
  return (async function* () {})();
};

export const getEventsForAnalyticsIntegrations = async function* (
  _projectId: string,
  _opts: any,
) {};

export const hasAnySessionFromEventsTable = async (_projectId: string) => false;
