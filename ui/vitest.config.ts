import { defineConfig } from 'vitest/config';

/**
 * Custom Vitest runner config, wired via `angular.json > test.options.runnerConfig`.
 * The Angular CLI generates the base config and overrides `test.projects` /
 * `test.include`; everything else here is merged on top.
 *
 * Why this file exists: `@foblex/flow-dagre-layout` ships as ESM that does
 * `import * as dagre from 'dagre'`, but `dagre@0.8.5` is CommonJS exporting via
 * `module.exports = { graphlib, layout, ... }`. `cjs-module-lexer` cannot
 * statically detect named exports from an object-literal assignment, so under
 * the test runner's native ESM resolution `dagre.layout` is `undefined` and the
 * graph-view layout throws `dagre.layout is not a function`. Inlining both
 * packages forces Vite to bundle them with proper CJS interop (synthesising the
 * named exports), the same outcome the production esbuild build already
 * produces. Production is unaffected; this only changes how the test runner
 * resolves the dependency.
 */
export default defineConfig({
  test: {
    server: {
      deps: {
        inline: ['dagre', /@foblex\/flow-dagre-layout/],
      },
    },
  },
});
