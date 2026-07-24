# Requirements — vigyan-llm-cli

## Purpose

`vigyan-llm-cli` provides a governed execution layer for vendor-native AI CLIs
without replacing their real auth or model-routing behavior.

## Product Requirements

The first-run user experience must be simple:

```text
install -> answer prompts -> llm-cli doctor -> use native CLI commands
```

Advanced governance must be explainable by the installer, not required reading
before a basic standalone install.

### 1. Front-door stability

Users should invoke:

- `claude`
- `codex`
- `gemini`
- `opencode`

The project must not require a separate daily-use launcher just to get governed
behavior.

### 2. Native auth preservation

- Claude, Codex, and Gemini must keep their native OAuth/config directories
- wrapper logic must not reroute auth into temp directories
- wrapper logic must not require environment-variable hacks that break browser
  login flows

### 3. Upgrade authority

- package mutation authority belongs to `llm-cli upgrade`
- `llm-cli report` is read-only
- runtime vendor update hints are informational only
- MOTD or shell hints must point to `llm-cli upgrade`, not vendor-native
  self-update flows

### 4. Install modes

The product should expose one installer entrypoint with mode/capability phases,
not separate products. OS-specific scripts may exist as bootstrap adapters, but
they must converge on the same questionnaire, config file, doctor report, and
verification contract.

#### `standalone`

Target:

- Windows
- Linux single-user installs

Requirements:

- no admin required for normal install/upgrade
- user-owned wrapper/bin paths
- user-owned pnpm/npm/conda/uv roots
- CAS/cache roots discovered from environment and package-manager config before
  prompting; no hardcoded Windows drive letters
- auth/config/state under user profile
- no dependency on cluster infrastructure by default
- governed shell/provenance wrapper installed for the user
- reverse SSH is optional and must be detected or configured explicitly

#### `cluster`

Target:

- Linux only

Requirements:

- shared/root-managed install surface allowed
- staging/rollout discipline allowed
- shared infrastructure wiring allowed
- governed shell/provenance wrapper installed for target users
- Linux `auditd`/`execve` provenance must be installed or explicitly reported
  unavailable by the installer/doctor path

Windows is `standalone` only.

### 4a. Installer questionnaire

Interactive install must ask or auto-detect:

- install mode: `standalone` or `cluster`
- platform lane: Linux shell, Windows Git Bash, PowerShell bootstrap, or `cmd`
  launcher only
- package roots for pnpm/npm/conda/uv
- filesystem/storage profile and link strategy
- native CLI auth homes to preserve
- PageIndex, LiteLLM, SearXNG, and telemetry endpoints if enabled
- governed shell policy: install `vigyan-bashlc`/equivalent and `BASH_ENV`
  preexec wiring
- Linux provenance policy: install/probe `auditd` in cluster mode; report
  wrapper-only provenance in standalone mode when auditd is not available
- reverse SSH status: not used, already configured, configure now, or skip
- Windows deployment path: local install, SSH from Linux controller, or manual
  bundle extraction

### 5. Tooling requirements

Installers must collect or auto-detect path roots interactively unless all
required values are supplied by flags/config. Public defaults must be
user-scoped and must not assume a VVC drive layout.

#### JavaScript

- `pnpm` is the preferred JS package-manager surface
- rationale: shared content-addressable store, reduced duplication, reproducible
  global CLI state
- prompts/flags must cover `PNPM_HOME`, `PNPM_STORE_PATH`, and npm-compatible
  prefix/cache choices
- the installer must warn when pnpm store and global install roots are on
  different filesystems and hardlink behavior may degrade to copy mode

#### Python

- `conda` + `uv` is the preferred Python tooling model
- rationale: reproducible heavy base envs plus fast package/venv workflows
- prompts/flags must cover `CONDA_PKGS_DIRS`, `CONDA_ENVS_PATH`,
  `UV_CACHE_DIR`, and `PIP_CACHE_DIR`

#### Filesystem/link strategy

- install mode decides ownership and broad location policy
- storage/filesystem profile decides link strategy
- Linux must support both ext-family/default filesystems and ZFS-backed roots
- Windows must support Git Bash paths over NTFS and optional custom drive roots
- Windows SSH automation must invoke the Git Bash shell binary, not GUI
  launchers, and must fall back to bundle/manual install when remote execution
  is not proven
- installers must probe whether hardlinks, symlinks, and Windows directory
  junctions are available before relying on them
- fallback order must be explicit: hardlink when safe, symlink/junction when
  allowed, copy when links are unavailable or cross-device behavior is unsafe
- `llm-cli doctor` must report selected roots, filesystem/device boundaries, and
  active link strategy

### 6. Optional infrastructure wiring

The project may optionally wire:

- PageIndex for repo/doc retrieval
- LiteLLM for local/open routing
- SearXNG for governed live web research
- user-space telemetry via OpenTelemetry/OpenObserve-compatible sinks

These are integrations, not mandatory prerequisites for core install.

### 6a. Dependency ownership

Derived from VVC's current installers, public `vigyan-llm-cli` should treat
dependencies as capability-owned. Default standalone install stays small; if a
capability is selected, the installer owns its dependency chain.

Core standalone dependencies:

