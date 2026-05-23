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

import type { IExtensionBase } from './base.js';
import type { IIgnoreFilter } from '../scan/ignore.js';
import type { IParseIssue } from '../scan/parsers/types.js';
import { walkContent } from '../scan/walk-content.js';

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
   * Parser diagnostics (audit L1). Populated by the walker when the
   * parser surfaced `IParseIssue` entries (e.g. malformed YAML).
   * Carried through `processRawNode` and converted into warn-level
   * kernel `Issue` rows inside `buildFreshNodeAndValidateFrontmatter`.
   * Empty / undefined on the happy path.
   */
  parseIssues?: readonly IParseIssue[];
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

export interface IProvider extends IExtensionBase {
  /** Discriminant injected by the loader from the folder structure. */
  kind: 'provider';

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
   * Precedence: when both `walk()` (runtime field) and `read` are
   * declared, `walk()` wins, `read` is ignored. The escape-hatch
   * relationship is intentional: most Providers should use `read`;
   * Providers with non-standard discovery requirements (custom file
   * naming, multi-pass walks, dynamic ignore logic) implement `walk()`
   * directly and accept the duplication of audit-cleared defences.
   *
   * Built-in parsers: `'frontmatter-yaml'` (markdown with `--- … ---`
   * YAML frontmatter; pollution-strip + JSON_SCHEMA-pinned), `'plain'`
   * (entire body, empty frontmatter). The set is closed; user plugins
   * cannot register their own.
   */
  read?: IProviderReadConfig;

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
    options?: { ignoreFilter?: IIgnoreFilter },
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
   * Provider's bundle, e.g. `'mentions'`, `'invokes'`) to the set of
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
   * Lens gating flag for vendor providers. When `true`, this Provider's
   * `classify()` only runs (and the walker only iterates its territory)
   * if `provider.id === activeProvider` (the project's active lens).
   * When `false` or omitted (default), the Provider is universal and
   * classifies unconditionally, regardless of the active lens.
   *
   * Vendor providers (`claude`, `openai`, `antigravity`) MUST set this
   * to `true`: the actual runtimes never read each other's on-disk
   * formats (Claude Code does not consume `.codex/`; Codex CLI does not
   * consume `.claude/`), and offering every file to every provider
   * fabricates cross-vendor graph edges the runtimes themselves reject.
   *
   * Universal providers (the open-standard `agent-skills`, the markdown
   * fallback `core/markdown`, any future format-based fallback) keep
   * this `false`: their territory is consumed by every vendor and they
   * MUST run on every scan, regardless of the active lens.
   *
   * When `activeProvider === null` (no lens resolved, e.g. a project
   * with no provider markers), the walker bypasses the gate entirely
   * and every gated Provider runs, mirroring the permissive
   * extractor-side fallback for unlensed projects.
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
   *   1. The `core/reserved-name` analyzer scans every user node and
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
}

const DEFAULT_READ_CONFIG: IProviderReadConfig = Object.freeze({
  extensions: Object.freeze(['.md']) as unknown as string[],
  parser: 'frontmatter-yaml',
});

/**
 * Resolve how a Provider walks its roots. Precedence:
 *
 *   1. If the Provider declares `walk()` (runtime field), use it as-is.
 *      Escape hatch for Providers with non-standard discovery logic.
 *   2. Else, use `provider.read` (declarative config), or the default
 *      `{ extensions: ['.md'], parser: 'frontmatter-yaml' }` when
 *      `read` is also absent, and route through the kernel walker.
 *
 * Defaulting at the call site (rather than at manifest-load) keeps the
 * AJV-validated manifest equal to what the plugin author wrote, `read`
 * is not silently injected into a Provider's runtime shape.
 */
export function resolveProviderWalk(
  provider: IProvider,
): (
  roots: string[],
  options?: { ignoreFilter?: IIgnoreFilter },
) => AsyncIterable<IRawNode> {
  if (provider.walk) {
    const walk = provider.walk.bind(provider);
    return walk;
  }
  const read = provider.read ?? DEFAULT_READ_CONFIG;
  return (roots, options) => {
    // `ignoreFilter` is optional under `exactOptionalPropertyTypes`; only
    // include the key when the caller actually supplied a filter so the
    // walker's default-fallback path is preserved.
    const walkOptions: import('../scan/walk-content.js').IWalkContentOptions = {
      extensions: read.extensions,
      parser: read.parser,
    };
    if (options?.ignoreFilter) walkOptions.ignoreFilter = options.ignoreFilter;
    return walkContent(roots, walkOptions);
  };
}
