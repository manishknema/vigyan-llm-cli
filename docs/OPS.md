# OPS — vigyan-llm-cli

## Operational Model

There are two operational layers:

1. direct CLI front doors
   - `claude`
   - `codex`
   - `gemini`
   - `opencode`
2. managed install/report/upgrade tool
   - `llm-cli`

`llm-cli` prepares policy and wrappers. The direct CLI commands remain the live
operator front doors.

Naive-user install guidance lives in [INSTALLATION.md](INSTALLATION.md). Keep
the first path simple; expose advanced choices through prompts and `llm-cli
doctor`, not through required manual reading.

## Autonomous Agent Loop

The public runtime should be local-first and OS-agnostic.

Build order matters. The first proof is not a full agent OS. The first proof is
context efficiency:

- PageIndex/session-state retrieval vs raw context
- optional graph/hybrid retrieval
- input filtering: `off`, then RTK/Headroom-style modes
- output style: `normal`, then Caveman-style terse mode
- telemetry for tokens, cache, latency, and task result

The agent loop and dashboard come after this proof has repeatable evidence.

Detailed first-build plan:

- [AUTONOMOUS_CONTEXT_PROOF_PLAN.md](AUTONOMOUS_CONTEXT_PROOF_PLAN.md)

Core contract:

- `llm-cli` owns the portable PID/log/trace runner
- Git worktrees isolate parallel file mutation
- run envelopes define role, budget, model, backend, retrieval mode, compression
  mode, branch, worktree, and trace paths
- seed prompts are generated from durable knowledge, not hand-written every run
- HITL gates define what must stop for human review
- `tmux`, `zellij`, system schedulers, and GitHub Actions are optional adapters

Paperclip-style concepts are useful when kept small:

- role agents
- goals
- budgets
- visible coordination
- receipts

They should not force the product to depend on GitHub, a web dashboard, or an OS
scheduler.

Minimum role set:

| Role | Purpose |
|---|---|
| architect | defines goal, run envelope, role split, budget |
| planner | decomposes the task and assigns scopes |
| builder | edits in an owned worktree |
| tester | runs tests, smoke probes, and benchmarks |
| verifier | judges whether the evidence is sufficient and interpretable |
| reviewer | reviews diff/trace |
| docs/handoff | updates durable state and operator docs |

The table is a role template, not a hidden fixed workflow. For a simple task the
runner may collapse roles; for a risky task it may add a specialist role. When
the split is ambiguous, the runner must write an interpretable role-selection
prompt and stop for HITL before launching workers.

Seed prompt layout:

```text
runs/<run_id>/seed-prompts/architect.md
runs/<run_id>/seed-prompts/planner.md
runs/<run_id>/seed-prompts/builder.md
runs/<run_id>/seed-prompts/tester.md
runs/<run_id>/seed-prompts/verifier.md
runs/<run_id>/seed-prompts/reviewer.md
runs/<run_id>/seed-prompts/docs-handoff.md
```

Seed generation source order:

1. active session-state through PageIndex
2. `work-units/session-state.json`
3. relevant `work-units/session-state-*.json`
4. archive state only when prior decisions/history matter
5. operator prompt delta

The operator prompt should steer the run, not replace durable state.

Expected operator input is short intent:

```text
I want to do <task>. You decide the roles, plan, context, gates, and verification.
```

The system expands that into:

- run envelope
- role-specific seed prompts
- worktree/file scopes
- retrieval/search plan
- budget and HITL policy
- verification criteria

HITL modes:

| Mode | Meaning |
|---|---|
| `auto` | role may act within budget and assigned scope |
| `gated` | role must stop before listed actions |
| `review-only` | role may read/verify/comment only |
| `manual` | role prepares plan/receipt only |

Default hard gates:

- secrets access
- production deploy
- destructive filesystem/git operations
- removing dirty worktrees
- changing auth/OAuth paths
- changing upgrade authority

HITL rule:

- use durable knowledge first
- ask the human only when durable state conflicts, a hard gate is reached, needed
  credentials/external state are missing, ownership is ambiguous, or budget would
  be spent without a clear success criterion

Agent loop:

1. generate/read seed prompt from durable state
2. read run envelope
3. retrieve repo context through PageIndex
4. use SearXNG for live web research only
5. think/plan into trace
6. build in assigned worktree
7. verify
8. append final receipt

## Agent Instruction Surface

Skills are useful, but they are adapters. The public repo should keep the
authoritative contract in portable files:

