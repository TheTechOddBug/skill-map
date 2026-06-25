/**
 * `backtick-balance` analyzer. Flags an UNCLOSED backtick in a node's
 * Markdown body, a body-syntax defect the JSON Schemas cannot express.
 *
 * Why it matters: the kernel's code-strip policy (see
 * `spec/architecture.md` §Extractor · code-region file references)
 * assumes every fence and inline span is balanced. An opening fence with
 * no closer makes `stripCodeBlocks` treat the whole remainder of the file
 * as code, so the prose-side extractors (`markdown-link`, `at-directive`,
 * `slash-command`, `external-url-counter`) see a blank body past the
 * dangling fence and stop emitting real edges.
 *
 * Two checks, in order, over the post-frontmatter body:
 *
 *   1. Fenced block balance. A line opening with `` ``` `` / `~~~`
 *      toggles fence state (a closer must use the same fence char). If a
 *      fence is still open at EOF, emit ONE finding for the unclosed
 *      block and STOP, the broken mask would make the inline pass below
 *      pure noise ("fence cuts the inline count").
 *   2. Inline span balance. Only when every fence is balanced. Mask the
 *      fenced lines (preserving line numbers), mask backslash-escaped
 *      chars (a literal `` \` `` is text in CommonMark, never opens a
 *      span), then pair backtick runs by the CommonMark rule: a run of N
 *      backticks is closed by the next run of EXACTLY N. The first run
 *      with no equal-length closer is the unclosed inline backtick.
 *
 * The graph carries `node.bytes.body` (the byte size, not the text), so
 * the analyzer re-reads each file from disk, resolving `node.path`
 * against `IAnalyzerContext.cwd`. Virtual nodes and unreadable files are
 * skipped. Reported lines are relative to the FILE (body line plus the
 * frontmatter's line height). Severity is fixed `warn`, consistent with
 * the other body-level core analyzers.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue } from '../../../../kernel/types.js';
import { tx } from '../../../../kernel/util/tx.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { BACKTICK_BALANCE_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'backtick-balance';

/** Line opening a fenced code block: three or more backticks or tildes. */
const FENCE = /^\s*(`{3,}|~{3,})/;
/** Leading YAML frontmatter block, stripped before body analysis. */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export const backtickBalanceAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description: 'Flags an unclosed backtick (fenced block or inline span) in a node body.',
  mode: 'deterministic',

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const cwd = ctx.cwd ?? process.cwd();
    const issues: Issue[] = [];
    for (const node of ctx.nodes) {
      if (node.virtual) continue;
      const raw = readBody(resolve(cwd, node.path));
      if (raw === null) continue;
      const issue = analyseBody(raw, node.path);
      if (issue) issues.push(issue);
    }
    return issues;
  },
};

// --- internal helpers ------------------------------------------------------

/** Read a file as UTF-8, returning `null` when it cannot be read. */
function readBody(absPath: string): string | null {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Run both balance checks over one file's content and return the single
 * finding (fence first, then inline), or `null` when balanced.
 */
function analyseBody(raw: string, nodePath: string): Issue | null {
  const fmMatch = FRONTMATTER.exec(raw);
  const frontmatterLines = fmMatch ? countNewlines(fmMatch[0]) : 0;
  const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;

  const { masked, unclosedFence, openFenceLine } = maskFences(body);
  if (unclosedFence) {
    return {
      analyzerId: ID,
      severity: 'warn',
      nodeIds: [nodePath],
      message: formatFinding({
        lines: [openFenceLine + frontmatterLines],
        body: tx(BACKTICK_BALANCE_TEXTS.unclosedFence),
      }),
      fix: { summary: BACKTICK_BALANCE_TEXTS.unclosedFenceFix },
      data: { kind: 'fence', line: openFenceLine + frontmatterLines },
    };
  }

  const idx = firstUnclosedRun(maskEscapes(masked));
  if (idx < 0) return null;
  const bodyLine = lineOf(masked, idx);
  const fileLine = bodyLine + frontmatterLines;
  return {
    analyzerId: ID,
    severity: 'warn',
    nodeIds: [nodePath],
    message: formatFinding({
      lines: [fileLine],
      body: tx(BACKTICK_BALANCE_TEXTS.unclosedInline),
    }),
    detail: body.split('\n')[bodyLine - 1]?.trim() ?? null,
    fix: { summary: BACKTICK_BALANCE_TEXTS.unclosedInlineFix },
    data: { kind: 'inline', line: fileLine },
  };
}

interface IFenceMask {
  /** Body with fenced-code lines blanked, line numbers preserved. */
  masked: string;
  /** True when a fence is still open at end of body. */
  unclosedFence: boolean;
  /** 1-indexed body line of the still-open fence (meaningful when `unclosedFence`). */
  openFenceLine: number;
}

/** Blank out fenced-code lines while preserving line numbers. */
function maskFences(body: string): IFenceMask {
  const out: string[] = [];
  let open = false;
  let fenceChar = '';
  let openFenceLine = 0;
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = FENCE.exec(line);
    if (m) {
      const ch = m[1]![0]!;
      if (!open) {
        open = true;
        fenceChar = ch;
        openFenceLine = i + 1;
      } else if (ch === fenceChar) {
        open = false;
        fenceChar = '';
      }
      out.push(''); // the fence marker line is not prose
      continue;
    }
    out.push(open ? '' : line); // blank everything inside a fence
  }
  return { masked: out.join('\n'), unclosedFence: open, openFenceLine };
}

/**
 * Mask backslash-escaped chars (`\x` -> two spaces) so a literal `` \` ``
 * in prose is not counted as a span opener. Two spaces keep char indices
 * and line numbers stable. Apply to the fence-masked text BEFORE
 * `firstUnclosedRun`.
 */
function maskEscapes(text: string): string {
  return text.replace(/\\[^\n]/g, '  ');
}

/** Return the char index of the first unmatched backtick run, or -1. */
function firstUnclosedRun(text: string): number {
  const re = /`+/g;
  const runs: { len: number; idx: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) runs.push({ len: m[0].length, idx: m.index });
  let i = 0;
  while (i < runs.length) {
    const open = runs[i]!;
    let j = i + 1;
    while (j < runs.length && runs[j]!.len !== open.len) j++; // skip span content
    if (j >= runs.length) return open.idx; // no equal-length closer
    i = j + 1; // span [i..j] consumed, continue after the closer
  }
  return -1;
}

/** 1-indexed line number of `idx` within `text`. */
function lineOf(text: string, idx: number): number {
  return text.slice(0, idx).split('\n').length;
}

/** Count `\n` occurrences in a string (the line height it consumes). */
function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\n') n++;
  }
  return n;
}
