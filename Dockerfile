# PropertyVision demo: one container runs the website, the analysis worker,
# Redis, and (when TUNNEL_TOKEN is set) the Cloudflare tunnel that serves
# demo.neoventurez.com. Nothing in it depends on Google Cloud.
FROM cloudflare/cloudflared:2026.7.3 AS cloudflared

FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends redis-server ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Cloudflare's tunnel connector, copied from its official image (pinned version).
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
RUN cloudflared --version

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# Demo mode: only the public API routes answer (src/middleware.ts) and the
# per-IP burst limit in the analyze route is on. Set before build so the
# middleware sees it.
ENV PV_LOCAL_DEMO=true PV_DEMO_EXPIRES_AT=none
RUN npm run build && chmod +x /app/start-demo.sh

ENV NODE_ENV=production \
    PORT=8080 \
    REDIS_URL=redis://127.0.0.1:6379 \
    LLM_PROVIDER=claude-api

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1

CMD ["/app/start-demo.sh"]
