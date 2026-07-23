# Security policy

## Reporting a vulnerability

Please report security vulnerabilities **privately**. Do NOT open a public
issue, a public discussion, or a pull request for a security problem.

Use GitHub's **private vulnerability reporting**: open the repository's
[**Security** tab](https://github.com/crystian/skill-map/security) and click
**"Report a vulnerability"**. This opens a private channel visible only to you
and the maintainers, your report is never public, and no email address is
exposed on either side (GitHub relays the notifications).

We aim to acknowledge a report within a few days. This is a pre-1.0,
best-effort process (there is no formal SLA yet); we will keep you updated as
we triage, fix, and coordinate disclosure. Please give us reasonable time to
ship a fix before disclosing publicly (coordinated disclosure).

## Scope

In scope, the reference implementation and the standard published from this
repository:

- **`@skill-map/cli`**, the `sm` / `skill-map` CLI, its bundled UI, and the
  local `sm serve` server (loopback-only by design).
- **`@skill-map/spec`**, the JSON Schemas and prose contracts.

Out of scope:

- **Third-party plugins.** Plugins are user-placed code that runs in-process.
  skill-map's isolation guards against accidents, not against a hostile plugin
  in the same process (see [`spec/db-schema.md`](./spec/db-schema.md)). Vet the
  plugins you install; a malicious plugin is a trust decision you make, not a
  vulnerability in skill-map.
- Content of the marketing site at `skill-map.ai` that does not expose user
  data (report those as normal issues).

## Supported versions

Pre-1.0, only the latest release published to npm (the `latest` dist-tag)
receives security fixes. There is no long-term-support branch yet.

## Verifying a release

Published packages carry a **Sigstore provenance attestation** (npm
`provenance`), so you can verify that a release was built by this repository's
CI from the expected commit. See the "Provenance" section on the package page
at [npmjs.com](https://www.npmjs.com/package/@skill-map/cli).
