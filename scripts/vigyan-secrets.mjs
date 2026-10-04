#!/usr/bin/env node
// vigyan-secrets.mjs -- `llm-cli secrets | setup | features | sync`: MCP secrets and config,
// resolved once, kept in one SOPS+age vault, delivered to every node, picked up by every CLI.
//
// Sources of truth (each has a content hash; `llm-cli sync` moves changes to every node):
//   registry   registry.json (servers, skills, features, `env` declarations with sources)
//   vault      <registry dir>/<fleet.vault> (dotenv, SOPS+age, values encrypted, safe to commit)
//   nodes      ~/.config/vigyan/nodes.json (private machine inventory)
//
//   secrets bootstrap [--refresh] [--only A,B] [--yes]   resolve sources -> vault (controller)
//   secrets set NAME [--stdin]                           hidden prompt (or stdin) -> vault
//   secrets rotate NAME                                  new value from its source or a prompt -> vault -> fleet sync
//   secrets unset NAME                                   remove a value from the vault -> fleet sync
//   secrets sync [--pull] [--no-wire]                    vault + registry -> ~/.config/vigyan/secret.d/mcp.env (600) -> wire
//   secrets status                                       every variable: kind, source, present/missing, set at. Never values
//   secrets keygen [--public]                            this node's age key (~/.config/sops/age/keys.txt), print the PUBLIC key
//   secrets recipients [--collect] [--backup-file PATH]  vault recipients = every node's age public key (collected over ssh)
//                                                        + static recipients (secrets/recipients.static.txt, e.g. the
//                                                        offline recovery key); --backup-file writes them for age -R
//   secrets escrow init [--replace]                      offline recovery key: printed ONCE on the terminal (+ QR), added
//                                                        as a static recipient, vault re-encrypted. Never written to disk
//   secrets escrow verify                                type the recovery key back: proves it decrypts the vault (names only)
//   secrets escrow export-usb MOUNTPOINT                 vault ciphertext + recipients + README to a removable stick
//                                                        (previous copy kept as .prev); refuses a non-removable mount
//   secrets scan [FILE…|--staged]                        fail if any vault value (or key-shaped string) is in the files / staged diff
//   secrets install-sops                                 user-scope sops binary, sha256-verified (Linux ~/.local/bin, Windows ~/bin)
//   features [--docs]                                    on/off/missing per feature; --docs prints docs/FEATURES.md
//   setup [--features a,b] [--add x] [--remove y] [--yes]   pick features -> bootstrap -> sync -> wire
//   sync [--check] [--force] [--quiet]                   controller: push changed registry/vault/runtime to every node
//
// Values move only file -> vault -> file. They are never printed, logged, put in argv, sent to
// telemetry, or written anywhere but the vault and the 600 env file.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, chmodSync, rmSync, readdirSync, realpathSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WIN = process.platform === 'win32';
const HOME = homedir();
const NODE = hostname().split('.')[0].toLowerCase();
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const expand = (p) => p.replace(/^~(?=$|[\\/])/, HOME);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const pad = (s, n) => String(s ?? '').padEnd(n);
const QUIET = flag('quiet');
const say = (...a) => { if (!QUIET) console.log(...a); };

const CFG = join(HOME, '.config', 'vigyan');
const BUNDLE = join(CFG, 'fleet-registry');
const SECRET_ENV = join(CFG, 'secret.d', 'mcp.env');
const STATE = join(CFG, 'secrets.state.json');
const FEATURES = join(CFG, 'features.json');
const NODES = process.env.VIGYAN_NODES_FILE || join(CFG, 'nodes.json');
const AGE_KEY = process.env.SOPS_AGE_KEY_FILE || join(HOME, '.config', 'sops', 'age', 'keys.txt');
// Where this operator's registry master lives (controller only). Nothing site-specific is baked in:
// VIGYAN_MCP_REGISTRY, else ~/.config/vigyan/llm-cli.json {"registry_master": "..."}, else
// ~/.config/vigyan/registry.json. Other nodes use the resolved bundle the controller pushes.
const LOCAL_CONF = (() => { try { return JSON.parse(readFileSync(join(HOME, '.config', 'vigyan', 'llm-cli.json'), 'utf8')); } catch { return {}; } })();
const MASTER = [process.env.VIGYAN_MCP_REGISTRY, LOCAL_CONF.registry_master && LOCAL_CONF.registry_master.replace(/^~(?=$|[\\/])/, HOME), join(HOME, '.config', 'vigyan', 'registry.json')].find((p) => p && existsSync(p));
const RT_RUNTIME = '.local/share/vigyan/llm-cli';
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const writePrivate = (p, text) => { mkdirSync(dirname(p), { recursive: true, mode: 0o700 }); writeFileSync(p, text, { mode: 0o600 }); try { chmodSync(p, 0o600); } catch { /* NTFS */ } };

// ── registry / vault locations ───────────────────────────────────────────────
function loadRegistry() {
  const p = MASTER && existsSync(MASTER) ? MASTER : join(BUNDLE, 'registry.resolved.json');
  const reg = readJson(p);
  if (!reg) die(`no registry (master ${MASTER ?? 'not on this node'}, bundle ${BUNDLE}/registry.resolved.json): run llm-cli wire or llm-cli sync --pull`);
  const fleet = reg.fleet ?? {};
  const isMaster = p === MASTER;
  return {
    reg, path: p, isMaster,
    vault: isMaster ? join(dirname(p), fleet.vault ?? 'secrets/fleet.sops.env') : join(BUNDLE, 'fleet.sops.env'),
    meta: isMaster ? join(dirname(p), fleet.vault_meta ?? 'secrets/fleet.meta.json') : join(BUNDLE, 'fleet.meta.json'),
    recipientsFile: isMaster ? join(dirname(p), 'secrets', 'recipients.txt') : null,
    staticRecipientsFile: isMaster ? join(dirname(p), 'secrets', 'recipients.static.txt') : null,
  };
}
const regHash = (L) => L.reg.hash ?? readJson(join(BUNDLE, 'registry.resolved.json'))?.hash ?? fileHash(L.path);
const fileHash = (p) => (existsSync(p) ? sha(readFileSync(p)).slice(0, 12) : '-');
function die(msg, code = 2) { console.error(`llm-cli secrets: ${msg}`); process.exit(code); }

