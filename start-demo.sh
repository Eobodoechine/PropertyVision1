#!/bin/sh
# Starts everything the demo needs inside one container:
#   Redis (job queue + cache), the analysis worker, the Cloudflare tunnel
#   (only when TUNNEL_TOKEN is set), and the Next.js website in the foreground.
# The worker and tunnel restart themselves if they exit.
set -e
PORT="${PORT:-8080}"

redis-server --daemonize yes --bind 127.0.0.1 --port 6379 --save "" --appendonly no
until redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1; do sleep 0.2; done
echo "[start-demo] redis ready"

if [ -z "$ANTHROPIC_API_KEY" ] && [ "${LIVE_ANALYSIS:-on}" != "off" ]; then
  echo "[start-demo] WARNING: ANTHROPIC_API_KEY is not set; live analyses will fail. Example reports still work."
fi

(
  while true; do
    # The worker opens its own health port; keep it off the website's port.
    RUN_WORKER=true PORT=8081 npx tsx src/server/worker.ts || true
    echo "[start-demo] worker exited; restarting in 5s"
    sleep 5
  done
) &

# Tunnel: either a token (TUNNEL_TOKEN, easiest on a cloud host) or a mounted
# credentials file plus tunnel ID (TUNNEL_CRED_FILE + TUNNEL_ID).
if [ -n "$TUNNEL_TOKEN" ] || { [ -n "$TUNNEL_CRED_FILE" ] && [ -n "$TUNNEL_ID" ]; }; then
  (
    while true; do
      if [ -n "$TUNNEL_TOKEN" ]; then
        cloudflared tunnel --no-autoupdate run --url "http://127.0.0.1:${PORT}" || true
      else
        cloudflared tunnel --no-autoupdate run --url "http://127.0.0.1:${PORT}" \
          --credentials-file "$TUNNEL_CRED_FILE" "$TUNNEL_ID" || true
      fi
      echo "[start-demo] tunnel exited; restarting in 5s"
      sleep 5
    done
  ) &
else
  echo "[start-demo] no tunnel settings; serving on port ${PORT} only"
fi

exec npx next start -H 0.0.0.0 -p "$PORT"
