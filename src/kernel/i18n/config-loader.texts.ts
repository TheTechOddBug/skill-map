/**
 * Kernel-side strings emitted by the layered config loader
 * (`kernel/config/loader.ts`). Same `tx(template, vars)` convention as
 * every other `kernel/i18n/*.texts.ts` peer.
 *
 * These warnings are accumulated into `ILoadedConfig.warnings` and surface
 * to the user via `cli/commands/config.ts` (and any other call site that
 * dumps them to stderr). Keeping them in the catalog keeps every
 * user-facing string greppable in one place and unblocks a future
 * Transloco migration.
 *
 * Strict mode also throws these strings as `Error` messages, same text,
 * same template; the loader picks `throw` vs `push` based on the
 * `strict` flag.
 */

export const CONFIG_LOADER_TEXTS = {
  readFailure:
    '[config:{{layer}}] failed to read {{path}}: {{message}}',

  invalidJson:
    '[config:{{layer}}] invalid JSON in {{path}}: {{message}}',

  expectedObject:
    '[config:{{layer}}] expected a JSON object, got {{type}}; ignored',

  unknownKey:
    '[config:{{layer}}] unknown key {{key}} ignored',

  invalidValue:
    '[config:{{layer}}] invalid value at {{path}}: {{message}}',

  projectLocalOnlyStripped:
    '[config:{{layer}}] key {{key}} is project-local only; stripped from the committed project layer. Move it to .skill-map/settings.local.json (gitignored, per-checkout).',

  /**
   * A privileged project-local key carries no grant minted in this
   * checkout, so it was ignored. Benign causes (the project was copied,
   * restored, moved, or re-cloned) are indistinguishable from a hostile
   * repo shipping the file, so this states the fact and never accuses.
   */
  localKeyNotGranted:
    "config: '{{key}}' in settings.local.json was not granted in this copy of the project and was ignored. " +
    'Re-apply it with `sm config set {{key}} <value>` to record consent here.',

  /**
   * The filesystem cannot anchor a grant at all. Separate message because
   * re-granting is futile: the operator needs to know it is the
   * environment, not their settings.
   */
  localKeyAnchorUnusable:
    "config: '{{key}}' in settings.local.json was ignored: this filesystem reports no creation time " +
    'for .skill-map/, so per-checkout settings cannot be anchored. Known on Windows drives mounted ' +
    'into WSL (/mnt/...), /proc and /sys.',
} as const;
