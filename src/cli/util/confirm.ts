/**
 * Interactive yes/no prompt helper used by destructive verbs
 * (`sm db restore`, `sm db reset --state`, `sm db reset --hard`,
 * `sm orphans undo-rename`).
 *
 * Writes the question + `[y/N] ` suffix to the supplied `stderr`. The
 * affirmative-answer regex is sourced from `UTIL_TEXTS` so a future
 * non-English locale can extend the alternation without touching this
 * helper. Match is trimmed and case-insensitive; any other answer
 * (including empty) returns false.
 *
 * Streams are supplied by the caller (typically `this.context.stdin` /
 * `this.context.stderr` from Clipanion) so commands can be tested with
 * captured streams instead of monkey-patching `process.*`.
 */

import { createInterface } from 'node:readline';

import type { Readable, Writable } from 'node:stream';

import { UTIL_TEXTS } from '../i18n/util.texts.js';

export interface IConfirmStreams {
  stdin: Readable;
  stderr: Writable;
}

export interface IConfirmOptions {
  /**
   * Which way to interpret an empty answer (user hits Enter).
   * `'no'` (default) → safe default for destructive prompts (prune, db
   * reset, etc). `'yes'` → friendlier default for consent-style prompts
   * where the user already triggered the action and is just
   * acknowledging it (the `.sm` write consent gate).
   *
   * The visible suffix flips with the default: `[y/N]` when `'no'`,
   * `[Y/n]` when `'yes'`. The yes-pattern is unchanged — typing `y` /
   * `yes` always matches yes, typing `n` / `no` always matches no; the
   * default only resolves the empty-answer case.
   */
  defaultAnswer?: 'yes' | 'no';
}

const YES_PATTERN = new RegExp(UTIL_TEXTS.confirmYesPatternSource, 'i');
const NO_PATTERN = new RegExp(UTIL_TEXTS.confirmNoPatternSource, 'i');

export async function confirm(
  question: string,
  streams: IConfirmStreams,
  opts?: IConfirmOptions,
): Promise<boolean> {
  const defaultAnswer = opts?.defaultAnswer ?? 'no';
  const suffix =
    defaultAnswer === 'yes'
      ? UTIL_TEXTS.confirmPromptSuffixDefaultYes
      : UTIL_TEXTS.confirmPromptSuffix;
  const rl = createInterface({ input: streams.stdin, output: streams.stderr });
  try {
    const answer = await new Promise<string>((resolveP) =>
      rl.question(`${question}${suffix}`, resolveP),
    );
    const trimmed = answer.trim();
    if (trimmed === '') return defaultAnswer === 'yes';
    if (YES_PATTERN.test(trimmed)) return true;
    if (NO_PATTERN.test(trimmed)) return false;
    // Anything else (gibberish): fall back to the default to mirror the
    // pre-2-pattern behaviour where non-matching answers returned false
    // and now, when the default is yes, return true. Keeps the prompt
    // ergonomic without forcing the operator to retype.
    return defaultAnswer === 'yes';
  } finally {
    rl.close();
  }
}