| File/dir | Purpose |
|---|---|
| `AGENTS.md` | model-agnostic governance and startup protocol |
| `CLAUDE.md` | redirect/adapt Claude Code to `AGENTS.md` |
| `GEMINI.md` | redirect/adapt Gemini CLI to `AGENTS.md` |
| `CODEX.md` | redirect/adapt Codex to `AGENTS.md` |
| `INSTRUCTIONS.md` | generic redirect for tools that look for instruction files |
| `skills/` | repo-native reusable operating briefs |
| client skill dirs | optional mirrors/adapters only |

Minimum skill set:

| Skill | Purpose |
|---|---|
| context retrieval | PageIndex/session-state first, bounded retrieval |
| provenance | wrapper stamps, governed shell, receipts |
| context benchmark | raw vs PageIndex/FalkorDB/hybrid and compression lanes |
| docs/handoff | update state/docs without chat-memory dependence |

Role seed prompts are generated into `runs/<run_id>/seed-prompts/`. Skills
define durable behavior; seed prompts define the current task. If the client has
no native skills system, the run still proceeds from `AGENTS.md`, the run
envelope, and the generated seed prompt.

## Update Workflow

Supported mutation path:

```bash
llm-cli upgrade
```

Supported read-only status path:

```bash
llm-cli report
```

Runtime update prompts from vendor CLIs are not authoritative. They may inform
the operator that a newer version exists, but the governed action remains
`llm-cli upgrade`.

## Product Surface Decisions

### Deterministic NL query

Natural-language telemetry query is part of the product, but the first version
must be deterministic rather than AI-dependent. The supported shape is guided
plain English over known telemetry fields:

- dictionary: host/node/machine -> host field, CLI/agent -> CLI field, tokens
  and cache phrases -> token/cache columns
- grammar/templates for common questions
- date phrase parsing
- DuckDB over parquet
- clarification when a phrase maps to multiple fields

This is the free/core proof path because it can show PageIndex and compression
gain without using AI to interpret the evidence. AI NL-to-query, query repair,
explanations, and recommendations are enhancement layers.

### Local text-to-query candidates

When deterministic parsing cannot resolve a question, the next fallback should
prefer local CPU-friendly models before cloud AI. These models are convenience
parsers, not trusted executors.

Initial candidates to benchmark:

| Candidate | Footprint | Why |
|---|---:|---|
| `prem-research/prem-1B-SQL` | 1B | CPU-first local Text-to-SQL candidate. |
| `mradermacher/prem-1B-SQL-GGUF` | 1B GGUF | llama.cpp-friendly Prem-1B lane. |
| `motherduckdb/DuckDB-NSQL-7B-v0.1-GGUF` | 7B GGUF | DuckDB/parquet-aligned upstream GGUF candidate. |
| `QuantFactory/DuckDB-NSQL-7B-v0.1-GGUF` | 7B GGUF | Quantized DuckDB-NSQL Q4 lane. |
| `QuantFactory/sqlcoder-7b-2-GGUF` | 7B GGUF | Analytics SQLCoder GGUF lane. |
| `MaziyarPanahi/sqlcoder-7b-2-GGUF` | 7B GGUF | Alternate SQLCoder GGUF mirror. |
| `support-pvelocity/Llama-2-7B-instruct-text2sql-GGUF` | 7B GGUF | llama.cpp text-to-SQL baseline. |
| `defog/sqlcoder` | 15B | Stronger reference, not small CPU default. |
| `cssupport/t5-small-awesome-text-to-sql` | small | Very light CPU baseline, outside GGUF-first path. |

These Hugging Face model pages were endpoint-checked from VVC on 2026-07-25 and
returned HTTP 200. If a user sees 404, check exact case-sensitive repo ID,
Hugging Face login/network filtering, and whether the failing URL points to a
missing model file rather than the model repository.

Guardrails:

- deterministic parser runs first
- model output must be structured intent or `SELECT`-only SQL
- schema, tables, columns, operations, and row limits are allowlisted
- DuckDB preflight runs before execution
- invalid output falls back to clarification

SigNoz-style observability UX is the reference bar: guided filters, query
builder behavior, saved views, dashboards, and drilldowns matter as much as NL
translation.

### PWA and Android push

The PWA/dashboard should be part of the free/core surface so users can see value
immediately. Android/Web Push is useful but must be doctor-gated:

- verify service worker support
- verify HTTPS or localhost context
- verify VAPID/server configuration
- request and test notification permission
- report browser/device power-policy limitations when observable

