# Telemetry

skill-map is local-first; by default it sends **nothing** off the operator's
machine. This is the normative contract for the optional exceptions: two
independently-consented, anonymous telemetry surfaces, both **OFF by default**.

- **Error reporting** (Sentry), so crashes in installations the maintainers do
  not control can be learned about and fixed.
- **Usage analytics** (PostHog), so the maintainers learn which verbs and
  built-in extensions are used in the wild and prioritise the roadmap.

The two surfaces share one consent prompt, one kill switch, and one scrubber,
but each has its own carrier, toggle, and stability contract. Either can be
shipped independently.

## Scope and non-goals

In scope:

- **Errors.** Uncaught exceptions and unhandled rejections in the CLI
  process, unhandled errors in the BFF (`sm serve`) request path, unhandled
  runtime errors in the browser UI, plus a small fixed set of triage tags
  (`surface`, `verb`, `phase`, `plugin_id` for built-ins, `extension_kind`,
  `route`, `method`, `status`).
- **Usage.** Which `sm` verb ran and the NAMES of its flags; the set of
  built-in extension ids that executed during a scan (presence, not volume);
  which UI view or feature was opened. Plus environment facts (`cli_version`,
  `node_major`, `os`, `arch`).

Out of scope (MUST NOT be collected under this contract, on either surface):

- **Flag values, file names, markdown bodies, frontmatter values, annotation
  contents, settings values.** Only flag names and built-in extension ids
  ever leave the machine.
- **Performance traces:** latency, throughput, span timing.
- **Project-shape signals:** file counts, node counts, frontmatter key sets,
  project size. "Which extensions ran" is presence only, never a count.
- **Any cross-session or cross-install correlation identifier**, with one
  documented exception: the single anonymous usage `distinct_id`
  (`telemetry.anonymousId`, below), which carries no identity and exists only
  to de-duplicate usage events from the same install. The error surface
  carries no correlation id at all.

## Consent contract (shared)

Both surfaces are **OFF by default**, running only after the operator opts in.
Consent state lives in the user-settings file at `~/.skill-map/settings.json`
under the `telemetry` object (see
[`user-settings.schema.json`](./schemas/user-settings.schema.json) and the
narrow `$HOME` exception in [`cli-contract.md`](./cli-contract.md) §User-settings file):

- `telemetry.errorsEnabled`, `telemetry.usageCliEnabled`,
  `telemetry.usageUiEnabled` (booleans). Opt-in for error reporting, CLI usage
  analytics, and UI usage analytics respectively. For each, absent or `false`
  MUST be treated as OFF.
- `telemetry.anonymousId` (string UUID, or null). The PostHog `distinct_id`
  for the usage surface. Minted once when any usage toggle first becomes
  `true`; never regenerated. The single allowed anonymous correlation id,
  scoped to usage only.
- `telemetry.firstRunAt` (integer milliseconds, or null). The first run on
  which the prompt was eligible, so it can be deferred to the next eligible run.
- `telemetry.promptedAt` (integer milliseconds, or null). When the consent
  prompt was shown, so it is never shown twice.

Rules:

1. **Default OFF.** When a toggle is absent or `false`, the matching SDK is
   not initialised, no endpoint is contacted, and there is zero added latency.
   MUST hold on every surface (CLI, BFF, UI).
2. **One shared consent prompt, TTY only, deferred to the second eligible
   run.** A run is "eligible" when the prompt could appear: an interactive
   terminal (`process.stdout.isTTY` true), at least one carrier configured
   (a Sentry DSN or the PostHog key non-empty), the kill switch unset, and
   `promptedAt` absent. The CLI MUST NOT prompt on the FIRST eligible run, it
   only stamps `firstRunAt`, so the operator's first `sm` invocation is not
   asked two things at once (a first `sm scan` may already prompt for the
   provider lens). The NEXT eligible run shows the interactive prompt
   (yes (default) / no / details). A single **yes** sets `errorsEnabled`,
   `usageCliEnabled`, and `usageUiEnabled` all to `true` and mints
   `anonymousId`; a **no** sets all three to `false` and mints nothing. Either
   way it stamps `promptedAt`. On a non-eligible run (non-TTY CI, pipes)
   nothing is asked or recorded and every surface stays OFF.
3. **Asked once.** Once `promptedAt` is set, the prompt MUST NOT be shown
   again; the persisted toggles are authoritative thereafter.
4. **Env override.** `SKILL_MAP_TELEMETRY=0` forces OFF on every surface
   (errors and both usage toggles) regardless of persisted settings. It is a
   kill switch, not a toggle: no value of it forces ON. Exactly one
   kill-switch variable covers all surfaces.
