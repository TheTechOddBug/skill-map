/**
 * Provider runtime contract. Walks filesystem roots and emits raw node
 * records; classification maps path conventions to a node kind.
 *
 * Distinct from the **hexagonal-architecture** 'adapter'
 * (`StoragePort.adapter`, etc.). A `Provider` is an extension kind authored
 * by plugins to declare a platform's universe (the catalog of kinds it
 * emits, the per-kind frontmatter schema, the filesystem directory it
 * owns); a hexagonal adapter is an internal implementation of a port.
 * Both can coexist without confusion because they live in different
 * namespaces.
 *
 * `walk()` is an async iterator so large scopes don't buffer in memory.
 * Each yielded `IRawNode` carries the full parsed frontmatter + body plus
 * the path relative to the scan root; the kernel computes hashes, bytes,
 * and tokens on top.
 *
 * **Structure-as-truth**: each plugin carries at most one Provider, declared
 * as `<plugin>/provider.ts`. The kinds catalog lives as folders under
 * `<plugin>/kinds/<kindName>/`; each kind folder contains `schema.json`
 * (the frontmatter JSON Schema) and `kind.json` (UI metadata). The loader
 * discovers each entry by walking the directory and populates the runtime
 * `kinds` map below. The manifest itself NO LONGER carries a `kinds` map
 * or a `defaultRefreshAction` field (the UI's Refresh button consumer was
 * retired alongside it; the replacement TBD).
 */

import type { IExtensionBase, IBuiltInManifest } from './base.js';
import type { IIgnoreFilter } from '../scan/ignore.js';
import type { IParseIssue } from '../scan/parsers/types.js';
import { walkContent } from '../scan/walk-content.js';
import type { LinkKind } from '../types.js';
import type { TMcpConfigDialect } from '../util/mcp-config.js';

export interface IRawNode {
  /** Path relative to the scan root that produced this node. */
  path: string;
  /** Raw markdown body (everything after the frontmatter fence). */
  body: string;
  /** Raw frontmatter text (between `---` fences). Empty string when absent. */
  frontmatterRaw: string;
  /** Parsed frontmatter, or `{}` when absent / unparseable. */
  frontmatter: Record<string, unknown>;
  /**
   * `true` when the parser recognised a DECLARED frontmatter block, even
   * an empty one (`---`, blank line, `---`). Disambiguates
   * `frontmatterRaw: ''` so the orchestrator can run the per-kind AJV
   * validation on a declared-but-empty block instead of treating it as
   * "no frontmatter". Optional: a Provider with a custom `walk()` that
   * never sets it falls back to the historic `frontmatterRaw.length > 0`
   * discriminator in `node-build`.
   */
  frontmatterDeclared?: boolean;
  /**
   * Number of file lines preceding the first `body` line (frontmatter
   * block, fences included), parser-owned (see
   * `IParsedFile.bodyLineOffset`). The orchestrator adds it to
   * body-relative line tracking so persisted `link.location.line` and
   * finding `L<n>` prefixes are FILE-absolute, matching the author's
   * editor. Omitted (`0`) when the body is the whole file, when a
   * `bodyField` swap makes a file-absolute line undefined, or by custom
   * `walk()` Providers that don't track it.
   */
  bodyLineOffset?: number;
  /**
   * File modification time (`mtime`) in Unix milliseconds, captured by
   * the kernel walker from the same `lstat` that guards the read (zero
   * extra syscalls). Threaded onto the persisted `Node` as
   * `modifiedAtMs`. Optional: a Provider that ships its own `walk()` and
   * does not stat its sources MAY omit it; virtual / derived nodes carry
   * no file and never set it.
   */
  modifiedAtMs?: number;
  /**
   * Parser diagnostics (audit L1). Populated by the walker when the
   * parser surfaced `IParseIssue` entries (e.g. malformed YAML).
   * Carried through `processRawNode` and converted into warn-level
   * kernel `Issue` rows inside `buildFreshNodeAndValidateFrontmatter`.
   * Empty / undefined on the happy path.
   */
  parseIssues?: readonly IParseIssue[];
  /**
   * Incremental-walk fast path. `true` when the walker matched this
   * file's on-disk `mtime` against the prior scan snapshot (via
   * `IProviderWalkOptions.priorMtimes`) and SKIPPED reading + parsing the
   * body, the dominant per-file cost. For such a record `body` /
   * `frontmatter` / `frontmatterRaw` are empty placeholders: the
   * orchestrator reuses the prior node verbatim and reads the body
   * (through `reread`) ONLY when a sidecar change forces re-extraction.
   * Absent / `false` means a normal record whose body was read eagerly.
   */
  unchanged?: boolean;
  /**
   * Present only on an `unchanged` record: a lazy reader that performs
   * the deferred `readFile` + parse and returns the body / frontmatter
   * the walker skipped. The orchestrator calls it only when it must
   * actually re-extract (a sidecar edit on an otherwise-unchanged file).
   * Keeps the read + parse logic in the walker (single source) rather
   * than duplicating it in the orchestrator.
   */
  reread?: () => Promise<
    Pick<
      IRawNode,
      'body' | 'frontmatterRaw' | 'frontmatter' | 'parseIssues' | 'frontmatterDeclared' | 'bodyLineOffset'
    >
  >;
}

/**
 * Runtime descriptor of one Provider kind, populated by the loader from
 * the structure under `<plugin>/kinds/<kindName>/`. The loader reads
 * `schema.json` from the kind folder, parses it once, attaches the path
 * (for diagnostics) and the parsed object (for AJV registration), and
 * reads `kind.json` for the UI metadata. The runtime descriptor lives in
 * memory; no field in this shape comes from the Provider manifest itself
 * since the structure-as-truth refactor.
 */
export interface IProviderKind {
  /**
   * Path to the kind's frontmatter JSON Schema, relative to the Provider's
   * package directory. Always `kinds/<kindName>/schema.json` under the new
   * layout. Kept on the descriptor for diagnostics (file references in
   * error messages, doctor reports).
   */
  schema: string;
  /**
   * Loaded JSON Schema document for the kind. The kernel registers this
   * with AJV at scan boot and validates each node's frontmatter against
   * it. The schema MUST extend the spec's
   * `frontmatter/base.schema.json` via `allOf` + `$ref` to base's `$id`;
   * the loader registers base into the same AJV instance so cross-package
   * `$ref`-by-`$id` resolves transparently.
   */
  schemaJson: unknown;
  /**
   * Presentation metadata the UI consumes to render nodes of this kind
   * (palette swatches, list tags, graph nodes, filter chips). Read from
   * `kinds/<kindName>/kind.json#/ui`. Required so the UI never has to
   * invent visuals for a Provider-declared kind.
   */
  ui: IProviderKindUi;
  /**
   * Priority-ordered list of identifier sources the post-walk resolver
   * uses to derive this kind's canonical name(s). Each entry contributes
   * one normalized name to the name index built by
   * `liftResolvedLinkConfidence`; multiple sources accumulate (e.g. a
   * skill with `name: foo` AND dirname `foo` yields one entry, a skill
   * with `name: bar` and dirname `foo` yields two).
   *
   * Defaults to `[]` (no name-resolvable). Source semantics:
   *
   *   - `'frontmatter.name'`, read `node.frontmatter.name`. Required-name
   *     kinds (`agent`, `command`, `skill` per their schemas) typically
   *     declare this first.
   *   - `'filename-basename'`, `basename(path)` without the extension.
   *     For Claude/OpenAI agents and commands the filename IS the
   *     invocation handle when `name:` is absent.
   *   - `'dirname'`, `basename(dirname(path))`. Anthropic skills +
   *     agent-skills (open standard, also adopted by Antigravity)
   *     resolve to the directory between the skills root and the
   *     SKILL.md (e.g. `.claude/skills/foo/SKILL.md` → `foo`).
   *
   * Compare with `IProvider.resolution` (which declares which target
   * kinds resolve which link.kind): `identifiers` is a per-kind detail
   * about WHERE the name lives; `resolution` is a per-provider strict
   * matrix about WHICH kinds count as resolution for a given link.kind.
   */
  identifiers?: TIdentifierSource[];
  /**
   * Severity of the `core/name-mismatch` issue emitted when a node's
   * NORMALISED `frontmatter.name` diverges from a declared path-derived
   * identifier (`filename-basename` / `dirname`), giving the node two
   * live names in the resolution index. Absent = no diagnostic. External
   * `kind.json` files declare `identifiers` / `identifierMismatch`
   * directly (both are optional keys on `provider-kind.schema.json`), so
   * a drop-in Provider reaches the same name-resolution lane a built-in
   * gets from this TypeScript field. `'warn'` when the kind's standard
   * REQUIRES agreement (the
   * open-standard skill kind mandates name == parent dirname); `'info'`
   * when the runtime documents the divergence as a legal override yet
   * the dual identity is still worth surfacing. Normative wording:
   * `spec/architecture.md` §Provider · kind identifiers · Identifier
   * agreement.
   */
  identifierMismatch?: 'warn' | 'info';
}