OIDC is not required for a local single-user notification test. It becomes
necessary when push is tied to user identity, teams, or remote/shared servers.

## Install Modes

Path selection is part of the install contract. The installer should run in
interactive mode when required roots are missing, and non-interactive mode only
when flags or a config file provide every required value.

There is one product installer contract:

- one questionnaire
- one persisted config file
- one `llm-cli doctor` report
- one verification checklist

OS-specific files are bootstrap adapters only:

- Linux shell installer
- Windows PowerShell bootstrap
- Windows Git Bash installer lane
- optional `cmd` launcher

They must converge on the same state and report format.

## Capability Dependency Contract

VVC already has separate installers for PageIndex, LiteLLM, SearXNG,
OpenObserve/telemetry, nginx gateway, and llm-cli wrappers. The public repo
should turn that lesson into one capability-driven installer contract:

| VVC source | Public capability lesson |
|---|---|
| `a23-setup-pageindex.sh` | PageIndex setup is a selected capability, not manual side work |
| `a19-install-litellm.sh` | model routing needs env/config/service verification |
| `a19-install-searxng.sh` | live search needs JSON verification |
| `a19-install-openobserve.sh` | telemetry sink setup must verify health/ingest |
| `a19-install-nginx-gateway.sh` and service installer | proxy exposure must be explicit and verified |
| `a19-install-llm-clis-all.sh` | wrappers, native auth preservation, pnpm roots, and agent configs belong in one doctor surface |

No selected capability should end with "now manually install X" unless the user
explicitly chose manual mode. In manual mode, the installer still produces a
checklist and verifies afterward.

SSH/reverse-SSH is the first HomeCloud capability to productize. VVC has proven
the CLI path for an experienced operator; the public cluster task is making it
safe for naive users through guided prompts, `llm-cli doctor`, key/host rotation
policy, and manual bundle fallback. The Tauri app comes after that and calls the
same proven CLI capability.

### Standalone

Use when:

- one user owns the machine
- no admin should be required for normal upgrades
- Windows is the primary target
- Linux is being used as a single-user workstation

Expected path model:

- wrappers in `~/bin` or `~/.local/bin`
- package-manager roots in user-owned paths
- auth/config under the user's home/profile

Default roots:

| Root | Linux default | Windows Git Bash default |
|---|---|---|
| bin | `~/.local/bin` | `~/bin` |
| config | `~/.config/vigyan-llm-cli` | `~/.config/vigyan-llm-cli` |
| state | `~/.local/state/vigyan-llm-cli` | `~/.local/state/vigyan-llm-cli` |
| share | `~/.local/share/vigyan-llm-cli` | `~/.local/share/vigyan-llm-cli` or prompted custom drive root |
| cache | `~/.cache/vigyan-llm-cli` | `~/.cache/vigyan-llm-cli` or prompted custom drive root |

### Cluster

Use when:

- Linux nodes are managed as shared infrastructure
- one rollout updates the node-wide install surface
- system integration and shared paths are acceptable

Expected path model:

- shared wrapper/binary surface
- explicit rollout/staging discipline
- system-level provenance may be enabled

Default roots:

| Root | Linux cluster default |
|---|---|
| bin | `/usr/local/bin` |
| config | `/etc/vigyan-llm-cli` |
| state | `/var/lib/vigyan-llm-cli` or prompted shared root |
| share | `/usr/local/share/vigyan-llm-cli` or prompted shared root |
| cache | `/var/cache/vigyan-llm-cli` or prompted shared root |

VVC may adapt cluster roots to `/vigyan/...`; the public repo must not hardcode
that layout.

### Tooling Path Prompts

Interactive install must ask for or confirm:

| Tooling root | Purpose |
|---|---|
| `PNPM_HOME` | global pnpm executable/state root |
| `PNPM_STORE_PATH` | pnpm content-addressable store |
| `NPM_CONFIG_PREFIX` | npm-compatible global prefix when needed |
| `CONDA_PKGS_DIRS` | conda package cache |
| `CONDA_ENVS_PATH` | conda environment root |
| `VIGYAN_LLM_CLI_CONDA_ENV` | managed helper env name, default `llm-cli-py` |
| `VIGYAN_LLM_CLI_PYTHON_VERSION` | optional Python version override; default is detected from governed Conda base |
| `UV_CACHE_DIR` | uv cache |
| `PIP_CACHE_DIR` | pip cache fallback |

