/**
 * Shared surface reader for the `spec/cli-contract.md` guard family.
 *
 * Four integration guards sit on top of this module, each closing a
 * class of defect that unit tests structurally cannot see, because
 * nothing else in the suite verifies that what the CONTRACT promises
 * actually RUNS:
 *
 *   1. `contract-flag-coverage.spec.ts`, every documented flag exists.
 *   2. `contract-flag-values.spec.ts`, every documented enumerated
 *      flag VALUE is accepted at runtime.
 *   3. `contract-json-stdout.spec.ts`, `--json` keeps stdout clean.
 *   4. `contract-elapsed-ms.spec.ts`, object payloads carry `elapsedMs`.
 *
 * The contract is prose, so parsing it is inherently brittle. The
 * mitigation is NOT to parse defensively (a parser that quietly matches
 * nothing turns every guard vacuous, which is worse than no guard at
 * all); it is to make the brittleness LOUD. Every consumer asserts a
 * plausibility floor on what came back before it asserts anything else,
 * so an upstream reformat fails as "the parser's assumptions broke"
 * instead of passing green while checking zero cases.
 *
 * What counts as a "command cell": the first column of the verb tables
 * (`| \`sm graph [--format ascii\|mermaid\|dot\|json]\` | ... |`) plus
 * the `####`-level verb headings (`#### \`sm doctor\``), which is where
 * the table-less verbs (`init`, `doctor`, `version`, `help`, `tutorial`,
 * `example`) are documented. Nothing else is scanned; fenced example
 * blocks are deliberately out of scope because an illustrative
 * invocation is not a flag declaration.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `src/`, the CLI workspace root. */
export const SRC_ROOT = resolve(HERE, '..', '..', '..');
/** Repository root, the parent of every workspace. */
export const REPO_ROOT = resolve(SRC_ROOT, '..');
/** The published `sm` entry point; loads `src/dist/cli.js`. */
export const BIN = join(SRC_ROOT, 'bin', 'sm.js');
/** The normative CLI contract these guards read. */
export const CONTRACT_PATH = join(REPO_ROOT, 'spec', 'cli-contract.md');
/** Project-local scratch root, per the repo's `.tmp/` temp-file rule. */
export const SCRATCH_ROOT = join(SRC_ROOT, '.tmp', 'contract-guards');

// --- Running the real binary -------------------------------------------

export interface ISmResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

export interface ISmOptions {
  cwd: string;
  /** Hard cap; a case that exceeds it is reported via `signal`. */
  timeoutMs?: number;
}

/**
 * Spawn the real CLI. Hermetic on purpose: `NO_COLOR` pins plain bytes
 * so stdout parses as JSON without ANSI noise, and the update-check and
 * telemetry kill switches keep the child off the network (an unpinned
 * spawn can stall on a blocked network, and `spawnSync` without a
 * timeout would hang the whole suite).
 */
export function sm(args: readonly string[], options: ISmOptions): ISmResult {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 60_000,
    // `sm help --format json` alone is ~210 KB; the 1 MB default would
    // silently truncate a larger surface into unparseable JSON, which
    // is the exact failure mode these guards exist to catch.
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      NO_COLOR: '1',
      SM_NO_UPDATE_CHECK: '1',
      SKILL_MAP_TELEMETRY: '0',
    },
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// --- `sm help --format json` -------------------------------------------

export interface IHelpFlag {
  name: string;
  aliases: string[];
  type: 'boolean' | 'string';
  description: string;
  required: boolean;
}

export interface IHelpVerb {
  name: string;
  category: string;
  description: string;
  flags: IHelpFlag[];
  exitCodes: number[];
}

export interface IHelpGlobalFlag {
  name: string;
  type: 'boolean' | 'string';
  description: string;
}

export interface IHelpSurface {
  cliVersion: string;
  specVersion: string;
  globalFlags: IHelpGlobalFlag[];
  verbs: IHelpVerb[];
}

/**
 * Read the runtime's own surface dump. This is a faithful mirror of the
 * code (its completeness is separately guarded), which is why the
 * guards diff the contract against it instead of shelling out once per
 * documented flag.
 */