/**
 * Sources the post-walk confidence-lift transform consults to derive a
 * node's canonical name. Closed set: extending it is a spec + kernel
 * change. Order is meaningful inside `IProviderKind.identifiers`, the
 * resolver visits sources in declaration order, but the resulting index
 * is presence-based so multiple matches collapse.
 */
export type TIdentifierSource =
  | 'frontmatter.name'
  | 'filename-basename'
  | 'dirname';

/**
 * Presentation contract for one Provider kind. The Provider declares
 * intent (label + base color, optional dark variant + emoji + icon);
 * the UI derives `bg`/`fg` tints per theme via a deterministic helper
 * and reads the registry from the `kindRegistry` field embedded in REST
 * envelopes. Single source of truth for what a kind looks like, the
 * UI never hardcodes presentation for a built-in kind.
 */
export interface IProviderKindUi {
  /**
   * Plural human-readable label for groups of this kind (e.g. `'Skills'`,
   * `'Agents'`, `'Cursor Rules'`). Used in filter dropdowns, palette
   * tooltips, and any list grouping.
   */
  label: string;
  /**
   * Base hex color (`#RRGGBB`) for the light theme. The UI derives `bg`
   * and `fg` tints from this value at runtime via a deterministic
   * helper. Declaring one base value (instead of three) keeps the
   * manifest small and centralises accessibility-driven contrast in the
   * UI.
   */
  color: string;
  /**
   * Optional dark-theme variant of `color`. When absent, the UI falls
   * back to `color`. Declared explicitly because a luminosity flip
   * rarely matches the brand intent for kinds that should stand out in
   * dark mode.
   */
  colorDark?: string;
  /**
   * Optional decorative emoji used as a fallback when `icon` is absent
   * or fails to render. Length-bound so the UI can lay it out
   * predictably alongside text.
   */
  emoji?: string;
  /**
   * Optional discriminated icon descriptor. The UI prefers `icon` over
   * `emoji`; when both are absent, the UI falls back to the first
   * letter of `label` colored with `color`.
   */
  icon?: TProviderKindIcon;
}

/**
 * Discriminated icon contract. `pi` references a PrimeIcons identifier
 * (e.g. `'pi-cog'`); `svg` carries raw SVG path data the UI wraps in a
 * `<svg viewBox="0 0 24 24"><path d="…"/></svg>` element tinted with
 * `currentColor`. The discriminator (`kind`) keeps the UI dispatch
 * exhaustive without string-sniffing the payload.
 */
export type TProviderKindIcon =
  | { kind: 'pi'; id: string }
  | { kind: 'svg'; path: string };

/**
 * Presentation contract for the Provider's OWN identity, distinct from
 * its per-kind visuals (`IProviderKindUi`). Drives the active-lens
 * dropdown label, the topbar lens chip, and the per-node provider chip
 * on cards. Reaches the UI via the `providerRegistry` field embedded in
 * REST envelopes (sibling of `kindRegistry`). Unlike kind colors
 * (normalised across Providers so every `agent` paints the same),
 * Provider colors are deliberately distinct so the chip tells the user
 * at a glance which platform a node came from. Mirrors
 * `spec/schemas/extensions/provider.schema.json#/properties/ui`.
 */
export interface IProviderUi {
  /**
   * Human-readable Provider name shown in the lens dropdown, the topbar
   * lens chip, and the per-node provider chip. Vendor lenses use a
   * possessive `<Vendor>'s <product>` form (`"Anthropic's Claude"`,
   * `"OpenAI's Codex"`, `"Google's Antigravity"`); the vendor-neutral open
   * standard uses a `'Standard: <name>'` prefix (`'Standard: Agent skills'`).
   * The non-gated `'Markdown'` base keeps a label for internal lookups but
   * is never a selectable lens.
   */
  label: string;
  /** Base hex color (`#RRGGBB`) for the light-theme provider chip. */
  color: string;
  /** Optional dark-theme variant of `color`. Falls back to `color`. */
  colorDark?: string;
  /** Optional decorative emoji fallback when `icon` is absent. */
  emoji?: string;
  /** Optional discriminated icon descriptor (preferred over `emoji`). */
  icon?: TProviderKindIcon;
  /**
   * When `true`, the UI does NOT paint this Provider's chip on node
   * cards. Reserved for the universal `markdown` fallback (carried by
   * the majority of nodes, so badging every generic `.md` would be
   * noise). The Provider still appears in the lens dropdown and the
   * topbar lens chip; only the per-card badge is suppressed.
   */
  hideChip?: boolean;
  /**
   * Single glyph this lens's runtime uses to invoke a skill / command,
   * surfaced as the `invokes` edge-kind glyph (and its tooltip example)
   * in the link-kind palette so the operator recognises the source
   * syntax instantly. `/` for the slash-invoking lenses (`claude`
   * commands + skills, `antigravity` skills + workflows), `$` for
   * `codex` (skills are `$skill`; `/` is reserved for Codex's own
   * built-in commands). Omitted for lenses with no `/`/`$` invocation
   * channel (the open-standard `agent-skills`, where skills activate by
   * `description`, and the non-lens `markdown` base): under those no
   * `invokes` edge arises, so the palette never paints the glyph.
   * Projected into `providerRegistry` and joined client-side against
   * the active lens.
   */
  invocationSigil?: string;
}

/**
 * Auto-detection markers for the active-provider lens. The lens resolver
 * checks each marker path (relative to the scope root) and, when present,
 * suggests this Provider as a candidate lens. Replaces the former
 * hardcoded detection table: the detectable set now derives from the
 * registered Providers. Mirrors
 * `spec/schemas/extensions/provider.schema.json#/properties/detect`.
 */
export interface IProviderDetect {
  /**
   * Paths relative to the scope root whose existence signals this
   * Provider's presence (e.g. `['.claude']`, `['.codex', 'AGENTS.md']`).
   * A directory or a file both count; existence is the only test.
   */
  markers: string[];
  /**
   * When `true`, this Provider is the open-standard FALLBACK lens: its
   * markers produce a detection candidate ONLY when no non-fallback
   * (vendor) Provider matched under the same scope. Reserved for
   * `agent-skills`, whose `.agents/` marker is the shared skill home that
   * vendor lenses (`codex`, `antigravity`) also populate; without this flag
   * a `.codex/` + `.agents/` project would falsely read as an ambiguous
   * `codex` vs `agent-skills` pair. Vendor Providers omit it (default
   * `false`) so two vendor markers still surface a real ambiguous prompt.
   * Mirrors `provider.schema.json#/properties/detect/properties/fallback`.
   */
  fallback?: boolean;
  /**
   * Provider ids whose detection candidate this Provider ABSORBS when both
   * matched under the same scope root: a one-way "I read that runtime's
   * territory too" relation. `opencode` declares `['claude']` because
   * OpenCode's Claude-compat reads `.claude/skills/` + `CLAUDE.md`, so a
   * `.claude/` directory is expected inside an OpenCode project and is not
   * evidence Claude Code is in use, while Claude Code never reads
   * `.opencode/`. Applied after the `fallback` rule, so it only ever
   * collapses a would-be ambiguous prompt into an unambiguous auto-detect;
   * a mutual pair keeps the ambiguity rather than tie-breaking arbitrarily.
   * Mirrors `provider.schema.json#/properties/detect/properties/subsumes`.
   */
  subsumes?: string[];
}

