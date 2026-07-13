/**
 * `ClaudeCliRunner`, the reference `RunnerPort` implementation (Step 10
 * Phase E, spec `architecture.md` §RunnerPort). Spawns the `claude` binary
 * in non-interactive print mode (`claude -p`) and returns the model's JSON
 * report plus runner-side metrics.
 *
 * **Content delivery: stdin.** The rendered job content is piped into the
 * subprocess's stdin (`claude -p` reads the prompt from stdin when piped),
 * so no temp file is materialized at all. The port contract blesses either
 * stdin or an ephemeral temp file as operational choices; stdin wins here
 * because it has no lifecycle to clean up and no arg-length ceiling.
 *
 * **Report extraction (tolerant, documented).** The runner asks for
 * `--output-format json`, so stdout normally carries the print-mode
 * envelope (`{ result: "<model text>", usage: { input_tokens,
 * output_tokens }, ... }`). Extraction is layered so a drifting CLI
 * version degrades instead of breaking:
 *   1. Parse stdout as the envelope; take `result` as the model text and
 *      `usage.*` as the token counts. If stdout is not the envelope, treat
 *      the raw stdout as the model text (tokens report 0).
 *   2. From the model text, extract the report: the whole text when it IS
 *      one JSON object; else the LAST parseable fenced ``` block; else the
 *      LAST balanced bare `{...}` object found by a string-aware scan.
 *   3. Nothing extractable -> the trimmed model text is returned verbatim
 *      (the record path's schema validation then fails it as
 *      `report-invalid`, which is the honest outcome).
 *
 * **Failure surfaces.**
 *   - Missing binary (spawn ENOENT) -> the typed `ClaudeCliNotFoundError`;
 *     the CLI maps it to exit 2 with a "claude CLI not found" advisory.
 *   - `timeoutMs` expiry -> the subprocess is killed and the result carries
 *     `exitCode = TIMEOUT_EXIT_CODE` (124, the `timeout(1)` convention);
 *     the caller records the run as a runner failure.
 *   - Non-zero subprocess exit -> `IRunResult` with that exit code. When
 *     stdout is empty, `reportJson` carries a trimmed stderr excerpt so the
 *     recorded failure detail names the actual error.
 */

import { spawn, spawnSync } from 'node:child_process';

import type { IRunOptions, IRunResult, RunnerPort } from '../../ports/runner.js';

/** Conventional `timeout(1)` exit code reported when the budget expires. */
export const TIMEOUT_EXIT_CODE = 124;

/** Cap on the stderr excerpt folded into a failed run's `reportJson`. */
const STDERR_EXCERPT_CHARS = 2000;

/**
 * Typed "binary not on PATH" error (spawn ENOENT). The CLI-runner loop
 * catches this specifically and exits 2 with an install advisory, per the
 * ROADMAP Phase E line (`missing binary -> exit 2`).
 */
export class ClaudeCliNotFoundError extends Error {
  constructor(binary: string) {
    super(`claude CLI not found (binary '${binary}' is not on PATH)`);
    this.name = 'ClaudeCliNotFoundError';
  }
}

export interface IClaudeCliRunnerOptions {
  /** Binary to spawn. Default `claude`. Overridable for tests / forks. */
  binary?: string;
}

/** Result of `probeClaudeCli` (`sm doctor`'s runner-availability check). */
export interface IClaudeCliProbe {
  /** True when the binary spawned and exited 0. */
  available: boolean;
  /** First line of `<binary> --version` stdout when available, else `null`. */
  version: string | null;
}

/**
 * Probe LLM-runner availability for `sm doctor`: spawn
 * `<binary> --version` synchronously (bounded by `timeoutMs`, default
 * 5s) and report the version line. ENOENT (binary not on PATH),
 * non-zero exit, and timeout all report `available: false`; the probe
 * never throws.
 */
export function probeClaudeCli(binary = 'claude', timeoutMs = 5000): IClaudeCliProbe {
  try {
    const child = spawnSync(binary, ['--version'], {
      encoding: 'utf8',
      timeout: timeoutMs,
    });
    if (child.error || child.status !== 0) return { available: false, version: null };
    return { available: true, version: firstNonEmptyLine(child.stdout) };
  } catch {
    return { available: false, version: null };
  }
}

/** First line of the probe stdout, trimmed; `null` when blank / absent. */
function firstNonEmptyLine(stdout: string | null | undefined): string | null {
  const line = (stdout ?? '').split('\n')[0]?.trim();
  return line ? line : null;
}

/** Envelope-parse + report-extraction result (see `extractRunReport`). */
export interface IExtractedReport {
  reportJson: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Parse the print-mode stdout into `{ reportJson, tokensIn, tokensOut }`:
 * unwrap the `--output-format json` envelope when present (summing
 * `usage.input_tokens` + the prompt-cache fields for `tokensIn`, taking
 * `usage.output_tokens` for `tokensOut`), then extract the report
 * object from the model text via `extractReportJson`. Falls back to the
 * trimmed text when no JSON object is extractable (the record path's
 * validation owns the rejection). Exported for unit tests.
 */
export function extractRunReport(stdout: string): IExtractedReport {
  const envelope = parsePrintEnvelope(stdout);
  const reportJson = extractReportJson(envelope.resultText) ?? envelope.resultText.trim();
  return { reportJson, tokensIn: envelope.tokensIn, tokensOut: envelope.tokensOut };
}

/**
 * Extract the last JSON OBJECT from free-form model text, tolerant to the
 * shapes a model actually emits: the bare object, a fenced ``` / ```json
 * block, or an object embedded in prose. Returns the matched substring
 * (not re-serialized), or `null` when no parseable object exists. Arrays
 * and scalars are deliberately not accepted, a report is always an object.
 */
export function extractReportJson(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (isJsonObject(trimmed)) return trimmed;
  // Fenced blocks, last one wins (a model that retries emits the final
  // corrected report last).
  const fences = [...trimmed.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)];
  for (let i = fences.length - 1; i >= 0; i -= 1) {
    const body = fences[i]![1]!.trim();
    if (isJsonObject(body)) return body;
  }
  return scanLastBareObject(trimmed);
}

