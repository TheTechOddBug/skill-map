/**
 * Kernel-side strings emitted by `kernel/adapters/plugin-loader.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation. See
 * `kernel/i18n/orchestrator.texts.ts` header for rationale.
 *
 * Reasons split by failure mode (per `IDiscoveredPlugin.status`):
 *   - `invalid-manifest`  → manifest JSON unreadable / schema mismatch /
 *                            directory name does not match manifest id
 *   - `incompatible-spec` → `manifest.specCompat` does not satisfy the
 *                            installed spec version
 *   - `load-error`        → extension file missing, import failure,
 *                            wrong export shape, kind mismatch, schema
 *                            mismatch, OR import timeout
 *   - `id-collision`      → two plugins (any combination of roots, e.g.
 *                            project + global) declared the same `id`.
 *                            Both collided plugins are blocked; no
 *                            precedence rule applies.
 */

/**
 * Base GitHub URL (blob, default branch) the manifest-validation errors
 * link to so an author can open the authoritative schema in the browser
 * instead of hunting for a local path. Resolved at module load; the
 * `{{...}}` tokens in the templates below stay literal for `tx`.
 */
export const SPEC_GITHUB_BASE = 'https://github.com/crystian/skill-map/blob/main';

export const PLUGIN_LOADER_TEXTS = {
  invalidManifestJsonParse:
    '{{manifestPath}}: {{errDescription}}. Validate the JSON (e.g. `npx jsonlint plugin.json`).',

  invalidManifestAjv:
    `{{manifestPath}}: {{errors}}. See ${SPEC_GITHUB_BASE}/spec/schemas/plugins-registry.schema.json#/$defs/PluginManifest.`,

  invalidSpecCompat:
    'specCompat "{{specCompat}}" is not a valid semver range. Use a range like "^1.0.0".',

  incompatibleSpec:
    '@skill-map/spec {{installedSpecVersion}} does not satisfy specCompat "{{specCompat}}". ' +
    "Either update the plugin's specCompat (and re-test) or pin sm to a compatible spec version.",

  loadErrorFileNotFound:
    'extension file not found: {{relEntry}} (resolved to {{abs}}). Check plugin.json#/extensions paths.',

  loadErrorImportFailed: '{{relEntry}}: import failed: {{errDescription}}',

  loadErrorMissingKind:
    '{{relEntry}}: default export missing a string `kind` field. Expected one of: {{knownKindsList}}.',

  loadErrorUnknownKind:
    '{{relEntry}}: unknown extension kind "{{kindReceived}}". Expected one of: {{knownKindsList}}.',

  // No "manifest invalid" framing here: the warning wrapper already
  // carries the `(invalid-manifest)` status, so this reason is just the
  // file + the specific error + the doc link. `{{docUrl}}` is chosen by
  // the caller: a bad view-slot value points to the slot catalog
  // (`spec/view-slots.md`), every other manifest-shape error to the kind
  // schema. Both are GitHub blob URLs.
  invalidManifestExtensionShape:
    '{{relEntry}}: {{errors}}. See {{docUrl}}.',

  importExceededTimeout:
    'import exceeded {{timeoutMs}}ms; likely a top-level side effect ' +
    '(network call, infinite loop, large blocking work). Move side effects ' +
    'into the runtime methods (`detect` / `evaluate` / `render` / etc.).',

  disabledByConfig: 'disabled by settings.json (plugins.<id>.enabled)',

  /**
   * Reason stamped on a project-local disk plugin discovered but not
   * imported because the operator never granted local import trust.
   * Distinct from `disabledByConfig` (an explicit operational toggle-off
   * in the config layers): this id is enabled but carries no scope-lock
   * grant, so its code stays unexecuted until `sm plugins trust` records
   * local consent.
   */
  untrustedNotLoaded:
    'not loaded: project-local plugin is enabled but not trusted in this checkout. ' +
    'Run `sm plugins trust {{pluginId}}` to load it.',

  /**
   * One-time aggregate notice the runtime emits when project-local
   * plugins were found on disk but left unloaded for lack of trust. The
   * `{{count}}` plugins ride the scan without executing any code.
   *
   * Deliberately does NOT send the operator to `sm plugins list`, which
   * the previous wording did: that verb still imports plugin code to
   * enumerate extensions, so recommending it as the "review" step meant
   * telling someone their code had not run and, in the same sentence,
   * handing them the command that runs it. Reading the source is the
   * honest review step until the family enumerates from the manifest.
   */
  untrustedPluginsFoundNotice:
    '{{count}} project-local plugin(s) found in .skill-map/plugins/ but not loaded ' +
    '(untrusted). Their code did NOT run. Read the plugin source, then ' +
    'trust what you vetted with `sm plugins trust <id>`.',

  /**
   * A grant EXISTS for these ids but was minted against a different copy
   * of the project. Benign causes are the common ones (the project was
   * copied, restored from a backup, moved across filesystems, or
   * re-cloned), and from in here they are indistinguishable from a
   * hostile repo shipping its own grants, so the wording states the fact
   * and never accuses.
   *
   * Deliberately no bulk re-adopt: re-granting stays a per-plugin act so
   * the operator has to name what they are trusting. A prompt offering to
   * adopt them all would turn the attack into social engineering.
   */
  foreignGrantNotice:
    '{{count}} project-local plugin(s) were granted in a different copy of this project ' +
    'and were NOT loaded: {{ids}}. Trust is recorded per checkout. ' +
    'Re-grant what you still want with `sm plugins trust <id>`.',

  /**
   * The filesystem cannot anchor a grant at all. Separate from every
   * other trust message because re-granting is futile here: the operator
   * needs to know it is the environment, not their data.
   */
  anchorUnusableNotice:
    '{{count}} project-local plugin(s) were NOT loaded: this filesystem reports no ' +
    'creation time for .skill-map/, so trust cannot be anchored to this checkout. ' +
    'Known on Windows drives mounted into WSL (/mnt/...), /proc and /sys.',

  invalidManifestDirMismatch:
    "directory name '{{dirName}}' does not match manifest id '{{manifestId}}'. " +
    'Rename the directory to match the id, or update the manifest id to match the directory.',

  idCollision:
    "Plugin '{{id}}' at {{pathA}} collides with the plugin at {{pathB}}. " +
    'Rename one and rerun.',

  loadErrorPluginIdMismatch:
    "{{relEntry}}: extension declares pluginId '{{declared}}' but its plugin.json declares id '{{manifestId}}'. " +
    'Remove the explicit pluginId from the extension; the loader injects it from plugin.json#/id.',

  invalidManifestRedeclaredField:
    '{{relEntry}}: extension manifest declares {{fields}}, derived from the folder layout (structure-as-truth) ' +
    'and not a manifest field. Remove it: id is the leaf folder, kind the parent folder, provider kinds the ' +
    '`kinds/` catalog, formatter formatId the formatter folder name.',

  loadErrorStorageSchemaRead:
    "plugin '{{pluginId}}' failed to load schema for table '{{table}}': {{schemaPath}}: {{errDescription}}",

  loadErrorStorageSchemaCompile:
    "plugin '{{pluginId}}' failed to compile schema for table '{{table}}': {{schemaPath}}: {{errDescription}}",

  loadErrorStorageKvSchemaRead:
    "plugin '{{pluginId}}' failed to load KV schema: {{schemaPath}}: {{errDescription}}",

  loadErrorStorageKvSchemaCompile:
    "plugin '{{pluginId}}' failed to compile KV schema: {{schemaPath}}: {{errDescription}}",

  invalidManifestHookUnknownTrigger:
    "Hook '{{hookId}}' declares unknown trigger '{{trigger}}'. Hookable triggers: {{hookableList}}.",

  invalidManifestHookEmptyTriggers:
    "Hook '{{hookId}}' declares no triggers. At least one entry from the curated set is required.",

  loadErrorPathEscapesPlugin:
    "extension entry '{{relEntry}}' resolves outside the plugin directory ({{pluginPath}}). Plugin entries must be relative paths inside the plugin tree.",

  loadErrorSchemaPathEscapesPlugin:
    "schema path '{{relPath}}' resolves outside the plugin directory ({{pluginPath}}). Plugin schemas must be relative paths inside the plugin tree.",

  invalidManifestRootSharedAnnotation:
    "{{relEntry}}: annotationContributions['{{key}}'] declares location: 'root' with ownership: '{{ownership}}'; root keys MUST be 'exclusive' (a top-level reserved key cannot be silently shared between plugins).",

  invalidManifestAnnotationSchemaCompile:
    "{{relEntry}}: annotationContributions['{{key}}'].schema is not a valid JSON Schema: {{errDescription}}",

  fatalAnnotationRootCollision:
    "Annotation root-key collision: '{{key}}' is claimed with ownership: 'exclusive' by multiple plugins ({{plugins}}). The kernel cannot boot with this configuration. Rename or merge the contributions and rerun.",

  // --- analyzer file conventions (structure-as-truth, probabilistic) ------
  invalidManifestAnalyzerMissingPrompt:
    'Probabilistic Analyzer at `{{relEntry}}` is missing `prompt.md` in its folder ' +
    '(structure-as-truth: probabilistic analyzers carry a prompt template by convention).',

  invalidManifestAnalyzerMissingReportSchema:
    'Probabilistic Analyzer at `{{relEntry}}` is missing `report.schema.json` in its folder ' +
    '(structure-as-truth: probabilistic analyzers carry a findings report schema by convention).',

  invalidManifestAnalyzerReportSchemaUnparseable:
    'Probabilistic Analyzer at `{{relEntry}}` has an unparseable `report.schema.json`: {{errDescription}}',

  invalidManifestAnalyzerReportSchemaNotFindings:
    'Probabilistic Analyzer at `{{relEntry}}` has a `report.schema.json` that does not extend the canonical ' +
    `findings envelope. Add a $ref to it (typically inside allOf). See ${SPEC_GITHUB_BASE}/spec/schemas/findings/report.schema.json.`,

  invalidManifestAnalyzerUnexpectedPrompt:
    'Deterministic Analyzer at `{{relEntry}}` carries an unexpected `prompt.md` ' +
    "(delete the file or switch `mode` to `'probabilistic'`).",
} as const;
