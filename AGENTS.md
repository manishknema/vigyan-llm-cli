# Agent Protocol

This is the shared instruction file for Claude, Codex, Gemini, OpenCode, and
future agent CLIs working in this repo.

## Simple Rule

For normal users, keep the product simple:

```text
install -> answer prompts -> run llm-cli doctor -> use claude/codex/gemini/opencode
```

Advanced choices such as cluster mode, auditd, reverse SSH, PageIndex, LiteLLM,
and telemetry are optional capabilities. They must not make standalone install
hard to understand.

## Agent Startup

1. Read `docs/REQUIREMENTS.md`.
2. Read `docs/OPS.md`.
3. Query PageIndex for active state before planning:

   ```text
   query_context(query='active task session state pending', navigation_only=true, domain='vigyan-llm-cli')
   ```

4. Query decision state when the task depends on prior choices:

   ```text
   query_context(query='<task terms> decision locked rationale', navigation_only=true, domain='vigyan-llm-cli', path_prefix='work-units/')
   ```

5. For autonomous/context work, read `docs/AUTONOMOUS_CONTEXT_PROOF_PLAN.md`.
6. Use `skills/` only as reusable operating briefs.

## Non-Negotiables

- Preserve native Claude/Codex/Gemini auth homes.
- Do not force native CLIs through LiteLLM by default.
- Use OpenCode and benchmark harnesses for LiteLLM/local/open/free routes.
- Keep standalone installs user-scoped.
- Treat Windows as standalone only.
- Treat cluster mode as Linux-only.
- Do not assume SSH, reverse SSH, Tailscale, GitHub Actions, tmux, zellij, or OS
  schedulers.
- Stop for HITL on secrets, destructive changes, production deploys, auth-path
  changes, upgrade-authority changes, or ambiguous role/worktree scope.
- Keep durable state in `work-units/session-state.json`,
  `work-units/session-decisions.json`, and
  `work-units/session-state-archive.json`; follow
  `docs/SESSION_STATE_GOVERNANCE.md`.

## Autonomous Runs

Autonomous runs start from short operator intent:

```text
I want to do <task>. You decide roles, plan, context, gates, and verification.
```

The runner generates the run envelope, seed prompts, worktree scopes, budget,
HITL gates, trace, and receipt. Roles are templates, not a hidden fixed workflow.
