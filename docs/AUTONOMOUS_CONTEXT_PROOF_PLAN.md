# Autonomous Context Proof Plan

## Purpose

The first build is not a full agent OS. The first build proves that governed
context handling reduces churn while preserving task success.

This document records the external inspirations and the minimum VVC-compatible
implementation path.

## External Patterns To Extract

| Project | Reference | Keep | Do not inherit |
|---|---|---|---|
| Paperclip / OpenClaw | https://github.com/paperclipai/paperclip | role agents, budgets, goals, visible coordination, receipts | OpenClaw dependency, Claude-only runtime, dashboard-first architecture |
| DIY AgentOS | https://github.com/open-agentos/agentos/blob/main/docs/diy-agentos.md | queue/state/trace discipline, role files, append-only receipts | hard GitHub dependency |
| RTK | https://github.com/rtk-ai/rtk | input-side shell/tool-output filtering | hidden harness mutation |
| Headroom | https://github.com/headroomlabs-ai/headroom | compression for tool output, logs, files, and RAG chunks | unmeasured black-box compression |
| Caveman | https://github.com/JuliusBrussee/caveman | output-side terse response mode | global forced terse UX without task/result measurement |
| OmniRoute | https://github.com/diegosouzapw/OmniRoute | multi-CLI launch ergonomics, model catalog UX, routing visibility, explicit provider profiles | TLS/client spoofing, ToS-risky OAuth interception, using stealth routing as product foundation |
| LiteLLM / OpenRouter | https://github.com/BerriAI/litellm | commodity routing substrate | treating routing as the product moat |

## Build Order

### Phase 1 — proof harness

Implement a small, local proof loop:

- one `run_id`
- one task
- shared run envelope
- lanes: `raw`, `pageindex`, `falkordb`, `hybrid`
- input mode: `off` first, then RTK/Headroom-style
- output style: `normal` first, then Caveman-style
- one trace per lane
- one telemetry row per lane

Success requires both:

- lower context/token usage
- task success preserved

Token savings without task success are not a valid product claim.

### Phase 2 — minimal autonomous runner

Build only the minimum needed to repeat Phase 1 without hand-holding:

```text
llm-cli run new "<task>"
llm-cli run start <run_id>
llm-cli run status <run_id>
llm-cli run trace <run_id>
llm-cli run cleanup <run_id>
```

The runner must be OS-agnostic:

- PID file
- stdout/stderr log
- append-only trace
- no mandatory `tmux`
- no mandatory `zellij`
- no mandatory GitHub
- no mandatory OS scheduler

`tmux`, `zellij`, GitHub Actions, `systemd --user`, and Windows Task Scheduler
are adapters only.

### Phase 3 — role split

Add roles only after Phase 1 proof is repeatable:

| Role | Purpose |
|---|---|
| architect | create run envelope, budget, gates |
| planner | decompose task and assign scopes |
| builder | mutate assigned worktree |
| tester | run tests, smoke probes, benchmark lane |
| verifier | decide whether evidence is sufficient |
| reviewer | review diff and trace |
| docs/handoff | update docs and durable state |

Roles are generated from short operator intent plus durable state:

```text
I want to do <task>. You decide the roles, plan, context, gates, and verification.
```

The operator should not retype known session/governance context.

The role table is a starting template, not a hardcoded agent graph. The runner
may collapse or expand roles per task, but any ambiguous role split must produce
an interpretable role-selection prompt and stop for HITL before workers mutate
files.

### Phase 4 — dashboard

Only after file/trace/telemetry truth exists:

- active runs
- roles and budgets
- current HITL gates
- lane comparison
- worktree status
- trace timeline
- token/context savings
- task success

The dashboard reads facts. It is not the source of truth.

## Run Envelope Minimum

```json
{
  "run_id": "20260724-context-proof-001",
  "task": "prove PageIndex/session-state context gain on a bounded llm-cli task",
  "agent": "opencode",
  "model": "vigyan/openrouter-free",
  "backend": "litellm",
  "roles": ["architect", "builder", "tester", "verifier", "docs-handoff"],
  "context": {
    "retrieval_mode": "pageindex",
    "input_filter": "off",
    "output_style": "normal"
  },
  "budget": {
    "max_minutes": 30,
    "max_input_tokens": 200000
  },
  "hitl": {
    "mode": "gated",
    "requires_human_before": [
      "secret_access",
      "production_deploy",
      "destructive_command",
      "dirty_worktree_removal",
      "auth_path_change",
      "upgrade_authority_change"
    ]
  },
  "outputs": {
    "trace_path": "runs/20260724-context-proof-001/trace.jsonl",
    "summary_path": "runs/20260724-context-proof-001/summary.md"
  }
}
```

## Metrics

Record per lane:

- `retrieval_mode`
- `input_filter`
- `output_style`
- raw estimated input tokens
- final input tokens
- cached input tokens
- output tokens
- compression/filter time
- wall time
- model/backend
- task success
- failure reason

## First Build Target

The first useful artifact is not a UI. It is:

```bash
llm-cli run new "Prove PageIndex/session-state context gain on a bounded llm-cli task"
```

That command should generate:

- `runs/<run_id>/envelope.json`
- `runs/<run_id>/seed-prompts/*.md`
- `runs/<run_id>/trace.jsonl`
- optional worktree path

Then `llm-cli run start <run_id>` executes one lane at a time.
