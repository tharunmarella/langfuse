/**
 * Sessions UI Table Events Service - PostgreSQL-only implementation.
 * The events table is ClickHouse-specific. In PostgreSQL-only mode,
 * these functions delegate to the main sessions service.
 */

import { FilterState } from "../../types";
import { OrderByState } from "../../interfaces/orderBy";
import {
  getSessionsTable,
  getSessionsTableCount,
  getSessionsWithMetrics,
  SessionDataReturnType,
  SessionWithMetricsReturnType,
} from "./sessions-ui-table-service";

export const getSessionsTableFromEvents = async (props: {
  projectId: string;
  filter: FilterState;
  orderBy?: OrderByState;
  limit?: number;
  page?: number;
}): Promise<SessionDataReturnType[]> => {
  return getSessionsTable(props);
};

export const getSessionsTableCountFromEvents = async (props: {
  projectId: string;
  filter: FilterState;
  orderBy?: OrderByState;
  limit?: number;
  page?: number;
}): Promise<number> => {
  return getSessionsTableCount(props);
};

export const getSessionsWithMetricsFromEvents = async (props: {
  projectId: string;
  filter: FilterState;
  orderBy?: OrderByState;
  limit?: number;
  page?: number;
}): Promise<SessionWithMetricsReturnType[]> => {
  return getSessionsWithMetrics(props);
};
