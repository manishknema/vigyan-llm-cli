# Secrets, config and features: configure once, every machine follows

`llm-cli setup` asks what you want, fills in everything it can find on its own, and asks you once,
with directions, for the rest. After that, a change on one machine (a rotated token, a new URL, a
new feature) reaches every machine and every coding agent CLI on its own.

## Three files are the source of truth

| File | Holds | Where |
|---|---|---|
| registry | MCP servers, skills, the feature catalog, and every variable's **sources** and **guide** | `~/.config/vigyan/registry.json` (point `~/.config/vigyan/llm-cli.json` `registry_master` elsewhere if you keep it in a private repo). Schema: [`schema/registry.schema.json`](../schema/registry.schema.json). Example: [`examples/registry.example.json`](../examples/registry.example.json) |
| vault | secret values (and config values you were asked for), encrypted with SOPS + age, safe to commit to a **private** repo | `<registry dir>/secrets/fleet.sops.env` |
| nodes | your machines (optional) | `~/.config/vigyan/nodes.json`, schema [`schema/nodes.schema.json`](../schema/nodes.schema.json) |

Each has a content hash. `llm-cli sync` compares hashes and only touches machines that are behind.

## How a variable gets its value

Every variable in `registry.env` lists `sources`, tried in order:

| Source | Example | Notes |
|---|---|---|
| `generate` | `llm-cli@{node}` | computed per machine, never stored |
| `config` | `http://localhost:8080` | fixed non-secret value in the registry |
| `cmd` | `gh auth token` | stdout of a command you are already logged in to (optionally on another `host` over ssh) |
| `sops` | `--extract` a key from an existing SOPS file | reuse a vault you already have |
| `file` / `env` | a dotenv file / an environment variable | |
| `random` | 24 random bytes, hex | internal shared secrets, canaries |
| `ask` | hidden prompt, once | shows the variable's **guide**: where to get it (exact menu path), minimum scopes, docs, cost, how to verify. Never prompts without a terminal |

Values only move file → vault → file. They are never printed, logged, passed on a command line,
sent to telemetry, or written anywhere except the vault and `~/.config/vigyan/secret.d/mcp.env`
(mode 600). `llm-cli secrets status` shows names, sources, present/missing and dates, never values.
`llm-cli secrets scan --staged` fails a commit that contains any vault value or a key-shaped string.

## Commands

```
llm-cli setup                                   # pick features, fill values, sync, wire every CLI
llm-cli setup --add n8n | --remove postiz       # change the feature set later
llm-cli setup --features github,telemetry --yes # agents/CI: never prompts; lists what is missing and exits 2
llm-cli features [--docs]                       # on/off/missing per feature; --docs regenerates docs/FEATURES.md
llm-cli secrets status | set NAME | rotate NAME | bootstrap [--refresh]
llm-cli secrets keygen | recipients --collect   # one age key per machine; the vault is encrypted to all of them
llm-cli sync [--check]                          # push changed registry / vault / runtime to every machine
```

## How the CLIs see the values

`llm-cli secrets sync` writes `~/.config/vigyan/secret.d/mcp.env` (600) and makes `~/.bashrc` and
the CLI wrappers source it. `llm-cli wire` writes each CLI's MCP config with variable **names** only
(Claude `${VAR}`, Codex `bearer_token_env_var`/`env_vars`, OpenCode `{env:VAR}`, Antigravity through
a small `sh -c` bridge), so a rotated value needs no config rewrite. Running agent sessions keep the
environment they started with; `llm-cli status` tells you when to restart them.

## Several machines

On the controller, `llm-cli nodes add …` registers a machine, `llm-cli secrets recipients --collect`
adds its age public key (public keys only travel), and `llm-cli sync` delivers the runtime, the
resolved registry and the vault over your existing SSH trust. Each machine decrypts locally with
its own key. A machine that was offline catches up on its next hourly run (it pulls from the
controller). Every sync emits OTLP `config.synced` / `secrets.changed` events with names and hash
prefixes only.

## Sample (fake values, sandbox home)

```
$ llm-cli setup --features github,telemetry,automation-n8n --yes
features: github, telemetry, automation-n8n
variable                      source                      state
GITHUB_PERSONAL_ACCESS_TOKEN  cmd > ask                   MISSING
N8N_URL                       ask                         MISSING
N8N_MCP_TOKEN                 ask                         MISSING
Missing values and where to get them (then: llm-cli secrets set NAME):
  GITHUB_PERSONAL_ACCESS_TOKEN
    where:  GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens …
    scopes: only the repos agents work on: Contents, Pull requests, Issues (read/write), Actions (read)
    verify: claude mcp list shows github ✔ Connected
  …
setup: 3 value(s) still missing (GITHUB_PERSONAL_ACCESS_TOKEN, N8N_URL, N8N_MCP_TOKEN) …
[exit 2]
```
