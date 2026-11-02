# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for a potential security vulnerability.

Report it privately through [GitHub Security Advisories](https://github.com/IQVO/landing-page/security/advisories/new). Include a clear description, reproduction steps, affected versions or commit SHA, and any suggested mitigation.

If private reporting is unavailable, contact the repository maintainers through the organization's private channels. Please allow time for the report to be assessed and remediated before public disclosure.

## Supported versions

Security fixes are applied to the current `develop` branch and included in subsequent releases from `main`.

## Scope

This is a static page: no server-side code, no forms, no cookies, no third-party requests. It is served with a strict
Content-Security-Policy (`deploy/security-headers.conf`). Note that the *rest of the IQVO estate* (REST, MCP and A2A
endpoints) is deliberately unauthenticated by decision; that is documented in the page and in warehouse-docs, and is not
a vulnerability report for this repository.
