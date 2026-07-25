# Claude Code

ALL RULES LIVE IN `AGENTS.md`.

Read `AGENTS.md` first. Do not treat this file as a separate policy source.

For durable memory, use:

- `work-units/session-state.json` for active focus
- `work-units/session-decisions.json` for locked decisions
- `work-units/session-state-archive.json` for historical/deferred context
- `work-units/session-state.md` for the human explanation of why these files exist

When PageIndex is available, query domain `vigyan-llm-cli` before planning.
