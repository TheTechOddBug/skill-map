---
"@skill-map/cli": patch
---

Finish the em-dash sweep across `src/` and lock it down with an ESLint rule.

Two pieces of work, both internal (no user-visible behaviour change):

- **Lint rule** in `src/eslint.config.js` blocks new em-dashes (`—`) inside string literals and template-literal pieces in `**/*.texts.ts` catalog files (the user-facing surface). Two `no-restricted-syntax` selectors fire on `Literal[value=/—/]` and `TemplateElement[value.raw=/—/]`. The rule scopes only to catalogs; non-catalog files (comments, JSDoc) are not enforced because the AST selectors do not see comment tokens.
- **Comment sweep** across `src/**/*.{ts,js}` (excluding `dist/`) replaces ~1500 em-dashes inside JSDoc and inline comments with context-appropriate punctuation (`,`, `;`, `:`, parens). Closes the historical gap left by the previous AGENTS.md "do not mass-rewrite old em dashes" guardrail. Three intentional em-dashes remain in `src/eslint.config.js`, the rule's own error messages reference the `—` character literally.

`AGENTS.md` updated so the no-em-dash rule now applies tree-wide (was "new code only"); the lint rule prevents regression on the catalog surface.
