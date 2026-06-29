/**
 * Provider runtime contract. Walks filesystem roots and emits raw node
 * records; classification maps path conventions to a node kind.
 *
 * Distinct from the **hexagonal-architecture** 'adapter' (`RunnerPort.adapter`,
 * `StoragePort.adapter`, etc.). A `Provider` is an extension kind authored
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
  reread?: () => Promise<Pick<IRawNode, 'body' | 'frontmatterRaw' | 'frontmatter' | 'parseIssues'>>;
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
  if (options.onOversizedFile) walkOptions.onOversizedFile = options.onOversizedFile;
  if (options.priorMtimes) walkOptions.priorMtimes = options.priorMtimes;
  if (options.scopedPaths) walkOptions.scopedPaths = options.scopedPaths;
}
