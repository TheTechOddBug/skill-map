---
"@skill-map/spec": minor
"@skill-map/cli": minor
"@skill-map/testkit": minor
---

Rename the `rule` plugin extension kind to `analyzer`.

The kind formerly known as `rule` not only finds issues but also projects findings into the UI via `viewContributions` (cards, badges, tabs). "Rule" undersold the breadth of the contract; **Analyzer** captures both axes — graph analysis and visual projection. Pre-1.0, no released consumers depend on the old name, so this ships as a sweep without compatibility shims.

**Wire format (breaking)**

- `kind` enum in `extensions/base.schema.json` now lists `analyzer` instead of `rule`.
- `extensions/rule.schema.json` is renamed to `extensions/analyzer.schema.json`.
- The const value of `kind` on the kind-specific schema is `"analyzer"`.
- The manifest array field `emitsRuleIds` is now `emitsAnalyzerIds`.

**Issue model + REST + DB (breaking)**

- `Issue.ruleId` is now `Issue.analyzerId` in the JSON wire and the TS shape.
- `GET /api/issues?ruleId=<id>` becomes `GET /api/issues?analyzerId=<id>`.
- The SQL column `scan_issues.rule_id` is now `scan_issues.analyzer_id`; the index `ix_scan_issues_rule_id` becomes `ix_scan_issues_analyzer_id`.

**Events (breaking)**

- The hook trigger `rule.completed` is now `analyzer.completed`. The payload field renames from `ruleId` to `analyzerId`.

**CLI (breaking)**

- `sm check --rules <ids>` becomes `sm check --analyzers <ids>`.
- The conformance kill-switch env var is `SKILL_MAP_DISABLE_ALL_ANALYZERS` (was `SKILL_MAP_DISABLE_ALL_RULES`); the corresponding `conformance-case.schema.json` field is `disableAllAnalyzers`.
- The advisory placeholder `{{ruleIds}}` in `--include-prob` output is now `{{analyzerIds}}`.

**Kernel + built-ins (breaking)**

- TypeScript symbols: `IRule` → `IAnalyzer`, `IRuleContext` → `IAnalyzerContext`, `IRuleOrphanSidecar` → `IAnalyzerOrphanSidecar`.
- The 11 built-in extensions previously under `src/built-in-plugins/rules/` now live under `src/built-in-plugins/analyzers/`. Each `*Rule` symbol (e.g. `triggerCollisionRule`) is renamed to its `*Analyzer` form (`triggerCollisionAnalyzer`).
- `IBuiltIns.rules` → `IBuiltIns.analyzers`; `IPluginRuntimeBundle.extensions.rules` → `analyzers`; `IScanExtensions.rules` → `analyzers`.
- The kernel filter utility `kernel/util/rule-filter.ts` (`matchesRuleFilter`) is renamed to `analyzer-filter.ts` (`matchesAnalyzerFilter`).

**Testkit (breaking, public)**

- `runRuleOnGraph` → `runAnalyzerOnGraph`.
- `makeRuleContext` → `makeAnalyzerContext`.
- `IRunRuleOptions` → `IRunAnalyzerOptions`.
- Re-exports `IAnalyzer`, `IAnalyzerContext` instead of the `IRule` variants.

**Migration**

Greenfield rename — no fallback. Existing user plugins with `kind: "rule"` and `emitsRuleIds` need to update their manifests. The scaffolder (`sm plugins create`) emits `kind: 'analyzer'` automatically; a future `sm plugins upgrade <id>` will rewrite legacy manifests.

## User-facing

The plugin extension kind was renamed from **Rule** to **Analyzer** to better reflect what these plugins do — they analyze the graph AND project findings into the UI. End-user-visible changes:

- The CLI flag `sm check --rules <ids>` is now `sm check --analyzers <ids>`.
- The `sm check --json` output's per-issue `ruleId` field is now `analyzerId`.
- Hook triggers in plugin manifests rename from `rule.completed` to `analyzer.completed`; the event payload field `ruleId` is now `analyzerId`.
- The Settings → Plugins page lists plugins of kind "analyzer".
- The marketing site shows the satellite as "Analyzer plugin kind" instead of "Rule plugin kind".

If you maintain a custom plugin with `kind: "rule"`, update the manifest to `kind: "analyzer"`, rename `emitsRuleIds` to `emitsAnalyzerIds`, and rename any imported `IRule` / `IRuleContext` symbols to `IAnalyzer` / `IAnalyzerContext`. The directory name and `id` rules remain unchanged.