/**
 * Authoring targets for verbs that MATERIALISE files into this
 * Provider's on-disk territory (today only `sm tutorial`). The WRITE
 * counterpart to `detect` (which READS markers to suggest a lens) and
 * `classify` (which READS paths during a scan). Mirrors
 * `spec/schemas/extensions/provider.schema.json#/properties/scaffold`.
 */
export interface IProviderScaffold {
  /**
   * Directory (relative to the scope root) under which a materialising
   * verb writes a skill folder, e.g. `.claude/skills` for Claude,
   * `.agents/skills` for the open standard. The verb appends
   * `/<skillName>/SKILL.md`. Relative, no leading slash, no `..`
   * traversal; the consuming verb joins it onto the cwd.
   */
  skillDir: string;
  /**
   * Optional directory the materialising verb creates so the active-lens
   * resolver picks THIS Provider when its `skillDir` is shared with another
   * lens. The open `.agents/skills` territory is read by several lenses
   * (`agent-skills`, `antigravity`, `codex`); a Provider whose skillDir is
   * that shared territory but whose lens needs a distinct marker (Codex's
   * `.codex`) declares it here, and `sm tutorial --for <id>` drops the marker
   * alongside the skill. Omitted when the skillDir's parent IS the marker.
   */
  marker?: string;
  /**
   * Display-only hints naming the agents that consume this scaffold
   * territory AND share its tutorial track, rendered in parentheses next to
   * the Provider label in the `sm tutorial` destination prompt. Purely
   * presentational: NOT matched by `--for` (only registered Provider ids
   * are) and has no runtime effect.
   */
  aka?: readonly string[];
  /**
   * Qualified id of the Provider that OWNS this `skillDir` when the
   * territory is shared. Declared CONSUMER-side (like the `COMMONS_KINDS`
   * composition it mirrors): `antigravity` and `opencode` both READ the
   * open `.agents/skills` territory that `agent-skills` owns, so they name
   * it here instead of duplicating ownership.
   *
   * It splits the two questions `scaffold` answers. Verbs that offer a
   * DESTINATION CHOICE (`sm tutorial`) list owners only, so one territory
   * stays one row; per-lens probes that ask "does THIS lens support / have
   * the skill?" (`sm agent install / status`, `GET /api/agent/install`, the
   * Quick Start row) resolve a sharing lens normally, because a skill
   * materialised there IS discovered by its runtime. Omitted when the
   * Provider owns its `skillDir`.
   */
  sharedWith?: string;
}

/**
 * Optional MCP config-discovery capability (see `spec/architecture.md`
 * §Provider · MCP config discovery). Declares WHERE this Provider's MCP server
 * config lives and in which dialect; the kernel reads + parses each source once
 * per scan (shared `kernel/util/mcp-config`) and materialises one virtual
 * `mcp://<server>` node per declared server. The Provider owns the filesystem
 * territory; the parsing stays in core so a new vendor onboards by naming a file
 * + dialect. Mirrors
 * `spec/schemas/extensions/provider.schema.json#/properties/mcpConfig`.
 */
export interface IProviderMcpConfig {
  /** One or more config files to read for declared MCP servers. */
  readonly sources: readonly IProviderMcpConfigSource[];
}

export interface IProviderMcpConfigSource {
  /**
   * Config file path, relative to the scope root (e.g. `.mcp.json`,
   * `.codex/config.toml`). Project-local; a home-scoped source would extend the
   * documented `os.homedir()` allowlist and is not supported here yet.
   */
  readonly path: string;
  /** Which config grammar the file uses. */
  readonly dialect: TMcpConfigDialect;
}

/**
 * Optional MCP REGISTRATION recipe (see `spec/architecture.md` §Provider · MCP
 * registration), the write-side mirror of `mcpConfig`: how an operator declares
 * skill-map's OWN MCP server to this Provider's runtime. Travels verbatim in the
 * BFF `providerRegistry` so the UI's Copy affordance is driven by the registered
 * Provider set instead of a client-side catalog; a Provider that declares
 * nothing falls back to the bare endpoint URL. `{{url}}` is the only
 * placeholder, substituted by the consumer with the live MCP endpoint. Mirrors
 * `spec/schemas/extensions/provider.schema.json#/properties/mcpRegister`.
 */
export type TProviderMcpRegister =
  | {
      /** The runtime ships an `mcp` CLI verb: registration is one shell line. */
      readonly kind: 'command';
      readonly command: {
        /** Shell command carrying `{{url}}` at least once. */
        readonly template: string;
      };
      readonly config?: never;
    }
  | {
      /** No `mcp` verb: registration means saving a JSON document. */
      readonly kind: 'config';
      readonly config: {
        /**
         * Where the document goes, shown as the paste hint. Display only:
         * skill-map never writes it, which is why a `~/` target is legitimate
         * here and leaves the never-read-$HOME invariant untouched.
         */
        readonly target: string;
        /** A COMPLETE config document; `{{url}}` substituted at any depth. */
        readonly document: Readonly<Record<string, unknown>>;
      };
      readonly command?: never;
    };

/**
 * Phase of one live-activity signal. `start` lights the resolved node;
 * `end` is emitted only for units whose provider runtime has a native
 * terminal event (a Claude subagent's matching `SubagentStop`). Units
 * with no native end (a Claude skill) simply never emit `end`; the UI
 * owns span decay (TTL). Mirrors `spec/provider-activity.md` §WS event.
 */
export type TActivityPhase = 'start' | 'end';

/**
 * Spawn-relation block riding an activity signal (see
 * `spec/provider-activity.md` §The `provider.activity` capability and
 * §WS event: `agent.spawn`). Produced by the spawning tool call's
 * events; the BFF turns each block into ONE stateless `agent.spawn`
 * frame, resolving `childKind`/`childName` through the same
 * identifiers contract name signals use. The Provider names the
 * relation; it does NOT resolve nodes.
 */
export interface IActivitySpawnRelation {
  /**
   * Opaque per-spawn correlation id: the RAW spawning tool-call id,
   * never a synthetic owner key (`spawn:<id>`), nothing downstream
   * parses owner strings.
   */
  spawnId: string;
  /**
   * `start` at the spawn call; `handoff` when an async child's own
   * owner id becomes known; `end` when the spawn completed with no
   * live child (sync spawns, or a completion arriving after the child
   * already stopped).
   */
  phase: 'start' | 'handoff' | 'end';
  /**
   * Owner key of the spawning context (an agent id, or the sessionized
   * main key). Opaque to consumers; the structural discriminator for a
   * session parent is the ABSENT `parentNodePath` on the resolved
   * frame, never the owner string.
   */
  parentOwner: string;
  /** Child unit kind as the runtime named it (`agent` today). */
  childKind?: string;
  /** Child unit name as the runtime named it (resolved downstream). */
  childName?: string;
  /** The child context's own owner id, known from `handoff` on. */
  childOwner?: string;
  /**
   * Parent -> child conversation half, carried on `start`. NEVER rides
   * the WS; retained only under the capture gate
   * (`spec/provider-activity.md` §Conversation capture).
   */
  prompt?: string;
  /**
   * Child -> parent conversation half, carried on a sync `end` (the
   * runtime returned the child's final report as a string). Same
   * capture-gate custody as `prompt`.
   */
  response?: string;
  /**
   * Aggregate execution summary of the completed child run, when the
   * runtime reports one (Claude: sync completions only). METADATA
   * (plain numbers), so unlike `prompt` / `response` it rides outside
   * the capture gate's content rules, feeding per-node aggregates and
   * retained records alike.
   */
  execution?: IActivitySpawnExecution;
}

