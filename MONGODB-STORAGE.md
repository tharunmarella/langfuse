# MongoDB GridFS Storage Option

This guide explains how to use MongoDB GridFS instead of S3/MinIO for file storage in Langfuse.

## Why MongoDB Instead of S3?

**Benefits:**
- ✅ Single database technology (MongoDB + PostgreSQL instead of PostgreSQL + S3)
- ✅ Simpler infrastructure (no need for MinIO or S3)
- ✅ Built-in for small files (< 16MB per file)
- ✅ Transactional file operations
- ✅ Easy backup (MongoDB backups include files)

**Trade-offs:**
- ❌ Not ideal for large files (>16MB)
- ❌ Slower for high-volume file operations
- ❌ More MongoDB storage needed

## What's Stored in MongoDB GridFS

Langfuse stores these files:
- **Event files:** Ingestion event batches (JSON)
- **Media files:** Uploaded images, attachments
- **Export files:** Batch exports (CSV/JSON)

## Configuration

### Environment Variables

Add to `.env`:

```env
# Enable MongoDB storage
LANGFUSE_USE_MONGODB_STORAGE="true"

# MongoDB connection string
LANGFUSE_MONGODB_CONNECTION_STRING="mongodb://username:password@host:port/database"

# S3 bucket names still required (used as GridFS bucket names)
LANGFUSE_S3_EVENT_UPLOAD_BUCKET="langfuse-events"
LANGFUSE_S3_MEDIA_UPLOAD_BUCKET="langfuse-media"
```

### Local Development with Docker

```bash
# Start PostgreSQL, Redis, MinIO, and MongoDB
docker compose -f docker-compose.infra-only.yml up -d
```

**Services started:**
- PostgreSQL: localhost:5433
- Redis: localhost:6379
- MinIO: localhost:9090 (optional, not used with MongoDB)
- **MongoDB: localhost:27018**

**Connection string for local:**
```env
LANGFUSE_MONGODB_CONNECTION_STRING="mongodb://mongo:mongosecret@localhost:27018/langfuse_storage?authSource=admin"
```

### Railway MongoDB

If you're using Railway:

1. **Add MongoDB service** in Railway dashboard
2. **Get connection string** from MongoDB service variables
3. **Update .env:**

```env
LANGFUSE_USE_MONGODB_STORAGE="true"
LANGFUSE_MONGODB_CONNECTION_STRING="mongodb+srv://user:pass@cluster.mongodb.net/langfuse_storage"
```

### MongoDB Atlas

For managed MongoDB:

1. **Create cluster** at https://www.mongodb.com/cloud/atlas
2. **Create database:** `langfuse_storage`
3. **Get connection string**
4. **Update .env:**

```env
LANGFUSE_MONGODB_CONNECTION_STRING="mongodb+srv://username:password@cluster.mongodb.net/langfuse_storage?retryWrites=true&w=majority"
```

## How It Works

### GridFS Collections

MongoDB GridFS creates two collections per bucket:

**For events bucket:**
- `langfuse-events.files` - File metadata
- `langfuse-events.chunks` - File chunks (256KB each)

**For media bucket:**
- `langfuse-media.files` - File metadata
- `langfuse-media.chunks` - File chunks

### File Operations

**Upload:**
```typescript
// Langfuse internally does:
await storageService.uploadJson(path, eventData);
// → Stored in MongoDB GridFS
```

**Download:**
```typescript
// Langfuse internally does:
const content = await storageService.download(path);
// → Retrieved from MongoDB GridFS
```

**Delete:**
```typescript
await storageService.deleteFiles([path1, path2]);
// → Deleted from MongoDB GridFS
```

## Architecture Comparison

### Before (S3/MinIO)
```
Langfuse App
├── PostgreSQL (data)
├── Redis (queues)
└── S3/MinIO (files)
```

### After (MongoDB GridFS)
```
Langfuse App
├── PostgreSQL (data)
├── Redis (queues)
└── MongoDB GridFS (files)
```

