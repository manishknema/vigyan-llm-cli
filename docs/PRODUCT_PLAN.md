# Product Plan — vigyan-llm-cli

This is the consolidated product plan for `vigyan-llm-cli`. It replaces reading
scattered decision logs when deciding what to build next.

## Product Thesis

`vigyan-llm-cli` is a local-first governed execution and telemetry layer for AI
coding CLIs.

It preserves native vendor CLIs while adding:

- one install/report/upgrade surface
- native OAuth preservation
- optional LiteLLM/OpenCode local routing
- PageIndex/session-state context discipline
- telemetry for tokens, cache, latency, model, host, and result
- PWA/dashboard visibility
- an autonomous run layer based on durable state, seed prompts, HITL gates, and
  receipts

The first product is not a generic gateway and not a full AgentOS.

## Target User

Primary:

- indie developers
- prosumer local-AI users
- homelab operators
- small teams using multiple AI CLIs

Not first-launch target:

- enterprise procurement
- Kubernetes GPU platform teams
- MuleSoft/Salesforce gateway buyers

## Differentiation

Routing is commodity. The edge is governance plus measured context efficiency:

- works across Claude Code, Codex, Gemini CLI, and OpenCode
- keeps native auth/config intact
- can run LAN/local without mandatory VPN/Tailscale
- records what happened through telemetry and receipts
- proves raw vs PageIndex/session-state behavior instead of claiming it
- gives a usable dashboard and guided query surface

## Locked Decisions

### Native CLI and install

- Users invoke `claude`, `codex`, `gemini`, and `opencode`.
- `llm-cli upgrade` owns package mutation.
- `llm-cli report` and `llm-cli doctor` are read/report surfaces.
- Vendor update prompts are informational.
- Claude, Codex, and Gemini keep native OAuth/config homes.
- OpenCode is the default managed LiteLLM/local-routing client.
- Standalone install is user-scoped.
- Cluster mode is Linux-only.
- Windows is Git-Bash-first; PowerShell and `cmd` are adapters.
- Public install is questionnaire-driven; no hardcoded drive or `/vigyan`
  layout.

### Tooling

- pnpm is preferred for Node CLIs because content-addressable storage can reduce
  duplication.
- conda plus uv is the Python tooling posture.
- `llm-cli-py` is the managed helper Python env.
- Windows Python must be validated; Microsoft Store shims are rejected.

### Telemetry and query

- Deterministic guided NL query over parquet is free/core.
- Use schema dictionary, templates, DuckDB, saved views, and clarification.
- AI NL-to-query is optional enhancement.
- Local models may be used only as guarded intent parsers.
- SQL must be read-only, allowlisted, bounded, and preflighted.
- SigNoz-style query/filter/dashboard ergonomics are the UX bar.

### PWA and push

- PWA/dashboard is free/core.
- Android/Web Push is optional and doctor-gated.
- Push depends on browser support, service worker, HTTPS/localhost,
  VAPID/server support, permission, and device power policy.
- OIDC is not needed for local single-user push.
- OIDC is needed for shared/team-scoped push.

### Autonomous agent layer

- Keep Paperclip-style primitives: roles, goals, budgets, seed prompts, HITL
  gates, visible coordination, receipts, and worktree isolation.
- Do not depend on Paperclip/OpenClaw, GitHub, dashboard-first orchestration, or
  an OS scheduler.
- `llm-cli` owns the portable PID/log/trace runner and run envelope.
- Git worktrees isolate builders.
- Operator gives short intent; the system generates context, role split, seed
  prompts, scopes, gates, and verification from durable state.

## Not Doing Now

- Full AgentOS.
- Dashboard-first build.
- Mandatory GitHub dependency.
- Mandatory `tmux`, `zellij`, systemd, Windows Task Scheduler, or GitHub Actions.
- TLS/client spoofing or risky OAuth interception.
- Replacing native OAuth.
- Selling routing as the moat.
- Shipping FalkorDB as public product.
- Claiming PageIndex saves context without measured proof.
- Assuming Web Push works everywhere.
- Running arbitrary model-generated SQL.

## Free / Paid Split

Free/core:

- installer/questionnaire
- `llm-cli doctor` / `llm-cli report`
- wrapper governance
- OpenCode LiteLLM/local routing
- PageIndex wiring
- basic telemetry
- local dashboard/PWA
- deterministic guided queries
- raw vs PageIndex comparison
- push health check/test notification

Paid/advanced:

- AI-assisted NL-to-query
- query repair and explanations
- natural-language run recommendations
- push routing/escalation rules
- team/OIDC identity
- retention controls
- multi-agent timelines
- run comparison reports
- tamper-evident provenance packs
- enterprise policy/export surfaces

