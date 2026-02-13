# Railway.app Setup Guide

This guide shows how to run Langfuse in PostgreSQL-only mode using Railway.app cloud services.

## ✅ Current Configuration

Your Langfuse instance is now connected to Railway services:

### Services Connected

1. **PostgreSQL** (Railway)
   - Host: `caboose.proxy.rlwy.net:44193`
   - Database: `railway`
   - Status: ✅ Connected & Migrations Applied

2. **Redis** (Railway)
   - Host: `interchange.proxy.rlwy.net:43974`
   - Status: ✅ Connected

3. **MongoDB GridFS Storage** (Railway) - Replaces S3/MinIO
   - Host: `metro.proxy.rlwy.net:30936`
   - Database: `langfuse_storage`
   - Status: ✅ Connected

4. **Langfuse Web App**
   - Running: http://localhost:3000
   - Health: ✅ `{"status":"OK","version":"3.153.0"}`

## Configuration (.env)

```env
# PostgreSQL (Railway)
DATABASE_URL="postgresql://postgres:nXTnBHWszltTuaCLEQolxMuZViBopdgK@caboose.proxy.rlwy.net:44193/railway"
DIRECT_URL="postgresql://postgres:nXTnBHWszltTuaCLEQolxMuZViBopdgK@caboose.proxy.rlwy.net:44193/railway"

# Redis (Railway)
REDIS_CONNECTION_STRING="redis://default:yfzvZovYNNBuzmlBTSOhEgZYfixGGFFo@interchange.proxy.rlwy.net:43974"

# MongoDB GridFS Storage (Railway) - Replaces S3/MinIO
LANGFUSE_USE_MONGODB_STORAGE="true"
LANGFUSE_MONGODB_CONNECTION_STRING="mongodb://mongo:PKFTpimrAviafaVbDohJvdYYZncVbpMy@metro.proxy.rlwy.net:30936/langfuse_storage"
```

**No S3 access keys needed!** MongoDB GridFS handles all file storage.

## Starting the Application

### Option 1: Local Development (Current Setup)

```bash
# Infrastructure already on Railway
pnpm run dev:web
```

Access: http://localhost:3000

### Option 2: Deploy to Railway

1. Create a new Railway service
2. Connect your GitHub repository
3. Set environment variables from `.env`
4. Railway will build and deploy automatically

### Option 3: Docker with Railway Backend

Build locally, use Railway for storage:

```bash
# Build Docker images
docker compose -f docker-compose.pg-only.yml build

# Run with Railway backend
docker compose -f docker-compose.pg-only.yml up -d
```

Update the compose file to use Railway URLs instead of local services.

## Verifying Connection

### Check Database Connection

```bash
# From project root
cd packages/shared
pnpm run db:migrate
```

Expected output: `Your database is now in sync with your schema.`

### Check Health Endpoint

```bash
curl http://localhost:3000/api/public/health
```

Expected response: `{"status":"OK","version":"3.153.0"}`

### Check Application Logs

```bash
# Watch dev server logs
tail -f ~/.cursor/projects/*/terminals/*.txt
```

Look for:
- ✅ "Ready in Xs"
- ✅ No PostgreSQL connection errors
- ✅ No Redis connection errors
- ⚠️ S3 errors (until access keys are added)

## Data Storage Locations

| Data Type | Storage Location | Privacy |
|-----------|------------------|---------|
| Traces, Observations, Scores | Railway PostgreSQL | ✅ Private (your Railway account) |
| Queue/Cache | Railway Redis | ✅ Private (your Railway account) |
| Event Files | Railway S3 | ✅ Private (your Railway account) |
| Application | Local (localhost:3000) | ✅ Private (your machine) |

**All data stays within your Railway account** - no third-party data transmission.

## Cost Considerations

Railway pricing:
- PostgreSQL: Based on usage (GB stored + queries)
- Redis: Based on memory usage
- S3: Based on storage + bandwidth
- Free tier available for testing

See: https://railway.app/pricing

## Troubleshooting

### Connection Errors

If you see "connection refused" or timeout errors:
1. Check Railway service status (dashboard)
2. Verify network connectivity
3. Check if IPs are whitelisted (if Railway requires it)

### S3 Errors

If you see S3-related errors:
- Add access keys to `.env` (see above)
- OR disable S3 features
- OR use local MinIO for S3 (start with `docker compose -f docker-compose.infra-only.yml up minio`)

### Performance Issues

Railway's free tier has resource limits. For better performance:
- Upgrade to Railway Pro
- Optimize database queries
- Add indexes for frequently queried columns

## Scaling on Railway

For production use:
1. Scale PostgreSQL: Increase storage and compute
2. Enable Redis persistence
3. Use Railway's CDN for static assets
4. Set up monitoring and alerts
5. Configure backups for PostgreSQL

## Migration from Local to Railway

Already done! Your setup is now:
- ✅ Migrations applied to Railway PostgreSQL
- ✅ Application configured to use Railway services
- ✅ Local Docker infrastructure stopped
- ✅ Running successfully

## Next Steps

1. **Add S3 access keys** (if using event/media storage)
2. **Create first user account** at http://localhost:3000
3. **Test trace ingestion** via SDK or API
4. **(Optional) Deploy to Railway** for production hosting

Your PostgreSQL-only Langfuse is now running on Railway! 🚀
