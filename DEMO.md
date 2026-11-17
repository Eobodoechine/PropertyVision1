# PropertyVision demo (demo.neoventurez.com)

PropertyVision estimates the after-repair value (ARV) of a house for fix-and-flip
investing. It finds recently sold comparable homes nearby, filters out the
outliers, and calculates the ARV from the best comps.

## How the demo runs

One container runs everything:

| Piece | What it does |
|---|---|
| Next.js website | The page, plus `/api/analyze` to start a run and `/api/analyze/status/:id` to poll it |
| Worker (`src/server/worker.ts`) | Runs the comp search and ARV pipeline |
| Redis (inside the container) | Job queue, progress, cache, daily usage counters |
| `cloudflared` | Connects the `propertyvision-demo` Cloudflare tunnel, which serves demo.neoventurez.com |

AI calls go to the Claude API (`src/server/claude-api.js`): Claude Sonnet 5.5 with
web search finds the sales, and Claude Haiku 5.5 turns text into JSON.
Addresses are geocoded with the free US Census geocoder. Nothing uses Google Cloud.

The page shows saved **example reports** (static files in `public/examples/`), so
they load instantly and cost nothing. A **live analysis** costs roughly $1 in
API usage and usually takes 5–15 minutes. It is capped at 3 runs per visitor per day and
25 runs per day in total.

## Settings

| Variable | Needed | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | for live runs | Claude API key. Set a monthly spend limit on it in the Claude Console. |
| `TUNNEL_TOKEN` | to serve demo.neoventurez.com | Token for the `propertyvision-demo` tunnel. Get it with `cloudflared tunnel token propertyvision-demo`. |
| `LIVE_ANALYSIS` | no | `off` shows only the example reports |
| `DEMO_MAX_PER_IP_PER_DAY` / `DEMO_MAX_PER_DAY` | no | Usage caps (defaults 3 and 25) |

## Run it

```bash
docker build -t propertyvision-demo .
docker run -d --restart unless-stopped --name propertyvision-demo \
  -e ANTHROPIC_API_KEY -e TUNNEL_TOKEN propertyvision-demo
```

Any always-on host that can run a Docker container works. It needs no public
port, because the tunnel connects outward to Cloudflare.

## Add an example report

Run an analysis on a running copy of the app, then:

```bash
node scripts/save-example.mjs <jobId> <example-id> http://127.0.0.1:3000
```

## Local development without an API key

`LLM_PROVIDER=claude-cli` sends the AI calls through the Claude Code CLI signed
in on your own machine. Use that only for your own runs, never for a hosted copy
that other people use.