5. **Independent toggles.** After the first run, the operator changes consent
   through the Settings UI (persisted via the BFF), like the update-check
   toggle. The three toggles are independent: `usageCliEnabled` and
   `usageUiEnabled` can each be turned off without affecting the other or
   `errorsEnabled`. Because the CLI reads `~/.skill-map/settings.json` fresh
   per invocation, turning CLI usage off from the browser is honoured on the
   next `sm` run. There is intentionally no dedicated `sm config` key:
   `sm config` writes project-local settings, these flags are per-machine.
   A future `sm telemetry` verb family MAY expose status and toggling from
   the CLI.
6. **Anonymous id.** `anonymousId` is a random UUID v4 with no personal data,
   minted once the first time any usage toggle becomes `true` (consent prompt
   or Settings enable), never regenerated for the life of the install. It is
   the PostHog `distinct_id` shared by the CLI and UI usage surfaces. The BFF
   exposes it read-only (see below) so the browser uses the same id; it MUST
   NOT be writable over the wire.

## Surface: Errors (Sentry)

Three surfaces report independently so a crash is attributed to the right
layer, across **two** Sentry projects.

| Surface | Runtime | Discriminator | Project |
|---|---|---|---|
| `sm <verb>` | Node (CLI) | `surface: cli` tag | shared Node project |
| `sm serve` BFF | Node (Hono) | `surface: bff` tag | shared Node project |
| UI | Browser (Angular) | own project | `skill-map-ui` |

The two Node surfaces share one project (same workspace code, same runtime); the
`surface` tag plus the per-event `route` / `method` tags separate a CLI crash
from a BFF request-path crash. The UI has its own project and needs no `surface`
tag. Each project carries a hardcoded DSN (`SENTRY_DSN_NODE` for the shared Node
project, `SENTRY_DSN_UI` for the UI), centralized in `src/public-config.ts` and
`ui/src/app/core/public-config.ts`. Sentry DSNs are public by design (they
identify an ingest endpoint, not secrets) and safe to ship. The BFF MUST NOT
emit usage events; it reports only unhandled errors in the request path.

The error surfaces send **no proactive beacons**: no release-health sessions,
no transactions, no performance traces. An event leaves the machine ONLY when
an error is captured. The browser SDK MUST drop the default session
integration so no session is sent on page load or route change.

### Error wire format

An error event MAY carry:

- A stack trace whose `filename` and `abs_path` frames have been run through
  the path scrubber (below).
- Environment facts: `cli_version`, `node_major`, `os`, `arch`, and, for the
  UI, browser family and version.
- The fixed tag set: `surface` (`cli` / `bff` on the shared Node project),
  `verb`, `phase`, `plugin_id` (built-in ids only), `extension_kind`,
  `route` (BFF), `method`, `status`.
- The error name, error code, and a scrubbed message.
- Breadcrumbs (a bounded recent-event trail), each message scrubbed.

## Surface: Usage (PostHog)

Usage analytics are carried by **PostHog Cloud (EU region)**, for data
residency parity with the Sentry `.de` projects. The public PostHog project
key is hardcoded and centralized in `src/public-config.ts` (`POSTHOG_KEY_NODE`)
and `ui/src/app/core/public-config.ts` (`POSTHOG_KEY_UI`). Like a Sentry DSN it
is a public ingest identifier, not a secret, and safe to ship. Setting a key to
`''` forces that surface dormant (no init, no network, SDK not even imported),
the same dormancy gate the error surface uses.

Only **two** runtimes emit usage events:

| Surface | Runtime | Toggle | Carrier |
|---|---|---|---|
| `sm <verb>` | Node (CLI) | `usageCliEnabled` | PostHog (server SDK) |
| UI | Browser (Angular) | `usageUiEnabled` | PostHog (browser SDK) |

The **BFF MUST NOT emit usage events** (its activity is the UI's, already
covered by the UI surface; double-emitting would double-count). The BFF
participates only by reading/writing consent and by exposing `anonymousId`
read-only on `GET /api/preferences` so the browser uses the same `distinct_id`
as the CLI.

Both usage SDKs send nothing beyond the allow-list below: PostHog autocapture,
pageview/pageleave capture, session recording, and client IP / geo-IP
enrichment are all disabled.

## Usage event taxonomy

Usage collection is **deny by default**: only the events and properties named
here may be sent. Every event carries `distinct_id = telemetry.anonymousId`,
the common environment facts (`cli_version`, `node_major`, `os`, `arch`; the UI
also carries browser family/version where the SDK provides it), and
`environment` (`dev` / `prod`, see below). The UI also attaches the active
theme as super-properties on every event: `theme_base` (`light` / `dark`) and
`theme_extra` (the active extra theme id, or `none`); future extra themes flow
through by value with no spec change. No other identity property is ever
attached.

The `environment` tag lets the maintainers filter their own dogfooding out of
real-world data. It is `dev` when `SKILL_MAP_TELEMETRY_ENV` is set to any
non-empty value other than a production marker (`prod` / `production`); the dev
tooling sets it. It is `prod` when the variable is absent, empty, or a
production marker. It is NOT a kill switch (it labels the source, never disables
telemetry) and rides on both surfaces: usage events as above, and Sentry's
native `environment` field on error events.

