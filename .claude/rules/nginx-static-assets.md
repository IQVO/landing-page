---
paths:
  - "deploy/**"
  - "Dockerfile"
  - "scripts/build.mjs"
  - "scripts/smoke.sh"
  - "src/assets/**"
---

# nginx static-asset rules (loaded when you touch the server config, the image or the asset build)

The page is static files served by nginx and nothing else (`docs/adr/0001-static-html-on-nginx.md`).
Two server configs carry the same policy and must change together: `deploy/nginx.conf` (the container,
`nginx-unprivileged` on 8080) and `deploy/nginx-host.example.conf` (a host-installed nginx).

## Routing

- HTML, CSS, JS, fonts and images are served by nginx directly. They are never routed through Kong:
  Kong is the fleet's API gateway, and the fleet edge keeps the asset server and the API gateway
  independent (never chain one through the other). This page has no API, so it never needs Kong.
- Real files only: an unknown path is a 404 with the custom `404.html`, never an SPA fallback `200`.
- Only GET and HEAD; any other method is 405.
- `/healthz` is a static file (`dist/healthz`, written by `scripts/build.mjs`), `no-store`, no access log.
- `absolute_redirect off`: a directory URL without its slash redirects with a RELATIVE `Location`, so
  the redirect survives a TLS edge in front of nginx.

## Caching

- `scripts/build.mjs` content-hashes CSS and JS (`main.<8 hex>.css`), so those match an `immutable`,
  one-year location. Never serve an unhashed CSS/JS name as immutable.
- Fonts and images keep stable names: long-lived but not immutable. The HTML document is `no-cache`,
  so a deploy is visible immediately.

## Headers

- Every `location` that sets its own `add_header` must `include` `deploy/security-headers.conf`
  again: nginx does not inherit `add_header` into such a location, and a forgotten include silently
  drops the CSP on that path.
- The CSP is `default-src 'none'` plus `'self'` for script, style, image, font and connect. Adding a
  third-party origin, an inline `<script>` or a `style="..."` attribute breaks it; do not relax the
  policy to make content fit.
- `Strict-Transport-Security` belongs at the TLS terminator, not in these files.

## Proof

`make docker-test` builds the image and runs `scripts/smoke.sh` against it read-only: healthz,
hashed-asset caching, gzip, 404 page, 405 on POST, the relative slash redirect, security headers.
Run it after any change here; CI's `image` job runs the same target.
