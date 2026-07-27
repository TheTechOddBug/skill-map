/**
 * Shared write-through machinery for the sidecar-backed dismissal verbs
 * (`sm findings dismiss --class` / `sm findings undismiss`,
 * `sm issues dismiss` / `sm issues undismiss`): the `.sm` consent gate
 * (mirror of `sm bump`) and the `scan_nodes.annotations_json` mirror
 * refresh that keeps every read surface honest without a scan.
 * Extracted from `cli/commands/findings.ts` when `sm issues` landed so
 * the two verb families ride one implementation.
 */

import type { StoragePort } from '../../kernel/ports/storage.js';
import { readSidecarFor } from '../../kernel/sidecar/index.js';
import { tx } from '../../kernel/util/tx.js';
import { EConsentRequiredError } from '../../core/config/sidecar-consent.js';
import { CONSENT_TEXTS } from '../i18n/consent.texts.js';
import type { IAnsi } from './ansi.js';
import { confirm } from './confirm.js';
import { ExitCode, type TExitCode } from './exit-codes.js';

/** Options for {@link runWithSidecarConsentGate}. */
export interface ISidecarConsentGateOptions {
  /** User-visible verb prefix for the directed messages (e.g. `'sm issues dismiss'`). */
  verb: string;
  /** Current `--yes` state; `true` means consent was already granted. */
  yes: boolean;
  /** Flip the caller's `--yes` after an interactive accept, so the re-dispatch persists the grant. */
  setYes: () => void;
  stdin: NodeJS.ReadStream;
  stderr: NodeJS.WriteStream;
  ansi: IAnsi;
  printError: (message: string) => void;
  /** The sidecar-writing operation; may throw `EConsentRequiredError` BEFORE any disk write. */
  dispatch: () => Promise<TExitCode>;
}

/**
 * The `.sm` consent gate shared by the sidecar-writing dismissal verbs,
 * mirror of `sm bump`: on the first `EConsentRequiredError`, prompt when
 * stdin is a TTY and `--yes` was not passed; on accept flip `--yes` (via
 * `setYes`) and re-run the dispatch (the second pass passes
 * `always: true` and persists the flag). On decline or non-TTY without
 * `--yes`, print the directed message + exit 2.
 */
export async function runWithSidecarConsentGate(
  opts: ISidecarConsentGateOptions,
): Promise<TExitCode> {
  try {
    return await opts.dispatch();
  } catch (err) {
    if (!(err instanceof EConsentRequiredError)) throw err;
    const isTTY = opts.stdin.isTTY === true;
    if (!isTTY || opts.yes) {
      opts.printError(
        tx(CONSENT_TEXTS.consentRequiredNonTty, {
          glyph: opts.ansi.red('✕'),
          verb: opts.verb,
          hint: opts.ansi.dim(CONSENT_TEXTS.consentRequiredNonTtyHint),
        }),
      );
      return ExitCode.Error;
    }
    const ok = await confirm(
      tx(CONSENT_TEXTS.consentPrompt, { glyph: opts.ansi.cyan('ℹ') }),
      { stdin: opts.stdin, stderr: opts.stderr },
      { defaultAnswer: 'yes' },
    );
    if (!ok) {
      opts.printError(
        tx(CONSENT_TEXTS.consentAborted, { glyph: opts.ansi.cyan('ℹ'), verb: opts.verb }),
      );
      return ExitCode.Error;
    }
    opts.setYes();
    return await opts.dispatch();
  }
}

/**
 * Write-through half of a sidecar suppression edit (`dismiss` /
 * `undismiss`, findings and issues alike): re-read the just-written
 * `.sm` and mirror its `annotations` block into
 * `scan_nodes.annotations_json`, so every read surface (the findings
 * view, the card counters, the suppression listings) sees the change
 * without a scan and without per-node file reads (`spec/db-schema.md`
 * §state_findings, read-time suppression lens; §scan_issues,
 * emission-time issue suppressions). The sidecar stays the source of
 * truth; a hand-edited `.sm` reconciles at the next scan.
 */
export async function refreshAnnotationsMirror(
  adapter: StoragePort,
  nodeId: string,
  mdAbs: string,
): Promise<void> {
  const annotations = readSidecarFor(mdAbs).parsed?.annotations ?? null;
  await adapter.scans.refreshAnnotations(nodeId, annotations);
}