| Event | Surface | Properties |
|---|---|---|
| `cli.<verb>` | CLI | `flags` (array of flag NAMES that were set), and on a scan, `extensions` (deduped, sorted set of built-in extractor ids that ran in the walk). One event per invocation; the event NAME is the verb (`cli.scan`, `cli.check`, ...), restricted to the registered closed verb set so an unknown command collapses to `cli.unknown` (a typo never mints a junk event name). |
| `ui.view.<view>` | UI | the opened view is the event name (`ui.view.map`, `ui.view.files`), from a closed route set. No properties beyond the common env facts. One per route change. |
| `ui.feature.<feature>` | UI | the opened feature is the event name (`ui.feature.inspector`, `ui.feature.settings`), from a closed set. |
| `plugin.apply` | CLI + UI | `enabled` / `disabled`: deduped, sorted sets of the plugin / extension ids toggled (built-in ids pass through, third-party collapse to `external_plugin`). Emitted on `sm plugins enable` / `disable` and on the Settings plugins Apply. |

Rules:

- **Flag names only, never values.** `--max-nodes 500` reports the name
  `max-nodes`, never `500`.
- **Extractor ids are presence, not counts.** `extensions` is a set; it never
  carries how many nodes an extractor processed or project size. Only
  extractors that ran in the walk appear (cached extractors on an incremental
  scan do not), so the signal is "which extractors this project exercises",
  aggregated across runs.
- **Third-party ids collapse.** Any extension id whose plugin is not a
  built-in (`claude`, `antigravity`, `codex`, `agent-skills`, `core`) MUST be
  replaced with `external_plugin` before the event leaves the machine.
- **No node paths, titles, or content** in any UI event; the view / feature is
  the event name, from a closed set, and nothing else is attached.

## Scrubbing rules (shared)

Scrubbing is **deny by default**, applied client-side in each SDK's pre-send
hook (`beforeSend` for Sentry, `before_send` for PostHog) before any event
leaves the machine. It applies to error events AND usage event properties
(defense in depth: the usage collectors emit only names and enums, but every
payload is still walked). An event MUST have the following removed or replaced:

- **Absolute paths**, anywhere they appear (frame `abs_path`, frame
  `filename`, inside the error message, breadcrumb messages, any nested event
  or property field). The home directory is replaced with `<HOME>` and the OS
  username with `<USER>`.
- **File names of user content** (scanned markdown files).
- **Markdown bodies, frontmatter values, annotation contents.** None of these
  are ever attached to an event.
- **IP address.** Opted out client-side and disabled at the project level.
- **Hostname** (`server_name` stripped).
- **OS username.**
- **Third-party plugin ids.** Only built-in plugin ids may appear; any
  non-built-in id MUST be replaced with the literal `external_plugin`.
- **Settings values** (`scan.referencePaths`, etc.).

The scrubber is a pure function with no SDK dependency, so it can be unit
tested against hostile inputs (Windows paths, symlinked paths, paths embedded
mid-message, nested `abs_path` fields, breadcrumb data, structured usage
properties) independently of SDK wiring.

## Server-side guarantees

As a second line of defense behind the client-side scrubber:

- Each **Sentry** project MUST be configured to not store IP addresses and to
  run a server-side data-scrubbing rule with the same path pattern as the
  client scrubber. The UI error surface additionally restricts reporting to
  loopback: Sentry retired its server-side allowed-domains setting, so this is
  enforced client-side via the SDK `allowUrls` option pinned to `localhost` /
  `127.0.0.1` (the UI is only served from loopback).
- The **PostHog** project MUST be configured to discard client IP addresses
  and disable geo-IP enrichment (the client SDKs disable geo and autocapture
  too, but the project setting is the backstop).

## Stability

The **consent model** (default OFF on every surface, the `telemetry` toggles
and bookkeeping in `user-settings.schema.json`, the `SKILL_MAP_TELEMETRY=0`
kill switch, prompt-once semantics) is stable as of the spec minor in which it
lands. Loosening any default (anything other than OFF), removing the kill
switch, or removing the consent gate is a major bump.

The **two surfaces are independent.** Error and usage scope each evolve on
their own minor bump. Adding a new usage event or property, or a new error tag
or environment fact, is a minor bump. Performance traces remain out of scope on
both and would be a third, separately-consented surface.

The **`anonymousId` exception** is normatively scoped to the usage surface
only: the one anonymous correlation id the contract permits, and the error
surface MUST remain free of any cross-session or cross-install id. Widening it
beyond usage, or attaching any identity, is a major bump.

The scrubbing exclusion list (what MUST NOT leave the machine) is the stable,
normative core and may only grow, never shrink, without a major bump.

Consumers and alternate implementations MAY ship neither surface; both are
optional. An implementation that ships a surface MUST honor the consent
contract and the scrubbing rules in full.
