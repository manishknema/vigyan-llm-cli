# Session State Governance

`vigyan-llm-cli` treats durable agent memory as a product feature. The goal is
that Claude, Codex, Gemini, OpenCode, or any future CLI can reconstruct current
state from repo files and PageIndex instead of depending on chat history.

## Why This Exists

Long AI projects fail when decisions are scattered across conversations. This
repo keeps state in small, typed files:

- active state
- decision registry
- archive
- canonical docs

Agents should read the same durable context regardless of which CLI launched
them.

## Files

### `work-units/session-state.json`

Active resume pointer only.

Use it for:

- active focus
- current blockers
- next actions
- current run/lane pointers
- references to canonical docs
- active decision IDs

Do not put long product plans, raw logs, or historical ledgers here.

### `work-units/session-decisions.json`

Compact decision registry.

Use it for:

- decision ID
- topic/domain
- status
- summary
- canonical doc pointer
- active/inactive marker

Example:

```json
{
  "id": "LLMCLI-AUTONOMY-001",
  "domain": "vigyan-llm-cli",
  "topic": "autonomous-runner",
  "status": "locked",
  "canonical_doc": "docs/PRODUCT_PLAN.md",
  "summary": "Use Paperclip-style primitives: roles, budgets, seed prompts, HITL gates, receipts, and worktrees. Do not build full AgentOS first.",
  "active": true
}
```

### `work-units/session-state-archive.json`

Historical archive.

Use it for:

- completed work
- deferred work
- superseded decisions
- historical context useful for future retrieval

Archive entries should remain searchable by PageIndex. Do not delete history
just to reduce active context.

### Canonical docs

Long-form reasoning belongs in docs:

- `docs/PRODUCT_PLAN.md`
- `docs/OPS.md`
- `docs/REQUIREMENTS.md`
- `docs/AUTONOMOUS_CONTEXT_PROOF_PLAN.md`

State files point to docs; they do not duplicate entire docs.

## PageIndex Contract

Every repo using this discipline should define a PageIndex domain in
`pageindex.conf`. If absent, `pageindex-init` derives the domain from the git
remote.

Suggested public domain:

```text
vigyan-llm-cli
```

Agent startup retrieval:

```text
query_context(
  query='active task session state pending',
  navigation_only=true,
  domain='vigyan-llm-cli'
)

query_context(
  query='<task terms> decision locked rationale',
  navigation_only=true,
  domain='vigyan-llm-cli',
  path_prefix='work-units/'
)
```

Then retrieve only the relevant line ranges. Do not load every state file in
full unless PageIndex is unavailable.

## Domains

`domain` is mandatory in decision/state entries so multiple repos and CLIs can
merge or compare state without guessing ownership.

Recommended values:

| Domain | Meaning |
|---|---|
| `vigyan-llm-cli` | public llm-cli product |
| `vvc` | private Vigyan Virtual Cloud integration |
| `homecloud` | HomeCloud/VigyanBytes product lane |
| `local-ai` | local model, LiteLLM, OpenCode, benchmark lane |

Public repo entries should normally use `vigyan-llm-cli`.

## Compaction

Run compaction when active state grows too large or after a major milestone:

1. Move long reasoning into a canonical doc.
2. Add or update compact decisions in `session-decisions.json`.
3. Keep `session-state.json` to active focus, blockers, next actions, and
   pointers.
4. Move completed/deferred/superseded items to archive.
5. Reindex PageIndex.

## Status Vocabulary

Use:

- `active`
- `pending`
- `blocked`
- `deferred`
- `completed`
- `superseded`
- `locked`

Avoid inventing many one-off statuses unless the schema is updated.

## Cross-CLI Rule

All CLIs should use the same state files:

- Claude reads `CLAUDE.md` then `AGENTS.md`
- Codex reads `AGENTS.md`
- Gemini reads `GEMINI.md` then `AGENTS.md`
- OpenCode or other tools are given `AGENTS.md`

The state files and PageIndex domain make the memory portable across all of
them.
