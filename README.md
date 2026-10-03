# vigyan-llm-cli

`vigyan-llm-cli` is a governed wrapper and installer layer for modern AI CLIs
such as Claude Code, Codex, Gemini CLI, and OpenCode.

It exists to solve four practical problems:

- keep native OAuth and vendor config working
- provide one upgrade authority (`llm-cli upgrade`)
- wire optional local infrastructure such as PageIndex and LiteLLM without
  patching vendor CLIs directly
- keep Linux and Windows installs reproducible for prosumer use

## Install Modes

- `standalone`: default; user-scoped; Windows and Linux single-user
- `cluster`: Linux-only; shared/root-managed install surface

## Core Contract

- front doors remain `claude`, `codex`, `gemini`, `opencode`
- package mutation authority belongs to `llm-cli upgrade`
- status/report authority belongs to `llm-cli report`
- runtime update hints are informational only
- native auth/config homes remain authoritative

## Documents

- [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md) — consolidated product direction, locked decisions, free/paid split, and build order
- [docs/SESSION_STATE_GOVERNANCE.md](docs/SESSION_STATE_GOVERNANCE.md) — cross-CLI durable memory contract using session-state, decisions, archive, and PageIndex
- [docs/INSTALLATION.md](docs/INSTALLATION.md) — simple install flow and justification
- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) — product and path contract
- [docs/OPS.md](docs/OPS.md) — operator behavior, rollout, verification
- [docs/AUTONOMOUS_CONTEXT_PROOF_PLAN.md](docs/AUTONOMOUS_CONTEXT_PROOF_PLAN.md) — first proof loop for context efficiency and minimal autonomy
- [AGENTS.md](AGENTS.md) — model-agnostic agent protocol
- [INSTRUCTIONS.md](INSTRUCTIONS.md) — generic redirect to AGENTS.md
- [skills/](skills/) — optional reusable agent briefs
- [docs/SECRETS.md](docs/SECRETS.md) — secrets, config and features: configure once, every machine follows (`llm-cli setup`, vault, sync)
- [docs/FEATURES.md](docs/FEATURES.md) — the feature catalog, generated from the registry
- [kits/gateway-forward-auth/](kits/gateway-forward-auth/) — protect nginx writes with any OpenID Connect provider (oauth2-proxy, pinned + sha256, all paths configurable)

## Intended Audience

- prosumer local-AI operators
- small teams running mixed cloud + local model workflows
- Linux and Windows users who want one governed CLI surface without replacing
  vendor auth flows

## Current Status

This repo scaffold is being carved out of a larger private VVC governance base.
The public contract should stay minimal and durable:

- `README.md`
- `docs/INSTALLATION.md`
- `docs/REQUIREMENTS.md`
- `docs/OPS.md`
- `AGENTS.md`
- `INSTRUCTIONS.md`
- `skills/`
- `work-units/session-state.md`
- `work-units/session-state.json`
- `work-units/session-decisions.json`
- `work-units/session-state-archive.json`

Everything else should derive from those documents rather than inventing policy
in a fourth place.