For Windows, prompts should accept Git Bash paths and display the equivalent
Windows path when possible. No public default should assume a specific drive
letter. The installer resolves package-manager CAS/cache roots from explicit
environment variables and tool config first, then prompts if the result is
missing or unsafe. A custom drive/root is an operator choice, not a product
requirement.

Resolution order:

1. Explicit environment: `PNPM_HOME`, `PNPM_STORE_PATH`,
   `NPM_CONFIG_PREFIX`, `NPM_CONFIG_CACHE`, `CONDA_PKGS_DIRS`,
   `CONDA_ENVS_PATH`, `VIGYAN_LLM_CLI_CONDA_ENV`,
   `VIGYAN_LLM_CLI_PYTHON_VERSION`, `UV_CACHE_DIR`, `PIP_CACHE_DIR`.
2. Package-manager config: `pnpm config`, npm config, conda config, uv/pip
   environment.
3. User-scoped defaults under the current user's home/profile.
4. Interactive prompt when the selected root crosses a filesystem/device
   boundary that would defeat content-addressable hardlink savings.

Cluster integrations such as VVC may adapt these roots to their own shared
storage presets, but public installation stays questionnaire-driven. There
should be one installer with OS-specific adapters: it installs or verifies
Git Bash/PowerShell/cmd launchers on Windows, pnpm/node roots, Conda, uv, the
managed `llm-cli-py` Python helper env, and selected capabilities from the same
persisted answers. VVC's `/vigyan` layout is one preset, not the default path
contract.

### Provenance Prerequisites

The installer must own the governed shell prerequisites instead of leaving them
as manual follow-up:

| Capability | Standalone Linux | Cluster Linux | Windows Git Bash |
|---|---|---|---|
| governed shell fallback | install user `vigyan-bashlc` | install shared `vigyan-bashlc` | install user `vigyan-bashlc` |
| preexec stamping | user `BASH_ENV`/wrapper env | shared wrapper plus user env | Git Bash wrapper env |
| kernel exec truth | optional/not assumed | install or verify `auditd` | unavailable |
| doctor status | report wrapper-only or audit-backed | report audit-backed or blocked | report wrapper/user-space only |

`auditd` is Linux-only. On Windows the product must be honest: provenance is
wrapper/user-space telemetry, not kernel `execve` capture.

### Reverse SSH Questionnaire

Reverse SSH is not a default dependency, but Windows deployment from a Linux
controller needs an explicit readiness check. The questionnaire should record:

| Question | Meaning |
|---|---|
| Is this a local Windows install? | Run everything on the Windows machine. |
| Is SSH from controller to Windows already working? | Use existing `ssh <target>` path. |
| Is reverse SSH already configured? | Use the operator-provided reverse tunnel target. |
| Should reverse SSH be configured now? | Generate instructions/config, then stop for confirmation. |
| Should SSH be skipped? | Produce a bundle/manual install path instead. |

If SSH or reverse SSH is not proven, the installer must not pretend remote
Windows deployment is available. It should fall back to bundle generation plus
manual extraction/run instructions.

For noninteractive SSH automation, invoke Git Bash through the shell binary, for
example `C:\Program Files\Git\bin\bash.exe`. Do not use GUI launchers such as
`git-bash.exe` for remote installer execution.

### Filesystem And Link Strategy

Before installing package-manager managed CLIs, `llm-cli doctor` and install
should probe:

- filesystem type or device boundary for selected roots
- hardlink creation
- symlink creation
- Windows directory junction availability
- cross-device pnpm store/global-install behavior

The selected strategy must be visible in `llm-cli doctor`:

| Strategy | Use when |
|---|---|
| hardlink | same filesystem/device and supported by the package manager |
| symlink | supported by OS/user policy and target remains stable |
| junction | Windows directory-link fallback where appropriate |
| copy | link behavior is unavailable, unsafe, or crosses unsupported boundaries |

ZFS is supported as a storage profile, but it must be detected and reported
because snapshot/dataset boundaries can affect hardlink assumptions. The public
repo supports the profile; VVC decides exact dataset roots.

## Verification

Minimum post-install or post-upgrade verification:

```bash
llm-cli report
claude --version
codex --version
gemini --version
opencode --version
```

If optional integrations are enabled, verify them separately:

- PageIndex reachable
- LiteLLM reachable
- telemetry sink reachable

## Prosumer Boundary

The public package should optimize for:

- single-machine install
- optional local-model routing
- no mandatory VPN overlay
- no mandatory cluster infrastructure
- predictable user-owned paths

Cluster behavior should remain available, but it should not distort the
standalone onboarding path.
