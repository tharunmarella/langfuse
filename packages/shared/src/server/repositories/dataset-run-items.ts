/**
 * Dataset Run Items repository - PostgreSQL-only implementation.
 * The dataset_run_items_rmt is ClickHouse-specific. In PostgreSQL-only mode,
 * we use the PostgreSQL dataset_run_items table via Prisma.
 */

import { prisma } from "../../db";

export const getDatasetRunsTableMetricsCh = async (_opts: any) => [];

export const getDatasetRunsTableRowsCh = async (_opts: any) => [];

export const getDatasetRunsTableCountCh = async (_opts: any) => 0;

export const getDatasetRunItemsCh = async (opts: {
  projectId: string;
  datasetRunId?: string;
  filter?: any;
  limit?: number;
  orderBy?: any;
  offset?: number;
  clickhouseConfigs?: any;
}) => {
  const projectId = opts.projectId;
  const datasetRunId = opts.datasetRunId;
  if (!datasetRunId) return [];
  const items = await prisma.datasetRunItems.findMany({
    where: { projectId, datasetRunId },
  });
  return items;
};

export const getDatasetRunItemsByDatasetIdCh = async (
  projectId: string,
  datasetId: string,
  _opts?: any,
) => {
  const items = await prisma.datasetRunItems.findMany({
    where: {
      projectId,
      datasetRun: { datasetId },
    },
  });
  return items;
};

export const getDatasetItemsWithRunDataCount = async (_opts: any) => 0;

export const getDatasetItemIdsWithRunData = async (_opts: any) => [];

export const getDatasetRunItemsWithoutIOByItemIds = async (
  _projectId: string,
  _itemIds: string[],
  _opts?: any,
) => [];

export const getDatasetItemIdsByTraceIdCh = async (
  _projectId: string,
  _traceId: string,
  _opts?: any,
) => [];

export const getDatasetRunItemsCountCh = async (_opts: any) => 0;

export const getDatasetRunItemsCountByDatasetIdCh = async (_opts: any) => 0;

export const hasAnyDatasetRunItem = async (projectId: string) => {
  const item = await prisma.datasetRunItems.findFirst({
    where: { projectId },
    select: { id: true },
  });
  return [{ count: item ? 1 : 0 }];
};

export const deleteDatasetRunItemsByProjectId = async (projectId: string) => {
  // Dataset run items are deleted via cascade from project deletion
};

export const deleteDatasetRunItemsByDatasetId = async ({
  projectId,
  datasetId,
}: {
  projectId: string;
  datasetId: string;
}) => {
  // Handled by cascade
};

export const deleteDatasetRunItemsByDatasetRunIds = async ({
  projectId,
  datasetRunIds,
}: {
  projectId: string;
  datasetRunIds: string[];
}) => {
  // Handled by cascade
};

export const getDatasetRunItemCountsByProjectInCreationInterval = async ({
  start,
  end,
}: {
  start: Date;
  end: Date;
}) => {
  const result = await prisma.datasetRunItems.groupBy({
    by: ["projectId"],
    where: { createdAt: { gte: start, lt: end } },
    _count: { id: true },
  });
  return result.map((r) => ({
    project_id: r.projectId,
    count: r._count.id,
  }));
};
