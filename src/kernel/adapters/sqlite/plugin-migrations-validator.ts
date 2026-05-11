/**
 * Plugin migration SQL validator — triple protection layer.
 *
 * Plugins MAY ship their own SQL migrations (`<plugin-dir>/migrations/`).
 * To keep a malicious or buggy plugin from clobbering kernel state, every
 * DDL object a plugin creates MUST live in the namespace
 * `plugin_<normalizedId>_*`. This module enforces the rule on three
 * layers:
 *
 *   Layer 1 — discovery: every migration file is parsed and validated
 *             before any of them run. A bad file aborts the whole
 *             plugin's migration batch with no side effects.
 *   Layer 2 — apply: the same SQL is re-validated immediately before
 *             `db.exec(sql)`, in case the file changed between discovery
 *             and apply (long-running session, on-disk edit).
 *   Layer 3 — post-apply catalog assertion: after each plugin's batch
 *             commits, we sweep `sqlite_master` and verify no objects
 *             live outside the prefix were created. This catches edge
 *             cases the regex layers might miss (e.g. a SQL feature we
 *             didn't anticipate that creates an object).
 *
 * Pragmatic regex implementation: per the Arquitecto's pick, this is a
 * whitelist of allowed DDL forms (CREATE / DROP / ALTER over TABLE,
 * INDEX, TRIGGER, VIEW, plus DML INSERT / UPDATE / DELETE for seed data),
 * with explicit denylist coverage for transaction control and pragmas.
 * Anything not on the whitelist is rejected. The grammar is intentionally
 * narrow because plugins are small and migrations should be auditable.
 *
 * Comment handling: SQL line comments (`-- ...`) and block comments
 * (`/* ... *​/`) are stripped before any other processing. The ZWSP
 * (U+200B) inside the close fence above is intentional — without it
 * the docstring's own block-comment delimiter would close prematurely.
 * A clever
 * attacker who hides DDL inside a comment is defeated by stripping
 * first; once stripped, the hidden DDL becomes visible to the regex.
 *
 * No external dependency. No SQL parser. No tokenizer. Heuristics only,
 * but defended by Layer 3 for everything the heuristics miss.
 */

import type { DatabaseSync } from 'node:sqlite';

/**
 * Normalize a plugin id into the form used as a table-prefix segment.
 *
 * Rule (from `spec/db-schema.md`): lowercase, replace any character
 * outside `[a-z0-9]` with `_`, collapse runs of `_`, strip leading and
 * trailing `_`.
 *
 * Example: `My-Plugin@v2` → `my_plugin_v2`.
 *
 * Two distinct plugin ids that normalise to the same string are a
 * load-time error — see `assertNoNormalizationCollisions`.
 */
export function normalizePluginId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Detects collisions when two distinct plugin ids share a normalized form. */
export function assertNoNormalizationCollisions(ids: string[]): void {
  const seen = new Map<string, string>();
  for (const id of ids) {
    const normalized = normalizePluginId(id);
    const prior = seen.get(normalized);
    if (prior !== undefined && prior !== id) {
      throw new Error(
        `Plugin id normalization collision: "${prior}" and "${id}" both normalize to "${normalized}"`,
      );
    }
    seen.set(normalized, id);
  }
}

export interface IValidationResult {
  ok: boolean;
  /** Human-readable issues; empty when ok=true. */
  violations: string[];
}

/**
 * Strip SQL comments. Block comments first (greedy across lines), then
 * line comments to end-of-line.
 *
 * Note: this does not respect comments inside string literals, so an
 * unusual identifier like `"foo--bar"` (double-quoted with embedded
 * dashes) could lose characters. Plugin authors who need that level
 * of escaping are expected to file an issue; for the v0.5.0 surface,
 * we tolerate the limitation. The catalog assertion (Layer 3) catches
 * any object that slips through.
 */
export function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n\r]*/g, ' ');
}

/**
 * Detect SQL whose validator-visible text (post `stripComments`) would
 * differ from the engine-visible text because a `--` or `/*` sits inside
 * a string literal. Returns `null` when the SQL is safe; otherwise a
 * violation message that the validator surfaces verbatim.
 *
 * Closes the lane where a hostile plugin shifts the validator's view
 * of statement boundaries by smuggling comment markers inside literals
 * (the validator sees one stripped statement, `db.exec` runs the
 * original — see audit finding M5).
 */
export function detectCommentMarkerInLiteral(sql: string): string | null {
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (ch === "'") {
      const end = scanCheckedLiteral(sql, i + 1, "'", 'string literal');
      if (typeof end === 'string') return end;
      i = end;
    } else if (ch === '"') {
      const end = scanCheckedLiteral(sql, i + 1, '"', 'double-quoted identifier');
      if (typeof end === 'string') return end;
      i = end;
    } else if (ch === '`') {
      i = skipUntilCloser(sql, i + 1, '`');
    } else if (ch === '[') {
      i = skipUntilCloser(sql, i + 1, ']');
    } else {
      i++;
    }
  }
  return null;
}