## Build Order

The first runtime proof happens in VVC because the real llm-cli wrappers,
PageIndex wiring, OpenCode/LiteLLM route, telemetry, Windows/Linux lessons, and
decision history live there. To avoid VVC noise, VVC keeps a focused lane file:

```text
/home/manish/projects/Vigyan-Virtual-Cloud/work-units/session-state-llm-cli.json
```

The public repo is built in parallel from distilled product-safe decisions. It
must not copy private VVC hostnames, paths, secrets layout, or raw logs.

### Phase 0 — stabilize llm-cli

- Linux wrappers verified.
- Windows Git Bash standalone verified.
- `.ps1` and `.cmd` converge on the same contract.
- OAuth paths remain untouched.
- OpenCode routing is verified.
- PageIndex/MCP wiring is verified.
- telemetry has host/model/run fields.

### Phase 1 — prove context efficiency

- one real task
- raw lane
- PageIndex/session-state lane
- token/cache/latency/result telemetry
- success required before claiming savings

Do not benchmark FalkorDB as a token-saving lane. FalkorDB is for structural
correctness/blast-radius questions.

The proof must keep fields for later local-AI expansion:

- OpenCode as the managed LiteLLM/local/free-route client
- backend label: cloud, LiteLLM, OpenRouter, llama.cpp, or vLLM
- model label
- retrieval mode
- input filter mode: `off`, then RTK/Headroom-style filtering
- output style: `normal`, then Caveman-style terse mode
- harness failure markers such as edit leaks or malformed tool calls

The public repo should not copy private VVC runtime logs. It should preserve the
schema and proof contract so VVC results can be compared safely.

### Phase 2 — minimal autonomous runner

Implement:

```text
llm-cli run new "<task>"
llm-cli run start <run_id>
llm-cli run status <run_id>
llm-cli run trace <run_id>
llm-cli run cleanup <run_id>
```

Generate:

```text
runs/<run_id>/run-envelope.json
runs/<run_id>/seed-prompts/architect.md
runs/<run_id>/seed-prompts/builder.md
runs/<run_id>/seed-prompts/verifier.md
runs/<run_id>/trace.jsonl
runs/<run_id>/receipt.md
```

Build this over the existing `autonomous-agent-session.sh` idea. Do not create a
large new platform first.

### Phase 3 — role loop

Default role templates:

- architect
- planner
- builder
- tester
- verifier
- reviewer
- docs/handoff

Roles may collapse or expand per task. Ambiguous role split stops for HITL.

### Phase 4 — dashboard/PWA

The dashboard reads facts:

- install/doctor status
- active runs
- CLI/model/lane/token/cache/result table
- raw vs PageIndex comparison
- deterministic guided query
- optional push health/test notification

Visual direction: instrument cluster plus SigNoz-style query ergonomics.

### Phase 5 — advanced local AI and policy

Add later:

- CPU-friendly text-to-query benchmark
- RTK/Headroom-style input filtering
- Caveman-style output mode
- OpenCode local/free-route benchmark expansion
- llama.cpp versus vLLM backend comparison
- weak/local-model harness repair
- on-box guardrails
- named policies
- tamper-evident provenance
- team/OIDC

## Local Text-to-Query Candidates

Benchmark candidates:

| Candidate | Role |
|---|---|
| `prem-research/prem-1B-SQL` | CPU-first baseline |
| `mradermacher/prem-1B-SQL-GGUF` | llama.cpp-friendly 1B lane |
| `motherduckdb/DuckDB-NSQL-7B-v0.1-GGUF` | DuckDB/parquet fit |
| `QuantFactory/DuckDB-NSQL-7B-v0.1-GGUF` | quantized DuckDB-NSQL lane |
| `QuantFactory/sqlcoder-7b-2-GGUF` | SQLCoder analytics lane |
| `MaziyarPanahi/sqlcoder-7b-2-GGUF` | alternate SQLCoder GGUF lane |
| `support-pvelocity/Llama-2-7B-instruct-text2sql-GGUF` | llama.cpp text-to-SQL baseline |
| `defog/sqlcoder` | heavier reference |
| `cssupport/t5-small-awesome-text-to-sql` | tiny CPU baseline |

Every model output must pass deterministic validation before execution.

## First Build Target

Build the missing bridge:

```text
Implement the minimal `llm-cli run` layer over autonomous session launchers.
It must generate a run envelope, role seed prompts, trace, receipt, and optional
builder worktree from PageIndex/session-state context.
```

This is the piece that lets Claude Code or Codex start from durable decisions
without the operator typing every step manually.
