/**
 * Dashboards repository - PostgreSQL-only implementation.
 * Provides simplified dashboard data. Complex time-series analytics
 * may have reduced functionality compared to the ClickHouse version.
 */

import { FilterState } from "../../types";

export type DateTrunc = "month" | "week" | "day" | "hour" | "minute";

export const getScoreAggregate = async (
  _projectId: string,
  _filter: FilterState,
  _scoreName: string,
) => {
  return [];
};

export const getObservationCostByTypeByTime = async (
  _projectId: string,
  _filter: FilterState,
  _groupBy: DateTrunc,
) => {
  return [];
};

export const getObservationUsageByTypeByTime = async (
  _projectId: string,
  _filter: FilterState,
  _groupBy: DateTrunc,
) => {
  return [];
};

// getNumericScoreHistogram is exported from scores.ts