/**
 * Scan a quoted region looking for a comment marker (`--` / `/`*).
 * Returns the index just past the closing quote on a clean scan, or a
 * directed error string the caller propagates verbatim.
 *
 * `allowStack` (true only for single-quote literals) honours the SQL
 * standard `''` doubling for escaped single quotes.
 */
function scanCheckedLiteral(
  sql: string,
  start: number,
  closer: string,
  label: string,
): number | string {
  const allowStack = closer === "'";
  let i = start;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (allowStack && ch === closer && next === closer) { i += 2; continue; }
    if (ch === closer) return i + 1;
    const marker = findCommentMarker(ch, next, label);
    if (marker !== null) return marker;
    i++;
  }
  return i;
}

/** Match `--` or `/`* at the current cursor; return the directed error or null. */
function findCommentMarker(ch: string, next: string | undefined, label: string): string | null {
  if (ch === '-' && next === '-') {
    return `${label} contains '--' (line comment marker). Reject — validator and engine would disagree on statement boundaries.`;
  }
  if (ch === '/' && next === '*') {
    return `${label} contains '/*' (block comment marker). Reject — validator and engine would disagree on statement boundaries.`;
  }
  return null;
}

/** Skip past the next occurrence of `closer`, no comment-marker check. */
function skipUntilCloser(sql: string, start: number, closer: string): number {
  let i = start;
  while (i < sql.length) {
    if (sql[i] === closer) return i + 1;
    i++;
  }
  return i;
}

/** Tokens that abort validation immediately — too dangerous in plugin space. */
const FORBIDDEN_KEYWORDS = [
  /\bBEGIN\b/i,
  /\bCOMMIT\b/i,
  /\bROLLBACK\b/i,
  /\bSAVEPOINT\b/i,
  /\bATTACH\b/i,
  /\bDETACH\b/i,
  /\bPRAGMA\b/i,
  /\bVACUUM\b/i,
  /\bREINDEX\b/i,
  /\bANALYZE\b/i,
];

/**
 * Allowed DDL / DML statement shapes. Each entry captures the object
 * name(s) the statement touches; the validator then checks each name
 * against the plugin's prefix.
 *
 * Object names tolerate the three SQLite identifier forms: bare,
 * double-quoted, backticked, square-bracketed. The capture group strips
 * the wrapping in `objectName()` below.
 *
 * Schema qualifiers (`main.`, `temp.`) are matched but rejected during
 * name normalization — a plugin migration MUST live in the default
 * `main` schema, qualified or not. `temp.*` and attached schemas are
 * rejected because they bypass the per-DB lifecycle.
 */
const STATEMENT_PATTERNS: Array<{ kind: string; re: RegExp; targets: ('first' | 'on')[] }> = [
  // CREATE [TEMP|TEMPORARY] [VIRTUAL] TABLE [IF NOT EXISTS] <name>
  // CREATE [TEMP|TEMPORARY] [UNIQUE] INDEX [IF NOT EXISTS] <name> ON <table>
  // CREATE [TEMP|TEMPORARY] TRIGGER [IF NOT EXISTS] <name>
  // CREATE [TEMP|TEMPORARY] VIEW [IF NOT EXISTS] <name>
  {
    kind: 'CREATE TABLE',
    re: /^\s*CREATE(?:\s+(?:TEMP|TEMPORARY))?(?:\s+VIRTUAL)?\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(\S+)/i,
    targets: ['first'],
  },
  {
    kind: 'CREATE INDEX',
    re: /^\s*CREATE(?:\s+(?:TEMP|TEMPORARY))?(?:\s+UNIQUE)?\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+(\S+)\s+ON\s+(\S+)/i,
    targets: ['first', 'on'],
  },
  {
    kind: 'CREATE TRIGGER',
    re: /^\s*CREATE(?:\s+(?:TEMP|TEMPORARY))?\s+TRIGGER(?:\s+IF\s+NOT\s+EXISTS)?\s+(\S+)/i,
    targets: ['first'],
  },
  {
    kind: 'CREATE VIEW',
    re: /^\s*CREATE(?:\s+(?:TEMP|TEMPORARY))?\s+VIEW(?:\s+IF\s+NOT\s+EXISTS)?\s+(\S+)/i,
    targets: ['first'],
  },
  // ALTER TABLE <name> RENAME / ADD / DROP ...
  {
    kind: 'ALTER TABLE',
    re: /^\s*ALTER\s+TABLE\s+(\S+)/i,
    targets: ['first'],
  },
  // DROP TABLE / INDEX / TRIGGER / VIEW [IF EXISTS] <name>
  {
    kind: 'DROP TABLE',
    re: /^\s*DROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+(\S+)/i,
    targets: ['first'],
  },
  {
    kind: 'DROP INDEX',
    re: /^\s*DROP\s+INDEX(?:\s+IF\s+EXISTS)?\s+(\S+)/i,
    targets: ['first'],
  },
  {
    kind: 'DROP TRIGGER',
    re: /^\s*DROP\s+TRIGGER(?:\s+IF\s+EXISTS)?\s+(\S+)/i,
    targets: ['first'],
  },
  {
    kind: 'DROP VIEW',
    re: /^\s*DROP\s+VIEW(?:\s+IF\s+EXISTS)?\s+(\S+)/i,
    targets: ['first'],
  },
  // DML over plugin tables: seed inserts, defensive cleanups.
  // INSERT INTO <name> ... / UPDATE <name> ... / DELETE FROM <name>
  {
    kind: 'INSERT',
    re: /^\s*INSERT(?:\s+OR\s+\w+)?\s+INTO\s+(\S+)/i,
    targets: ['first'],
  },
  {
    kind: 'UPDATE',
    re: /^\s*UPDATE\s+(\S+)/i,
    targets: ['first'],
  },
  {
    kind: 'DELETE',
    re: /^\s*DELETE\s+FROM\s+(\S+)/i,
    targets: ['first'],
  },
];