// ── sops ─────────────────────────────────────────────────────────────────────
function sops(argv, input) {
  const r = spawnSync('sops', argv, { encoding: 'utf8', input, env: { ...process.env, SOPS_AGE_KEY_FILE: AGE_KEY }, maxBuffer: 16 << 20 });
  if (r.error) die(`sops not found (llm-cli secrets install-sops): ${r.error.code}`);
  return r;
}
function parseDotenv(text) {
  const m = new Map();
  for (const l of text.split(/\r?\n/)) {
    const i = l.indexOf('=');
    if (i > 0 && !l.startsWith('#')) m.set(l.slice(0, i).trim(), l.slice(i + 1));
  }
  return m;
}
function decryptVault(vault) {
  if (!existsSync(vault)) return new Map();
  const r = sops(['--decrypt', '--input-type', 'dotenv', '--output-type', 'dotenv', vault]);
  if (r.status !== 0) die(`cannot decrypt ${vault} with ${AGE_KEY} (is this node a recipient? llm-cli secrets recipients --collect on the controller)`);
  return parseDotenv(r.stdout);
}
// recipient files: one `age1… # label` per line (age X25519 keys, or plugin recipients such as
// age1yubikey1… for a future YubiKey via age-plugin-yubikey: sops/age then need the plugin on PATH). recipients.txt = node keys (rewritten by
// `recipients --collect`); recipients.static.txt = keys that are not nodes (the offline recovery
// key), never touched by --collect.
function readRecipientFile(f) {
  const m = new Map();
  if (f && existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n')) { const x = l.match(/^(age1[0-9a-z]+)\s*#?\s*(.*)$/); if (x) m.set(x[1], x[2] || '?'); }
  return m;
}
function recipients(L) {
  const list = [...readRecipientFile(L.recipientsFile).keys()];
  if (!list.length) { const own = agePublic(); if (own) list.push(own); }
  return [...new Set([...list, ...readRecipientFile(L.staticRecipientsFile).keys()])];
}
function writeSopsYaml(L) {
  writeFileSync(join(dirname(L.path), '.sops.yaml'), `# llm-cli fleet vault recipients (public keys only). Source: secrets/recipients.txt + recipients.static.txt\ncreation_rules:\n  - path_regex: secrets/.*\\.sops\\.env$\n    age: >-\n      ${recipients(L).join(',')}\n`);
}
// age -R format for the secrets backup tarballs (a6): comments on their own lines, age rejects trailing ones
function writeBackupRecipients(L, file) {
  const all = new Map([...readRecipientFile(L.recipientsFile), ...readRecipientFile(L.staticRecipientsFile)]);
  writeFileSync(file, `# fleet vault recipients (node keys + static, e.g. the offline recovery key) for backup encryption.\n# PUBLIC keys only. Written by llm-cli secrets recipients --backup-file; age rejects trailing comments.\n${[...all].map(([k, n]) => `# ${n}\n${k}`).join('\n')}\n`);
  console.log(`backup recipients (${all.size}) written to ${file}: commit it and re-install the backup (a6-backup-daily --install) so the tarballs use them`);
}
// After every vault write: copy the ciphertext to a mirror dir (Nextcloud admin/files/Vigyan-Vault on the
// controller). VIGYAN_VAULT_MIRROR_DIR / llm-cli.json vault_mirror_dir; with vault_mirror_owner it is
// copied as root with that owner (Nextcloud data dir), like the Claude-Shared publish. Never fatal.
function mirrorVault(L) {
  const dir = process.env.VIGYAN_VAULT_MIRROR_DIR ?? LOCAL_CONF.vault_mirror_dir;
  if (!dir || !L.isMaster || !existsSync(L.vault)) return;
  const owner = process.env.VIGYAN_VAULT_MIRROR_OWNER ?? LOCAL_CONF.vault_mirror_owner;
  let r;
  if (owner) {   // create the dir as the owner first: rsync --mkpath under sudo would make it root:root
    r = spawnSync('sudo', ['-n', 'install', '-d', '-o', owner, '-g', owner, '-m', '0750', dir], { encoding: 'utf8' });
    if (r.status === 0) r = spawnSync('sudo', ['-n', 'rsync', '-c', `--chown=${owner}:${owner}`, '--chmod=F0640', L.vault, dir.replace(/\/?$/, '/')], { encoding: 'utf8' });
  }
  else { try { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, basename(L.vault)), readFileSync(L.vault)); r = { status: 0 }; } catch (e) { r = { status: 1, stderr: String(e.message) }; } }
  if (r.status === 0) console.error(`vault ciphertext mirrored to ${dir}`);
  else console.error(`WARN: vault mirror to ${dir} failed: ${(r.stderr || '').trim().split('\n')[0] || 'no sudo/rsync'}`);
}
function encryptVault(L, map) {
  let rc = recipients(L);
  if (!rc.length && !existsSync(AGE_KEY)) { keygenQuiet(); rc = recipients(L); }
  if (!rc.length) die('no vault recipients (llm-cli secrets keygen, then recipients --collect)');
  const dir = join(HOME, '.cache', 'vigyan', 'secrets-tmp');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `plain-${process.pid}-${randomBytes(4).toString('hex')}.env`);
  const body = [...map].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  try {
    writePrivate(tmp, body);
    // --filename-override: sops loads the nearest .sops.yaml from the cwd and refuses a temp path that
    // matches none of its creation rules ("no matching creation rules found" when run inside the vault
    // repo, 2026-10-04); match the rules against the vault file being written
    const r = sops(['--encrypt', '--age', rc.join(','), '--filename-override', L.vault, '--input-type', 'dotenv', '--output-type', 'dotenv', tmp]);
    if (r.status !== 0) die(`sops --encrypt failed: ${(r.stderr || '').split('\n')[0]}`);
    mkdirSync(dirname(L.vault), { recursive: true });
    writeFileSync(L.vault, r.stdout);
    mirrorVault(L);
  } finally {
    try { writeFileSync(tmp, Buffer.alloc(body.length)); rmSync(tmp, { force: true }); } catch { /* gone */ }
  }
  mirrorToBundle(L);
}
// The controller keeps a copy of vault + meta next to the registry bundle so nodes can pull them.
function mirrorToBundle(L) {
  if (!L.isMaster) return;
  mkdirSync(BUNDLE, { recursive: true });
  for (const [src, name] of [[L.vault, 'fleet.sops.env'], [L.meta, 'fleet.meta.json']]) if (existsSync(src)) writeFileSync(join(BUNDLE, name), readFileSync(src));
}

// ── age keys (no age-keygen needed: X25519 + bech32, the format age and sops read) ──
const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function bech32Encode(hrp, data) {
  const conv = []; let acc = 0, bits = 0;
  for (const b of data) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; conv.push((acc >> bits) & 31); } }
  if (bits) conv.push((acc << (5 - bits)) & 31);
  const polymod = (v) => { const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]; let c = 1; for (const x of v) { const t = c >> 25; c = ((c & 0x1ffffff) << 5) ^ x; for (let i = 0; i < 5; i++) if ((t >> i) & 1) c ^= G[i]; } return c; };
  const hx = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
  const pm = polymod([...hx, ...conv, 0, 0, 0, 0, 0, 0]) ^ 1;
  const chk = [0, 1, 2, 3, 4, 5].map((i) => (pm >> (5 * (5 - i))) & 31);
  return hrp + '1' + [...conv, ...chk].map((d) => B32[d]).join('');
}
function agePublic() {
  const t = existsSync(AGE_KEY) ? readFileSync(AGE_KEY, 'utf8') : '';
  return t.match(/public key:\s*(age1[0-9a-z]+)/)?.[1] ?? null;
}
function keygenQuiet() { const saved = console.log; console.log = () => {}; try { keygen(); } finally { console.log = saved; } }
function keygen() {
  if (!existsSync(AGE_KEY) || !agePublic()) {
    if (existsSync(AGE_KEY)) die(`${AGE_KEY} exists but has no "# public key:" line; not touching it`);
    const { privateKey, publicKey } = generateKeyPairSync('x25519');
    const d = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url');
    const x = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
    const pub = bech32Encode('age', x);
    writePrivate(AGE_KEY, `# created: ${new Date().toISOString()} by llm-cli secrets keygen on ${NODE}\n# public key: ${pub}\n${bech32Encode('age-secret-key-', d).toUpperCase()}\n`);
    console.error(`created age key ${AGE_KEY} (600). Back it up offline: losing every recipient key loses the vault.`);
  }
  console.log(flag('public') ? agePublic() : `${NODE} ${agePublic()}`);
}

