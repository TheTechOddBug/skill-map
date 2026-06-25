/**
 * Getting-started menu for a bare `sm` invocation in an empty folder
 * (no `.skill-map/` project). Per spec/cli-contract.md §Binary: on an
 * interactive terminal the entry point offers two choices, run the
 * guided tutorial (dispatches `sm tutorial`) or drop a ready-to-explore
 * example project (dispatches `sm example`), and routes the chosen verb.
 *
 * Kept out of `cli/entry.ts` so the menu is unit-testable in isolation
 * (the pure `classifyEmptyFolderAnswer` below) and the entry stays lean.
 * Mirrors the readline prompt pattern used by `sm tutorial`'s provider
 * picker (`promptForTarget` in `cli/commands/tutorial.ts`).
 */

import { createInterface } from 'node:readline';

import { tx } from '../../kernel/util/tx.js';
import { ENTRY_TEXTS } from '../i18n/entry.texts.js';
import { type IAnsi } from './ansi.js';

/** The two getting-started verbs the menu dispatches to. */
export type TEmptyFolderChoice = 'tutorial' | 'example';

/** Snapshot of the cwd / terminal state a bare `sm` (no args) sees. */
export interface IBareNoArgsState {
  /** A `.skill-map/` project DB exists in the cwd. */
  hasDb: boolean;
  /** stdin is an interactive terminal (can answer a prompt). */
  isTty: boolean;
  /** The cwd has no entries at all (including dotfiles). */
  isEmptyDir: boolean;
}

/**
 * What bare `sm` (no args) resolves to: either route to a verb's argv,
 * or fall through to the no-project hint (the caller prints it and
 * exits 2).
 */
export type TBareNoArgsResult = { kind: 'route'; argv: string[] } | { kind: 'hint' };

/**
 * Pure routing decision for a bare `sm` (no args), separated from the
 * I/O (FS probes, stdout, `process.exit`) so every branch is unit-
 * testable with an injected `prompt`. Per spec/cli-contract.md §Binary:
 *
 *   - project DB present  -> serve it.
 *   - no DB, empty cwd, interactive terminal -> run the menu; route to
 *     the chosen verb, or fall through to the hint when the operator
 *     gives no valid pick.
 *   - otherwise (non-empty cwd, or non-interactive stdin) -> hint.
 *
 * `prompt` is only invoked in the empty + interactive case, so a
 * non-TTY caller never blocks on stdin.
 */
export async function decideBareNoArgs(
  state: IBareNoArgsState,
  prompt: () => Promise<TEmptyFolderChoice | null>,
): Promise<TBareNoArgsResult> {
  if (state.hasDb) return { kind: 'route', argv: ['serve'] };
  if (state.isTty && state.isEmptyDir) {
    const choice = await prompt();
    if (choice !== null) return { kind: 'route', argv: [choice] };
  }
  return { kind: 'hint' };
}

/**
 * Resolve one trimmed answer to the verb it names, `null` when
 * unrecognised. An empty answer accepts the default (the tutorial,
 * option 1). Accepts the option number (`1` / `2`) or the verb name
 * (`tutorial` / `example`, case-insensitive).
 */
export function classifyEmptyFolderAnswer(trimmed: string): TEmptyFolderChoice | null {
  if (trimmed === '') return 'tutorial';
  if (trimmed === '1') return 'tutorial';
  if (trimmed === '2') return 'example';
  const lower = trimmed.toLowerCase();
  if (lower === 'tutorial') return 'tutorial';
  if (lower === 'example') return 'example';
  return null;
}

/**
 * Render the two-option menu to `stderr`, read the operator's pick from
 * `stdin` (an interactive TTY), and return the chosen verb. Bounded
 * re-ask: an unrecognised answer re-asks; the cap stops a misbehaving
 * stdin from looping forever. Returns `null` when no valid pick lands
 * within the attempt budget (the caller falls back to the hint).
 */
export async function promptEmptyFolderChoice(
  stdin: NodeJS.ReadStream,
  stderr: NodeJS.WriteStream,
  ansi: IAnsi,
): Promise<TEmptyFolderChoice | null> {
  const menu = [
    tx(ENTRY_TEXTS.emptyMenuHeader, { glyph: ansi.yellow('?') }),
    ENTRY_TEXTS.emptyMenuOptionTutorial,
    ENTRY_TEXTS.emptyMenuOptionExample,
  ].join('\n');
  stderr.write(menu + '\n');

  const rl = createInterface({ input: stdin, output: stderr });
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const answer = await new Promise<string>((resolveP) =>
        rl.question(ENTRY_TEXTS.emptyMenuInput, resolveP),
      );
      const choice = classifyEmptyFolderAnswer(answer.trim());
      if (choice !== null) return choice;
    }
    return null;
  } finally {
    rl.close();
  }
}
