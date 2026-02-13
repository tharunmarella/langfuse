# Privacy: External Data Transmission

This document explains what data Langfuse sends to external services and how to disable it.

## Current Configuration (.env)

```env
TELEMETRY_ENABLED="true"
```

**PostHog/Sentry Keys:** ❌ Not configured (empty)

## What Data Could Be Sent

### 1. Telemetry (when TELEMETRY_ENABLED="true")

**Destination:** PostHog (https://eu.posthog.com)  
**Frequency:** Every 12 hours  
**When:** Only in production mode, only for self-hosted instances (not in development)

**Data Sent:**
- **Aggregate counts** (no actual trace data):
  - Number of traces created
  - Number of observations created
  - Number of scores created
  - Number of datasets/items/runs
  - Total projects count
- **Email domains** (not full emails): e.g., "gmail.com", "company.com"
- **Langfuse version**
- **Client ID** (randomly generated UUID)
- **Environment**: production/development
- **License info**: If using Enterprise Edition

**Code Location:** `web/src/features/telemetry/index.ts`

**What's NOT sent:**
- ❌ No actual trace data
- ❌ No user emails (only domains)
- ❌ No API keys
- ❌ No trace content (input/output)
- ❌ No observation data
- ❌ No score values
- ❌ No personally identifiable information (PII)

### 2. PostHog Analytics (Optional)

**Status:** ❌ **DISABLED** - No PostHog key configured in your .env

If you configure `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`, PostHog would track:
- Page views
- Button clicks
- Feature usage
- User interactions (frontend only)

### 3. Sentry Error Tracking (Optional)

**Status:** ❌ **DISABLED** - No Sentry DSN configured in your .env

If you configure `NEXT_PUBLIC_SENTRY_DSN`, Sentry would receive:
- JavaScript errors
- Backend errors
- Stack traces
- Performance data

### 4. Next.js Telemetry

**Status:** ✅ Enabled by default (Next.js framework)

**Data Sent:**
- Next.js version
- Project configuration (anonymous)
- Build performance metrics

**Controlled by:** `NEXT_TELEMETRY_DISABLED` environment variable

## Local Development Data Storage

### Your Current Setup

All data is stored **locally only**:

- **PostgreSQL**: localhost:5433 (Docker container)
- **Redis**: localhost:6379 (Docker container)
- **MinIO (S3)**: localhost:9090 (Docker container)

**No external storage or databases are used.**

## How to Completely Disable External Data Transmission

### Option 1: Disable Telemetry Only

Add to `.env`:
```env
TELEMETRY_ENABLED="false"
```

### Option 2: Disable All External Services

Add to `.env`:
```env
# Disable Langfuse telemetry
TELEMETRY_ENABLED="false"

# Disable Next.js telemetry
NEXT_TELEMETRY_DISABLED="1"

# Don't configure these (leave empty/unset):
# NEXT_PUBLIC_POSTHOG_KEY=
# NEXT_PUBLIC_POSTHOG_HOST=
# NEXT_PUBLIC_SENTRY_DSN=
```

### Option 3: Network-Level Blocking

Block outbound connections to:
- `eu.posthog.com` (telemetry)
- `posthog.com` (analytics, if configured)
- `sentry.io` (error tracking, if configured)

## Verifying No Data is Sent

### Check Environment Variables

```bash
grep -E "TELEMETRY|POSTHOG|SENTRY" .env
```

Expected output for fully private mode:
```
TELEMETRY_ENABLED="false"
NEXT_TELEMETRY_DISABLED="1"
```

### Check Outbound Connections

Monitor network connections:
```bash
# macOS
sudo lsof -i -P | grep node

# Linux
sudo netstat -tunp | grep node
```

You should only see:
- Connections to localhost (127.0.0.1)
- Connections to Docker containers (172.x.x.x)

### Check Application Logs

With telemetry disabled, you should NOT see:
- PostHog API calls
- Telemetry job runs
- External service connections

## Data Privacy Summary

### Current State (Your Setup)

| Service | Status | Data Sent | External Host |
|---------|--------|-----------|---------------|
| Langfuse Telemetry | ⚠️ **ENABLED** | Aggregate counts only (no PII) | eu.posthog.com |
| PostHog Analytics | ❌ Disabled | None | - |
| Sentry Error Tracking | ❌ Disabled | None | - |
| Next.js Telemetry | ✅ Enabled | Anonymous framework data | nextjs.org |

### Recommended for Complete Privacy

```env
TELEMETRY_ENABLED="false"
NEXT_TELEMETRY_DISABLED="1"
```

This ensures **zero external data transmission** and all data stays on your infrastructure.

## Code References

- Telemetry implementation: `web/src/features/telemetry/index.ts`
- PostHog client: `web/src/features/posthog-analytics/ServerPosthog.ts`
- Telemetry trigger: Called during app initialization

## Open Source & Transparency

Langfuse is open source. You can audit all code:
- GitHub: https://github.com/langfuse/langfuse
- All telemetry code is visible and auditable
- No hidden data collection