// ── sources ──────────────────────────────────────────────────────────────────
function runSource(src, name) {
  const local = !src.host || src.host === NODE;
  if (src.type === 'generate') return src.template.replace('{node}', NODE).replace('{agent}', 'llm-cli');
  if (src.type === 'config') return src.value ?? null;
  if (src.type === 'random') return randomBytes(src.bytes ?? 24).toString('hex');      // canaries, internal shared secrets
  if (src.type === 'env') return process.env[src.name ?? name] || null;
  if (src.type === 'file') {
    for (const f of [expand(src.path)]) {
      if (!existsSync(f)) continue;
      const v = parseDotenv(readFileSync(f, 'utf8').replace(/^export /gm, '')).get(src.key ?? name);
      if (v) return v.replace(/^['"]|['"]$/g, '');
    }
    return null;
  }
  if (src.type === 'sops') {
    const f = expand(src.file);
    if (!existsSync(f)) return null;
    const r = sops(['--decrypt', '--extract', `["${src.key}"]`, f]);
    return r.status === 0 ? r.stdout.trim() || null : null;
  }
  if (src.type === 'cmd') {
    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    const r = local ? spawnSync(src.argv[0], src.argv.slice(1), { encoding: 'utf8', timeout: 30000 })
      : spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', src.host, src.argv.map(q).join(' ')], { encoding: 'utf8', timeout: 30000 });
    const v = r.status === 0 ? (r.stdout || '').trim().split('\n')[0].trim() : '';
    return v || null;
  }
  return null;   // ask: handled by the caller
}
// a terminal we can prompt on (never true under ssh without -t, CI, timers or agents)
const hasTty = () => spawnSync('bash', ['-c', ': </dev/tty'], { stdio: 'ignore' }).status === 0;
function askHidden(name, guide, visible = false) {
  if (!hasTty()) return null;
  if (guide) printGuide(name, guide, process.stderr);
  // bash reads from the terminal (echo off for secrets); the value travels only through this pipe
  const r = spawnSync('bash', ['-c', `read -r${visible ? '' : 's'} -p "$1: " v </dev/tty; ${visible ? '' : 'echo >&2; '}printf %s "$v"`, 'ask', `value for ${name} (${visible ? 'config' : 'hidden'}, empty = skip)`],
    { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
  return (r.stdout || '').trim() || null;
}
function printGuide(name, g, out = process.stdout) {
  const w = (s) => out.write(s + '\n');
  w(`  ${name}${g.what ? ` — ${g.what}` : ''}`);
  if (g.where) w(`    where:  ${g.where}`);
  if (g.scopes) w(`    scopes: ${g.scopes}`);
  if (g.docs) w(`    docs:   ${g.docs}`);
  if (g.cost) w(`    cost:   ${g.cost}`);
  if (g.verify) w(`    verify: ${g.verify}`);
}

// ── features ─────────────────────────────────────────────────────────────────
function catalog(reg) { return reg.features?.catalog ?? []; }
function enabledFeatures(reg) {
  const f = readJson(FEATURES);
  if (f?.enabled) return f.enabled;
  return reg.features?.fleet_defaults ?? catalog(reg).filter((x) => x.default).map((x) => x.id);
}
function wantedVars(reg, only) {
  const env = reg.env ?? {};
  if (only) return only.filter((n) => env[n]);
  const on = new Set(enabledFeatures(reg));
  const names = new Set(catalog(reg).filter((f) => on.has(f.id)).flatMap((f) => f.env ?? []));
  return [...names].filter((n) => env[n]);
}

// ── bootstrap / set / rotate ─────────────────────────────────────────────────
function emit(event, fields) {
  const p = [join(here, 'vigyan-otlp-log.py'), '/usr/local/vigyan/vigyan-otlp-log.py'].find(existsSync);
  if (!p) return;
  spawnSync(WIN ? 'python' : 'python3', [p, '--service', 'llm-cli-secrets'], { input: JSON.stringify({ event_name: event, node: NODE, ...fields }), timeout: 10000 });
}
function bootstrap({ only, refresh, interactive } = {}) {
  const L = loadRegistry();
  if (!L.isMaster) die('bootstrap runs on the controller (where the registry master lives); other nodes get the vault with llm-cli sync');
  const env = L.reg.env ?? {};
  const vault = decryptVault(L.vault);
  const meta = readJson(L.meta) ?? {};
  const names = wantedVars(L.reg, only);
  const rows = [], changed = [], missing = [];
  for (const n of names) {
    const d = env[n];
    const staticSrc = (d.sources ?? []).find((s) => (s.type === 'config' && s.value) || s.type === 'generate');
    if (staticSrc) { rows.push([n, staticSrc.type === 'generate' ? 'generated per node' : 'config (registry)', 'present']); continue; }
    if (vault.has(n) && !refresh) { rows.push([n, `vault (${meta[n]?.source ?? '?'})`, 'present']); continue; }
    let v = null, used = null;
    for (const s of d.sources ?? []) {
      if (s.type === 'ask') { if (interactive !== false) { v = askHidden(n, d.guide, !d.secret); used = v ? 'asked' : null; } }
      else { try { v = runSource(s, n); } catch { v = null; } used = v ? s.type + (s.host ? `@${s.host}` : '') : null; }
      if (v) break;
    }
    if (v) {
      if (vault.get(n) !== v) { vault.set(n, v); changed.push(n); meta[n] = { source: used, set_at: new Date().toISOString(), by: NODE }; }
      rows.push([n, used, 'present']);
    } else { rows.push([n, (d.sources ?? []).map((s) => s.type).join(' > '), 'MISSING']); missing.push(n); }
    v = null;
  }
  if (changed.length) { encryptVault(L, vault); writeFileSync(L.meta, JSON.stringify(meta, null, 2) + '\n'); mirrorToBundle(L); emit('secrets.changed', { names: changed.join(','), vault_hash: fileHash(L.vault) }); }
  console.log(`${pad('variable', 30)}${pad('source', 28)}state`);
  for (const r of rows) console.log(`${pad(r[0], 30)}${pad(r[1], 28)}${r[2]}`);
  console.log(`vault ${L.vault} (${fileHash(L.vault)}): ${changed.length} changed${changed.length ? ` (${changed.join(', ')})` : ''}, ${missing.length} missing`);
  if (missing.length) {
    console.log('\nMissing values and where to get them (then: llm-cli secrets set NAME):');
    for (const n of missing) printGuide(n, env[n].guide ?? {});
  }
  return { changed, missing };
}
function unsetValue(name) {
  const L = loadRegistry();
  if (!L.isMaster) die('secrets unset runs on the controller');
  const vault = decryptVault(L.vault);
  const meta = readJson(L.meta) ?? {};
  if (!vault.has(name) && !meta[name]) { console.log(`${name}: not in the vault`); return; }
  vault.delete(name); delete meta[name];
  encryptVault(L, vault);
  writeFileSync(L.meta, JSON.stringify(meta, null, 2) + '\n'); mirrorToBundle(L);
  emit('secrets.changed', { names: name, vault_hash: fileHash(L.vault), removed: true });
  console.log(`${name}: removed from the vault (${fileHash(L.vault)})`);
  fleetSync({});
}
function setValue(name, { rotate = false } = {}) {
  const L = loadRegistry();
  if (!L.isMaster) die('secrets set/rotate run on the controller');
  const d = L.reg.env?.[name]; if (!d) die(`${name} is not declared in registry env`);
  if ((d.sources ?? []).some((s) => (s.type === 'config' && s.value) || s.type === 'generate')) die(`${name} has a fixed value in the registry (env.${name}.sources): change it there, then llm-cli sync`);
  let v = null, used = null;
  if (flag('stdin')) { v = readFileSync(0, 'utf8').trim() || null; used = 'stdin'; }
  else if (rotate) {
    for (const s of d.sources ?? []) { if (s.type === 'ask') continue; try { v = runSource(s, name); } catch { v = null; } if (v) { used = s.type; break; } }
    if (!v) { v = askHidden(name, d.guide); used = 'asked'; }
  } else { v = askHidden(name, d.guide, !d.secret); used = 'asked'; }
  if (!v) die(`no value for ${name} (nothing entered${hasTty() ? '' : '; no terminal: use --stdin'})`, 3);
  const vault = decryptVault(L.vault);
  const meta = readJson(L.meta) ?? {};
  const same = vault.get(name) === v;
  vault.set(name, v); v = null;
  if (!same) {
    encryptVault(L, vault);
    meta[name] = { source: used, set_at: new Date().toISOString(), by: NODE, ...(rotate ? { rotated_at: new Date().toISOString() } : {}) };
    writeFileSync(L.meta, JSON.stringify(meta, null, 2) + '\n'); mirrorToBundle(L);
    emit('secrets.changed', { names: name, vault_hash: fileHash(L.vault), rotated: rotate });
  }
  console.log(`${name}: ${same ? 'unchanged' : rotate ? 'rotated' : 'set'} (vault ${fileHash(L.vault)})`);
  if (!same) fleetSync({});
}

// ── node-side sync: vault + registry -> mcp.env -> wire ─────────────────────
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// A vault-managed secret must not also live in ~/.bashrc as a literal fallback
// (${NAME:-literal}); rewrite such fallbacks to fail loudly instead. Returns the names scrubbed.
function scrubLiteralDefaults(secretNames) {
  const rc = join(HOME, '.bashrc');
  if (!existsSync(rc)) return [];
  let txt = readFileSync(rc, 'utf8');
  const hit = [];
  for (const n of secretNames) {
    const re = new RegExp(`\\$\\{${n}:-[^}$]+\\}`, 'g');
    if (re.test(txt)) { txt = txt.replace(re, `\${${n}:?${n} not set: llm-cli secrets sync}`); hit.push(n); }
  }
  if (hit.length) { writePrivate(rc + `.bak-scrub-${Date.now()}`, readFileSync(rc, 'utf8')); writeFileSync(rc, txt); }
  return hit;
}
function ensureBashrc() {
  const rc = join(HOME, '.bashrc');
  const begin = '# >>> vigyan mcp env (llm-cli secrets sync)', end = '# <<< vigyan mcp env';
  const body = `${begin}\n[ -r "$HOME/.config/vigyan/secret.d/mcp.env" ] && . "$HOME/.config/vigyan/secret.d/mcp.env"\n${end}`;
  const cur = existsSync(rc) ? readFileSync(rc, 'utf8') : '';
  if (cur.includes(begin)) return false;
  writeFileSync(rc, `${cur.trimEnd()}\n\n${body}\n`);
  return true;
}
function pullBundle() {
  // ssh targets of the controller: env, else the bundle's fleet.hub_ssh, else nodes.json's controller entry
  const bundled = readJson(join(BUNDLE, 'registry.resolved.json'))?.fleet ?? {};
  const fromNodes = (readJson(NODES)?.nodes ?? []).filter((n) => n.name === bundled.controller).map((n) => n.ssh);
  const hubs = (process.env.VIGYAN_REGISTRY_HUB_SSH?.split(/\s+/) ?? bundled.hub_ssh ?? fromNodes).filter(Boolean);
  if (!hubs.length) return null;
  mkdirSync(BUNDLE, { recursive: true });
  for (const h of hubs) {
    let ok = true;
    for (const f of ['registry.resolved.json', 'fleet.sops.env', 'fleet.meta.json']) {
      const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', h, `cat ~/.config/vigyan/fleet-registry/${f}`], { maxBuffer: 16 << 20 });
      if (r.status !== 0 || !r.stdout?.length) { ok = f !== 'registry.resolved.json' && ok; continue; }
      writeFileSync(join(BUNDLE, f), r.stdout);
    }
    if (ok) return h;
  }
  return null;
}
function nodeSync() {
  if (flag('pull') && !(MASTER && existsSync(MASTER))) { const h = pullBundle(); say(h ? `pulled registry + vault from ${h}` : 'hub unreachable; using the cached bundle'); }
  const L = loadRegistry();
  const env = L.reg.env ?? {};
  const vault = decryptVault(L.vault);
  const lines = [], have = [], lack = [];
  const wanted = new Set(wantedVars(L.reg));
  for (const [n, d] of Object.entries(env)) {
    if (n.startsWith('$')) continue;
    if (d.export === false) continue;   // service secrets: read from the vault by their installer, never put in shells
    let v = null;
    if (!d.secret) for (const s of d.sources ?? []) { if (['config', 'generate'].includes(s.type)) { v = runSource(s, n); if (v) break; } }
    if (!v) v = vault.get(n) ?? null;   // secrets, and config values that had to be asked for
    if (v) { lines.push(`export ${n}=${shq(v)}`); have.push(n); } else if (wanted.has(n)) lack.push(n);
    v = null;
  }
  const body = `# managed by llm-cli secrets sync on ${NODE}; do not edit (llm-cli secrets set / registry env)\n${lines.join('\n')}\n`;
  const prev = existsSync(SECRET_ENV) ? readFileSync(SECRET_ENV, 'utf8') : '';
  const changed = sha(prev.replace(/^#.*\n/, '')) !== sha(body.replace(/^#.*\n/, ''));
  if (changed) writePrivate(SECRET_ENV, body);
  const rcAdded = ensureBashrc();
  const scrubbed = scrubLiteralDefaults(Object.entries(env).filter(([, d]) => d.secret).map(([n]) => n));
  const st = readJson(STATE) ?? {};
  const rHash = regHash(L);
  const next = { node: NODE, registry_hash: rHash, vault_hash: fileHash(L.vault), runtime_hash: runtimeHash(), env_changed_at: changed ? new Date().toISOString() : st.env_changed_at ?? null, synced_at: new Date().toISOString(), present: have, missing: lack };
  writeFileSync(STATE, JSON.stringify(next, null, 2) + '\n');
  let wired = 'skipped';
  const role = (() => { try { return readFileSync(join(CFG, 'node-role'), 'utf8').trim(); } catch { return ''; } })() || (existsSync('/etc/vigyan/node-role') ? readFileSync('/etc/vigyan/node-role', 'utf8').trim() : 'dev');
  const wiredHash = readJson(join(CFG, 'mcp-wire.state.json'))?.registry_hash;
  if (!flag('no-wire') && !process.env.VIGYAN_NO_WIRE && role !== 'server' && (changed || st.registry_hash !== rHash || wiredHash !== rHash || flag('force'))) {
    const a19 = [join(here, 'a19-install-llm-clis-all.sh'), '/usr/local/vigyan/a19-install-llm-clis-all.sh'].find(existsSync);
    const r = a19 ? spawnSync('bash', [a19, 'wire', '--no-otlp'], { encoding: 'utf8', env: { ...process.env, ...Object.fromEntries(lines.map((l) => { const m = l.match(/^export ([A-Z0-9_]+)=/); return [m[1], parseShq(l.slice(m[0].length))]; })) }, timeout: 600000 }) : null;
    wired = r ? (r.status === 0 ? 'rewired' : `wire rc=${r.status}`) : 'wire not found';
  }
  emit('config.synced', { registry_hash: rHash, vault_hash: next.vault_hash, env_changed: changed, wired });
  // refresh the cached login banner so it shows the new registry/drift right away
  const a19s = [join(here, 'a19-install-llm-clis-all.sh'), '/usr/local/vigyan/a19-install-llm-clis-all.sh'].find(existsSync);
  if (a19s && (changed || wired === 'rewired')) spawnSync('bash', [a19s, 'status', '--refresh'], { stdio: 'ignore', timeout: 120000 });
  say(`secrets sync on ${NODE}: ${have.length} variable(s) in ${SECRET_ENV}${changed ? ' (changed)' : ' (unchanged)'}; missing: ${lack.join(', ') || 'none'}; wire: ${wired}${rcAdded ? '; ~/.bashrc now sources it' : ''}${scrubbed.length ? `; removed literal defaults for ${scrubbed.join(', ')} from ~/.bashrc` : ''}`);
  if (changed) say('running claude/codex/opencode/agy sessions keep their old environment: restart them to pick up changed MCP values');
}
function parseShq(s) { return s.startsWith("'") ? s.slice(1, -1).replace(/'\\''/g, "'") : s; }
function runtimeHash() {
  const h = createHash('sha256');
  for (const f of ['a19-install-llm-clis-all.sh', 'vigyan-secrets.mjs', 'vigyan-mcp-wire.mjs', 'vigyan-nodes.mjs']) { const p = join(here, f); if (existsSync(p)) h.update(readFileSync(p)); }
  return h.digest('hex').slice(0, 12);
}

// ── status ───────────────────────────────────────────────────────────────────
function status() {
  const L = loadRegistry();
  const env = L.reg.env ?? {};
  const meta = readJson(L.meta) ?? {};
  const st = readJson(STATE) ?? {};
  let vaultNames = null;
  try { vaultNames = new Set(decryptVault(L.vault).keys()); } catch { vaultNames = null; }
  const want = new Set(wantedVars(L.reg));
  console.log(`node ${NODE} (${L.isMaster ? 'controller' : 'node'}); registry ${regHash(L)}; vault ${fileHash(L.vault)}; last sync ${st.synced_at ?? 'never'}; env file ${existsSync(SECRET_ENV) ? SECRET_ENV : 'not written'}`);
  console.log(`${pad('variable', 30)}${pad('kind', 10)}${pad('source', 26)}${pad('state', 10)}set at`);
  for (const [n, d] of Object.entries(env)) {
    if (n.startsWith('$')) continue;
    const kind = d.secret ? 'secret' : d.sources?.[0]?.type === 'generate' ? 'generated' : 'config';
    const present = d.sources?.some((s) => (s.type === 'config' && s.value) || s.type === 'generate') || (vaultNames ? vaultNames.has(n) : st.present?.includes(n));
    console.log(`${pad(n, 30)}${pad(kind, 10)}${pad(d.secret ? meta[n]?.source ?? (d.sources ?? []).map((s) => s.type).join('>') : d.sources?.[0]?.type, 26)}${pad(present ? 'present' : want.has(n) ? 'MISSING' : 'unused', 10)}${meta[n]?.rotated_at ?? meta[n]?.set_at ?? ''}`);
  }
}

// ── features / setup / docs ──────────────────────────────────────────────────
function featuresCmd() {
  const L = loadRegistry();
  if (flag('docs')) return console.log(featuresDoc(L.reg));
  const on = new Set(enabledFeatures(L.reg));
  const vaultNames = (() => { try { return new Set(decryptVault(L.vault).keys()); } catch { return new Set(); } })();
  const env = L.reg.env ?? {};
  console.log(`features (${existsSync(FEATURES) ? FEATURES : 'defaults: no features.json yet'})`);
  for (const f of catalog(L.reg)) {
    const miss = (f.env ?? []).filter((n) => !env[n]?.sources?.some((s) => (s.type === 'config' && s.value) || s.type === 'generate') && !vaultNames.has(n));
    console.log(`  [${on.has(f.id) ? 'x' : ' '}] ${pad(f.id, 20)} ${pad(f.group, 16)} ${f.gives}${on.has(f.id) && miss.length ? `   MISSING: ${miss.join(', ')}` : ''}`);
  }
}
function featuresDoc(reg) {
  const env = reg.env ?? {};
  let out = '# Features\n\nGenerated from the feature catalog (`llm-cli features --docs`); edit the catalog, not this file.\n' +
    'Pick features with `llm-cli setup` (interactive) or `llm-cli setup --features a,b --yes` (agents/CI).\n';
  for (const g of [...new Set(catalog(reg).map((f) => f.group))]) {
    out += `\n## ${g}\n`;
    for (const f of catalog(reg).filter((x) => x.group === g)) {
      out += `\n### ${f.title} (\`${f.id}\`)${f.default ? ' — on by default' : ''}\n\n**What you get:** ${f.gives}.\n\n`;
      const turns = [['MCP servers', f.servers], ['Skills', f.skills], ['CLIs', f.clis], ['Services', f.services]].filter(([, v]) => v?.length);
      if (turns.length) out += turns.map(([k, v]) => `- ${k}: ${v.map((x) => `\`${x}\``).join(', ')}`).join('\n') + '\n';
      for (const n of f.env ?? []) {
        const d = env[n] ?? {}; const gd = d.guide ?? {};
        out += `\n**\`${n}\`** (${d.secret ? 'secret, kept in the vault' : 'config'}). Filled automatically from: ${(d.sources ?? []).map((s) => s.type).join(' → ') || 'nothing'}.\n`;
        for (const [k, label] of [['what', 'What'], ['where', 'Where to get it'], ['scopes', 'Minimum scopes'], ['docs', 'Docs'], ['cost', 'Cost'], ['verify', 'Verify']]) if (gd[k]) out += `- ${label}: ${gd[k]}\n`;
      }
    }
  }
  return out;
}
function setup() {
  const L = loadRegistry();
  const cat = catalog(L.reg);
  const ids = new Set(cat.map((f) => f.id));
  let on = new Set(enabledFeatures(L.reg));
  const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
  const bad = [...list(opt('features')), ...list(opt('add')), ...list(opt('remove'))].filter((x) => !ids.has(x));
  if (bad.length) die(`unknown feature(s): ${bad.join(', ')} (llm-cli features)`);
  if (opt('features')) on = new Set(list(opt('features')));
  for (const x of list(opt('add'))) on.add(x);
  for (const x of list(opt('remove'))) on.delete(x);
  const interactive = !flag('yes') && hasTty();
  if (interactive && !opt('features') && !opt('add') && !opt('remove')) {
    for (;;) {
      console.log('\nWhat do you want llm-cli to set up? (numbers toggle, Enter accepts)');
      cat.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2)}. [${on.has(f.id) ? 'x' : ' '}] ${pad(f.group, 16)} ${pad(f.title, 30)} ${f.gives}`));
      const r = spawnSync('bash', ['-c', 'read -r -p "> " v </dev/tty; printf %s "$v"'], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
      const picks = (r.stdout || '').split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => n >= 1 && n <= cat.length);
      if (!picks.length) break;
      for (const n of picks) { const id = cat[n - 1].id; on.has(id) ? on.delete(id) : on.add(id); }
    }
  }
  writePrivate(FEATURES, JSON.stringify({ enabled: [...on], updated: new Date().toISOString(), by: NODE }, null, 2) + '\n');
  console.log(`features: ${[...on].join(', ')} (saved to ${FEATURES})`);
  if (!L.isMaster) { console.log('this node is not the controller: secrets come from the controller (llm-cli sync --pull)'); nodeSync(); return; }
  const { missing } = bootstrap({ interactive });
  fleetSync();   // this node + every node in nodes.json (no-op for nodes already current)
  if (missing.length && !interactive) { console.error(`\nsetup: ${missing.length} value(s) still missing (${missing.join(', ')}); see the guide above, then llm-cli secrets set NAME`); process.exitCode = 2; }
}

// ── recipients ───────────────────────────────────────────────────────────────
function recipientsCmd() {
  const L = loadRegistry();
  if (!L.isMaster) die('recipients are managed on the controller');
  const set = readRecipientFile(L.recipientsFile);
  const statics = readRecipientFile(L.staticRecipientsFile);
  for (const k of statics.keys()) set.delete(k);     // a static key never lives in the node list
  const own = agePublic(); if (own) set.set(own, NODE);
  if (flag('collect')) {
    for (const n of (readJson(NODES)?.nodes ?? []).filter((x) => x.ssh !== 'local' && x.enabled !== false)) {
      const r = remoteRun(n, `VIGYAN_REPO=~/${RT_RUNTIME} bash ~/${RT_RUNTIME}/scripts/a19-install-llm-clis-all.sh secrets keygen --public`);
      const k = (r.stdout || '').match(/age1[0-9a-z]{50,}/)?.[0];
      console.log(`  ${pad(n.name, 18)} ${k ? 'public key collected' : `FAILED (${(r.stderr || '').trim().split('\n').pop()?.slice(0, 80) || 'no runtime? llm-cli push --node ' + n.name + ' install'})`}`);
      if (k) set.set(k, n.name);
    }
  }
  mkdirSync(dirname(L.recipientsFile), { recursive: true });
  writeFileSync(L.recipientsFile, `# age PUBLIC keys that can decrypt the fleet vault (one per node). Never put a secret key here.\n${[...set].map(([k, n]) => `${k} # ${n}`).join('\n')}\n`);
  writeSopsYaml(L);
  console.log(`${set.size} node recipient(s) in ${L.recipientsFile}${statics.size ? ` + ${statics.size} static (${[...statics.values()].join(', ')}) kept` : ''}`);
  if (existsSync(L.vault)) { encryptVault(L, decryptVault(L.vault)); console.log(`vault re-encrypted to ${recipients(L).length} recipient(s) (${fileHash(L.vault)})`); }
  if (opt('backup-file')) writeBackupRecipients(L, expand(opt('backup-file')));
}

// ── scan: no value (or key-shaped string) in files / staged diff ─────────────
function scan() {
  const L = (() => { try { return loadRegistry(); } catch { return null; } })();
  let values = [];
  try { values = L ? [...decryptVault(L.vault)].filter(([, v]) => v && v.length >= 8) : []; } catch { values = []; }
  const shapes = [/AGE-SECRET-KEY-1[0-9A-Z]{20,}/, /\bgh[opsu]_[A-Za-z0-9]{30,}/, /\bsk-[A-Za-z0-9_-]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bxox[bp]-[A-Za-z0-9-]{20,}/];
  let text = '';
  const files = args.filter((a) => !a.startsWith('--') && a !== 'scan' && a !== 'secrets');
  if (flag('staged') || !files.length) text = spawnSync('git', ['diff', '--cached', '-U0'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stdout || '';
  for (const f of files) if (existsSync(f)) text += readFileSync(f, 'utf8');
  const added = flag('staged') || !files.length ? text.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n') : text;
  const hits = [];
  for (const [n, v] of values) if (added.includes(v)) hits.push(`value of ${n}`);
  for (const re of shapes) if (re.test(added)) hits.push(`key-shaped string ${re.source.slice(0, 24)}…`);
  values = [];
  if (hits.length) { console.error(`secret scan: FOUND ${hits.length}: ${hits.join('; ')}`); process.exit(1); }
  console.log(`secret scan: clean (${flag('staged') || !files.length ? 'staged diff' : files.length + ' file(s)'})`);
}

// ── sops install (user scope, verified) ──────────────────────────────────────
function installSops() {
  const have = spawnSync('sops', ['--version'], { encoding: 'utf8' });
  if (have.status === 0) return console.log(`sops present: ${have.stdout.split('\n')[0]}`);
  const ver = process.env.VIGYAN_SOPS_VERSION || '3.13.3';
  const asset = WIN ? `sops-v${ver}.amd64.exe` : `sops-v${ver}.linux.amd64`;
  const dest = WIN ? join(HOME, 'bin', 'sops.exe') : join(HOME, '.local', 'bin', 'sops');
  const base = `https://github.com/getsops/sops/releases/download/v${ver}`;
  const dir = join(tmpdir(), `sops-${process.pid}`); mkdirSync(dir, { recursive: true });
  for (const f of [asset, `sops-v${ver}.checksums.txt`]) {
    const r = spawnSync('curl', ['-fsSL', '-o', join(dir, f), `${base}/${f}`], { encoding: 'utf8' });
    if (r.status !== 0) die(`download failed: ${f}`);
  }
  const want = readFileSync(join(dir, `sops-v${ver}.checksums.txt`), 'utf8').split('\n').find((l) => l.endsWith(` ${asset}`))?.split(/\s+/)[0];
  const got = sha(readFileSync(join(dir, asset)));
  if (!want || want !== got) die(`sha256 mismatch for ${asset}; refusing`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(join(dir, asset))); chmodSync(dest, 0o755);
  rmSync(dir, { recursive: true, force: true });
  console.log(`installed ${dest} (sops ${ver}, sha256 verified)`);
}

// ── fleet sync (controller) ──────────────────────────────────────────────────
function remoteRun(n, cmd, input) {
  if (n.ssh === 'local') return spawnSync('bash', ['-c', cmd], { encoding: 'utf8', input, timeout: 900000 });
  const r = n.os === 'windows-git-bash' ? `"${n.bash || 'C:\\Program Files\\Git\\bin\\bash.exe'}" -lc "${cmd}"` : `bash -lc '${cmd}'`;
  return spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', n.ssh, r], { encoding: input ? undefined : 'utf8', input, timeout: 900000, maxBuffer: 16 << 20 });
}
function fleetSync() {
  const L = loadRegistry();
  if (!L.isMaster) { args.push('--pull'); return nodeSync(); }
  // refresh the resolved registry bundle (and mirror vault/meta) before comparing hashes
  const wire = [join(here, 'vigyan-mcp-wire.mjs'), '/usr/local/vigyan/vigyan-mcp-wire.mjs'].find(existsSync);
  if (wire) spawnSync('node', [wire, '--bundle-only'], { stdio: 'ignore' });
  mirrorToBundle(L);
  const bundle = readJson(join(BUNDLE, 'registry.resolved.json'));
  const want = { registry_hash: bundle?.hash ?? '-', vault_hash: fileHash(join(BUNDLE, 'fleet.sops.env')), runtime_hash: runtimeHash() };
  const rows = [];
  // the controller itself first
  if (!flag('check')) { args.push('--quiet'); nodeSync(); rows.push([NODE, 'local', 'synced']); }
  else { const st = readJson(STATE) ?? {}; const behind = Object.entries(want).filter(([k, v]) => st[k] !== v).map(([k]) => k.replace('_hash', '')); rows.push([NODE, behind.length ? `behind: ${behind.join(', ')}` : 'up to date', 'local']); }
  for (const n of (readJson(NODES)?.nodes ?? []).filter((x) => x.ssh !== 'local' && x.enabled !== false)) {
    const cur = remoteRun(n, 'cat ~/.config/vigyan/secrets.state.json 2>/dev/null || echo {}');
    let st = {}; try { st = JSON.parse(cur.stdout || '{}'); } catch { st = {}; }
    if (cur.status !== 0 && !cur.stdout) { rows.push([n.name, 'unreachable', (cur.stderr || '').trim().split('\n').pop()?.slice(0, 60)]); continue; }
    const behind = Object.entries(want).filter(([k, v]) => st[k] !== v).map(([k]) => k.replace('_hash', ''));
    if (!behind.length && !flag('force')) { rows.push([n.name, 'up to date', '-']); continue; }
    if (flag('check')) { rows.push([n.name, `behind: ${behind.join(', ')}`, '-']); continue; }
    if (behind.includes('runtime')) {
      const nodesJs = [join(here, 'vigyan-nodes.mjs')].find(existsSync);
      const p = spawnSync('node', [nodesJs, 'push', '--node', n.name, 'status'], { encoding: 'utf8', timeout: 900000 });
      if (p.status !== 0) { rows.push([n.name, 'runtime push FAILED', (p.stdout || '').trim().split('\n').pop()]); continue; }
    }
    let ok = true;
    remoteRun(n, 'mkdir -p ~/.config/vigyan/fleet-registry');
    for (const f of ['registry.resolved.json', 'fleet.sops.env', 'fleet.meta.json']) {
      const src = join(BUNDLE, f); if (!existsSync(src)) continue;
      const r = remoteRun(n, `cat > ~/.config/vigyan/fleet-registry/${f}`, readFileSync(src));
      if (r.status !== 0) ok = false;
    }
    if (!ok) { rows.push([n.name, 'copy FAILED', '-']); continue; }
    const r = remoteRun(n, `VIGYAN_REPO=~/${RT_RUNTIME} bash ~/${RT_RUNTIME}/scripts/a19-install-llm-clis-all.sh secrets sync`);
    rows.push([n.name, `synced (${behind.join(', ') || 'forced'})`, r.status === 0 ? (String(r.stdout).trim().split('\n').find((l) => l.startsWith('secrets sync')) ?? 'ok').replace(/^secrets sync on \S+: /, '') : `rc=${r.status} ${String(r.stderr || '').trim().split('\n').pop()?.slice(0, 80)}`]);
  }
  emit('config.synced', { scope: 'fleet', registry_hash: want.registry_hash, vault_hash: want.vault_hash, nodes: rows.map((r) => `${r[0]}:${r[1]}`).join(';').slice(0, 400) });
  console.log(`fleet sync from ${NODE}: registry ${want.registry_hash} vault ${want.vault_hash} runtime ${want.runtime_hash}`);
  console.log(`${pad('node', 18)}${pad('result', 34)}detail`);
  for (const r of rows) console.log(`${pad(r[0], 18)}${pad(r[1], 34)}${r[2] ?? ''}`);
}

// ── escrow: offline recovery key (DEC-2026-10-04-02) ─────────────────────────
// If every node key is lost, the vault and the secrets backups are unreadable. The recovery key
// is a 4th, static recipient whose private half exists only on paper / a KeePassXC USB stick.
// init: generated in memory (never a file), shown once on /dev/tty only (not stdout, so a
// redirect or a log cannot capture it), confirmed by typing its tail back, then added.
// verify: typed back into a 0600 file in /dev/shm for sops, which runs with an empty HOME so
// no node key can do the decrypting instead; names only; the file is shredded.
const TTY = '/dev/tty';
function askTty(prompt) {   // hidden read from the terminal; the answer travels only through this pipe
  const r = spawnSync('bash', ['-c', 'read -rs -p "$1: " v </dev/tty; echo >/dev/tty; printf %s "$v"', 'ask', prompt], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
  return (r.stdout || '').trim() || null;
}
const toTty = (t) => writeFileSync(TTY, t);
function ageKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const d = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url');
  const x = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const out = { pub: bech32Encode('age', x), sec: bech32Encode('age-secret-key-', d).toUpperCase() };
  d.fill(0);
  return out;
}
function bech32Decode(str) {
  const s = str.toLowerCase(); const i = s.lastIndexOf('1');
  if (i < 1) return null;
  const all = [...s.slice(i + 1)].map((c) => B32.indexOf(c));
  if (all.length < 7 || all.some((v) => v < 0)) return null;
  const polymod = (v) => { const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]; let c = 1; for (const x of v) { const t = c >> 25; c = ((c & 0x1ffffff) << 5) ^ x; for (let k = 0; k < 5; k++) if ((t >> k) & 1) c ^= G[k]; } return c; };
  const hrp = s.slice(0, i);
  const hx = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31));
  if (polymod([...hx, ...all]) !== 1) return null;   // checksum: catches typos
  const data = all.slice(0, -6);
  const out = []; let acc = 0, bits = 0;
  for (const v of data) { acc = (acc << 5) | v; bits += 5; if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); } }
  return { hrp: s.slice(0, i), bytes: Buffer.from(out) };
}
function agePublicOf(secret) {   // public key of an AGE-SECRET-KEY-1… string, without age-keygen
  const dec = bech32Decode(secret.trim());
  if (!dec || dec.hrp !== 'age-secret-key-' || dec.bytes.length !== 32) return null;
  const pk = createPublicKey(createPrivateKey({ key: { kty: 'OKP', crv: 'X25519', d: dec.bytes.toString('base64url'), x: Buffer.alloc(32).toString('base64url') }, format: 'jwk' }));
  dec.bytes.fill(0);
  return bech32Encode('age', Buffer.from(pk.export({ format: 'jwk' }).x, 'base64url'));
}
function escrowInit() {
  const L = loadRegistry();
  if (!L.isMaster) die('escrow runs on the controller (where the vault is)');
  if (!hasTty()) die('escrow init needs a terminal: the recovery key is shown once, on screen only (no TTY here)');
  if (!existsSync(L.vault)) die(`no vault at ${L.vault}`);
  const statics = readRecipientFile(L.staticRecipientsFile);
  const old = [...statics].filter(([, n]) => /^recovery/.test(n));
  if (old.length && !flag('replace')) die(`a recovery key is already a recipient (${old[0][0].slice(0, 16)}…, ${old[0][1]}); use --replace to swap it (the old paper key then stops working for new vault versions)`);
  decryptVault(L.vault);   // fail now, before anything is shown, if this node cannot re-encrypt
  const { pub, sec } = ageKeypair();
  toTty(`\n  RECOVERY KEY for the fleet vault and the secrets backups. Shown ONCE; never stored on any machine.\n  Write it on paper and put it in KeePassXC on the USB stick (scan the QR). Keep the two apart.\n\n    ${sec}\n\n  public part (safe to share): ${pub}\n\n`);
  const qr = spawnSync('qrencode', ['-t', 'ANSIUTF8', '-m', '2'], { input: sec, encoding: 'utf8' });
  if (qr.status === 0 && qr.stdout) toTty(qr.stdout + '\n'); else toTty('  (qrencode not installed: no QR; apt install qrencode)\n\n');
  const tail = sec.slice(-8);
  const typed = askTty('  type the LAST 8 characters of the key (hidden; proves you wrote it down)');
  if ((typed || '').trim().toUpperCase() !== tail) {
    toTty('\x1b[2J\x1b[3J\x1b[H');
    die('the last 8 characters did not match: nothing was changed. Run escrow init again.', 3);
  }
  toTty('\x1b[2J\x1b[3J\x1b[H');   // clear screen + scrollback (most terminals); also clear it yourself if yours keeps history
  const keep = [...statics].filter(([, n]) => !/^recovery/.test(n));
  writeFileSync(L.staticRecipientsFile, `# static age PUBLIC recipients of the fleet vault (not nodes; kept by recipients --collect).\n# recovery = offline key on paper/USB (llm-cli secrets escrow). Never put a secret key here.\n${[...keep, [pub, `recovery (offline; escrow init ${new Date().toISOString().slice(0, 10)} on ${NODE})`]].map(([k, n]) => `${k} # ${n}`).join('\n')}\n`);
  writeSopsYaml(L);
  encryptVault(L, decryptVault(L.vault));
  emit('secrets.escrow', { action: old.length ? 'replaced' : 'init', recipients: recipients(L).length, vault_hash: fileHash(L.vault) });
  console.log(`recovery key added as a static recipient (${pub.slice(0, 16)}…); vault re-encrypted to ${recipients(L).length} recipients (${fileHash(L.vault)})`);
  console.log('next: 1) llm-cli secrets escrow verify (type it back from paper)');
  console.log('      2) llm-cli secrets recipients --backup-file <VVC checkout>/configs/backup/age-recipients.txt, commit, a6-backup-daily --install (git drill)');
  console.log('      3) llm-cli secrets escrow export-usb <USB mountpoint> (encrypted vault copy for the stick; the key goes into KeePassXC there)');
}
function escrowVerify() {
  const L = loadRegistry();
  if (!L.isMaster && !existsSync(L.vault)) die('no vault on this node');
  if (!hasTty()) die('escrow verify needs a terminal (the key is typed, hidden)');
  if (!existsSync('/dev/shm')) die('/dev/shm is missing: run verify on Linux (the key must stay in RAM)');
  const sec = askTty('recovery key AGE-SECRET-KEY-1… (hidden)');
  if (!sec || !/^AGE-SECRET-KEY-1[0-9A-Z]+$/.test(sec.trim().toUpperCase())) die('that is not an age secret key (AGE-SECRET-KEY-1…)', 3);
  const pub = agePublicOf(sec.trim().toUpperCase());
  if (!pub) die('the key checksum/length is wrong: check for a typo (0/O, 1/L, 8/B)', 3);
  const statics = readRecipientFile(L.staticRecipientsFile);
  const label = statics.get(pub) ?? readRecipientFile(L.recipientsFile).get(pub);
  console.log(label ? `key matches recipient ${pub.slice(0, 16)}… (${label})` : `WARN: ${pub.slice(0, 16)}… is not in the recipient lists`);
  const dir = join('/dev/shm', `vigyan-escrow-${process.pid}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { mode: 0o700 });
  const kf = join(dir, 'keys.txt');
  try {
    writePrivate(kf, sec.trim().toUpperCase() + '\n');
    const env = { PATH: process.env.PATH, HOME: dir, XDG_CONFIG_HOME: dir, SOPS_AGE_KEY_FILE: kf };
    const r = spawnSync('sops', ['--decrypt', '--input-type', 'dotenv', '--output-type', 'dotenv', L.vault], { encoding: 'utf8', env, maxBuffer: 16 << 20 });
    if (r.status !== 0) die(`the recovery key does NOT decrypt ${L.vault}: it is not one of its recipients (llm-cli secrets recipients lists them)`, 1);
    const names = [...parseDotenv(r.stdout).keys()].sort();
    console.log(`OK: the recovery key decrypts the vault (${names.length} variables, values not shown):`);
    for (const n of names) console.log(`  ${n}`);
    emit('secrets.escrow', { action: 'verified', variables: names.length, vault_hash: fileHash(L.vault) });
  } finally {
    spawnSync('shred', ['-u', kf], { stdio: 'ignore' });
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('done: key file shredded. Clear your terminal scrollback.');
}

// export-usb: the offline copy that goes with the paper/KeePassXC key. Ciphertext only, never a
// key. Linux: the mountpoint must be the root of a mounted filesystem on a removable/hotplug/USB disk.
function removableMount(mnt) {
  const f = spawnSync('findmnt', ['-n', '-o', 'SOURCE,TARGET', '--target', mnt], { encoding: 'utf8' });
  const [src, target] = (f.stdout || '').trim().split(/\s+/);
  if (f.status !== 0 || !src) return { ok: false, why: `${mnt} is not on a mounted filesystem` };
  if (target !== realpathSync(mnt)) return { ok: false, why: `${mnt} is not a mountpoint (it is inside ${target})` };
  if (!src.startsWith('/dev/')) return { ok: false, why: `${mnt} is ${src}, not a block device` };
  const parent = (spawnSync('lsblk', ['-no', 'PKNAME', src], { encoding: 'utf8' }).stdout || '').trim().split('\n')[0];
  const disk = parent ? `/dev/${parent}` : src;
  const [rm, hp, tran] = (spawnSync('lsblk', ['-dno', 'RM,HOTPLUG,TRAN', disk], { encoding: 'utf8' }).stdout || '').trim().split(/\s+/);
  const ok = rm === '1' || hp === '1' || tran === 'usb';
  return { ok, why: ok ? `${disk} (removable=${rm} hotplug=${hp} tran=${tran || '-'})` : `${disk} is not removable (removable=${rm ?? '?'} hotplug=${hp ?? '?'} tran=${tran || '-'})` };
}
function exportVaultTo(L, dest) {   // dest = <stick>/vigyan-vault; returns the vault hash written
  mkdirSync(dest, { recursive: true });
  const cur = join(dest, basename(L.vault));
  if (existsSync(cur)) writeFileSync(cur + '.prev', readFileSync(cur));     // keep the previous copy
  writeFileSync(cur, readFileSync(L.vault));
  if (fileHash(cur) !== fileHash(L.vault)) die(`copy to ${cur} does not match the vault`, 1);
  writeBackupRecipientsQuiet(L, join(dest, 'recipients.txt'));
  const bundle = exportBundleTo(join(dest, 'lifeos'));
  const recips = [...new Map([...readRecipientFile(L.recipientsFile), ...readRecipientFile(L.staticRecipientsFile)])].map(([k, n]) => `- ${n}: \`${k}\``).join('\n');
  writeFileSync(join(dest, 'README.md'), `# Vigyan fleet vault — offline copy

Written ${new Date().toISOString()} by \`llm-cli secrets escrow export-usb\` on ${NODE}.
\`${basename(L.vault)}\` is the SOPS+age **encrypted** vault (values are ciphertext; names are readable).
\`${basename(L.vault)}.prev\` is the copy this one replaced. No key is on this stick.

Vault hash: \`${fileHash(L.vault)}\`

## Who can decrypt it (public keys)

${recips}

## Recover with the paper / KeePassXC key (if every machine key is lost)

On any Linux machine with \`sops\` and \`age\`:

    install -m 600 /dev/null /dev/shm/r.txt        # RAM only
    # type the AGE-SECRET-KEY-1… line from paper/KeePassXC into /dev/shm/r.txt (an editor, not the shell history)
    SOPS_AGE_KEY_FILE=/dev/shm/r.txt sops -d --input-type dotenv --output-type dotenv ${basename(L.vault)} | cut -d= -f1   # names
    SOPS_AGE_KEY_FILE=/dev/shm/r.txt sops -d --input-type dotenv --output-type dotenv ${basename(L.vault)} > /dev/shm/vault.env   # values, RAM only
    shred -u /dev/shm/r.txt                         # and /dev/shm/vault.env when done

${bundle ? `The encrypted git bundle of the vault's repo is in \`lifeos/\` (${bundle.name}, ${bundle.at || 'date in its .json'}):

    age -d -i /dev/shm/r.txt lifeos/lifeos-latest.bundle.age > /dev/shm/l.bundle && git clone /dev/shm/l.bundle lifeOS-personal && shred -u /dev/shm/l.bundle

` : ''}Then re-create machine keys (\`llm-cli secrets keygen\`), put the vault back under
\`lifeOS-personal/secrets/\`, run \`llm-cli secrets recipients --collect\` and \`llm-cli sync\`.
A YubiKey recipient (\`age1yubikey1…\`, if added later) needs \`age-plugin-yubikey\` on PATH:
\`age-plugin-yubikey --identity > /dev/shm/yk.txt\` and use that file as SOPS_AGE_KEY_FILE.
`);
  spawnSync('sync', [], { stdio: 'ignore' });
  return fileHash(cur);
}
// The newest encrypted repo bundle (a6 writes <usb_bundle_dir>/<name>.bundle.age + <name>.json daily,
// age-encrypted to the vault recipients) goes on the stick too. Optional; missing = warning, not failure.
function exportBundleTo(dest) {
  const dir = process.env.VIGYAN_USB_BUNDLE_DIR ?? LOCAL_CONF.usb_bundle_dir;
  if (!dir) return null;
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.bundle.age')).sort(); } catch (e) { console.error(`WARN: bundle dir ${dir} not readable (${e.code}); stick has the vault only`); return null; }
  if (!names.length) { console.error(`WARN: no *.bundle.age in ${dir} yet; stick has the vault only`); return null; }
  const name = names[names.length - 1];
  mkdirSync(dest, { recursive: true });
  const cur = join(dest, 'lifeos-latest.bundle.age');
  if (existsSync(cur)) writeFileSync(cur + '.prev', readFileSync(cur));
  writeFileSync(cur, readFileSync(join(dir, name)));
  if (fileHash(cur) !== fileHash(join(dir, name))) die(`bundle copy to ${cur} does not match ${name}`, 1);
  const manifest = join(dir, name.replace(/\.bundle\.age$/, '.json'));
  let at = null;
  if (existsSync(manifest)) {
    const mj = join(dest, 'lifeos-latest.json');
    if (existsSync(mj)) writeFileSync(mj + '.prev', readFileSync(mj));
    writeFileSync(mj, readFileSync(manifest));
    at = readJson(manifest)?.at ?? null;
  }
  console.error(`bundle ${name} (${fileHash(cur)}) copied as lifeos/lifeos-latest.bundle.age`);
  return { name, at, hash: fileHash(cur) };
}
function writeBackupRecipientsQuiet(L, file) { const saved = console.log; console.log = () => {}; try { writeBackupRecipients(L, file); } finally { console.log = saved; } }
function escrowExportUsb() {
  const L = loadRegistry();
  if (!L.isMaster) die('export-usb runs on the controller (where the vault is)');
  const mnt = args[3];
  if (!mnt) die('usage: secrets escrow export-usb MOUNTPOINT   (the USB stick, e.g. /media/$USER/VAULT)');
  if (process.platform !== 'linux') die('export-usb checks the device with lsblk: run it on Linux');
  if (!existsSync(mnt)) die(`${mnt} does not exist (is the stick mounted?)`);
  if (!existsSync(L.vault)) die(`no vault at ${L.vault}`);
  const dev = removableMount(mnt);
  if (!dev.ok) die(`refusing: ${dev.why}. Plug in the USB stick and pass its mountpoint.`);
  const h = exportVaultTo(L, join(mnt, 'vigyan-vault'));
  emit('secrets.escrow', { action: 'export-usb', vault_hash: h });
  console.log(`vault ciphertext ${h} + recipients + README written to ${join(mnt, 'vigyan-vault')} on ${dev.why}; previous copy kept as .prev. No key was written.`);
}

// ── dispatch ─────────────────────────────────────────────────────────────────
const [a0, a1] = args;
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : null);
const table = {
  'secrets:bootstrap': () => bootstrap({ only: list(opt('only')), refresh: flag('refresh'), interactive: !flag('yes') }),
  'secrets:set': () => setValue(a1 === 'set' ? args[2] : args[1]),
  'secrets:rotate': () => setValue(args[2], { rotate: true }),
  'secrets:unset': () => unsetValue(args[2]),
  'secrets:sync': nodeSync,
  'secrets:status': status,
  'secrets:keygen': keygen,
  'secrets:recipients': recipientsCmd,
  'secrets:escrow': () => (args[2] === 'verify' ? escrowVerify() : args[2] === 'init' ? escrowInit() : args[2] === 'export-usb' ? escrowExportUsb() : die('usage: secrets escrow init [--replace] | verify | export-usb MOUNTPOINT')),
  'secrets:scan': scan,
  'secrets:install-sops': installSops,
  'features:': featuresCmd,
  'setup:': setup,
  'sync:': fleetSync,
};
const key = a0 === 'secrets' ? `secrets:${a1 ?? 'status'}` : `${a0}:`;
(table[key] ?? (() => { console.error('usage: secrets bootstrap|set|rotate|sync|status|keygen|recipients|escrow|scan|install-sops  |  features [--docs]  |  setup [...]  |  sync [--check|--force]'); process.exit(2); }))();