/**
 * Strip identifier wrapping (double-quote / backtick / square bracket)
 * and any schema qualifier (`main.`, `temp.`, etc.). Returns the
 * normalized identifier or `null` if the schema qualifier is anything
 * other than the default `main`.
 */
export function objectName(token: string): { name: string; schema: string | null } | null {
  const trimmed = stripParenAndTrailingPunct(token);
  const { schema, body } = splitSchemaQualifier(trimmed);
  const name = stripIdentifierWrapper(body);
  if (name.length === 0) return null;
  return { name, schema };
}

/**
 * Strip everything from the first opening paren onward — handles
 * `CREATE TABLE name(col INTEGER)` where the captured token has no
 * whitespace between the name and the column list. Trailing
 * punctuation (`,`, `;`, `)`) that follows the identifier in some
 * grammars also goes.
 */
function stripParenAndTrailingPunct(token: string): string {
  const parenIdx = token.indexOf('(');
  const raw = parenIdx !== -1 ? token.slice(0, parenIdx) : token;
  return raw.replace(/[(),;]+$/g, '');
}

/** Split `<schema>.<name>` into the lowercased schema + the rest. */
function splitSchemaQualifier(raw: string): { schema: string | null; body: string } {
  const dotIdx = raw.indexOf('.');
  if (dotIdx === -1) return { schema: null, body: raw };
  return { schema: raw.slice(0, dotIdx).toLowerCase(), body: raw.slice(dotIdx + 1) };
}

/** Strip the three SQLite identifier wrappers: `"..."`, `` `...` ``, `[...]`. */
function stripIdentifierWrapper(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  if (raw.startsWith('`') && raw.endsWith('`')) return raw.slice(1, -1);
  if (raw.startsWith('[') && raw.endsWith(']')) return raw.slice(1, -1);
  return raw;
}

/**
 * Split a SQL string into statements on top-level semicolons.
 *
 * Respects single-quote strings (with `''` escape), double-quote
 * identifiers, backtick identifiers, and square-bracket identifiers.
 * Block comments and line comments must be stripped before calling
 * this function — `stripComments` does that.
 *
 * Trailing empty / whitespace-only statements are dropped so the caller
 * can iterate without filtering.
 */
const QUOTE_OPENERS = new Set(["'", '"', '`', '[']);

export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (QUOTE_OPENERS.has(ch)) {
      const consumed = copyQuotedRegion(sql, i, ch);
      current += consumed.text;
      i = consumed.next;
      continue;
    }
    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) out.push(trimmed);
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  const tail = current.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

/**
 * Copy a quoted region verbatim into the caller's buffer and return
 * the index just past it. Handles the four SQLite quote modes: single
 * (with `''` escape stacking), double, backtick, square bracket.
 */
function copyQuotedRegion(
  sql: string,
  start: number,
  opener: string,
): { text: string; next: number } {
  const closer = opener === '[' ? ']' : opener;
  const allowStack = opener === "'";
  let text = opener;
  let i = start + 1;
  while (i < sql.length) {
    const ch = sql[i]!;
    text += ch;
    if (ch === closer) {
      if (allowStack && sql[i + 1] === closer) {
        text += closer;
        i += 2;
        continue;
      }
      return { text, next: i + 1 };
    }
    i++;
  }
  return { text, next: i };
}