/**
 * Aggregate execution summary of one completed child run, as reported
 * by the runtime's completion payload. Every field optional: providers
 * extract defensively and omit what the payload does not carry.
 */
export interface IActivitySpawnExecution {
  /** Total wall-clock of the child run, milliseconds. */
  durationMs?: number;
  /** Total tokens consumed by the child run. */
  tokens?: number;
  /** Total tool invocations the child run made. */
  toolUses?: number;
}

/**
 * One node-attributable signal derived from a single raw provider hook
 * payload by `IProviderActivityAdapter.mapEvent`. The Provider names the
 * unit in ONE of two forms (see `spec/provider-activity.md`); it does
 * NOT resolve nodes:
 *
 * - **By name** (`kind` + `name`): the BFF resolves `(kind, name)`
 *   against the scanned node set through the same `kinds[*].identifiers`
 *   contract link resolution uses.
 * - **By path** (`path`, scope-relative, forward-slash): used when the
 *   runtime reports a FILE rather than a named unit (a markdown read via
 *   the provider's file-read tool). Path signals match the scanned node
 *   with that exact `path` ACROSS providers and kinds, the path already
 *   identifies one node unambiguously. When `path` is present, `kind` /
 *   `name` are ignored.
 *
 * Signals that resolve to no scanned node are dropped either way.
 *
 * A third, RELATION-ONLY form carries `spawn` + `owner` + `phase` with
 * NO `kind`/`name`/`path`: a spawn happening in a context that is not
 * itself a node (the main session spawning a subagent). There is no
 * parent node to claim, but the relation still matters; the resolver
 * emits one `agent.spawn` frame and no `node.activity` event.
 */
export interface IActivitySignal {
  /** Node kind the unit belongs to (`skill`, `agent`, `command`, ...). Required unless `path` is set. */
  kind?: string;
  /** Raw unit name as the runtime reported it (normalised by the resolver). Required unless `path` is set. */
  name?: string;
  /**
   * Optional finer-grained label for WHAT this signal represents beneath the
   * node itself, e.g. the specific MCP tool invoked (`notion-create-pages`) on
   * an `mcp://<server>` node. Metadata only: it rides `node.activity` to the UI
   * (glow label + the per-node recent history) and is stored in the recent
   * ring; it is NEVER used for resolution. Absent when the runtime reports no
   * finer detail.
   */
  detail?: string;
  /**
   * Scope-relative node path (forward-slash). When present, resolution
   * is a direct `node.path` match and `kind` / `name` are ignored.
   */
  path?: string;
  /**
   * Adapter-declared access class for a PATH signal (spec
   * `provider-activity.md` field list, 2026-08-17): `'write'` when the
   * vendor tool wrote / edited the file (Claude `Write` / `Edit`,
   * Antigravity `write_to_file`, ...). Omit for reads; the resolver
   * defaults any unstamped non-`mcp://` path signal to `"read"` and
   * derives `"mcp"` from the path prefix regardless. Ignored on NAME
   * signals (a unit's own execution carries no access class).
   */
  access?: 'read' | 'write' | 'shell';
  /** Signal phase, see `TActivityPhase`. */
  phase: TActivityPhase;
  /**
   * Opaque identifier of the executing context (`'main'`, an agent id,
   * a session id, provider-dependent). Consumers treat it as a grouping
   * key only; absent when the runtime reports none.
   */
  owner?: string;
  /**
   * Opaque session identifier the executing context belongs to. Groups
   * every owner (the main context AND the subagents it spawned) under one
   * session so a `sessionScope` end can release them together. Rides the
   * frame; consumers build an `owner -> session` map from the signals
   * that carry both. Absent when the runtime reports no session id.
   */
  session?: string;
  /**
   * Only meaningful on `phase: 'end'`: `true` when the signal marks the
   * end of a WHOLE SESSION (a runtime's turn ended), releasing EVERY
   * owner grouped under `session`. The safety net for runtimes that drop
   * a subagent's own `ownerScope` end (Codex, live-verified 2026-07-24:
   * a subagent that itself spawns a nested worker never gets its
   * `SubagentStop`, so only the main-context `Stop` unwinds it). Node-less
   * like the owner-release form; `session` is REQUIRED for it to mean
   * anything.
   */
  sessionScope?: boolean;
  /**
   * Only meaningful on `phase: 'end'`: `true` when the signal marks the
   * end of the OWNER'S WHOLE EXECUTION CONTEXT (a subagent terminating),
   * not just of the named node. Consumers release every claim held by
   * that `owner`, so the units the context lit along the way (the
   * skills it invoked, the markdowns it read) go dark with it instead
   * of waiting out their decay.
   *
   * OWNER-RELEASE form: an ownerScope end MAY omit `kind`/`name`/`path`
   * entirely when the runtime reports a context end with no node to
   * hang it on (Antigravity's `Stop`: conversations are not nodes).
   * The resolver forwards it as a node-less release instead of
   * resolving; `owner` is REQUIRED for the form to mean anything.
   */
  ownerScope?: boolean;
  /**
   * Only meaningful on `phase: 'end'` with an `owner`: `true` when the
   * owner's TURN completed (a `napping` runtime's main context reporting
   * a real turn boundary, e.g. Claude's main `Stop`). A sync spawn call
   * cannot outlive its caller's turn, so consumers release every
   * relation that owner PARENTS whose child identity never materialized
   * (no `childOwner`), the shape an interrupted or failed spawn call
   * leaves behind. Async relations and the owner's node claims are
   * untouched (NOT an `ownerScope` release). Node-less like the
   * owner-release form. `spec/provider-activity.md` §WS event:
   * `node.activity`.
   */
  turnEnd?: boolean;
  /**
   * Only meaningful on `phase: 'start'`: `true` for LIFECYCLE claims
   * (an agent's own span, a parent held lit by a running child), which
   * get a much longer decay window than momentary usage claims. Sticky
   * claims are meant to end via `ownerScope` ends; the long window is a
   * safety net against a crashed runtime that never sends one.
   */
  sticky?: boolean;
  /**
   * Only meaningful on `phase: 'start'`: `true` for CUSTODY claims (a
   * parent held lit through a spawn). Keep-alive starts light and
   * refresh nodes exactly like any other start but are EXCLUDED from
   * execution counting (`spec/provider-activity.md` §Execution stats):
   * custody is not an execution of the named unit.
   */
  keepAlive?: boolean;
  /**
   * Spawn-relation block riding the signal produced by the spawning
   * tool call. On a node-carrying signal the resolved node becomes the
   * frame's `parentNodePath`; combined with NO `kind`/`name`/`path` it
   * forms the RELATION-ONLY signal (see the interface docstring).
   */
  spawn?: IActivitySpawnRelation;
  /**
   * Only meaningful on `phase: 'end'` BOUNDARY signals: the ending
   * context's final message, as the runtime reported it on its stop
   * event (Claude: `last_assistant_message`). CONTENT, not metadata:
   * it never rides the WS; the BFF hands it to the conversation store
   * only under the capture gate, where it completes the response half
   * of async spawns by matching the record's `childOwner`. Stop events
   * fire on pause too; consumers overwrite, so the terminal message
   * wins.
   */
  report?: string;
}

/**
 * Declarative install descriptor consumed by `sm activity install
 * <provider>`: where the provider's PROJECT-LOCAL hook config lives and
 * which install shape applies. Discriminated on `kind` so each shape
 * carries ONLY the fields that parameterize it, mirroring the schema's
 * per-kind gate in
 * `extensions/provider.schema.json#/properties/activity/properties/install`
 * (a `plugin-file` descriptor with wiring knobs is invalid there too).
 */
export type TActivityInstall = IActivityInstallJsonHooks | IActivityInstallPluginFile;

/** Fields shared by every install shape. */
export interface IActivityInstallBase {
  /**
   * Path of the provider's hook config file (`json-hooks`) or the plugin
   * file to write (`plugin-file`), relative to the scope root. No leading
   * slash, no `..` traversal; the consuming verb joins it onto the cwd.
   */
  configPath: string;
}

