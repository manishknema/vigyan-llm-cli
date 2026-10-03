#!/usr/bin/env bash
# gateway-forward-auth -- protect nginx routes with any OpenID Connect provider via oauth2-proxy.
#
# Provider-agnostic: Keycloak, Authentik, Authelia, Zitadel, Google, GitHub (via oauth2-proxy's
# providers), or a Nextcloud with an OIDC provider app — anything with an OIDC discovery document.
# oauth2-proxy is pinned and sha256-verified against the release checksum file. All paths are flags.
#
#   sudo ./install.sh install --issuer https://idp.example.com/realms/main \
#        --origin https://gateway.example.com \
#        --client-id-file /root/fa/client_id --client-secret-file /root/fa/client_secret \
#        [--group operators] [--port 4180] [--cookie-expire 8h] \
#        [--prefix /opt/forward-auth] [--config-dir /etc/forward-auth] [--nginx-dir /etc/nginx/forward-auth] \
#        [--user forward-auth] [--unit forward-auth] [--version 7.15.5] [--email-claim email] [--dry-run]
#   sudo ./install.sh add-group --group editors [same dirs]   # one more auth location for another group
#   sudo ./install.sh uninstall [same dirs]
#   ./install.sh render --issuer … --origin … --out DIR        # no root: write every file into DIR for review
#
# What it writes (defaults):
#   /opt/forward-auth/<version>/oauth2-proxy  + symlink current      (binary, root:root 0755)
#   /etc/forward-auth/oauth2-proxy.cfg                               (no secrets)
#   /etc/forward-auth/oauth2-proxy.env                               (0600: client id/secret, cookie secret)
#   /etc/systemd/system/forward-auth.service                         (system user, loopback only)
#   /etc/nginx/forward-auth/locations.conf                           (include inside your server {} block)
#   /etc/nginx/forward-auth/example-route.conf                       (copy/adapt; not included by default)
# Secrets are read from files you provide (never from the command line) or generated (cookie secret).
set -euo pipefail

CMD="${1:-}"; shift || true
ISSUER="" ORIGIN="" CID_FILE="" CSECRET_FILE="" COOKIE_FILE="" DISCOVERY_FILE=""
GROUP="${FA_GROUP:-operators}" PORT="${FA_PORT:-4180}" COOKIE_EXPIRE="${FA_COOKIE_EXPIRE:-8h}"
PREFIX="${FA_PREFIX:-/opt/forward-auth}" CONFIG_DIR="${FA_CONFIG_DIR:-/etc/forward-auth}"
NGINX_DIR="${FA_NGINX_DIR:-/etc/nginx/forward-auth}" SVC_USER="${FA_USER:-forward-auth}" UNIT="${FA_UNIT:-forward-auth}"
VERSION="${FA_OAUTH2_PROXY_VERSION:-7.15.5}" EMAIL_CLAIM="${FA_EMAIL_CLAIM:-email}" COOKIE_NAME="${FA_COOKIE_NAME:-_forward_auth}"
DRY=0 OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --issuer) ISSUER="$2"; shift 2 ;;            --origin) ORIGIN="${2%/}"; shift 2 ;;
    --client-id-file) CID_FILE="$2"; shift 2 ;;  --client-secret-file) CSECRET_FILE="$2"; shift 2 ;;
    --cookie-secret-file) COOKIE_FILE="$2"; shift 2 ;;  --discovery-file) DISCOVERY_FILE="$2"; shift 2 ;;
    --group) GROUP="$2"; shift 2 ;;              --port) PORT="$2"; shift 2 ;;
    --cookie-expire) COOKIE_EXPIRE="$2"; shift 2 ;; --cookie-name) COOKIE_NAME="$2"; shift 2 ;;
    --prefix) PREFIX="$2"; shift 2 ;;            --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    --nginx-dir) NGINX_DIR="$2"; shift 2 ;;      --user) SVC_USER="$2"; shift 2 ;;
    --unit) UNIT="$2"; shift 2 ;;                --version) VERSION="$2"; shift 2 ;;
    --email-claim) EMAIL_CLAIM="$2"; shift 2 ;;  --dry-run) DRY=1; shift ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
die(){ echo "forward-auth: $*" >&2; exit 1; }
[[ "${GROUP}" =~ ^[A-Za-z0-9._-]+$ ]] || die "--group must be [A-Za-z0-9._-]"
[[ "${PORT}" =~ ^[0-9]+$ ]] || die "--port must be a number"

discovery(){
  if [[ -n "${DISCOVERY_FILE}" ]]; then cat "${DISCOVERY_FILE}"
  else curl -fsS -m 15 "${ISSUER%/}/.well-known/openid-configuration" || die "no discovery at ${ISSUER%/}/.well-known/openid-configuration (use --discovery-file)"; fi
}

