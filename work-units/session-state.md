# Session State

This file explains the durable memory files in `work-units/`.

The JSON files are the machine-readable state. This markdown file is only the
human guide.

## Why Session State Exists

AI CLI work often spans many long sessions. Chat history is not a reliable
source of truth because it can be lost, compacted, hidden inside one vendor
client, or unavailable to another CLI.

`vigyan-llm-cli` stores durable state in the repo so Claude, Codex, Gemini,
OpenCode, and future agents can all resume from the same facts.

The value is:

- no dependence on one chat transcript
- cross-CLI continuity
- fewer repeated explanations from the operator
- less context burn because agents query only relevant state
- cleaner autonomous runs because seed prompts can be generated from files
- better handoff between humans and agents

## Files

| File | Purpose |
|---|---|
| `work-units/session-state.json` | Current active focus, blockers, next actions, and pointers. |
| `work-units/session-decisions.json` | Compact registry of locked/current decisions. |
| `work-units/session-state-archive.json` | Historical completed, deferred, or superseded context. |
| `work-units/session-state.schema.json` | JSON schema for the state shape. |
| `docs/SESSION_STATE_GOVERNANCE.md` | Full operating contract for state, decisions, archive, compaction, and PageIndex usage. |

## How Agents Should Use It

Before planning or editing, query PageIndex:

```text
query_context(
  query='active task session state pending',
  navigation_only=true,
  domain='vigyan-llm-cli'
)
```

If prior decisions matter:

```text
query_context(
  query='<task terms> decision locked rationale',
  navigation_only=true,
  domain='vigyan-llm-cli',
  path_prefix='work-units/'
)
```

Then retrieve only the relevant line ranges.

If PageIndex is not available, read the files in this order:

1. `work-units/session-state.json`
2. `work-units/session-decisions.json`
3. canonical docs linked from those files
4. `work-units/session-state-archive.json` only when history matters

## How Autonomous Runs Use It

`llm-cli run new "<task>"` should eventually use these files to generate:

- `runs/<run_id>/run-envelope.json`
- `runs/<run_id>/seed-prompts/*.md`
- `runs/<run_id>/trace.jsonl`
- `runs/<run_id>/receipt.md`

The operator supplies short intent. The runner expands that intent using
session state, decisions, canonical docs, and PageIndex retrieval.

## What Not To Put In Active State

Do not put these in `session-state.json`:

- long product plans
- raw logs
- large benchmark dumps
- failed-attempt scratchpads
- completed historical ledgers
- secrets or credentials

Put long reasoning in docs, decisions in `session-decisions.json`, and history
in the archive.