function isJsonObject(candidate: string): boolean {
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * Forward scan for top-level balanced `{...}` spans (string-aware, so
 * braces inside JSON strings don't break the count); the LAST span that
 * parses as an object wins. Scanning forward and skipping past each
 * matched span keeps nested objects (e.g. a report's inner `safety`
 * object) from being returned as fragments.
 */
function scanLastBareObject(text: string): string | null {
  let last: string | null = null;
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start === -1) break;
    const end = matchClosingBrace(text, start);
    if (end === -1) {
      i = start + 1;
      continue;
    }
    const candidate = text.slice(start, end + 1);
    if (isJsonObject(candidate)) {
      last = candidate;
      i = end + 1;
    } else {
      i = start + 1;
    }
  }
  return last;
}

/** Index of the `}` closing the `{` at `start`, or `-1` when unbalanced. */
function matchClosingBrace(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      i = skipJsonString(text, i);
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/**
 * Skip a JSON string literal: `start` points at the opening quote; returns
 * the index just past the closing quote (escape-aware), or the text end
 * when unterminated.
 */
function skipJsonString(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '"') return i + 1;
    i += 1;
  }
  return text.length;
}

interface IParsedEnvelope {
  resultText: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Unwrap the `claude -p --output-format json` envelope. Not-an-envelope
 * (older CLI, `--output-format` unsupported, plain text) degrades to the
 * raw stdout with zero token counts, the extraction layer above still
 * finds the report inside the text.
 *
 * `tokensIn` sums `usage.input_tokens` PLUS the prompt-caching fields
 * (`cache_creation_input_tokens`, `cache_read_input_tokens`, each
 * defaulting to 0 when absent): with caching active the bulk of the real
 * input arrives in the cache fields and `input_tokens` alone undercounts
 * the run by orders of magnitude.
 */
function parsePrintEnvelope(stdout: string): IParsedEnvelope {
  try {
    const doc = JSON.parse(stdout.trim()) as unknown;
    if (doc !== null && typeof doc === 'object' && !Array.isArray(doc)) {
      const record = doc as Record<string, unknown>;
      if (typeof record['result'] === 'string') {
        const usage =
          record['usage'] !== null && typeof record['usage'] === 'object'
            ? (record['usage'] as Record<string, unknown>)
            : {};
        return {
          resultText: record['result'],
          tokensIn:
            toTokenCount(usage['input_tokens']) +
            toTokenCount(usage['cache_creation_input_tokens']) +
            toTokenCount(usage['cache_read_input_tokens']),
          tokensOut: toTokenCount(usage['output_tokens']),
        };
      }
    }
  } catch {
    // Not the envelope; fall through to raw text.
  }
  return { resultText: stdout, tokensIn: 0, tokensOut: 0 };
}

function toTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export class ClaudeCliRunner implements RunnerPort {
  private readonly binary: string;

  constructor(options: IClaudeCliRunnerOptions = {}) {
    this.binary = options.binary ?? 'claude';
  }

  async run(jobContent: string, options: IRunOptions = {}): Promise<IRunResult> {
    const args = ['-p', '--output-format', 'json'];
    if (options.model !== undefined) args.push('--model', options.model);
    const startedAt = Date.now();

    return new Promise<IRunResult>((resolvePromise, rejectPromise) => {
      const child = spawn(this.binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let timer: NodeJS.Timeout | null = null;

      if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, options.timeoutMs);
        // Never keep the event loop alive just for the kill timer.
        timer.unref();
      }

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (timer !== null) clearTimeout(timer);
        rejectPromise(
          err.code === 'ENOENT' ? new ClaudeCliNotFoundError(this.binary) : err,
        );
      });

      child.on('close', (code, signal) => {
        if (timer !== null) clearTimeout(timer);
        const durationMs = Date.now() - startedAt;
        // Killed by the budget -> the timeout convention code; killed by an
        // external signal -> generic failure (1); else the real exit code.
        const exitCode = timedOut ? TIMEOUT_EXIT_CODE : code ?? (signal !== null ? 1 : 0);
        const extracted = extractRunReport(stdout);
        // A failed run with silent stdout still deserves a diagnosable
        // detail: fold a stderr excerpt into the report slot (the caller
        // records it as the failure text, never as a report).
        const reportJson =
          exitCode !== 0 && extracted.reportJson === ''
            ? stderr.trim().slice(0, STDERR_EXCERPT_CHARS)
            : extracted.reportJson;
        resolvePromise({
          reportJson,
          tokensIn: extracted.tokensIn,
          tokensOut: extracted.tokensOut,
          durationMs,
          exitCode,
        });
      });

      // EPIPE fires when the child dies before draining stdin (e.g. ENOENT
      // or an early crash); the 'error' / 'close' handlers own the outcome.
      child.stdin.on('error', () => undefined);
      child.stdin.end(jobContent);
    });
  }
}