/**
 * `json-hooks`: merge hook entries that spawn the activity bridge
 * command into a JSON settings/hooks file.
 */
export interface IActivityInstallJsonHooks extends IActivityInstallBase {
  kind: 'json-hooks';
  /**
   * The provider lifecycle events to wire the bridge into, with an
   * optional per-event matcher in the provider runtime's own matcher
   * grammar. Only the events `mapEvent` actually consumes belong here,
   * every wired event spawns one bridge process at runtime, so a tight
   * list keeps the overhead proportional to the signal.
   */
  events?: readonly IActivityInstallEvent[];
  /**
   * NAMED-GROUP document shape (Antigravity's `.agents/hooks.json`):
   * the top-level group key skill-map owns in the hook document.
   * Claude / Codex nest the event map under the vendor's fixed `hooks`
   * key (operator entries coexist inside, marker-filtered);
   * Antigravity's document maps GROUP NAMES to event maps, so skill-map
   * writes its entries under its own group and uninstall removes exactly
   * that group. Omitted = the conventional `hooks` container. The inner
   * per-event shape is identical either way.
   */
  group?: string;
  /**
   * Working directory the provider runtime spawns hook commands with,
   * which decides how the bridge command's SCRIPT PATH is written into
   * the config. `'scope-root'` (default, Claude / Codex): the runtime
   * spawns at the project root, so the plain scope-relative bridge path
   * resolves. `'config-dir'` (Antigravity, live-verified 2026-07-04):
   * the runtime spawns at the hook config's OWN directory, so the
   * installer prefixes the relative hops from `dirname(configPath)`
   * back to the root (e.g. `node ../.skill-map/activity/bridge.js`).
   * The bridge itself derives its scope root from its installed
   * location, never from the spawn cwd, so this only affects command
   * path resolution.
   */
  commandCwd?: 'scope-root' | 'config-dir';
  /**
   * Name of an environment variable the runtime sets to the PROJECT ROOT
   * when it spawns a hook command, if it provides one (Claude Code:
   * `CLAUDE_PROJECT_DIR`, per its changelog "Hooks: Added
   * CLAUDE_PROJECT_DIR env var for hook commands"). When declared, the
   * installer anchors the bridge path on it and `commandCwd` is ignored,
   * because the path is then absolute at spawn time.
   *
   * Prefer this over the cwd-relative form wherever the runtime offers
   * it. The relative form assumes the hook is spawned at the project
   * root, and that assumption is not stable within a single session: an
   * agent that changes directory while working (the Bash tool's cwd
   * persists between calls) makes every later hook resolve against the
   * subdirectory, so ingestion stops with a `MODULE_NOT_FOUND` naming a
   * path the operator never wrote.
   *
   * An absolute literal would fix the cwd problem and break a worse one:
   * these hook configs are routinely committed, so a baked
   * `/home/<someone>/...` breaks every teammate. The variable keeps the
   * config portable AND cwd-immune, which is why it is the right shape
   * rather than merely a convenient one.
   */
  projectDirEnvVar?: string;
}

/**
 * `plugin-file`: write an in-process plugin file that POSTs to the
 * ingest route directly (no spawn). Carries NO wiring knobs: the
 * hook-registration half is the adapter's `pluginHooksSource` (code,
 * never manifest data).
 */
export interface IActivityInstallPluginFile extends IActivityInstallBase {
  kind: 'plugin-file';
}

/** One provider hook event to wire the bridge into (`json-hooks` installs). */
export interface IActivityInstallEvent {
  /** Provider runtime event name, verbatim (e.g. `PreToolUse`). */
  event: string;
  /**
   * Optional matcher in the provider's own grammar (e.g. a Claude tool
   * regex `^(Skill|Agent)$`). Omitted = the event's match-all form.
   */
  matcher?: string;
  /**
   * Marks the event as OPT-IN (spec `provider.schema.json`): the
   * install renders it only when the matching operator choice is on
   * (`'shell'` -> the project-local `activity.shellCapture` key, set by
   * `sm activity install --shell`; provider-activity.md, Capture level
   * rung 5). Omitted = always rendered.
   */
  optIn?: 'shell';
  /**
   * Entry shape the runtime expects for THIS event's array. `'wrapped'`
   * (default): the `{ matcher?, hooks: [{ type, command }] }` group
   * every tool event uses. `'flat'`: a bare `{ type, command }` command
   * entry, the shape Antigravity's lifecycle events (PreInvocation /
   * PostInvocation / Stop) take (its parser rejects the wrapped form
   * there). Matchers do not apply to flat entries.
   */
  entryShape?: 'wrapped' | 'flat';
}

/**
 * Optional live-activity capability (see `spec/provider-activity.md`).
 * Declared by Providers whose runtime exposes a hook system that reports
 * skill / agent / command invocations in real time. Like `scaffold`, a
 * provider-owned capability sub-object, NOT a new extension kind. This
 * surface is UNRELATED to skill-map's internal `hook` extension kind
 * (scan lifecycle); provider activity consumes an EXTERNAL event source.
 */
export interface IProviderActivityAdapter {
  /** Declarative install descriptor, the manifest (JSON) half. */
  install: TActivityInstall;
  /**
   * How the runtime holds custody while a spawned child runs, which
   * decides what an OWNER-SCOPED END means for the spawns that owner
   * PARENTS (see `spec/provider-activity.md` §Spawn custody).
   *
   * - `napping` (default, Claude's shape): the parent may idle while
   *   its child works, so its owner-scoped end is ambiguous and counts
   *   as a pause while it still parents a live spawn.
   * - `blocking` (OpenCode's shape): the parent blocks inside the spawn
   *   call and cannot report idle mid-spawn, so an owner-scoped end
   *   from it is TERMINAL and releases the spawns it parents too.
   *
   * The resolver projects it onto the wire as `terminal: true` on the
   * owner-release frame. Without it, a spawn whose completion never
   * arrives (a refused or crashed call, e.g. OpenCode refusing a nested
   * `task`) stays drawn until the client's decay sweep.
   */
  spawnCustody?: 'blocking' | 'napping';
  /**
   * Runtime half (TypeScript-only, never in the manifest JSON, mirroring
   * `classify()` / `walk()`): turn ONE raw provider hook payload into
   * zero or more activity signals, or `null` to disclaim the event.
   * MUST be pure and total over arbitrary input (the payload arrives
   * from an external process verbatim); throwing is treated as a
   * disclaim by the caller.
   */
  mapEvent(raw: unknown): IActivitySignal[] | null;
  /**
   * Second runtime half, REQUIRED when `install.kind === 'plugin-file'`
   * (the install engine refuses to render without it) and meaningless
   * otherwise: the hook-registration source spliced into the generated
   * in-process plugin. The engine's template
   * (`core/activity/plugin-template.ts`) owns the ENVELOPE (header
   * marker, `serve.json` discovery, scope + loopback + token checks,
   * fetch timeout, never-throw); this source is the body of the
   * plugin's returned hooks map, one
   * `'<hook>': async (...) => { await forward('<hook>', {...}); },`
   * entry per hook `mapEvent` consumes, including any wiring-level
   * filters that keep high-frequency host traffic from ever leaving
   * the process. Payload knowledge exactly like `mapEvent`: it lives
   * with the Provider, never in the manifest and never in core.
   */
  pluginHooksSource?: string;
}

export interface IProvider extends IExtensionBase {
  /** Discriminant injected by the loader from the folder structure. */
  kind: 'provider';

  /**
   * Presentation metadata for the Provider's own identity (lens dropdown
   * label, topbar lens chip, per-node provider chip). Required so the UI
   * never hardcodes a closed provider list: it reads every registered
   * Provider's identity from the `providerRegistry` envelope field.
   * Distinct from `kinds[*].ui` (per-kind node visuals).
   *
   * Named `presentation`, NOT `ui`: the base `IExtensionBase.ui` field is
   * the view-contributions map (`Record<string, IViewContribution>`,
   * declared only by `extractor` / `analyzer` kinds). Providers leave that
   * inherited field undefined and carry their identity here instead.
   */
  presentation: IProviderUi;

