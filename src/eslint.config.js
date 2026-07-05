/**
 * ESLint v10 flat config for the `src/` workspace.
 *
 * Three layers:
 *   1. Project rules, translated from the legacy `.eslintrc.json`
 *      (preserved verbatim where possible).
 *   2. Architectural invariants, enforce the cross-layer contracts
 *      surfaced in the v0.6 audit:
 *        - kernel must not write stdout/stderr (`no-console`);
 *        - kernel must not read `process.cwd` / `process.env` (port them);
 *        - kernel must not import from `cli/`;
 *        - relative ESM imports terminate in `.js`.
 *   3. Stylistic, formatting rules ESLint moved out of core in v9 live
 *      in `@stylistic/eslint-plugin`.
 *
 * Tests are excluded (separate rigor) and so is the build output.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import importX from 'eslint-plugin-import-x';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      'node_modules/**',
      'coverage/**',
      'migrations/**',
      'test/**',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/*.mjs',
      '**/*.js',
      '!eslint.config.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    plugins: {
      '@stylistic': stylistic,
      'import-x': importX,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        // `node` env equivalent, Node 24 globals are first-class.
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
      },
    },
    rules: {
      // --- Project rules (from legacy .eslintrc.json) ----------------------
      // Promoted to 'error' after the complexity sweep; functions that
      // are inherently complex (CLI orchestrators, parsers,
      // multi-accumulator folds) carry an `eslint-disable-next-line
      // complexity` with rationale.
      complexity: ['error', { max: 8 }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'no-eval': 'error',
      'no-throw-literal': 'error',
      'block-scoped-var': 'error',
      'no-fallthrough': 'error',
      'no-useless-return': 'error',
      'no-else-return': ['error', { allowElseIf: true }],
      'no-extra-boolean-cast': ['error', { enforceForLogicalOperands: true }],
      curly: ['error', 'multi-line', 'consistent'],
      'no-console': ['error', { allow: ['warn', 'error', 'log'] }],

      // --- TS rules (from legacy .eslintrc.json) --------------------------
      '@typescript-eslint/explicit-module-boundary-types': [
        'error',
        { allowArgumentsExplicitlyTypedAsAny: true },
      ],
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-function': 'error',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',

      // --- Quality rules surfaced by the audit -----------------------------
      'preserve-caught-error': 'error',
      // Allow ZWSP / BOM / NBSP inside string literals, regex, and
      // JSDoc, these come up legitimately in YAML BOM detection,
      // block-comment escaping, etc. Identifier whitespace stays an error.
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipComments: true, skipRegExps: true, skipTemplates: true },
      ],
      'no-useless-assignment': 'error',
      'no-unused-private-class-members': 'error',

      // --- Stylistic (moved out of ESLint core in v9) ---------------------
      '@stylistic/quotes': [
        'error',
        'single',
        { avoidEscape: true, allowTemplateLiterals: 'always' },
      ],
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/linebreak-style': ['error', 'unix'],
      '@stylistic/no-multi-spaces': 'error',
      '@stylistic/newline-per-chained-call': ['error', { ignoreChainWithDepth: 4 }],

      // --- Repo invariants (apply everywhere) ------------------------------
      // Relative ESM imports MUST terminate in `.js` (TS source uses `.js`
      // because the emitted file is what the runtime resolves).
      'import-x/extensions': [
        'error',
        'always',
        { ts: 'never', tsx: 'never', json: 'always' },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Kernel-only invariants (V1, V5 of the audit)
  // -------------------------------------------------------------------------
  {
    files: ['kernel/**/*.ts'],
    rules: {
      // V1, kernel never writes to stdout/stderr directly. Use the
      // singleton `log` from `kernel/util/logger.js` instead.
      'no-console': 'error',

      // V5, kernel never reads `process.cwd()` / `process.env` directly.
      // Adapters (CLI, test harness) must inject those values via options.
      // We use targeted AST selectors so other `process.*` access (like
      // `process.exit` in tests, which is excluded anyway) keeps working.
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='cwd']",
          message:
            'Kernel must not call process.cwd(). Inject `cwd` via the caller (CLI / adapter).',
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Kernel must not read process.env. Inject env values via the caller (CLI / adapter).',
        },
      ],

      // Kernel must not import from cli/ or core/. Resolves the V1
      // invariant structurally (was hand-audited in the v0.6 review).
      //
      // The `core/` ban enforces the layer direction: the kernel is the
      // innermost layer, `core/` (the kernel-side runtime layer) sits
      // ABOVE it and imports DOWN into the kernel, never the reverse. A
      // kernel file reaching up into `core/` is the inversion the v0.x
      // audit (H1) flagged; the fix is to move the shared leaf DOWN into
      // kernel/ (e.g. `kernel/util/atomic-write.ts`,
      // `kernel/update-check/`, `kernel/adapters/sqlite/schema-fingerprint.ts`)
      // or INJECT it (e.g. the sidecar consent gate, the active-provider
      // filesystem detector). The `../`-prefixed globs target the
      // sibling `src/core/` only; `plugins/core/*` (built-in parser /
      // analyzer implementations the kernel legitimately registers) is
      // reached via `../plugins/core/...` and is intentionally NOT
      // matched.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../cli/*',
                '../cli/**',
                '../../cli/*',
                '../../cli/**',
                '../../../cli/*',
                '../../../cli/**',
                '../../../../cli/*',
                '../../../../cli/**',
              ],
              message: 'Kernel must not import from cli/.',
            },
            {
              group: [
                '../core/*',
                '../core/**',
                '../../core/*',
                '../../core/**',
                '../../../core/*',
                '../../../core/**',
                '../../../../core/*',
                '../../../../core/**',
              ],
              message:
                'Kernel must not import from core/ (the runtime layer sits ABOVE the kernel). Move the shared leaf down into kernel/, or inject it. See context/kernel.md §Layer direction.',
            },
          ],
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // CLI verb invariants, printer discipline (audit M4)
  // -------------------------------------------------------------------------
  // Every `cli/commands/**` verb extends `SmCommand`, which provides a
  // channel-aware `IPrinter` (`this.printer`). Hand-rolling
  // `this.context.stdout.write(...)` / `this.context.stderr.write(...)`
  // bypasses the channel-discipline contract: the printer routes `data`
  // → stdout, `info`/`warn`/`error` → stderr, and silences `info`
  // under `--quiet`. Direct stream writes drift silently, pre-M4 a
  // verb landed JSON output on stderr and nobody noticed for two
  // releases.
  //
  // `help.ts` is exempt: `HelpCommand` and `RootHelpCommand` extend
  // Clipanion's `Command` directly (not `SmCommand`) so `--help` /
  // `-h` parsing stays narrow, no `--json` / `--quiet` inherited,
  // since none of them apply to the help surface. The help renderer
  // therefore has no `printer` to route through. `stubs.ts` is
  // covered by `StubCommand extends SmCommand` so the rule applies
  // there normally.
  //
  // The second selector is the regression guard for the 2026-07-05
  // review finding M1: `printer.info` is suppressed under `-q` /
  // `--json` (`quietInfo`), so an error block emitted via `info`
  // immediately before returning a non-Ok `ExitCode` exits silently
  // exactly when a machine consumer is watching, violating
  // spec/cli-contract.md §Exit codes ("accompanied by an error
  // message on stderr"). It matches the adjacent-sibling shape
  // `printer.info(...); return <...ExitCode.<fatal>...>;` (including
  // object returns like `{ exit: ExitCode.Error }`). `Ok` and
  // `Issues` are excluded: exit 1 is "command completed, result has
  // error-severity issues" per the spec table, the result on stdout
  // carries the explanation, so a summary banner via `info` before a
  // conditional `Issues`/`Ok` return is correct channel use. Heuristic,
  // not control-flow analysis: an `info` separated from the return by
  // another statement escapes it, but every occurrence of the bug
  // in the M1 sweep (44 sites) had exactly this shape.
  {
    files: ['cli/commands/**/*.ts'],
    ignores: ['cli/commands/help.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[property.name='write'][object.type='MemberExpression'][object.property.name=/^(stdout|stderr)$/][object.object.type='MemberExpression'][object.object.property.name='context'][object.object.object.type='ThisExpression']",
          message:
            'CLI verbs must use `this.printer!.{data,info,warn,error}`, never `this.context.std{out,err}.write` directly. The printer enforces channel discipline (data → stdout; info/warn/error → stderr; info silenced under --quiet).',
        },
        {
          selector:
            "ExpressionStatement:has(CallExpression[callee.property.name='info']:matches([callee.object.name='printer'], [callee.object.property.name='printer'], [callee.object.expression.property.name='printer'])) + ReturnStatement:has(MemberExpression[object.name='ExitCode'][property.name!=/^(Ok|Issues)$/])",
          message:
            'Fatal-path message emitted via printer.info() right before a non-Ok ExitCode return; info is suppressed under -q/--json, so the command would exit non-zero with no explanation. Use printer.error() (spec/cli-contract.md §Exit codes).',
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Core-only invariants, peer of kernel; same boundary discipline
  // -------------------------------------------------------------------------
  // `core/` is the kernel-side runtime layer (paths, sqlite wrappers,
  // plugin runtime, scan runner, watcher runtime). It is consumed by
  // both `cli/` and `server/` (BFF), so it MUST NOT import from `cli/`
  // every leak drags CLI presentation surfaces (printer, i18n,
  // progress emitter) into the BFF transitive deps. Same contract as
  // `kernel/**`: no `process.cwd()` / `process.env` reads either,
  // CLI / BFF adapters resolve those at the boundary (e.g.
  // `cli/util/conformance-env.ts`) and thread the resolved values
  // through options.
  {
    files: ['core/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='cwd']",
          message:
            'core/ must not call process.cwd(). Inject `cwd` via the runtime context (`IRuntimeContext`).',
        },
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'core/ must not read process.env. Resolve env values in the CLI / BFF adapter and thread them through options (e.g. cli/util/conformance-env.ts → killSwitches).',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../cli/*',
                '../cli/**',
                '../../cli/*',
                '../../cli/**',
                '../../../cli/*',
                '../../../cli/**',
                '../../../../cli/*',
                '../../../../cli/**',
              ],
              message:
                'core/ must not import from cli/. Move the shared piece down to core/ or kernel/, or invert the dependency.',
            },
          ],
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // plugins/ layering: built-ins must not pull CLI code into the runtime
  // -------------------------------------------------------------------------
  // The generated `plugins/built-ins.ts` registry is imported by the core
  // runtime (`core/watcher/runtime.ts`, plugin-runtime composer) and the
  // BFF (`server/index.ts`). A `plugins/** → cli/` import therefore drags
  // CLI presentation code (ansi, texts, user-settings store) into both,
  // silently defeating the `core/ must not import cli/` rule above via
  // the plugins hop. Impure glue a built-in needs (env reads, homedir
  // stores, TTY detection) stays in `cli/`, injected by the driver
  // through the event payload / kernel context (see
  // `plugins/core/hooks/update-check/index.ts` for the pattern).
  {
    files: ['plugins/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../cli/*',
                '../cli/**',
                '../../cli/*',
                '../../cli/**',
                '../../../cli/*',
                '../../../cli/**',
                '../../../../cli/*',
                '../../../../cli/**',
                '../../../../../cli/*',
                '../../../../../cli/**',
              ],
              message:
                'plugins/ must not import from cli/. built-ins.ts feeds the core runtime and the BFF; inject impure glue from the driver via the event payload instead.',
            },
          ],
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // i18n catalog hygiene (AGENTS.md: no em-dashes)
  // -------------------------------------------------------------------------
  // Every user-facing string lives in a `*.texts.ts` catalog. AGENTS.md
  // bans em-dashes (`—`) in user-visible text: stylistic preference (em
  // dashes feel AI-generated). This rule blocks NEW em-dashes inside
  // string literals and template-literal pieces in catalog files.
  // Comments are tokens, not AST nodes, so JSDoc / `//` stays untouched.
  //
  // Trade-off: this block also matches `kernel/i18n/*.texts.ts` and
  // `core/runtime/i18n/*.texts.ts`, so it overrides the kernel / core
  // `no-restricted-syntax` array for those files. Acceptable: catalog
  // files are plain string maps, they don't read `process.*` or
  // import from `cli/`. The kernel / core import + process restrictions
  // still bite on every non-catalog kernel / core file.
  {
    files: ['**/*.texts.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/\\u2014/]',
          message:
            'No em-dashes (—) in catalog string values. Replace with a comma, colon, semicolon, or parens (per AGENTS.md).',
        },
        {
          selector: 'TemplateElement[value.raw=/\\u2014/]',
          message:
            'No em-dashes (—) in catalog template literals. Replace with a comma, colon, semicolon, or parens (per AGENTS.md).',
        },
      ],
    },
  },
);
