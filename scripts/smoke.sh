#!/usr/bin/env bash
# Smoke-test the nginx image: read-only rootfs, non-root, security headers, caching, 404/405, health.
#   scripts/smoke.sh [image]
set -euo pipefail
IMAGE="${1:-iqvo-landing-page:dev}"
NAME="iqvo-lp-smoke-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" -p 127.0.0.1::8080 --read-only \
  --tmpfs /tmp --tmpfs /var/cache/nginx --tmpfs /var/run "$IMAGE" >/dev/null
PORT="$(docker port "$NAME" 8080/tcp | head -1 | sed 's/.*://')"
BASE="http://127.0.0.1:${PORT}"
for _ in $(seq 1 20); do curl -fsS "$BASE/healthz" >/dev/null 2>&1 && break; sleep 0.5; done

ok()   { echo "ok   $1"; }
fail() { echo "FAIL $1" >&2; exit 1; }
hdr()  { curl -sI "$BASE$1" | tr -d '\r'; }

[ "$(curl -fsS "$BASE/healthz")" = "ok" ]                                  && ok "healthz"                    || fail "healthz"
hdr / | grep -qi "^content-security-policy: default-src 'none'"             && ok "strict CSP"                 || fail "CSP"
hdr / | grep -qi "^x-content-type-options: nosniff"                         && ok "nosniff"                    || fail "nosniff"
hdr / | grep -qi "^cache-control: no-cache"                                 && ok "html revalidates"           || fail "html cache-control"
hdr / | grep -qi "^server: nginx$"                                          && ok "no version in Server"       || fail "server_tokens"
CSS="$(curl -s "$BASE/" | grep -o '/assets/css/main\.[0-9a-f]\{8\}\.css' | head -1)"
[ -n "$CSS" ]                                                               && ok "hashed css referenced"      || fail "hashed css"
hdr "$CSS" | grep -qi "immutable"                                           && ok "hashed css immutable"       || fail "immutable"
curl -s -H 'Accept-Encoding: gzip' -D- -o /dev/null "$BASE$CSS" | grep -qi "content-encoding: gzip" && ok "gzip" || fail "gzip"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/nope")" = "404" ]        && ok "404 for unknown path"       || fail "404"
curl -s "$BASE/nope" | grep -q "does not exist"                            && ok "custom 404 page"            || fail "404 page"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/")" = "405" ]    && ok "405 for POST"               || fail "405"
[ "$(docker exec "$NAME" id -u)" != "0" ]                                   && ok "runs as non-root"           || fail "root"
curl -s "$BASE/" | grep -q '<link rel="canonical" href="https://iqvo.cloud/">'  && ok "canonical is iqvo.cloud"    || fail "canonical"
hdr /sitemap.xml | grep -qi "^content-type: .*xml"                          && ok "sitemap.xml served"         || fail "sitemap"
curl -s "$BASE/robots.txt" | grep -q "Sitemap: https://iqvo.cloud/sitemap.xml" && ok "robots points at sitemap" || fail "robots"
echo "smoke passed"