## Performance Considerations

**Good for:**
- Small-scale deployments (< 10K files)
- Files under 16MB each
- Low-frequency file access
- Development environments

**Not recommended for:**
- High-volume file operations (thousands of files/sec)
- Large files (>16MB becomes inefficient)
- Frequent file access (S3 with CDN is better)

## Monitoring MongoDB Storage

### Check storage usage

```bash
# Connect to MongoDB
docker exec -it langfuse-mongodb-1 mongosh -u mongo -p mongosecret

# In mongosh:
use langfuse_storage

# Check storage stats
db.stats()

# List files in events bucket
db["langfuse-events.files"].find().pretty()

# Check total file count
db["langfuse-events.files"].countDocuments()
db["langfuse-media.files"].countDocuments()
```

### Check file sizes

```bash
# In mongosh:
db["langfuse-events.files"].aggregate([
  { $group: { _id: null, totalSize: { $sum: "$length" } } }
])
```

## Switching Between S3 and MongoDB

### From S3 to MongoDB

1. **Enable MongoDB:**
```env
LANGFUSE_USE_MONGODB_STORAGE="true"
LANGFUSE_MONGODB_CONNECTION_STRING="mongodb://..."
```

2. **Restart application**

New files will be stored in MongoDB. Existing S3 files remain in S3.

### From MongoDB to S3

1. **Disable MongoDB:**
```env
LANGFUSE_USE_MONGODB_STORAGE="false"
```

2. **Configure S3:**
```env
LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT="..."
LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID="..."
LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY="..."
```

3. **Restart application**

## Backup Strategy

### Backup MongoDB

```bash
# Export all GridFS files
docker exec langfuse-mongodb-1 mongodump \
  --uri="mongodb://mongo:mongosecret@localhost:27017/langfuse_storage?authSource=admin" \
  --out=/tmp/backup

# Copy from container
docker cp langfuse-mongodb-1:/tmp/backup ./mongodb-backup
```

### Restore MongoDB

```bash
# Copy to container
docker cp ./mongodb-backup langfuse-mongodb-1:/tmp/backup

# Restore
docker exec langfuse-mongodb-1 mongorestore \
  --uri="mongodb://mongo:mongosecret@localhost:27017/langfuse_storage?authSource=admin" \
  /tmp/backup
```

## Troubleshooting

### Connection Errors

If you see "MongoServerError" or connection refused:

1. **Check MongoDB is running:**
```bash
docker compose -f docker-compose.infra-only.yml ps mongodb
```

2. **Check MongoDB logs:**
```bash
docker compose -f docker-compose.infra-only.yml logs mongodb
```

3. **Test connection:**
```bash
mongosh "mongodb://mongo:mongosecret@localhost:27018/langfuse_storage?authSource=admin"
```

### GridFS Upload Errors

If uploads fail:
- Check MongoDB disk space
- Check file size (keep under 16MB)
- Check connection string authentication

### Performance Issues

If MongoDB is slow:
- Add indexes on GridFS collections
- Consider S3 for high-volume deployments
- Increase MongoDB memory/CPU resources

## Complete Stack

With MongoDB storage, your complete infrastructure is:

```yaml
services:
  postgres:      # Data storage (traces, observations, scores)
  redis:         # Queue/cache
  mongodb:       # File storage (events, media)
  # minio: (no longer needed)
```

**Total: 3 services** instead of 4 (PostgreSQL, Redis, MongoDB vs PostgreSQL, Redis, MinIO, ClickHouse)

## Files Modified

- ✅ `packages/shared/src/server/services/MongoDBStorageService.ts` - New GridFS adapter
- ✅ `packages/shared/src/server/services/StorageService.ts` - Factory updated
- ✅ `packages/shared/src/env.ts` - Added MongoDB env vars
- ✅ `docker-compose.infra-only.yml` - Added MongoDB service
- ✅ `package.json` - Added `mongodb` dependency

Your Langfuse can now use MongoDB for file storage! 🎉
