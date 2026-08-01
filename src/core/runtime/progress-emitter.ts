/**
 * `createStderrProgressEmitter(stderr)`, `ProgressEmitterPort` that
 * writes a stderr line every time the orchestrator emits an
 * `extension.error` event.
 *
 * Why: the orchestrator drops links / issues that violate their
 * contract (e.g. an extractor emitting a link kind outside the spec's
 * closed enum, a rule emitting an issue with an out-of-spec severity). Without surfacing the drop, a plugin author
 * sees their link / issue silently disappear from the result with no
 * explanation, the worst possible plugin-author UX. This helper wires
 * those events to stderr so authors get a clear pointer at the offending
 * extension.
 *
 * Other event kinds (`scan.started` / `scan.progress` / `scan.completed`)
 * stay in-memory: the CLI already prints a structured summary and we
 * don't want to flood stderr with progress noise.
 *
 * Lives under `core/runtime/` so the BFF (`src/server/`) and the
 * scan-runner can build a stderr-aware progress port without crossing
 * into `src/cli/`. Historic `cli/util/cli-progress-emitter.ts` keeps
 * working through a re-export shim there.
 */

import { InMemoryProgressEmitter } from '../../kernel/adapters/in-memory-progress.js';
import type { ProgressEmitterPort, ProgressEvent } from '../../kernel/ports/progress-emitter.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { PROGRESS_EMITTER_TEXTS } from './i18n/progress-emitter.texts.js';

const EXTENSION_ERROR = 'extension.error';

/** 256-color yellow used when the caller enables ANSI color. */
const ESC_YELLOW = '\x1b[38;5;214m';
const ESC_RESET = '\x1b[0m';

interface IExtensionErrorData {
  kind: string;
  extensionId: string;
  message: string;
  [key: string]: unknown;
}

export interface ICreateStderrProgressEmitterOpts {
  /**
   * When true, the warning glyph (⚠) is wrapped in a yellow ANSI
   * escape sequence. When false (default), the glyph prints unstyled
   * so non-TTY pipes stay grep-friendly. CLI verbs resolve color via
   * `cli/util/ansi.ts: ansiFor(...)` and forward the boolean here.
   */
  colorEnabled?: boolean;
}

export function createStderrProgressEmitter(
  stderr: NodeJS.WritableStream,
  opts: ICreateStderrProgressEmitterOpts = {},
): ProgressEmitterPort {
  const inner = new InMemoryProgressEmitter();
  const glyph = opts.colorEnabled === true
    ? `${ESC_YELLOW}⚠${ESC_RESET}`
    : '⚠';
  return {
    emit(event: ProgressEvent): void {
      if (event.type === EXTENSION_ERROR) {
        const data = event.data as IExtensionErrorData | undefined;
        // Sanitise at this choke point, the single place every
        // `extension.error` payload becomes terminal bytes (audit
        // finding, 2026-08-01). The message is plugin-authored, and
        // several built-in emissions interpolate extractor-supplied
        // virtual-node paths, which are derived from scanned content
        // and therefore attacker-authored under clone-and-scan.
        const message = sanitizeForTerminal(
          data?.message ?? PROGRESS_EMITTER_TEXTS.extensionErrorNoDetail,
        );
        stderr.write(tx(PROGRESS_EMITTER_TEXTS.extensionError, { glyph, message }));
      }
      inner.emit(event);
    },
    subscribe: (listener) => inner.subscribe(listener),
  };
}

/**
 * `ProgressEmitterPort` that serialises every event as one ndjson line
 * on the supplied stream, the normative `json` transport of
 * `spec/job-events.md` (`sm record --json`, the canonical synthetic-run
 * envelope emission). Serialisation is plain `JSON.stringify` of the
 * envelope; consumers parse line by line. Subscribers still receive the
 * event objects (the port contract), so a caller can compose ndjson
 * output with in-process listeners.
 */
export function createNdjsonProgressEmitter(
  stream: { write(chunk: string): unknown },
): ProgressEmitterPort {
  const inner = new InMemoryProgressEmitter();
  return {
    emit(event: ProgressEvent): void {
      stream.write(JSON.stringify(event) + '\n');
      inner.emit(event);
    },
    subscribe(listener) {
      return inner.subscribe(listener);
    },
  };
}
