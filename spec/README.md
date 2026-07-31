# skill-map spec

The **skill-map specification** defines a vendor-neutral standard for mapping, inspecting, and managing collections of interrelated Markdown files, skills, agents, commands, hooks, and notes that compose AI-agent ecosystems (Claude Code, Codex, Antigravity, docs sites, and any future platform).

This document is the **source of truth**. The reference implementation under `../src/` conforms to it. Third parties can build alternative implementations (any language, any UI, any CLI) using only `spec/`, without reading the reference source.

## What this spec defines

- The **domain model**: nodes, links, issues, scan results.
- The **extension contract**: six extension kinds (provider, extractor, analyzer, action, formatter, hook) with their input/output shapes.
- The **CLI contract**: verb set, flags, exit codes, JSON introspection.
- The **persistence contract**: table catalog owned by the kernel, plugin key-value API.
- The **job contract**: lifecycle states, event stream, prompt preamble, submit/claim/record semantics.
- The **frontmatter standard**: base fields and per-kind extensions.
- The **summary standard**: shape of action-produced summaries per kind.
- The **plugin manifest**: metadata, `specCompat` range, storage mode, security declarations.

## What this spec does not define

- Language or runtime of the implementation.
- Database engine (spec assumes a relational, SQL-like store; engine-agnostic).
- UI framework, theming, layout.
- Test framework (conformance suite is language-neutral data, not code).
- Logging format, telemetry, or distribution channels.
- Plugin marketplace mechanics.

These are implementation decisions. The reference impl picks them (see [`../AGENTS.md`](../AGENTS.md) and [`../ROADMAP.md`](../ROADMAP.md)); others may pick differently and still conform.

## Properties

- **Machine-readable**: all domain shapes are JSON Schemas. Validate from any language with a JSON Schema validator.
- **Human-readable**: prose documents for each subsystem, with examples.
- **Independently versioned**: spec `v1.0.0` can be implemented by CLI `v0.3.2`. See [`versioning.md`](./versioning.md).
- **Platform-neutral**: no platform is privileged. Each is expressed as an adapter extension.
- **Conformance-tested**: every conforming implementation passes the suite under [`conformance/`](./conformance/README.md). Pass/fail is binary.

## Naming conventions

Two analyzers govern every identifier in the spec. Both are **normative**.

- **Filesystem artefacts use kebab-case.** Every file and directory in `spec/` (and in any conforming implementation), `scan-result.schema.json`, `job-lifecycle.md`, `report-base.schema.json`, `auto-rename-medium` (as an `issue.analyzerId` value), `direct-override` (as a `safety.injectionType` enum value), and so on, is kebab-case lowercase. Enum values and issue analyzer ids follow the same convention so they echo into URLs, filenames, and log keys without escaping.
- **JSON content uses camelCase.** Every key inside a JSON Schema, frontmatter block, config file, plugin manifest, action manifest, job record, report, event payload, or API response is camelCase: `whatItDoes`, `injectionDetected`, `expectedTools`, `sourceVersion`, `docsUrl`, `examplesUrl`, `ttlSeconds`, `runId`, `jobId`. This matches the JS/TS ecosystem the reference impl ships in and the Kysely `CamelCasePlugin` that bridges to the `snake_case` SQL layer, but the analyzer is spec-level: an alternative implementation in any language still exposes camelCase JSON keys.

The SQL persistence layer is the sole exception: tables, columns, and migration filenames use `snake_case` (see `db-schema.md`). That boundary is crossed only inside a storage adapter; nothing that leaves the kernel should ever be `snake_case`.

## Repo layout