  /**
   * Optional auto-detection markers for the active-provider lens. When
   * present, the lens resolver auto-suggests this Provider if any marker
   * path exists under the scope root. Absent means the Provider is never
   * auto-suggested (it can still be selected manually).
   */
  detect?: IProviderDetect;

  /**
   * Optional authoring targets for materialising verbs (`sm tutorial`).
   * When present, the Provider is offered as a destination for newly
   * generated content (a skill folder dropped under `scaffold.skillDir`).
   * Absent means a materialising verb never offers this Provider, e.g.
   * `codex` until Codex skills land, `antigravity` (skills live under
   * the open-standard `agent-skills` territory), `core/markdown` (owns
   * no authoring convention).
   */
  scaffold?: IProviderScaffold;

  /**
   * Optional live-activity capability (see `spec/provider-activity.md`
   * and `IProviderActivityAdapter`). Present only on Providers whose
   * runtime exposes a hookable event system (claude today; codex /
   * antigravity / opencode are additive follow-ups). Absent means
   * `sm activity install` never offers this Provider and the ingest
   * route drops events tagged with its id.
   */
  activity?: IProviderActivityAdapter;

  /**
   * Optional MCP config-discovery capability (see `IProviderMcpConfig` and
   * `spec/architecture.md` §Provider · MCP config discovery). When present, the
   * kernel reads the declared config file(s) each scan and materialises the
   * declared MCP servers as virtual `mcp://<server>` nodes (config-side
   * canonical over the consumer-side `core/mcp-tools` emission). Absent means
   * this Provider surfaces MCP usage only from the consumer side.
   */
  mcpConfig?: IProviderMcpConfig;

  /**
   * Optional MCP REGISTRATION recipe (see `TProviderMcpRegister` and
   * `spec/architecture.md` §Provider · MCP registration): how an operator
   * declares skill-map's own MCP server to this Provider's runtime, either as a
   * shell command or as a config document to save. Projected verbatim into the
   * BFF `providerRegistry`; absent means the UI copies the bare endpoint URL.
   */
  mcpRegister?: TProviderMcpRegister;

  /**
   * Catalog of node kinds this Provider emits. Populated by the loader
   * from the `<plugin>/kinds/<kindName>/` directory layout: each subfolder
   * becomes one entry, with `schema.json` parsed into `schemaJson` and
   * `kind.json#/ui` projected into `ui`. Authors do NOT write this map by
   * hand any more, it is a runtime descriptor only.
   *
   * The string keys are typed loosely (`string`) rather than `NodeKind`
   * because the value space is open by design: a future Cursor Provider
   * could declare `rule`, an Obsidian Provider could declare `daily`.
   */
  kinds: Record<string, IProviderKind>;

  /**
   * Optional path globs the Provider claims. Enforcement-grade since
   * structure-as-truth: a Provider declaring `roots` only receives files
   * matching at least one glob; a Provider without `roots` acts as a
   * fallback for files unmatched by every other Provider's roots. Two
   * Providers whose `roots` both match the same file produce a
   * `provider-ambiguous` issue and the file stays unclassified. Mirrors
   * `extensions/provider.schema.json#/properties/roots`.
   */
  roots?: string[];

  /**
   * Optional auxiliary JSON Schemas this Provider's per-kind schemas
   * `$ref` by `$id`. Registered with AJV via `addSchema` BEFORE the
   * per-kind schemas compile, so cross-file `$ref` resolution succeeds.
   *
   * Use case: when several kinds share a common base (e.g. Anthropic's
   * merged skill / command frontmatter, both extend a shared
   * `skill-base.schema.json`), the Provider declares the base here so
   * `skill.schema.json` and `command.schema.json` can `$ref` it without
   * duplicating fields.
   *
   * Runtime-only, does NOT appear in the spec's `provider.schema.json`
   * manifest. Manifest-validated schemas remain the per-kind ones in
   * `kinds[<kind>].schema`; auxiliary schemas are an implementation
   * concern of how the runtime composes those.
   */
  schemas?: unknown[];

  /**
   * Declarative file-discovery config consumed by the kernel walker.
   * When present, the kernel walks every root, includes files whose
   * extension matches `extensions`, parses each with the parser id
   * registered in the kernel-internal registry, and yields `IRawNode`
   * records the same shape `walk()` would.
   *
   * When neither `read` nor `walk` is declared, `resolveProviderWalk`
   * applies the default `{ extensions: ['.md'], parser: 'frontmatter-yaml' }`
   * so the most common Provider shape needs zero configuration.
   *
   * Either a SINGLE rule (the common case) or an ARRAY of rules. A
   * Provider that reads several file families with different parsers
   * declares an array, and `resolveProviderWalk` runs one walk pass per
   * rule (each filtering by its own `extensions`). The codex provider
   * uses this to read `.toml` sub-agents (`parser: 'toml'`,
   * `bodyField: 'developer_instructions'`) AND `.md` open-standard skills
   * (`parser: 'frontmatter-yaml'`) declaratively, without an escape-hatch
   * `walk()`. Rules SHOULD use disjoint extensions; overlaps are
   * tolerated because the orchestrator's first-wins `claimedPaths` dedup
   * drops a path already claimed on an earlier pass.
   *
   * Precedence: when both `walk()` (runtime field) and `read` are
   * declared, `walk()` wins, `read` is ignored. The escape-hatch
   * relationship is intentional: most Providers should use `read` (single
   * or multi-rule); Providers with genuinely non-standard discovery
   * requirements (custom file naming, dynamic ignore logic) implement
   * `walk()` directly and accept the duplication of audit-cleared defences.
   *
   * Built-in parsers: `'frontmatter-yaml'` (markdown with `--- … ---`
   * YAML frontmatter; pollution-strip + JSON_SCHEMA-pinned), `'plain'`
   * (entire body, empty frontmatter), `'toml'` (whole-file TOML as
   * structured frontmatter). The set is closed; user plugins cannot
   * register their own.
   */
  read?: IProviderReadConfig | IProviderReadConfig[];

  /**
   * Walk the given roots and yield every node the Provider recognises.
   * Non-matching files are silently skipped. Unreadable files produce
   * a diagnostic via the emitter but do not abort the walk.
   *
   * `options.ignoreFilter`, when supplied, the Provider MUST
   * skip every directory and file whose path-relative-to-root the
   * filter reports as ignored. Providers MAY also keep their own
   * hard-coded skip list (e.g. `.git`) as a defensive measure, but the
   * filter is the canonical source of user intent.
   *
   * Optional. When omitted, the Provider MUST declare `read` (or rely
   * on the default config). The orchestrator never calls `walk()`
   * directly, it goes through `resolveProviderWalk(provider)` which
   * picks `walk` over `read`.
   */
  walk?(
    roots: string[],
    options?: IProviderWalkOptions,
  ): AsyncIterable<IRawNode>;

  /**
   * Given a path and its parsed frontmatter, decide the node kind, or
   * `null` to disclaim the file. The classifier is called after walk()
   * yields; with multiple Providers active, every Provider walks every
   * file matching its `read.extensions`, so each Provider MUST disclaim
   * paths it does not recognise. Returning the same path's kind from
   * two Providers fires the spec's `provider-ambiguous` issue and the
   * orchestrator drops the duplicate.
   *
   * Convention: a Provider's classify returns one of its own `kinds`
   * map keys for paths in its territory (`.claude/`, `.codex/`,
   * `.agents/skills/`, etc.) and `null` elsewhere. External Providers
   * (Cursor, Obsidian, …) follow the same rule: claim what's yours,
   * disclaim everything else. The orchestrator does not validate the
   * kind against `NodeKind`.
   */
  classify(path: string, frontmatter: Record<string, unknown>): string | null;