| Dependency | Required for | Installer behavior |
|---|---|---|
| POSIX shell / Git Bash | shell installer and wrappers | require or use PowerShell bootstrap on Windows |
| PowerShell | Windows bootstrap | required only for Windows bootstrap/bundle flow |
| `git` | repo detection, optional dependency clone | require or prompt for manual bundle |
| `curl` or equivalent HTTP client | health/model/search checks | require or use platform-native fallback |
| `python3` | JSON edits, doctor/report helpers, PageIndex clients | require or install/probe |
| Node.js | Claude/Codex/Gemini/OpenCode package runtime | require or install/probe |
| `pnpm` | managed Node CLI installs | install/probe and configure paths |
| `ssh` | remote node or Windows deployment | optional; probe before use |

Optional capability dependencies:

| Capability | Dependencies | Installer must |
|---|---|---|
| PageIndex for current repo | PageIndex bundle/server, Python runtime, repo config | install/locate bundle, initialize current repo, index, wire agent configs |
| external repo/bundle extraction | `git` or archive download/extract tooling | clone/vendor/download or prompt for path; record source/version |
| LiteLLM routing | Python, conda/uv or venv, LiteLLM config, endpoint | install or accept endpoint, verify `/v1/models` |
| OpenCode routed client | Node.js, pnpm, OpenCode package | install when selected, write provider/model config |
| SearXNG live search | local service stack or endpoint | install or accept endpoint, verify JSON search |
| telemetry | OTLP endpoint or local sink | configure endpoint, emit/verify test event or report path |
| OpenObserve-style sink | binary/container/runtime, storage, optional nginx | install only when selected, verify health/ingest |
| nginx/reverse proxy | nginx plus port/firewall policy | install/configure only for selected web/proxy surfaces |
| Linux auditd | auditd package/service/rules | install/enable/verify in cluster mode or report unavailable |
| SSH/reverse SSH | OpenSSH client/server or tunnel config | prove reachability or fall back to manual bundle |
| service management | systemd on Linux cluster; user/process runner in standalone | use only when selected and available |
| firewall | UFW or platform equivalent | reconcile only for selected exposed ports; never expose by default |
| agent instruction files | `AGENTS.md`, redirects, skills/templates | install/update repo-local files and client adapters where supported |

`llm-cli doctor` must report each selected capability as `verified`, `manual`,
or `unavailable`.

### 6b. SSH and HomeCloud app sequencing

SSH is already proven as a CLI/operator capability in VVC-style environments,
but it is still too hard for naive cluster users. Public cluster onboarding must
make SSH state visible and guided before asking users to rely on it.

Build order:

1. Keep the proven CLI SSH path.
2. Add guided cluster questionnaire and `llm-cli doctor` checks.
3. Add reliable key/path/host rotation policy.
4. Keep manual/bundle fallback for Windows.
5. Build Tauri app that calls the proven CLI capability.

The GUI must not be required to make SSH work, but it can make cluster SSH
usable for non-expert operators after the CLI path is stable.

### 7. Autonomous runtime requirements

- context-efficiency proof must precede the full agent-OS layer
- the proof matrix must compare raw retrieval against PageIndex/session-state,
  optional graph/hybrid retrieval, input filtering, and terse output style
- token savings must be recorded with task result, cache behavior, and latency;
  savings without success are not a valid proof
- autonomy must not require GitHub
- autonomy must not require an OS scheduler
- the portable runner must work through PID/log/trace files
- Git worktrees are the file-isolation layer for parallel builders
- role agents must have explicit goals, budgets, seed prompts, traces, HITL policy,
  and cleanup policy
- role definitions must be interpretable; default roles are templates and must
  not become a hidden hardcoded workflow
- seed prompts must be generated from durable state first, then operator prompt
  delta; the operator must not be required to retype known governance/session
  context every run
- operator input should be a short task intent; the system must decide roles,
  context, plan, gates, worktree scopes, and verification from durable state
- when the role split cannot be inferred safely, the runner must emit a
  role-selection prompt and stop for HITL instead of silently guessing
- PageIndex is the default repo-context path
- SearXNG is the governed live web-search path
- HITL gates must be explicit for secrets, deploys, destructive commands, dirty
  worktree removal, auth-path changes, and upgrade-authority changes
- HITL is for ambiguity or hard gates; agents should proceed when the answer can
  be reconstructed from durable state, docs, PageIndex, or bounded runtime probes

### 7a. Agent onboarding requirements

Agents need a small, portable instruction surface:

- `AGENTS.md` is the model-agnostic source of truth
- `CLAUDE.md`, `GEMINI.md`, and `CODEX.md` redirect to `AGENTS.md`
- repo-native `skills/<name>/SKILL.md` files hold reusable operating briefs
- client-native skill folders may mirror/adapt those skills, but must not be the
  only place where governance exists
- minimum skills: context retrieval/PageIndex, governed execution/provenance,
  context benchmark/compression, and docs/handoff
- skills should tell agents how to retrieve context, obey hard gates, emit
  receipts, and avoid raw noisy logs
- role seed prompts are generated per run; skills provide stable discipline, not
  task-specific plans
- every agent run must write or reference a run envelope, trace, and receipt
- if a client has no native skill system, it must still obey `AGENTS.md` and the
  generated seed prompt

### 8. Platform requirements

#### Windows

- Git Bash is the primary governed shell lane
- PowerShell is the bootstrap/orchestration bridge
- `cmd` is a thin launcher only
- no drive letter should be hard-coded as a product requirement

#### Linux

- `cluster` and `standalone` must be explicit install contracts
- Linux must not implicitly mean root-managed

### 9. Public-repo discipline

Public documentation must not assume:

- private hostnames
- private LAN IPs
- VPN/Tailscale dependency
- private secrets layout
- private repo structure

The public repo must stay buildable and comprehensible for a prosumer operator
on a single machine.
