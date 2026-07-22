/**
 * Built-in probabilistic `ai-suspicion-analyzer` Analyzer (user request
 * 2026-07-22, the security lane's ADVERSARIAL half). Judges ONE node
 * for content that looks designed to manipulate an AI agent: injection
 * attempts, instructions hidden from human readers, purpose-foreign
 * exfiltration requests, attempts to weaken safety behavior. Its
 * judgments land in `state_findings` as `type: 'suspicion'` rows.
 *
 * Split from its sibling `core/ai-security-analyzer` (the HYGIENE half)
 * by design: here the author may be the VICTIM, not the responsible
 * party, so the right response is review / quarantine. This finder
 * NEVER gets a fixer: an automated fixer would hand edit permissions to
 * an agent reading content designed precisely to manipulate agents.
 *
 * Complements (never replaces) the kernel safety lane: the reserved
 * `injection-detected` / `content-suspicious` / `content-malformed`
 * rows are the processing model's PASSIVE self-report (the `safety`
 * block of every probabilistic report, promoted to `origin: 'kernel'`
 * rows at record time, `kernel/jobs/findings-report.ts`). This finder
 * is the ACTIVE, operator-selected judgment: its own prompt, per-finding
 * severity / detail / confidence, `origin: 'extension'` rows under its
 * own non-reserved slug.
 *
 * As a probabilistic Analyzer it carries NO `evaluate()`: prompt.md +
 * preamble + report contract render into a queued job; `sm record`
 * validates against `report.schema.json`. The snapshot is BODY-ONLY and
 * hidden instructions can ride frontmatter too, so the prompt instructs
 * reading the LIVE file at the user-content id path, with an extra
 * hardened treat-as-data framing (this finder reads hostile content by
 * definition).
 *
 * GRADUATED to `stability: 'stable'` (enabled by default) on
 * 2026-07-23 after its live playground pass: adversarial traps (hidden HTML-comment exfiltration, role-swap override, .env exfiltration fallback) all found with the legit-agent-instruction and quoted-attack controls untouched.
 */

import type { IAnalyzer, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

export const aiSuspicionAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: 'ai-suspicion-analyzer',
  pluginId: PLUGIN_ID,
  kind: 'analyzer',
  description:
    'Flags content that looks designed to manipulate an AI agent: injection attempts, instructions hidden from human readers, or requests to leak data that has nothing to do with the file.',
  // Graduated 2026-07-23 after its live playground pass.
  stability: 'stable',
  mode: 'probabilistic',
  // ADVISORY wall-clock estimate (Decision #139: never arms a TTL).
  probExpectedDurationSeconds: 60,
  // No precondition: an adversarial payload can hide in any instruction
  // file, `--all` fans out to every non-virtual node.
  // No `evaluate`: probabilistic analyzers have none by contract.
};
