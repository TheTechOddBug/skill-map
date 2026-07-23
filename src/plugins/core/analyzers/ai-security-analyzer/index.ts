/**
 * Built-in probabilistic `ai-security-analyzer` Analyzer (user request
 * 2026-07-22, the security lane's HYGIENE half). Judges ONE node for
 * dangerous content the author wrote in good faith: credential values
 * pasted in plain text, piped-to-shell installs (`curl … | bash`),
 * destructive commands with no guardrails, instructions granting or
 * requesting overly broad permissions. Its judgments land in
 * `state_findings` as `type: 'security'` rows (advisory, never
 * exit-code-bearing); read them with `sm findings`.
 *
 * Split from its sibling `core/ai-suspicion-analyzer` (the ADVERSARIAL
 * half) by design: here the AUTHOR owns the problem and fixes their own
 * content, so severities and dismissal read as ordinary hygiene. Ships
 * FINDER-ONLY: a fixer may come later, but redacting a secret is
 * destructive (the value is lost), so most findings are expected to end
 * in `human-decision` rather than an automated edit.
 *
 * As a probabilistic Analyzer it carries NO `evaluate()`: the kernel
 * renders `prompt.md` + the canonical preamble + the report contract
 * into a queued job, an external agent processes it (`sm jobs claim`),
 * and `sm record` validates the JSON report against
 * `report.schema.json`. The job snapshot is BODY-ONLY, and secrets can
 * ride frontmatter fields too, so the prompt instructs reading the LIVE
 * file at the user-content id path (same pattern as the trigger / scope
 * finders).
 *
 * **Structure-as-truth siblings.** `prompt.md` (single `{{userContent}}`
 * placeholder) and `report.schema.json` ($refs the canonical findings
 * envelope and narrows `findings[].type` to the const `'security'`),
 * inlined onto the emitted manifest by the built-ins codegen.
 *
 * GRADUATED to `stability: 'stable'` (enabled by default) on
 * 2026-07-23 after its live playground pass: security hygiene traps (frontmatter token, connection string, curl|bash, unguarded rm -rf, chmod 777) all found with clean controls.
 */

import type { IAnalyzer, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const aiSecurityAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: 'ai-security-analyzer',
  pluginId: PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Finds security problems written in good faith: credentials pasted in plain text, piped-to-shell installs, destructive commands with no guardrails, overly broad permissions.',
  // Graduated 2026-07-23 after its live playground pass.
  stability: 'stable',
  mode: 'probabilistic',
  // ADVISORY wall-clock estimate (Decision #139: never arms a TTL).
  probExpectedDurationSeconds: 60,
  // No precondition: secrets and dangerous commands can appear in any
  // instruction file, `--all` fans out to every non-virtual node.
  // No `evaluate`: probabilistic analyzers have none by contract.
};
