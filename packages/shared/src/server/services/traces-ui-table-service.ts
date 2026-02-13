/**
 * Traces UI Table Service - PostgreSQL-only implementation.
 * Provides data for the traces list UI with pagination, filtering, and metrics.
 */

import { OrderByState } from "../../interfaces/orderBy";
import { FilterState } from "../../types";
import { TraceRecordReadType } from "../repositories/definitions";
import Decimal from "decimal.js";
import { ScoreAggregate } from "../../features/scores";
import { TracingSearchType } from "../../interfaces/search";
import { ObservationLevelType, TraceDomain } from "../../domain";
import { prisma } from "../../db";

export type TracesTableReturnType = Pick<
  TraceRecordReadType,
  | "project_id"
  | "id"
  | "name"
  | "timestamp"
  | "bookmarked"
  | "release"
  | "version"
  | "user_id"
  | "session_id"
  | "environment"
  | "tags"
  | "public"
>;

export type TracesTableUiReturnType = Pick<
  TraceDomain,
  | "id"
  | "projectId"
  | "timestamp"
  | "tags"
  | "bookmarked"
  | "name"
  | "release"
  | "version"
  | "userId"
  | "environment"
  | "sessionId"
  | "public"
>;

export type TracesMetricsUiReturnType = {
  id: string;
  projectId: string;
  promptTokens: bigint;
  completionTokens: bigint;
  totalTokens: bigint;
  latency: number | null;
  level: ObservationLevelType;
  observationCount: bigint;
  calculatedTotalCost: Decimal | null;
  calculatedInputCost: Decimal | null;
  calculatedOutputCost: Decimal | null;
  scores: ScoreAggregate;
  usageDetails: Record<string, number>;
  costDetails: Record<string, number>;
  errorCount: bigint;
  warningCount: bigint;
  defaultCount: bigint;
  debugCount: bigint;
};

export async function getTracesTable(opts: {
  projectId: string;
  filter: FilterState;
  searchQuery?: string;
  searchType?: TracingSearchType | TracingSearchType[];
  orderBy?: OrderByState;
  limit: number;
  page: number;
  clickhouseConfigs?: any;
}): Promise<TracesTableUiReturnType[]> {
  const traces = await prisma.pgTrace.findMany({
    where: { projectId: opts.projectId },
    orderBy: { timestamp: "desc" },
    take: opts.limit,
    skip: opts.page * opts.limit,
    select: {
      id: true,
      projectId: true,
      timestamp: true,
      tags: true,
      bookmarked: true,
      name: true,
      release: true,
      version: true,
      userId: true,
      environment: true,
      sessionId: true,
      public: true,
    },
  });

  return traces.map((t) => ({
    id: t.id,
    projectId: t.projectId,
    timestamp: t.timestamp,
    tags: t.tags,
    bookmarked: t.bookmarked,
    name: t.name ?? null,
    release: t.release ?? null,
    version: t.version ?? null,
    userId: t.userId ?? null,
    environment: t.environment,
    sessionId: t.sessionId ?? null,
    public: t.public,
  }));
}

export async function getTracesTableCount(opts: {
  projectId: string;
  filter: FilterState;
  searchQuery?: string;
  searchType?: TracingSearchType;
}): Promise<number> {
  return prisma.pgTrace.count({
    where: { projectId: opts.projectId },
  });
}

export async function getTracesTableMetrics(opts: {
  projectId: string;
  traceIds?: string[];
  filter?: FilterState;
  clickhouseConfigs?: any;
}): Promise<TracesMetricsUiReturnType[]> {
  if (!opts.traceIds || opts.traceIds.length === 0) return [];

  const metrics: TracesMetricsUiReturnType[] = [];

  for (const traceId of opts.traceIds || []) {
    const observations = await prisma.pgObservation.findMany({
      where: { projectId: opts.projectId, traceId },
      select: {
        id: true,
        level: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        calculatedTotalCost: true,
        calculatedInputCost: true,
        calculatedOutputCost: true,
        startTime: true,
        endTime: true,
        usageDetails: true,
        costDetails: true,
      },
    });

    const trace = await prisma.pgTrace.findFirst({
      where: { projectId: opts.projectId, id: traceId },
      select: { timestamp: true },
    });

    let latency: number | null = null;
    if (trace && observations.length > 0) {
      const maxEndTime = observations.reduce((max, obs) => {
        if (obs.endTime && obs.endTime > max) return obs.endTime;
        return max;
      }, trace.timestamp);
      latency = (maxEndTime.getTime() - trace.timestamp.getTime()) / 1000;
    }

    const errorCount = observations.filter((o) => o.level === "ERROR").length;
    const warningCount = observations.filter(
      (o) => o.level === "WARNING",
    ).length;
    const defaultCount = observations.filter(
      (o) => o.level === "DEFAULT",
    ).length;
    const debugCount = observations.filter((o) => o.level === "DEBUG").length;

    let level: ObservationLevelType = "DEBUG";
    if (errorCount > 0) level = "ERROR";
    else if (warningCount > 0) level = "WARNING";
    else if (defaultCount > 0) level = "DEFAULT";

    const promptTokens = observations.reduce(
      (sum, o) => sum + BigInt(o.promptTokens),
      BigInt(0),
    );
    const completionTokens = observations.reduce(
      (sum, o) => sum + BigInt(o.completionTokens),
      BigInt(0),
    );
    const totalTokens = observations.reduce(
      (sum, o) => sum + BigInt(o.totalTokens),
      BigInt(0),
    );

    const totalCost = observations.reduce(
      (sum, o) =>
        o.calculatedTotalCost ? sum.add(o.calculatedTotalCost.toString()) : sum,
      new Decimal(0),
    );
    const inputCost = observations.reduce(
      (sum, o) =>
        o.calculatedInputCost ? sum.add(o.calculatedInputCost.toString()) : sum,
      new Decimal(0),
    );
    const outputCost = observations.reduce(
      (sum, o) =>
        o.calculatedOutputCost
          ? sum.add(o.calculatedOutputCost.toString())
          : sum,
      new Decimal(0),
    );

    metrics.push({
      id: traceId,
      projectId: opts.projectId,
      promptTokens,
      completionTokens,
      totalTokens,
      latency,
      level,
      observationCount: BigInt(observations.length),
      calculatedTotalCost: totalCost.isZero() ? null : totalCost,
      calculatedInputCost: inputCost.isZero() ? null : inputCost,
      calculatedOutputCost: outputCost.isZero() ? null : outputCost,
      scores: {},
      usageDetails: {},
      costDetails: {},
      errorCount: BigInt(errorCount),
      warningCount: BigInt(warningCount),
      defaultCount: BigInt(defaultCount),
      debugCount: BigInt(debugCount),
    });
  }

  return metrics;
}
