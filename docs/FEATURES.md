# Features

Generated from the feature catalog (`llm-cli features --docs`); edit the catalog, not this file.
Pick features with `llm-cli setup` (interactive) or `llm-cli setup --features a,b --yes` (agents/CI).

## Agents

### Coding agent CLIs (`agents`) — on by default

**What you get:** Claude Code, Codex, OpenCode and Antigravity installed, wrapped and kept up to date.

- CLIs: `claude`, `codex`, `opencode`, `agy`

## Code hosting

### GitHub (`github`) — on by default

**What you get:** agents read/write repos, PRs, issues and CI.

- MCP servers: `github`

**`GITHUB_PERSONAL_ACCESS_TOKEN`** (secret, kept in the vault). Filled automatically from: cmd → ask.
- Where to get it: GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Or run `gh auth login` once and llm-cli reads it.
- Minimum scopes: only the repos agents work on: Contents, Pull requests, Issues (read/write), Actions (read)
- Docs: https://github.com/github/github-mcp-server
- Cost: free
- Verify: claude mcp list shows github ✔ Connected

## Deploy

### Coolify (`deploy-coolify`)

**What you get:** deploys, env vars and logs of self-hosted apps.

- MCP servers: `coolify`

**`COOLIFY_BASE_URL`** (config). Filled automatically from: ask.
- What: Coolify dashboard URL, e.g. https://coolify.example.com
- Verify: curl $COOLIFY_BASE_URL/api/health

**`COOLIFY_ACCESS_TOKEN`** (secret, kept in the vault). Filled automatically from: ask.
- Where to get it: Coolify → Keys & Tokens → API tokens → Create (shown once; Coolify keeps only a hash)
- Minimum scopes: read for status/logs; write to deploy
- Docs: https://coolify.io/docs/api-reference/authorization
- Cost: free (self-hosted)
- Verify: claude mcp list shows coolify ✔ Connected

### Vercel (`deploy-vercel`)

**What you get:** deploys, env and logs on Vercel (OAuth on first use).

- MCP servers: `vercel`

## Database

### Supabase (`database-supabase`)

**What you get:** projects, SQL and logs (OAuth on first use).

- MCP servers: `supabase`

## Cloudflare

### Cloudflare (`cloudflare`)

**What you get:** DNS, cache purge, rules and docs search.

- MCP servers: `cloudflare-api`, `cloudflare-docs`

## Notion

### Notion (`notion`)

**What you get:** agents read and write your Notion workspace (OAuth on first use).

- MCP servers: `notion`

## Site

### Your site's MCP (`site`)

**What you get:** pages, blog, products and settings through the site's own MCP endpoint.

- MCP servers: `site`

**`SITE_URL`** (config). Filled automatically from: ask.
- What: Your site's base URL, e.g. https://www.example.com

**`SITE_MCP_KEY`** (secret, kept in the vault). Filled automatically from: env → ask.
- Where to get it: Your site's MCP_SECRET_KEY (its env vars / secret store)
- Docs: https://github.com/aryannema/vigyan-site-os/blob/main/docs/AGENT_MCP.md
- Cost: free
- Verify: claude mcp list shows site ✔ Connected

**`MCP_CALLER_LABEL`** (config). Filled automatically from: generate.
- What: Caller label sent to your site's MCP (audit log); CLI wrappers override it as <agent>@<node>.

## Social

### Postiz (`social-postiz`)

**What you get:** schedule posts across social accounts.

- MCP servers: `postiz`

**`POSTIZ_BACKEND_URL`** (config). Filled automatically from: ask.
- What: Postiz backend URL, e.g. https://postiz.example.com/api

**`POSTIZ_API_KEY`** (secret, kept in the vault). Filled automatically from: ask.
- Where to get it: Postiz → Settings → Public API → API key
- Docs: https://docs.postiz.com/public-api
- Cost: free (self-hosted) or Postiz cloud plan
- Verify: claude mcp list shows postiz ✔ Connected

## Automation

### n8n (`automation-n8n`)

**What you get:** list and run n8n workflows exposed to MCP.

- MCP servers: `n8n`

**`N8N_URL`** (config). Filled automatically from: ask.
- What: n8n base URL, e.g. https://n8n.example.com

**`N8N_MCP_TOKEN`** (secret, kept in the vault). Filled automatically from: ask.
- Where to get it: n8n → Settings → Instance-level MCP → Enable → Access token
- Docs: https://docs.n8n.io/advanced-ai/accessing-n8n-mcp-server/
- Cost: free (self-hosted)
- Verify: claude mcp list shows n8n ✔ Connected

## Search

### SearXNG (`search-searxng`)

**What you get:** private web search for agents.

- MCP servers: `searxng`

**`SEARXNG_URL`** (config). Filled automatically from: config.
- What: SearXNG base URL with JSON output enabled
- Verify: curl "$SEARXNG_URL/search?q=test&format=json"

## Telemetry

### Local collector → OpenObserve (`telemetry`) — on by default

**What you get:** every CLI's OTel logs, metrics and traces through a local collector.

- Services: `otel-collector`

## Judge/RCA

### Local judge model (`judge`)

**What you get:** online evaluation and alert triage by a small local model.

- Services: `judge-lane`, `alertd`

## Shared memory

### Shared agent memory (`shared-memory`)

**What you get:** every agent's memory digest in one synced folder (Nextcloud, Drive or any synced directory).

- Services: `claude-shared`

## Fleet

### Several machines over SSH (`fleet`)

**What you get:** one controller pushes registry, config and secrets to every node.

- Services: `nodes`, `sync`

