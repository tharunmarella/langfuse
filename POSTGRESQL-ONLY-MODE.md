# PostgreSQL-Only Mode

This document explains how to run Langfuse with **PostgreSQL only** (no ClickHouse dependency).

## Overview

Langfuse has been modified to support PostgreSQL-only deployment for small-scale use cases (< 10K traces). This simplifies deployment by removing the ClickHouse dependency.

**Trade-offs:**
- ✅ Simpler deployment (one database instead of two)
- ✅ Lower infrastructure costs
- ✅ Easier to manage for small teams
- ❌ Slower analytics queries (dashboards, exports)
- ❌ Some advanced analytics features return empty data
- ❌ Not suitable for high-volume production use (>10K traces)

## Architecture Changes

### What Changed

**Database Schema:**
- Renamed Prisma models: `LegacyPrismaTrace` → `PgTrace`, etc.
- Added `environment`, `metadata`, and cost/usage tracking columns
- Tables map to the same database names (`traces`, `observations`, `scores`)

**Repository Layer:**
- All ClickHouse queries replaced with Prisma/PostgreSQL
- `queryClickhouse()` now routes to PostgreSQL via Prisma
- ClickHouse client returns stubs (no actual ClickHouse connection)

**Worker:**
- `ClickhouseWriter` writes to PostgreSQL via Prisma upserts
- ClickHouse-specific tables (events, observations_batch_staging) are skipped

**Deployment:**
- `web/entrypoint.sh` - ClickHouse checks and migrations commented out
- `CLICKHOUSE_URL` is optional in env validation

## Running Locally (Development)

### 1. Start Infrastructure

```bash
# Start PostgreSQL, Redis, MinIO
docker compose -f docker-compose.infra-only.yml up -d
```

### 2. Run Migrations

```bash
cd packages/shared
pnpm run db:migrate
```

### 3. Start Web App

```bash
# From project root
pnpm run dev:web
```

The app will be available at **http://localhost:3000** (or 3002 if 3000 is in use).

### 4. Seed Database (Optional)

```bash
cd packages/shared
pnpm run db:seed
```

## Running with Docker Compose

Use the PostgreSQL-only compose file:

```bash
docker compose -f docker-compose.pg-only.yml up -d
```

**Note:** Docker builds are memory-intensive. If you encounter OOM errors, increase Docker's memory limit:
- Docker Desktop: Settings → Resources → Memory (recommended: 8GB+)
- Or use the local development setup above

## Environment Variables

### Required

```env
# PostgreSQL
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres
DIRECT_URL=postgresql://postgres:postgres@localhost:5433/postgres

# Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<generate with: openssl rand -base64 32>
SALT=<generate with: openssl rand -base64 32>
ENCRYPTION_KEY=<generate with: openssl rand -hex 32>

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_AUTH=myredissecret

# S3/MinIO
LANGFUSE_S3_EVENT_UPLOAD_BUCKET=langfuse
LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT=http://localhost:9090
LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID=minio
LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=miniosecret
# (... more S3 settings)
```

### Optional (ClickHouse disabled)

```env
CLICKHOUSE_URL=""
CLICKHOUSE_USER=""
CLICKHOUSE_PASSWORD=""
LANGFUSE_AUTO_CLICKHOUSE_MIGRATION_DISABLED=true
```

## What Works

- ✅ Trace/observation/score ingestion via API
- ✅ Trace listing and detail views
- ✅ Session aggregation
- ✅ Score CRUD operations
- ✅ User management, projects, API keys
- ✅ Prompt management
- ✅ Dataset management
- ✅ Basic filtering and search
- ✅ Data deletion and retention

## Known Limitations

These features have reduced functionality or return empty data:

- ❌ Dashboard time-series charts (cost by time, usage by time)
- ❌ Score analytics (histograms, heatmaps, correlations)
- ❌ Events table features (experiments, advanced analytics)
- ❌ Advanced query builder (generates ClickHouse SQL)
- ❌ Blob storage file log tracking
- ❌ Large-scale exports (>10K records may be slow)

## Performance Expectations

For < 10K traces:
- Trace listing: ~100-500ms (vs ~50ms with ClickHouse)
- Dashboard queries: Return empty or simplified data
- Exports: ~2-5s per 1000 records (vs ~500ms)

## Troubleshooting

### Port Conflicts

If ports are in use, modify `docker-compose.infra-only.yml`:

```yaml
postgres:
  ports:
    - 127.0.0.1:5433:5432  # Use 5433 instead of 5432
```

Update `.env` accordingly:
```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres
```

### Memory Issues in Docker Builds

If Docker builds fail with OOM (exit code 137):
1. Increase Docker memory limit to 8GB+
2. OR use local development setup (infrastructure in Docker, app runs locally)

### Migration Errors

If migrations fail, ensure PostgreSQL is running:

```bash
docker compose -f docker-compose.infra-only.yml ps
```

## Files Modified

Key files changed for PostgreSQL-only mode:

- `packages/shared/prisma/schema.prisma` - Schema updates
- `packages/shared/src/server/repositories/clickhouse.ts` - PostgreSQL adapter
- `packages/shared/src/server/repositories/postgres.ts` - New converter utilities
- `packages/shared/src/server/repositories/traces.ts` - Rewritten for Prisma
- `packages/shared/src/server/repositories/observations.ts` - Rewritten for Prisma
- `packages/shared/src/server/repositories/scores.ts` - Rewritten for Prisma
- `packages/shared/src/server/clickhouse/client.ts` - Stub implementation
- `worker/src/services/ClickhouseWriter/index.ts` - PostgreSQL upserts
- `web/entrypoint.sh` - Removed ClickHouse checks
- `packages/shared/src/env.ts` - Made ClickHouse optional
- `web/src/env.mjs` - Made ClickHouse optional

## Reverting to ClickHouse Mode

To revert back to using ClickHouse:

1. Restore the original repository files from git
2. Set required ClickHouse environment variables
3. Run ClickHouse migrations
4. Restart the application

## Support

For production deployments or large-scale usage (>10K traces), we recommend using the standard ClickHouse-based deployment for optimal performance.