```
spec/                              ← published as @skill-map/spec
├── README.md                      ← this file
├── CHANGELOG.md                   ← spec history (independent from CLI)
├── [versioning.md](./versioning.md) ← evolution policy
├── package.json                   ← npm manifest for @skill-map/spec
├── index.json                     ← machine-readable manifest + per-file sha256 (generated)
│
├── [architecture.md](./architecture.md)      ← hexagonal ports & adapters
├── [cli-contract.md](./cli-contract.md)      ← verbs, flags, exit codes, JSON introspection
├── [job-events.md](./job-events.md)          ← canonical event stream schema
├── [prompt-preamble.md](./prompt-preamble.md) ← canonical injection-mitigation preamble (verbatim normative)
├── [db-schema.md](./db-schema.md)            ← table catalog (kernel-owned)
├── [plugin-kv-api.md](./plugin-kv-api.md)    ← ctx.store KV persistence contract
├── [job-lifecycle.md](./job-lifecycle.md)     ← queued → running → completed | failed
├── [telemetry.md](./telemetry.md)            ← opt-in error reporting + usage analytics (both default OFF)
├── [mcp-server.md](./mcp-server.md)          ← skill-map as an MCP server (opt-in, off by default)
├── [provider-activity.md](./provider-activity.md) ← live node activity reported by external AI CLIs
├── [view-slots.md](./view-slots.md)          ← closed catalog of UI slots a plugin can emit into
├── [input-types.md](./input-types.md)        ← closed catalog of plugin-setting input types
├── [plugin-quickstart.md](./plugin-quickstart.md) ← 3-step path to a working plugin
├── [plugin-author-guide.md](./plugin-author-guide.md) ← full plugin author guide (descriptive)
│
├── schemas/                       ← JSON Schemas, draft 2020-12, camelCase keys (authoritative list + sha256 in index.json)
│   ├── *.schema.json              ← the top-level domain shapes: node, link, issue,
│   │                                 scan-result, execution-record, project-config,
│   │                                 plugins-registry, job, report-base, conformance-case,
│   │                                 history-stats, sidecar, signal, and the report
│   │                                 envelopes each verb emits. `index.json` is the
│   │                                 authoritative list; this tree is illustrative.
│   │
│   ├── api/                       ← RestEnvelope, the wrapper every `/api/*` response uses
│   ├── enrichments/               ← per-enrichment report payloads (github)
│   ├── findings/                  ← FindingsReport, the envelope every probabilistic
│   │                                 Analyzer's own report.schema.json extends
│   ├── tags/                      ← NodeTagsReport, the canonical tagger-report shape
│   │
│   ├── extensions/                ← base + one per kind (provider, extractor,
│   │                                 analyzer, action, formatter, hook) +
│   │                                 provider-kind.schema.json +
│   │                                 extension-manifest.schema.json (the per-extension
│   │                                 `extension.json`); validated at plugin load
│   │
│   ├── frontmatter/               ← user-authored; additionalProperties: true
│   │   └── base.schema.json        ← universal shape; per-kind schemas live with
│   │                                 the Provider that emits the kind (the built-in
│   │                                 Claude Provider declares `agent`, `command`,
│   │                                 `skill` and `mcp`, and ships their schemas in
│   │                                 `src/plugins/claude/providers/claude/schemas/`)
│   │
│   └── summaries/                 ← kernel-controlled; additionalProperties: false
│       └── markdown.schema.json    ← extends report-base via allOf. Per-kind summary
│                                     shapes are a Provider concern; only the
│                                     provider-agnostic `markdown` one is spec-owned.
│
├── interfaces/
│   └── [security-scanner.md](./interfaces/security-scanner.md) ← convention over the Analyzer kind (NOT a 7th extension kind)
├── [conformance/](./conformance/README.md)
│   ├── [coverage.md](./conformance/coverage.md) ← schema-to-case coverage matrix
│   ├── fixtures/                  ← controlled MD corpora + preamble-v2.txt
│   └── cases/                     ← declarative test cases (kernel-empty-boot,
│                                    preamble-bitwise-match, orphan-markdown-fallback, ...)
```

## How to read this spec

- **Building a tool or plugin that consumes skill-map output?** Start with [`schemas/scan-result.schema.json`](./schemas/scan-result.schema.json) and [`schemas/node.schema.json`](./schemas/node.schema.json).
- **Building a custom extractor, analyzer, or formatter?** Read [`architecture.md`](./architecture.md), then the relevant schema under [`schemas/extensions/`](./schemas/extensions/).
- **Building an alternative CLI implementation?** Read [`cli-contract.md`](./cli-contract.md) and run [`conformance/`](./conformance/README.md).
- **Integrating a new platform (adapter)?** Read [`architecture.md`](./architecture.md) §adapters, then the built-in Claude Provider source in `../src/plugins/claude/providers/claude/` as a worked example.
- **Shipping a job-running runner?** Read [`job-events.md`](./job-events.md), [`job-lifecycle.md`](./job-lifecycle.md), [`prompt-preamble.md`](./prompt-preamble.md).

## Relationship to the reference implementation

The reference implementation ([`../src/`](../src/README.md)) is one conforming consumer of this spec. It ships the CLI binary `sm`, a built-in SQLite storage adapter, and a set of default extensions.

The reference impl has no privileged access. Breaking changes to the spec must follow [`versioning.md`](./versioning.md) regardless of reference-impl convenience.

When spec and reference impl disagree, the spec wins. File an issue; one of them is wrong.

## Distribution

Published to npm as [`@skill-map/spec`](https://www.npmjs.com/package/@skill-map/spec).

### Install

```bash
npm i @skill-map/spec
```

### Use, load a schema

```js
import specIndex from '@skill-map/spec';
import nodeSchema from '@skill-map/spec/schemas/node.schema.json' with { type: 'json' };

console.log(specIndex.specPackageVersion);  // npm package version; source of truth for `spec` in `sm version`
console.log(specIndex.indexPayloadVersion); // → "0.0.1" (payload shape of `index.json` itself; bumps only when this manifest's structure changes)
console.log(specIndex.integrity.algorithm); // → "sha256"
console.log(nodeSchema.$id);                // → "https://skill-map.ai/spec/v1/node.schema.json"
```

Every JSON Schema is exported individually via `@skill-map/spec/schemas/*.json`. Prose documents ship in the tarball but are not `exports`-surfaced.

### Verify integrity

The package ships `index.json` with a sha256 per file. To verify a local install matches what was published:

```js
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import index from '@skill-map/spec';

const file = 'schemas/node.schema.json';
const actual = createHash('sha256').update(readFileSync(`node_modules/@skill-map/spec/${file}`)).digest('hex');
console.log(actual === index.integrity.files[file] ? 'ok' : 'drift');
```

### JSON Schema Store

The schemas register on JSON Schema Store once the canonical URLs under `skill-map.ai/spec/v1/` are stable.

## License

MIT. See `../LICENSE`.
