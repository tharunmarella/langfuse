/**
 * Blob Storage Log repository - PostgreSQL-only implementation.
 * The blob_storage_file_log is ClickHouse-specific. In PostgreSQL-only mode,
 * these functions are stubs.
 */

export const getBlobStorageByProjectAndEntityId = async (
  _projectId: string,
  _entityId: string,
) => [];

export const getBlobStorageByProjectId = function (
  _projectId: string,
  _opts?: any,
) {
  return (async function* () {})();
};

export const getBlobStorageByProjectIdBeforeDate = function (
  _projectId: string,
  _date: Date,
  _opts?: any,
) {
  return (async function* () {})();
};

export const getBlobStorageByProjectIdAndEntityIds = function (
  _projectId: string,
  _entityType: string,
  _entityIds: string[],
  _opts?: any,
) {
  return (async function* () {})();
};

export const getBlobStorageByProjectIdAndTraceIds = function (
  _projectId: string,
  _traceIds: string[],
  _opts?: any,
) {
  return (async function* () {})();
};

export const insertIntoS3RefsTableFromEventLog = async (_opts: any) => {};

export const getLastEventLogPrimaryKey = async (_projectId: string) => null;

export const findS3RefsByPrimaryKey = async (
  _projectId: string,
  _primaryKey: string,
) => [];
