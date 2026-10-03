# Gateway forward auth (any OpenID Connect provider)

Use this to put a real login in front of **writes** on an nginx gateway (theme changes, settings, admin
APIs) while reads stay open. It works with any identity provider that publishes an OpenID Connect
discovery document: Keycloak, Authentik, Authelia, Zitadel, Google, or a Nextcloud with an OIDC provider
app. Users sign in once; nginx asks a local oauth2-proxy on every write whether the session is valid
and whether the user is in the group that route requires.

```
browser ──https──► nginx
                    │ GET  /app/…   → open
                    │ POST /app/…   → internal twin → auth_request /_forward_auth_<group>
                    │                                    └─► oauth2-proxy 127.0.0.1:4180 /oauth2/auth?allowed_groups=<group>
                    │                                         202 allow · 401 no session · 403 not a member
                    │ /oauth2/*     → oauth2-proxy (sign-in, callback, sign-out)
                    ▼
              oauth2-proxy ──code flow + PKCE──► your OIDC provider
```

## Needs

- A Linux host with systemd, nginx (with `auth_request`, standard in most builds), curl and python3.
- The gateway reachable over **HTTPS**, because the session cookie is `Secure`.
- A client registered at your provider:
  - confidential client, authorization-code flow
  - redirect URI `https://<your gateway>/oauth2/callback`
  - scopes `openid profile email groups`
  - the provider must put the user's groups into a `groups` claim (ID token or UserInfo)
- Put the client id and client secret into two root-only files. The installer reads files and never takes values on the command line.

## Install

```
sudo ./install.sh install \
  --issuer https://idp.example.com/realms/main \
  --origin https://gateway.example.com \
  --client-id-file /root/forward-auth/client_id \
  --client-secret-file /root/forward-auth/client_secret \
  --group operators
```

Review first without root: `./install.sh render --issuer … --origin … --out /tmp/fa-review`.

| Flag (env) | Default | What |
|---|---|---|
| `--issuer` | required | OIDC issuer; discovery is read from `<issuer>/.well-known/openid-configuration` (or `--discovery-file`) |
| `--origin` | required | public HTTPS origin of the gateway; callback = `<origin>/oauth2/callback` |
| `--group` (`FA_GROUP`) | `operators` | group whose members may write; `add-group --group X` adds more |
| `--port` (`FA_PORT`) | `4180` | loopback port of oauth2-proxy |
| `--cookie-expire` (`FA_COOKIE_EXPIRE`) | `8h` | session length (no refresh) |
| `--cookie-name` (`FA_COOKIE_NAME`) | `_forward_auth` | host-only, Secure, SameSite=Lax |
| `--email-claim` (`FA_EMAIL_CLAIM`) | `email` | use `sub` or `preferred_username` if your users have no e-mail |
| `--prefix` (`FA_PREFIX`) | `/opt/forward-auth` | binary dir: `<prefix>/<version>/oauth2-proxy` + `current` symlink |
| `--config-dir` (`FA_CONFIG_DIR`) | `/etc/forward-auth` | `oauth2-proxy.cfg` (no secrets) and `oauth2-proxy.env` (0600) |
| `--nginx-dir` (`FA_NGINX_DIR`) | `/etc/nginx/forward-auth` | `locations.conf` (include this) + `example-route.conf` |
| `--user` / `--unit` | `forward-auth` | system user and systemd unit name |
| `--version` (`FA_OAUTH2_PROXY_VERSION`) | `7.15.5` | oauth2-proxy release; sha256 checked against the release checksum file |
| `--cookie-secret-file` | generated | your own cookie secret (16/24/32 bytes) |

## Protect a route

1. In your HTTPS `server { }` block, add `include /etc/nginx/forward-auth/locations.conf;`.
2. Adapt `example-route.conf`:
   - Non-GET requests are rewritten to an `internal` twin that carries `auth_request /_forward_auth_<group>;`.
   - A sign-in page carries `error_page 401 = @forward_auth_signin;`, so a user without a session is sent to the provider and comes back.
3. Run `nginx -t && systemctl reload nginx`.

Never answer the protected request with `return`: nginx runs `return` before `auth_request`, which skips
the check. Serve the response with `proxy_pass` or a file.

## Check it

```
curl -sk -o /dev/null -w '%{http_code}\n' https://gateway.example.com/app/            # 200  (reads open)
curl -sk -o /dev/null -w '%{http_code}\n' -X POST https://gateway.example.com/app/x   # 401  (no session)
curl -sk -o /dev/null -w '%{http_code} %{redirect_url}\n' https://gateway.example.com/app/login   # 302 → /oauth2/start
```

In a browser, opening `/app/login` signs you in at the provider and then comes back. A member's writes
work (200); a non-member's get 403.

## Operate

| Task | How |
|---|---|
| Add/remove a writer | add/remove the user in the group **at your provider**. This takes effect at their next sign-in, because groups are read at sign-in |
| Cut all sessions now | new cookie secret (`--cookie-secret-file` with a new value, then re-run `install`) |
| Rotate the client secret | rotate it at the provider, update the file, re-run `install` |
| Sign out | `https://<gateway>/oauth2/sign_out`. Signing out at the provider does **not** end the gateway session (oauth2-proxy has no back-channel logout); the session lasts until `--cookie-expire` |
| Remove | `sudo ./install.sh uninstall` (same dir flags), then remove the include and `auth_request` lines and reload nginx |

## Troubleshooting

| Symptom | Check |
|---|---|
| Writes return 500 | oauth2-proxy is not answering: `systemctl status forward-auth`, `curl 127.0.0.1:4180/ping` |
| Sign-in loops | wrong client secret, clock skew, or the redirect URI doesn't match exactly: `journalctl -u forward-auth` |
| A member gets 403 | the provider doesn't send `groups`: enable the groups claim/mapper for this client and sign in again |
| "invalid redirect_uri" at the provider | register exactly `<origin>/oauth2/callback` |