export function loadHelpSurface(cwd: string): IHelpSurface {
  const result = sm(['help', '--format', 'json'], { cwd });
  if (result.status !== 0) {
    throw new Error(`\`sm help --format json\` exited ${result.status}: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as IHelpSurface;
}

/** Every flag spelling a verb answers to, long form plus aliases. */
export function flagSpellings(verb: IHelpVerb): Map<string, IHelpFlag> {
  const spellings = new Map<string, IHelpFlag>();
  for (const flag of verb.flags) {
    spellings.set(flag.name, flag);
    for (const alias of flag.aliases) spellings.set(alias, flag);
  }
  return spellings;
}

// --- Parsing the contract ----------------------------------------------

export interface IContractFlag {
  /** Long or short spelling exactly as the contract writes it. */
  name: string;
  /**
   * The argument placeholder the contract shows after the flag
   * (`<node.path>`, `N`, `ascii|mermaid|dot|json`), or `null` when the
   * contract writes the flag as a bare switch.
   */
  argument: string | null;
}

export interface IContractVerb {
  /** Verb path as the CLI names it (`db migrate`), when resolvable. */
  verb: string;
  /** `false` when no prefix of the documented words is a real verb. */
  resolved: boolean;
  flags: Map<string, IContractFlag>;
  /** The raw command cells this entry was built from, for messages. */
  sources: string[];
}

export interface IContractSurface {
  verbs: Map<string, IContractVerb>;
  /** How many command cells the parser matched; the vacuity tripwire. */
  cellCount: number;
}

/**
 * A command cell is a `\`sm ...\`` code span opening either a table row
 * or a verb heading. Table cells escape the alternation pipe (`\|`)
 * because a bare pipe would close the column, headings do not; the
 * unescape below normalises both to the same text.
 */
const COMMAND_CELL_RE = /^(?:\|\s*|#{3,6}\s+)`(sm [^`]*)`/;

/**
 * Flag spellings inside a command cell. The lookbehind/lookahead pair
 * keeps the short-flag branch from firing inside a long flag or a
 * hyphenated word (`--no-open` must not yield `-o`, `compare-with` must
 * not yield `-w`).
 */
const FLAG_RE = /(?<![\w-])(--[a-z][a-z0-9-]*|-[a-zA-Z])(?![\w-])/g;

function collectCommandCells(markdown: string): string[] {
  const cells: string[] = [];
  for (const line of markdown.split('\n')) {
    const match = COMMAND_CELL_RE.exec(line.trim());
    if (match !== null) cells.push(match[1]!.replace(/\\\|/g, '|'));
  }
  return cells;
}

/**
 * What the contract shows immediately after a flag, or `null` when the
 * flag is a bare switch.
 *
 * The `null` cases, in the order they are tested: end of cell
 * (`... --changed`); an alternation or grouping character glued to the
 * flag (`--open|--no-open`, `--no-backup]`); and a following token that
 * opens a group, another flag, or an alternation branch
 * (`--wait [--interval <seconds>]`, `-n / --dry-run`,
 * `--dry-run | --status`).
 */
function argumentAfter(rest: string): string | null {
  if (rest === '' || /^[|/\]),]/.test(rest)) return null;
  const match = /^\s+([^\s\])]+)/.exec(rest);
  if (match === null) return null;
  const candidate = match[1]!;
  if (/^[[\-|/]/.test(candidate)) return null;
  return candidate;
}

function collectFlags(cell: string): IContractFlag[] {
  const found: IContractFlag[] = [];
  const scanner = new RegExp(FLAG_RE.source, 'g');
  let match = scanner.exec(cell);
  while (match !== null) {
    const rest = cell.slice(match.index + match[0].length);
    found.push({ name: match[1]!, argument: argumentAfter(rest) });
    match = scanner.exec(cell);
  }
  return found;
}

/**
 * Longest documented word-prefix that names a real verb.
 *
 * The trailing words of a cell can be positionals rather than verb path
 * segments (`sm hooks install pre-commit-bump` is the verb
 * `hooks install` plus a positional), so a bare "leading lowercase
 * words" rule over-reaches. Resolving against the live verb list is
 * what tells the two apart.
 */
function resolveVerbName(
  cell: string,
  knownVerbs: ReadonlySet<string>,
): { verb: string; resolved: boolean } {
  const words: string[] = [];
  for (const token of cell.split(/\s+/).slice(1)) {
    if (!/^[a-z][a-z0-9-]*$/.test(token)) break;
    words.push(token);
  }
  for (let take = words.length; take > 0; take -= 1) {
    const candidate = words.slice(0, take).join(' ');
    if (knownVerbs.has(candidate)) return { verb: candidate, resolved: true };
  }
  return { verb: words.join(' '), resolved: false };
}

/** Keep the argument-bearing sighting; a verb may be documented twice. */
function mergeFlag(into: Map<string, IContractFlag>, flag: IContractFlag): void {
  const seen = into.get(flag.name);
  if (seen === undefined || (seen.argument === null && flag.argument !== null)) {
    into.set(flag.name, flag);
  }
}

export function parseContractSurface(
  markdown: string,
  knownVerbs: ReadonlySet<string>,
): IContractSurface {
  const cells = collectCommandCells(markdown);
  const verbs = new Map<string, IContractVerb>();
  for (const cell of cells) {
    const { verb, resolved } = resolveVerbName(cell, knownVerbs);
    let entry = verbs.get(verb);
    if (entry === undefined) {
      entry = { verb, resolved, flags: new Map(), sources: [] };
      verbs.set(verb, entry);
    }
    entry.sources.push(cell);
    for (const flag of collectFlags(cell)) mergeFlag(entry.flags, flag);
  }
  return { verbs, cellCount: cells.length };
}

// --- Enumerated flag values --------------------------------------------

export interface IEnumeratedFlag {
  verb: string;
  flag: string;
  values: string[];
}

/**
 * Every `--flag <a|b|c>` form the contract spells out.
 *
 * Branches carrying a placeholder (`provider:<id>` in
 * `--scope spec|provider:<id>|all`) are dropped: they stand for a
 * family of ids, not a literal the CLI can be handed verbatim.
 */
export function enumeratedFlags(surface: IContractSurface): IEnumeratedFlag[] {
  const found: IEnumeratedFlag[] = [];
  for (const entry of surface.verbs.values()) {
    for (const flag of entry.flags.values()) {
      if (flag.argument === null || !flag.argument.includes('|')) continue;
      const values = flag.argument.split('|').filter((v) => !/[<>]/.test(v) && v !== '');
      if (values.length > 0) found.push({ verb: entry.verb, flag: flag.name, values });
    }
  }
  return found;
}

// --- `spec/cli-contract.md` §Elapsed time §Scope ------------------------

export interface IElapsedScope {
  /** Verbs the contract names as owing a wall-clock report. */
  inScope: string[];
  /** Verbs the contract explicitly excuses. */
  exempt: string[];
}

function verbsOnMarkedLine(markdown: string, marker: string): string[] {
  const line = markdown.split('\n').find((l) => l.trimStart().startsWith(marker));
  if (line === undefined) return [];
  const found: string[] = [];
  const scanner = /`sm ([^`]+)`/g;
  let match = scanner.exec(line);
  while (match !== null) {
    found.push(match[1]!.trim());
    match = scanner.exec(line);
  }
  return found;
}

/**
 * Read the two enumerations under §Elapsed time §Scope so guard 4
 * tracks the contract instead of a copy that can drift away from it.
 */
export function parseElapsedScope(markdown: string): IElapsedScope {
  return {
    inScope: verbsOnMarkedLine(markdown, '**In scope**'),
    exempt: verbsOnMarkedLine(markdown, '**Exempt**'),
  };
}

// --- Throwaway scopes ---------------------------------------------------

/**
 * A small but genuinely connected corpus: one Claude agent that links
 * out to a doc, the doc it links to, and a handbook that mentions the
 * agent by `@`-path. Enough for extractors, analyzers, and every
 * formatter to have real rows to render, which matters because a verb
 * that short-circuits on an empty project would never reach the code
 * these guards are aimed at.
 */
export function seedScope(dir: string): string {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(
    join(dir, '.claude', 'agents', 'architect.md'),
    '---\nname: architect\ndescription: Designs the system.\n---\n\nSee [deploy](../../docs/deploy.md).\n',
  );
  writeFileSync(join(dir, 'docs', 'deploy.md'), '# Deploy\n\nHow the project ships.\n');
  writeFileSync(join(dir, 'AGENTS.md'), '# Handbook\n\nDelegates to @.claude/agents/architect.md\n');
  return dir;
}

/** Seed a scope and run the first scan, so the project DB exists. */
export function seedScannedScope(dir: string): string {
  seedScope(dir);
  const scan = sm(['scan', '--yes'], { cwd: dir });
  if (scan.status !== 0) {
    throw new Error(`seed scan failed (exit ${scan.status}): ${scan.stderr}`);
  }
  return dir;
}

export function readContract(): string {
  return readFileSync(CONTRACT_PATH, 'utf8');
}