render_cfg(){  # stdout; endpoints taken from discovery so path quirks of the provider cannot break it
  [[ -n "${ISSUER}" && -n "${ORIGIN}" ]] || die "--issuer and --origin are required"
  local host; host="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.urlsplit(sys.argv[1]).hostname)' "${ORIGIN}")"
  FA_DISC="$(discovery)" python3 - "${ORIGIN}" "${host}" "${PORT}" "${COOKIE_EXPIRE}" "${COOKIE_NAME}" "${EMAIL_CLAIM}" <<'PY'
import json, os, sys
origin, host, port, expire, cname, eclaim = sys.argv[1:7]
d = json.loads(os.environ["FA_DISC"])
cfg = {
  "http_address": f"127.0.0.1:{port}", "provider": "oidc",
  "oidc_issuer_url": d["issuer"], "skip_oidc_discovery": True,
  "login_url": d["authorization_endpoint"], "redeem_url": d["token_endpoint"],
  "oidc_jwks_url": d["jwks_uri"], "profile_url": d.get("userinfo_endpoint", ""), "validate_url": d.get("userinfo_endpoint", ""),
  "redirect_url": f"{origin}/oauth2/callback", "proxy_prefix": "/oauth2",
  "scope": "openid profile email groups", "oidc_groups_claim": "groups", "oidc_email_claim": eclaim,
  "insecure_oidc_allow_unverified_email": eclaim != "email", "email_domains": ["*"], "code_challenge_method": "S256",
  "reverse_proxy": True, "set_xauthrequest": True, "skip_provider_button": True, "upstreams": ["static://202"],
  "whitelist_domains": [host], "cookie_name": cname, "cookie_secure": True, "cookie_samesite": "lax",
  "cookie_path": "/", "cookie_expire": expire, "cookie_refresh": "0s",
}
def toml(v):
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, list): return "[" + ", ".join(toml(x) for x in v) + "]"
    return json.dumps(v)
print("# Managed by gateway-forward-auth/install.sh. No secrets here (see oauth2-proxy.env).")
print("".join(f"{k} = {toml(v)}\n" for k, v in cfg.items()), end="")
PY
}
render_unit(){ cat <<EOF
# Managed by gateway-forward-auth/install.sh
[Unit]
Description=oauth2-proxy forward auth (OIDC) for nginx
After=network-online.target
Wants=network-online.target
RequiresMountsFor=${PREFIX}
[Service]
User=${SVC_USER}
Group=${SVC_USER}
EnvironmentFile=${CONFIG_DIR}/oauth2-proxy.env
ExecStart=${PREFIX}/current/oauth2-proxy --config=${CONFIG_DIR}/oauth2-proxy.cfg
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
[Install]
WantedBy=multi-user.target
EOF
}
auth_location(){  # $1 group -> an internal auth location for that group
  cat <<EOF
# writes need a session AND membership of group "$1": 202 allow, 401 no session, 403 not a member
location = /_forward_auth_$1 {
    internal;
    proxy_pass http://127.0.0.1:${PORT}/oauth2/auth?allowed_groups=$1;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Uri \$request_uri;
    proxy_set_header Cookie \$http_cookie;
}
EOF
}
render_locations(){ cat <<EOF
# Managed by gateway-forward-auth/install.sh. Include inside your HTTPS server {} block:
#     include ${NGINX_DIR}/locations.conf;
location /oauth2/ {                     # sign-in, callback, sign-out
    proxy_pass http://127.0.0.1:${PORT};
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$host;
    proxy_set_header X-Forwarded-Uri \$request_uri;
}
location @forward_auth_signin {         # error_page 401 = @forward_auth_signin; on sign-in pages
    return 302 /oauth2/start?rd=\$request_uri;
}
EOF
  auth_location "${GROUP}"
}
render_example(){ cat <<EOF
# Example (not included automatically): reads open, writes need group "${GROUP}".
# Never answer the protected request with 'return' — it runs before auth_request and skips it.
location /app/ {
    if (\$request_method !~ ^(GET|HEAD)\$) { rewrite ^/app/(.*)\$ /_app_write/\$1 last; }
    proxy_pass http://127.0.0.1:8080;
}
location /_app_write/ {
    internal;
    auth_request /_forward_auth_${GROUP};
    auth_request_set \$fa_user \$upstream_http_x_auth_request_user;
    proxy_set_header X-Forwarded-User \$fa_user;
    rewrite ^/_app_write/(.*)\$ /\$1 break;
    proxy_pass http://127.0.0.1:8080;
}
location = /app/login {                 # a page users open to sign in
    auth_request /_forward_auth_${GROUP};
    error_page 401 = @forward_auth_signin;
    proxy_pass http://127.0.0.1:8080/;
}
EOF
}

