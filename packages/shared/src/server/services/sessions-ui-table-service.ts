/**
 * Sessions UI Table Service - PostgreSQL-only implementation.
 */

import { OrderByState } from "../../interfaces/orderBy";
import { FilterState } from "../../types";
import { prisma } from "../../db";

export type SessionDataReturnType = {
  session_id: string;
  max_timestamp: string;
  min_timestamp: string;
  trace_ids: string[];
  user_ids: string[];
  trace_count: number;
  trace_tags: string[];
  trace_environment?: string;
  scores_avg?: Array<Array<[string, number]>>;
  score_categories?: Array<Array<string>>;
};

export type SessionWithMetricsReturnType = SessionDataReturnType & {
  total_observations: number;
  duration: number;
  session_usage_details: Record<string, number>;
  session_cost_details: Record<string, number>;
  session_input_cost: string;
  session_output_cost: string;
  session_total_cost: string;
  session_input_usage: string;
  session_output_usage: string;
  session_total_usage: string;
};

export const getSessionsTableCount = async (props: {
  projectId: string;
  filter: FilterState;
  orderBy?: OrderByState;
  limit?: number;
  page?: number;
}) => {
  const result = await prisma.pgTrace.groupBy({
    by: ["sessionId"],
    where: { projectId: props.projectId, sessionId: { not: null } },
    _count: { id: true },
  });
  return result.length;
};

export const getSessionsTable = async (props: {
  projectId: string;
  filter: FilterState;
  orderBy?: OrderByState;
  limit?: number;
  page?: number;
}): Promise<SessionDataReturnType[]> => {
  const limit = props.limit ?? 50;
  const page = props.page ?? 0;

  const sessions = await prisma.$queryRawUnsafe<any[]>(
    `
    SELECT
      session_id,
      MAX(timestamp) as max_timestamp,
      MIN(timestamp) as min_timestamp,
      array_agg(DISTINCT id) as trace_ids,
      array_agg(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) as user_ids,
      COUNT(*)::int as trace_count,
      array_agg(DISTINCT unnest_tags) as trace_tags
    FROM traces
    LEFT JOIN LATERAL unnest(tags) AS unnest_tags ON true
    WHERE project_id = $1
      AND session_id IS NOT NULL
    GROUP BY session_id
    ORDER BY max_timestamp DESC
    LIMIT $2 OFFSET $3
  `,
    props.projectId,
    limit,
    page * limit,
  );

  return sessions.map((s) => ({
    session_id: s.session_id,
    max_timestamp: s.max_timestamp?.toISOString() ?? "",
    min_timestamp: s.min_timestamp?.toISOString() ?? "",
    trace_ids: s.trace_ids ?? [],
    user_ids: (s.user_ids ?? []).filter(Boolean),
    trace_count: Number(s.trace_count),
    trace_tags: (s.trace_tags ?? []).filter(Boolean),
  }));
};

export const getSessionsWithMetrics = async (props: {
  projectId: string;
  filter: FilterState;
  orderBy?: OrderByState;
  limit?: number;
  page?: number;
  clickhouseConfigs?: any;
}): Promise<SessionWithMetricsReturnType[]> => {
  const sessions = await getSessionsTable(props);

  // Fetch metrics for each session
  const results: SessionWithMetricsReturnType[] = [];
  for (const session of sessions) {
    const observations = await prisma.pgObservation.aggregate({
      where: {
        projectId: props.projectId,
        traceId: { in: session.trace_ids },
      },
      _count: { id: true },
      _sum: {
        calculatedTotalCost: true,
        calculatedInputCost: true,
        calculatedOutputCost: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
      },
    });

    const duration =
      session.max_timestamp && session.min_timestamp
        ? (new Date(session.max_timestamp).getTime() -
            new Date(session.min_timestamp).getTime()) /
          1000
        : 0;

    results.push({
      ...session,
      total_observations: observations._count.id,
      duration,
      session_usage_details: {
        input: observations._sum.promptTokens ?? 0,
        output: observations._sum.completionTokens ?? 0,
        total: observations._sum.totalTokens ?? 0,
      },
      session_cost_details: {},
      session_input_cost: (
        observations._sum.calculatedInputCost ?? 0
      ).toString(),
      session_output_cost: (
        observations._sum.calculatedOutputCost ?? 0
      ).toString(),
      session_total_cost: (
        observations._sum.calculatedTotalCost ?? 0
      ).toString(),
      session_input_usage: (observations._sum.promptTokens ?? 0).toString(),
      session_output_usage: (
        observations._sum.completionTokens ?? 0
      ).toString(),
      session_total_usage: (observations._sum.totalTokens ?? 0).toString(),
    });
  }

  return results;
};

export type FetchSessionsTableProps = {
  projectId: string;
  filter: FilterState;
  searchQuery?: string;
  orderBy?: OrderByState;
  limit?: number;
  page?: number;
};