  /**
   * Strict resolution matrix consumed by the post-walk confidence-lift
   * transform: maps a `link.kind` (emitted by an Extractor in this
   * Provider's plugin, e.g. `'mentions'`, `'invokes'`) to the set of
   * target `node.kind` values that count as a valid resolution.
   *
   * Used to decide whether to bump a link's confidence to 1.0 when its
   * normalized trigger matches some node's identifier (see
   * `IProviderKind.identifiers`). A link whose name resolves to a node
   * whose kind is NOT in `resolution[link.kind]` stays at its
   * extractor-emitted confidence, the name exists but does not resolve
   * AS THIS link.kind. Example: in `claude`, `invokes` resolves to
   * `['command', 'skill']`, so a `/foo` slash matching an `agent` named
   * `foo` does not bump (agents are mentioned with `@`, not invoked
   * with `/`).
   *
   * The lookup uses the Provider id attached to the link's SOURCE node
   * (i.e. who wrote the trigger). A link sourced from a markdown body
   * outside any Provider's territory falls under `core/markdown`'s
   * empty rules, no bump applies via the name path (the path-match rule
   * still does).
   *
   * Default `undefined` ≡ empty map ≡ no link.kind bumps under this
   * Provider's name index. Path matches (`link.target === node.path`)
   * are unaffected, those always bump regardless of `resolution`.
   *
   * Distinct from the spec's `IProvider.resolverRules` (referenced in
   * §Resolver phase): `resolverRules` rank candidates inside the Signal
   * IR (Phase 3+, not wired today); `resolution` is the post-walk
   * confidence-lift contract, which runs against the merged Link graph.
   */
  resolution?: Record<string, string[]>;

  /**
   * Lens gating flag. When `true`, this Provider is a LENS: its
   * `classify()` only runs (and the walker only iterates its territory)
   * if `provider.id === activeProvider` (the project's active lens), and
   * it is offered as a selectable lens (the BFF projects `isLens: true`
   * from this flag). When `false` or omitted (default), the Provider is a
   * non-gated universal BASE and classifies unconditionally.
   *
   * Vendor providers (`claude`, `codex`, `antigravity`) and the
   * open-standard `agent-skills` provider MUST set this `true`: the actual
   * runtimes never read each other's on-disk formats (Claude Code does not
   * consume `.codex/`; Codex CLI does not consume `.claude/`), and offering
   * every file to every provider fabricates cross-vendor graph edges the
   * runtimes themselves reject.
   *
   * Only the markdown fallback `core/markdown` (and any future
   * format-based fallback) keeps this `false`: the single non-gated base,
   * consumed by every lens and run on every scan. It is the substrate, NOT
   * a selectable lens (`isLens: false`).
   *
   * There is no unlensed state: a project with no vendor marker resolves
   * to the open-standard `agent-skills` default lens, under which the
   * open-standard classifier plus the universal base run. The resolver
   * never yields a null lens.
   *
   * Default `undefined` ≡ `false` ≡ universal. The field affects
   * classification ONLY; extractors continue to filter via their own
   * `precondition.provider` allowlist and are unaffected by this flag.
   */
  gatedByActiveLens?: boolean;

  /**
   * Reserved invocation names this Provider's runtime owns for each
   * kind. Maps a `node.kind` to the set of normalised names the runtime
   * uses for its built-in invocables (e.g. `claude` reserves
   * `['help', 'clear', 'init', …]` under `command` because typing
   * `/help` in the Claude CLI runs the built-in help screen, not a
   * user-authored `.claude/commands/help.md`).
   *
   * Two consumers share the catalog:
   *
   *   1. The `core/name-reserved` analyzer scans every user node and
   *      emits a `warn` issue when the node's normalised identifiers
   *      (per `IProviderKind.identifiers`) intersect the reserved list
   *      for its provider + kind. The user file is silently shadowed
   *      by the runtime, the analyzer surfaces it so the operator can
   *      rename.
   *   2. The post-walk confidence-lift transform downgrades any link
   *      that resolves to a reserved node (by path OR by name) to a
   *      very low confidence floor (today `0.1`) instead of bumping
   *      to `1.0`. The graph then reflects "this edge exists in disk
   *      but the runtime ignores the target".
   *
   * Default `undefined` ≡ empty map ≡ no reserved names. Reserved
   * lookup normalises both sides via the §Extractor · trigger
   * normalization pipeline (lowercase, NFD, separator unification),
   * so a literal `Init-Project` in the manifest still matches a user
   * `name: init project` or filename `Init-Project.md`.
   *
   * The set is intentionally per-kind, not global: a name reserved for
   * commands (`/help`) may legitimately appear as a skill (a "help"
   * skill that triggers via something other than the command channel).
   * Providers MUST scope each entry to the kind the runtime actually
   * consumes.
   */
  reservedNames?: Record<string, readonly string[]>;

  /**
   * Per-Provider ranking hints consumed by the Signal IR **resolver
   * phase** (kernel `resolveSignals`). Drives intra-Signal candidate
   * selection AND cross-Signal range-overlap tiebreaks.
   *
   * Optional, when absent the resolver uses the default tiebreak chain:
   * `confidence` DESC → `range` length DESC → extractor declaration
   * order. Most Providers do not need to declare this; the default chain
   * is correct unless the Provider has a kind-specific preference (e.g.
   * "treat `invokes` edges as more important than `mentions` of the
   * same range").
   *
   * Distinct from the `resolution` field above: `resolverRules` ranks
   * candidates INSIDE the Signal IR (the candidate that becomes a Link
   * in the first place); `resolution` ranks Links AFTER they exist
   * (confidence lift on already-emitted edges). The two surfaces share
   * no mechanism and intentionally do not compose.
   */
  resolverRules?: IResolverRules;
}

/**
 * Per-Provider Signal IR resolver ranking hints. Mirrors
 * `extensions/provider.schema.json#/properties/resolverRules`.
 */
export interface IResolverRules {
  /**
   * When present, the resolver ranks candidates whose `kind` appears
   * earlier in this array ABOVE candidates whose `kind` appears later.
   * Candidates whose `kind` is absent from the array drop to the end
   * (after every listed kind). Ties inside the same `kindPriority`
   * bucket fall through to the `confidence` → range-length → declaration
   * order tiebreaks.
   *
   * Example: a Provider that wants `invokes` edges to win against
   * `mentions` / `references` of the same byte range declares
   * `['invokes', 'references', 'mentions']`.
   */
  kindPriority?: readonly LinkKind[];
}

/**
 * Per-invocation options the orchestrator threads into a Provider walk
 * (and through `resolveProviderWalk` into the kernel walker). All
 * optional, so a bare `provider.walk(roots)` keeps working.
 *
 *   - `ignoreFilter`, the composed `.skillmapignore` + config.ignore +
 *     bundled-defaults filter.
 *   - `maxFileSizeBytes` / `onOversizedFile`, mirror of
 *     `scan.maxFileSizeBytes` and the collector that records skipped
 *     files into `ScanResult.oversizedFiles`. A Provider that ships its
 *     own `walk()` SHOULD forward both into `walkContent` (or apply the
 *     same size guard) so oversized files stay skipped + reported
 *     regardless of which discovery path runs.
 */