/**
 * Validate one plugin migration's SQL against the prefix rule. Returns
 * a list of violation strings (empty when valid).
 *
 * Each statement must (a) match a whitelisted shape, (b) target only
 * objects whose name starts with `plugin_<normalizedId>_`, (c) live in
 * the default schema (no `temp.*`, no attached-DB references), and (d)
 * not contain a forbidden keyword (transaction control, pragma, etc.).
 */
export function validatePluginMigrationSql(sql: string, normalizedId: string): IValidationResult {
  // Pre-check: reject any literal that contains a comment marker. If
  // we skip this, `stripComments` mutates the validator's view of the
  // statement while `db.exec` still runs the original — opening a
  // boundary-shifting attack (see audit finding M5).
  const literalIssue = detectCommentMarkerInLiteral(sql);
  if (literalIssue) return { ok: false, violations: [literalIssue] };

  const prefix = `plugin_${normalizedId}_`;
  const stripped = stripComments(sql);
  const violations: string[] = [
    ...detectForbiddenKeywords(stripped),
    ...detectStatementViolations(stripped, prefix),
  ];
  return { ok: violations.length === 0, violations };
}

function detectForbiddenKeywords(stripped: string): string[] {
  const out: string[] = [];
  for (const re of FORBIDDEN_KEYWORDS) {
    if (re.test(stripped)) {
      out.push(
        `forbidden keyword: matches /${re.source}/. Plugin migrations cannot manage transactions, pragmas, or attached databases.`,
      );
    }
  }
  return out;
}

function detectStatementViolations(stripped: string, prefix: string): string[] {
  const out: string[] = [];
  for (const stmt of splitStatements(stripped)) {
    const matched = matchStatement(stmt);
    if (!matched) {
      out.push(`unsupported statement: ${truncate(stmt, 80)}`);
      continue;
    }
    for (const tok of matched.tokens) {
      collectObjectViolations(tok, matched.kind, prefix, out);
    }
  }
  return out;
}

function matchStatement(stmt: string): { kind: string; tokens: string[] } | null {
  for (const pattern of STATEMENT_PATTERNS) {
    const m = pattern.re.exec(stmt);
    if (!m) continue;
    const tokens: string[] = [];
    for (let j = 1; j < m.length; j++) tokens.push(m[j]!);
    return { kind: pattern.kind, tokens };
  }
  return null;
}

function collectObjectViolations(
  tok: string,
  kind: string,
  prefix: string,
  out: string[],
): void {
  const parsed = objectName(tok);
  if (!parsed) {
    out.push(`${kind}: could not parse object name from "${tok}"`);
    return;
  }
  if (parsed.schema !== null && parsed.schema !== 'main') {
    out.push(
      `${kind}: schema qualifier "${parsed.schema}." not allowed (must be unqualified or "main.")`,
    );
    return;
  }
  if (!parsed.name.startsWith(prefix)) {
    out.push(
      `${kind}: object "${parsed.name}" is outside the plugin's namespace ("${prefix}*")`,
    );
  }
}

/**
 * Layer 3 — post-apply catalog assertion. After a plugin's migration
 * batch commits, sweep `sqlite_master` for any object NOT in the
 * `plugin_<normalizedId>_*` prefix that wasn't there before. We compare
 * against a snapshot taken before the batch ran.
 *
 * Returns an empty array when clean; otherwise a list of object names
 * that should not exist. The caller decides what to do (we recommend
 * raising an error and refusing to advance the ledger).
 */
export function detectCatalogIntrusion(
  before: Set<string>,
  after: Set<string>,
  normalizedId: string,
): string[] {
  const prefix = `plugin_${normalizedId}_`;
  const intrusions: string[] = [];
  for (const name of after) {
    if (before.has(name)) continue; // pre-existing
    if (name.startsWith(prefix)) continue; // legitimate plugin object
    if (name.startsWith('sqlite_')) continue; // SQLite internal
    intrusions.push(name);
  }
  return intrusions;
}

/**
 * Read every user-visible object name from `sqlite_master`. Filters
 * out auto-generated indexes (those start with `sqlite_autoindex_`)
 * because they shadow whatever table they belong to and don't have an
 * independent author. Plugins that want their own indexes must `CREATE
 * INDEX` them explicitly.
 */
export function snapshotCatalog(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type IN ('table', 'index', 'trigger', 'view')
         AND name NOT LIKE 'sqlite_autoindex_%'`,
    )
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s.replace(/\s+/g, ' ');
  return s.slice(0, max).replace(/\s+/g, ' ') + '…';
}