ensure_binary(){
  local dir="${PREFIX}/${VERSION}" t="oauth2-proxy-v${VERSION}.linux-amd64" tmp
  if "${dir}/oauth2-proxy" --version 2>&1 | grep -q "v${VERSION}"; then ln -sfn "${VERSION}" "${PREFIX}/current"; return; fi
  tmp="$(mktemp -d)"; local base="https://github.com/oauth2-proxy/oauth2-proxy/releases/download/v${VERSION}"
  curl -fsSL -o "${tmp}/${t}.tar.gz" "${base}/${t}.tar.gz"
  curl -fsSL -o "${tmp}/sum.txt" "${base}/${t}.tar.gz-sha256sum.txt"
  local want got; want="$(awk '{print $1; exit}' "${tmp}/sum.txt")"; got="$(sha256sum "${tmp}/${t}.tar.gz" | awk '{print $1}')"
  [[ -n "${want}" && "${want}" == "${got}" ]] || { rm -rf "${tmp}"; die "sha256 mismatch for ${t}.tar.gz; refusing"; }
  tar -xzf "${tmp}/${t}.tar.gz" -C "${tmp}"
  install -d -m 0755 "${dir}"; install -m 0755 "${tmp}/${t}/oauth2-proxy" "${dir}/oauth2-proxy"; rm -rf "${tmp}"
  ln -sfn "${VERSION}" "${PREFIX}/current"
  echo "oauth2-proxy v${VERSION} installed in ${dir} (sha256 verified)"
}

case "${CMD}" in
  render)
    [[ -n "${OUT}" ]] || die "--out DIR required"
    mkdir -p "${OUT}"
    render_cfg >"${OUT}/oauth2-proxy.cfg"; render_unit >"${OUT}/${UNIT}.service"
    render_locations >"${OUT}/locations.conf"; render_example >"${OUT}/example-route.conf"
    echo "rendered into ${OUT}: oauth2-proxy.cfg ${UNIT}.service locations.conf example-route.conf" ;;
  install)
    [[ ${EUID} -eq 0 ]] || die "run as root (or use 'render --out DIR' to review)"
    [[ -r "${CID_FILE}" && -r "${CSECRET_FILE}" ]] || die "--client-id-file and --client-secret-file are required (files, not values)"
    cfg="$(render_cfg)"
    if [[ ${DRY} -eq 1 ]]; then echo "${cfg}"; render_unit; render_locations; exit 0; fi
    id "${SVC_USER}" >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "${SVC_USER}"
    install -d -m 0755 "${PREFIX}" "${CONFIG_DIR}" "${NGINX_DIR}"
    ensure_binary
    printf '%s\n' "${cfg}" >"${CONFIG_DIR}/oauth2-proxy.cfg"; chmod 0644 "${CONFIG_DIR}/oauth2-proxy.cfg"
    ( umask 077
      cookie="$( [[ -n "${COOKIE_FILE}" ]] && tr -d '\r\n' <"${COOKIE_FILE}" || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
      { printf 'OAUTH2_PROXY_CLIENT_ID=%s\n' "$(tr -d '\r\n' <"${CID_FILE}")"
        printf 'OAUTH2_PROXY_CLIENT_SECRET=%s\n' "$(tr -d '\r\n' <"${CSECRET_FILE}")"
        printf 'OAUTH2_PROXY_COOKIE_SECRET=%s\n' "${cookie}"; } >"${CONFIG_DIR}/oauth2-proxy.env" )
    chmod 0600 "${CONFIG_DIR}/oauth2-proxy.env"
    render_unit >"/etc/systemd/system/${UNIT}.service"
    render_locations >"${NGINX_DIR}/locations.conf"; render_example >"${NGINX_DIR}/example-route.conf"
    systemctl daemon-reload; systemctl enable --now "${UNIT}"; systemctl restart "${UNIT}"
    for _ in $(seq 1 20); do curl -fs -m 2 "http://127.0.0.1:${PORT}/ping" >/dev/null && break; sleep 1; done
    curl -fs -m 2 "http://127.0.0.1:${PORT}/ping" >/dev/null || die "oauth2-proxy did not start: journalctl -u ${UNIT}"
    echo "running on 127.0.0.1:${PORT}. Now add 'include ${NGINX_DIR}/locations.conf;' to your server block, protect routes (see example-route.conf), nginx -t && reload." ;;
  add-group)
    [[ ${EUID} -eq 0 ]] || die "run as root"
    auth_location "${GROUP}" >>"${NGINX_DIR}/locations.conf"
    echo "added /_forward_auth_${GROUP} to ${NGINX_DIR}/locations.conf; nginx -t && reload" ;;
  uninstall)
    [[ ${EUID} -eq 0 ]] || die "run as root"
    systemctl disable --now "${UNIT}" 2>/dev/null || true
    rm -f "/etc/systemd/system/${UNIT}.service" "${CONFIG_DIR}/oauth2-proxy.cfg" "${CONFIG_DIR}/oauth2-proxy.env"
    rm -rf "${NGINX_DIR}" "${PREFIX}"; systemctl daemon-reload
    id "${SVC_USER}" >/dev/null 2>&1 && userdel "${SVC_USER}" || true
    echo "removed. Remove the 'include ${NGINX_DIR}/locations.conf;' line and auth_request lines from nginx, then nginx -t && reload." ;;
  *) sed -n '2,30p' "$0"; exit 2 ;;
esac
