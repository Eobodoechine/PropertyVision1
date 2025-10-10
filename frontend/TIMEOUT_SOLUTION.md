# Cloud Run Timeout Solution

## Problem
- Cloud Run has a 3-minute HTTP/1.1 connection timeout through Google Frontend
- Backend analyses take 5-10 minutes
- Setting `--timeout 600` only affects the container timeout, not the load balancer

## Solution Options

### Option 1: Async Job Pattern (RECOMMENDED)
1. POST to `/api/analyze` returns immediately with jobId
2. Frontend polls `/api/analyze/status/{jobId}` every 5 seconds
3. When complete, returns full results

### Option 2: Server-Sent Events
Keep connection alive with periodic updates

### Option 3: WebSocket
Real-time bidirectional communication

## Implementation (Option 1 - Simplest)

Create Redis-backed job queue:
- Store job status in Redis
- Return jobId immediately
- Poll for completion