export interface IProviderWalkOptions {
  ignoreFilter?: IIgnoreFilter;
  maxFileSizeBytes?: number;
  /**
   * Mirror of `scan.followExternalSymlinks` (default `false`). Forwarded
   * to the kernel walker so a symlink whose target escapes the scan roots
   * is refused unless the operator opted in. A Provider shipping its own
   * `walk()` SHOULD forward it (or apply the same containment) so the
   * gate holds regardless of the discovery path. Absent → contained.
   */
  followExternalSymlinks?: boolean;
  onOversizedFile?: (info: { path: string; bytes: number }) => void;
  /**
   * Incremental-walk hint: prior-scan file mtimes keyed by root-relative
   * path (the same form as `IRawNode.path`). When supplied, the kernel
   * walker compares each file's on-disk `mtime` against this map and, on
   * a match, yields a lightweight `unchanged` record WITHOUT reading or
   * parsing the body (the dominant cost on a re-scan). The orchestrator
   * builds this from the prior snapshot only when cache reuse is on and
   * the tokenizer is unchanged; absent means "read every file" (the
   * full-scan default). A Provider shipping its own `walk()` MAY honour
   * it for the same speedup but is not required to.
   */
  priorMtimes?: ReadonlyMap<string, number>;
  /**
   * Scoped-walk hint for the watcher's incremental path: an explicit
   * list of ABSOLUTE file paths to read instead of traversing the
   * roots. When supplied, the kernel walker skips traversal entirely and
   * reads ONLY these paths (those matching the provider's `extensions`,
   * existing on disk, passing the size guard), yielding a normal
   * `IRawNode` per match. Built by the orchestrator from chokidar's
   * changed-path list; absent means "traverse the roots" (the full-scan
   * default). A Provider shipping its own `walk()` MAY honour it for the
   * same speedup but is not required to.
   */
  scopedPaths?: readonly string[];
  /**
   * Per-pass directory containment memo for the scoped read (audit H4).
   * The orchestrator allocates ONE and hands the same instance to every
   * active provider's scoped walk, so the containment `realpath`s are
   * paid once per directory instead of once per provider per file. A
   * Provider shipping its own `walk()` may ignore it.
   */
  scopedContainmentCache?: Map<string, boolean>;
}

/**
 * Declarative read config a Provider declares via `IProvider.read`.
 * Mirrors `extensions/provider.schema.json#/properties/read` at the
 * TypeScript level. Built-in parser ids: `'frontmatter-yaml'`, `'plain'`.
 */
export interface IProviderReadConfig {
  /**
   * File extensions the walker yields. Strings include the leading dot
   * (e.g. `'.md'`, `'.mdc'`, `'.toml'`). Match is suffix-based; the
   * comparison is case-sensitive.
   */
  extensions: string[];
  /**
   * Parser id from the kernel-internal registry. Built-ins:
   * `'frontmatter-yaml'`, `'plain'`. Unknown ids surface as
   * `UnknownParserError` from the walker; the orchestrator translates
   * the error into a Provider issue with status `invalid-manifest`.
   */
  parser: string;
  /**
   * Name of a parsed-frontmatter field that carries the node's markdown
   * body. When set, the walker feeds `frontmatter[bodyField]` (when it is
   * a string) to every downstream consumer as the node `body` instead of
   * the parser's own `body` output: the body hash, byte counts, and every
   * body-scoped extractor (markdown-link, at-directive, slash, ...) then
   * see this prose. For formats where the prompt lives inside structured
   * frontmatter rather than after a fence: OpenAI Codex sub-agents are
   * pure TOML (`read.parser: 'toml'`) whose markdown prompt is the
   * triple-quoted `developer_instructions` field, so the codex provider
   * declares `bodyField: 'developer_instructions'`. When the field is
   * absent or not a string,
   * the parser's own `body` is used unchanged (the default for `.md`
   * providers). The field stays in `frontmatter` too, so frontmatter-scoped
   * extractors (e.g. `core/mcp-tools` reading `tools`) are unaffected.
   */
  bodyField?: string;
}

const DEFAULT_READ_CONFIG: IProviderReadConfig = Object.freeze({
  extensions: Object.freeze(['.md']) as unknown as string[],
  parser: 'frontmatter-yaml',
});

/**
 * Deduped union of the file extensions every given Provider reads (each
 * Provider's `read.extensions`, default `['.md']` when `read` is absent;
 * a multi-rule `read` array contributes every rule's extensions). Mirrors
 * the read normalization in `resolveProviderWalk`. Used to scope the live
 * filesystem watcher to the file types a scan would actually open, so it
 * reacts to `.md` (every lens) and `.toml` (codex) but not arbitrary
 * files. The `.sm` sidecar is NOT a Provider extension; callers add it.
 */
export function collectReadExtensions(
  providers: readonly Pick<IProvider, 'read'>[],
): string[] {
  const out = new Set<string>();
  for (const provider of providers) {
    const read = provider.read ?? DEFAULT_READ_CONFIG;
    const rules = Array.isArray(read) ? read : [read];
    for (const rule of rules) {
      for (const ext of rule.extensions) out.add(ext);
    }
  }
  return [...out];
}

/**
 * Resolve how a Provider walks its roots. Precedence:
 *
 *   1. If the Provider declares `walk()` (runtime field), use it as-is.
 *      Escape hatch for Providers with non-standard discovery logic.
 *   2. Else, use `provider.read` (declarative config), or the default
 *      `{ extensions: ['.md'], parser: 'frontmatter-yaml' }` when
 *      `read` is also absent, and route through the kernel walker. A
 *      multi-rule `read` array runs one `walkContent` pass per rule
 *      (each filtering by its own `extensions`); the rules are yielded
 *      in declaration order and the orchestrator's `claimedPaths` dedup
 *      keeps a path that two rules happen to match from double-emitting.
 *
 * Defaulting at the call site (rather than at manifest-load) keeps the
 * AJV-validated manifest equal to what the plugin author wrote, `read`
 * is not silently injected into a Provider's runtime shape.
 */
export function resolveProviderWalk(
  // Accepts both the fully-loaded shape and the codegen-input shape
  // (`IBuiltInManifest<IProvider>` strips `version` since the codegen
  // stamps it post-authoring). This function reads `walk` / `read` /
  // `kinds` only, never `version`, so widening is structurally safe
  // and keeps test files importing raw built-in manifests buildable
  // without a runtime workaround.
  provider: IBuiltInManifest<IProvider>,
): (
  roots: string[],
  options?: IProviderWalkOptions,
) => AsyncIterable<IRawNode> {
  if (provider.walk) {
    const walk = provider.walk.bind(provider);
    return walk;
  }
  const read = provider.read ?? DEFAULT_READ_CONFIG;
  const rules = Array.isArray(read) ? read : [read];
  return async function* walkRules(roots, options): AsyncIterable<IRawNode> {
    for (const rule of rules) {
      yield* walkContent(roots, buildWalkContentOptions(rule, options));
    }
  };
}

/**
 * Assemble the kernel walker's `IWalkContentOptions` from a Provider's
 * declarative `read` config plus the per-invocation walk options. Each
 * optional key is set only when the caller supplied it (the keys are
 * optional under `exactOptionalPropertyTypes`, so the walker's default-
 * fallback paths are preserved). Extracted from `resolveProviderWalk` so
 * the returned walk closure stays under the complexity cap.
 */
function buildWalkContentOptions(
  read: IProviderReadConfig,
  options: IProviderWalkOptions | undefined,
): import('../scan/walk-content.js').IWalkContentOptions {
  const walkOptions: import('../scan/walk-content.js').IWalkContentOptions = {
    extensions: read.extensions,
    parser: read.parser,
  };
  if (read.bodyField !== undefined) walkOptions.bodyField = read.bodyField;
  if (options) copyOptionalWalkOptions(walkOptions, options);
  return walkOptions;
}

/**
 * Copy the per-invocation walk knobs onto `walkOptions`, setting each key
 * only when supplied so the walker's default-fallback paths survive under
 * `exactOptionalPropertyTypes`. Takes a guaranteed-defined `options` (the
 * caller already null-checked) so each guard is a single branch, keeping
 * both this helper and `buildWalkContentOptions` under the complexity cap.
 */
function copyOptionalWalkOptions(
  walkOptions: import('../scan/walk-content.js').IWalkContentOptions,
  options: IProviderWalkOptions,
): void {
  if (options.ignoreFilter) walkOptions.ignoreFilter = options.ignoreFilter;
  if (options.maxFileSizeBytes !== undefined) {
    walkOptions.maxFileSizeBytes = options.maxFileSizeBytes;
  }
  if (options.followExternalSymlinks === true) {
    walkOptions.followExternalSymlinks = true;
  }
  if (options.onOversizedFile) walkOptions.onOversizedFile = options.onOversizedFile;
  if (options.priorMtimes) walkOptions.priorMtimes = options.priorMtimes;
  if (options.scopedPaths) walkOptions.scopedPaths = options.scopedPaths;
  if (options.scopedContainmentCache) {
    walkOptions.scopedContainmentCache = options.scopedContainmentCache;
  }
}
