# Telemetry

skill-map is a local-first tool. By default it sends **nothing** off the
operator's machine. This document is the normative contract for the one
optional exception: **opt-in, anonymous error reporting**, so that crashes
happening in installations the maintainers do not control can be learned
about and fixed.

The contract here covers **errors only** (Level 1). Product analytics (verb
and flag usage) and performance traces are explicitly out of scope and, if
ever added, ship under their own contract and their own separate consent
toggle.

## Scope and non-goals

In scope:

- Uncaught exceptions and unhandled rejections in the CLI process.
- Unhandled errors in the BFF (`sm serve`) request path.
- Unhandled runtime errors in the browser UI.
- A small, fixed set of tags (`verb`, `phase`, `plugin_id` for built-ins,
  `extension_kind`, `route`, `method`, `status`) that help triage a crash.

Out of scope (MUST NOT be collected under this contract):

- Product analytics: which verbs, flags, or views are used.
- Performance traces: latency, throughput, span timing.
- Project-shape signals: file counts, frontmatter key sets, project size.
- Any cross-session or cross-install correlation identifier.

## Consent contract

Error reporting is **OFF by default**. It runs only after the operator has
explicitly opted in. The consent state lives in the user-settings file at
`~/.skill-map/settings.json` under the `telemetry` object (see
[`user-settings.schema.json`](./schemas/user-settings.schema.json) and the
narrow `$HOME` exception in [`cli-contract.md`](./cli-contract.md) §User-settings file):

- `telemetry.errorsEnabled` (boolean). Absent or `false` MUST be treated as
  OFF. `true` is the only value that enables reporting.
- `telemetry.firstRunAt` (integer milliseconds, or null). Records the first
  run on which the prompt was eligible, so the prompt can be deferred to the
  next eligible run.
- `telemetry.promptedAt` (integer milliseconds, or null). Records when the
  consent prompt was shown so it is never shown twice.

Rules:

1. **Default OFF.** When `errorsEnabled` is absent or `false`, no telemetry
   SDK is initialised, no DSN is contacted, and there is zero added latency
   to any verb. This MUST hold on every surface (CLI, BFF, UI).
2. **Consent prompt, TTY only, deferred to the second eligible run.** A run
   is "eligible" when the prompt could appear: an interactive terminal
   (`process.stdout.isTTY` true), a DSN configured, the kill switch unset,
   and `promptedAt` absent. The CLI MUST NOT prompt on the FIRST eligible
   run, it only stamps `firstRunAt` and stays silent, so the operator's
   first `sm` invocation is not asked two things at once (a first `sm scan`
   may already prompt for the provider lens). The NEXT eligible run shows the
   interactive prompt (yes (default) / no / details), persists the choice,
   and stamps `promptedAt`. On a non-eligible run (non-TTY CI, pipes) nothing
   is asked or recorded and the state stays OFF; the operator opts in
   explicitly later.
3. **Asked once.** Once `promptedAt` is set, the prompt MUST NOT be shown
   again. The persisted `errorsEnabled` is authoritative thereafter.
4. **Env override.** The `SKILL_MAP_TELEMETRY=0` environment variable forces
   OFF on every surface regardless of the persisted setting. It is a kill
   switch, not a toggle: there is no value of the variable that forces ON.
5. **Toggle surfaces.** After the first run, the operator changes consent
   through the Settings UI (persisted via the BFF), the same way the
   update-check toggle works today. There is intentionally no
   dedicated `sm config` key, because `sm config` writes project-local
   settings and this flag is per-machine. A future `sm telemetry` verb family
   MAY expose status and toggling from the CLI; it is not part of this level.

## Surfaces and carrier

Three surfaces report independently, to three logically separate Sentry
projects, so a crash can be attributed to the right layer:

| Surface | Runtime | Project |
|---|---|---|
| `sm <verb>` | Node (CLI) | `skill-map-cli` |
| `sm serve` BFF | Node (Hono) | `skill-map-bff` |
| UI | Browser (Angular) | `skill-map-ui` |

Each surface carries a hardcoded DSN. Sentry DSNs are public by design (they
identify an ingest endpoint, they are not secrets) and are safe to ship in
the published artifact. The BFF MUST NOT emit usage events; it reports only
unhandled errors in the request path.

## Wire format

An event MAY carry:

- A stack trace whose `filename` and `abs_path` frames have been run through
  the path scrubber (below).
- Environment facts: `cli_version`, `node_major`, `os`, `arch`, and, for the
  UI, browser family and version.
- The fixed tag set: `verb`, `phase`, `plugin_id` (built-in ids only),
  `extension_kind`, `route` (BFF), `method`, `status`.
- The error name, error code, and a scrubbed message.
- Breadcrumbs (a bounded recent-event trail) with each message scrubbed.

## Scrubbing rules

Scrubbing is **deny by default** and applied client-side in the SDK
`beforeSend` hook, before any event leaves the machine. An event MUST have
the following removed or replaced:

- **Absolute paths**, anywhere they appear (frame `abs_path`, frame
  `filename`, inside the error message, inside breadcrumb messages, inside
  nested event fields). The user's home directory is replaced with the
  literal `<HOME>` and the OS username with `<USER>`.
- **File names of user content** (scanned markdown files).
- **Markdown bodies, frontmatter values, annotation contents.** None of these
  are ever attached to an event.
- **IP address.** Opted out client-side and disabled at the project level.
- **Hostname** (`server_name` stripped).
- **OS username.**
- **Third-party plugin ids.** Only built-in plugin ids may appear in the
  `plugin_id` tag. Any non-built-in id MUST be replaced with the literal
  `external_plugin`.
- **Settings values** (`scan.extraFolders`, `scan.referencePaths`, etc.).

The scrubber is a pure function with no Sentry dependency, so it can be unit
tested against hostile inputs (Windows paths, symlinked paths, paths embedded
mid-message, nested `abs_path` fields, breadcrumb data) independently of the
SDK wiring.

## Server-side guarantees

As a second line of defense behind the client-side scrubber, each Sentry
project MUST be configured to:

- **Not store IP addresses** (project-level setting).
- **Run a server-side data-scrubbing rule** with the same path pattern as the
  client scrubber.

The UI surface additionally restricts reporting to loopback. Sentry retired
its server-side allowed-domains project setting, so this is enforced
**client-side** via the SDK `allowUrls` option pinned to `localhost` /
`127.0.0.1` (the UI is only ever served from loopback).

## Stability

The **consent model** (default OFF, `telemetry.errorsEnabled` /
`telemetry.promptedAt` in `user-settings.schema.json`, the
`SKILL_MAP_TELEMETRY=0` kill switch, prompt-once semantics) is stable as of
the spec minor in which it lands. Loosening the default (anything other than
OFF), removing the kill switch, or removing the consent gate is a major bump.

The **scope** (errors only) is normative: adding usage analytics or
performance traces is a new, separately-consented surface, not an extension
of this contract, and requires its own minor bump and its own toggle.

The **tag set** and **wire format** are experimental across spec v0.x. Adding
a tag or an environment fact is a minor bump; the scrubbing exclusion list
(what MUST NOT leave the machine) is the stable, normative core and may only
grow, never shrink, without a major bump.

Consumers and alternate implementations MAY choose not to ship telemetry at
all; the feature is optional. An implementation that does ship it MUST honor
the consent contract and the scrubbing rules in full.
