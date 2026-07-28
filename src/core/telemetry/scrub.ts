/**
 * Pure telemetry scrubber. No Sentry import, no filesystem, no
 * `os.homedir()` read (the `$HOME` allow-list in `spec/cli-contract.md`
 * §User-settings file stays closed). The scrubber is the client-side,
 * deny-by-default privacy gate described in `spec/telemetry.md`
 * §Scrubbing rules: it runs inside the SDK `beforeSend` hook before any
 * event leaves the machine.
 *
 * Two responsibilities, both pure:
 *
 *   1. `scrubString` redacts an operator's home directory / username out
 *      of any string. It is pattern-based rather than `homedir()`-based
 *      so it redacts paths that did not originate from the current home
 *      (symlink targets, paths quoted mid-message, Windows layouts) and
 *      so this module never needs to read `$HOME`.
 *   2. `scrubEvent` walks an entire event object and applies `scrubString`
 *      to every string it finds (frames, messages, breadcrumbs, nested
 *      fields), then strips the known host-identifying envelope keys
 *      (`server_name`, `user`). Walking every string is the deny-by-default
 *      posture: a path that slips into a field we did not anticipate is
 *      still redacted.
 *
 * The functions never mutate their input; `scrubEvent` returns a scrubbed
 * deep copy so the caller can hand it straight to the SDK.
 */

/** Literal that replaces a redacted home-directory prefix. */
export const HOME_PLACEHOLDER = '<HOME>';

/**
 * Literal that replaces a redacted project root.
 *
 * The home patterns below only recognise `/home/<u>`, `/Users/<u>`,
 * `C:\\Users\\<u>` and `/root`. A project checked out anywhere else
 * (`/srv/work/client-acme`, `/opt/...`, a WSL `/mnt/d/work/client-x`)
 * therefore reached the wire verbatim, disclosing the project, and often
 * the client, name in every stack frame. The driver knows its own root
 * and passes it in; the scrubber stays pure and never reads `$HOME` or
 * `process.cwd()` itself (`spec/cli-contract.md` §User-settings file
 * keeps that allow-list closed).
 */
export const PROJECT_PLACEHOLDER = '<PROJECT>';

/**
 * Envelope keys stripped wholesale from every event. `server_name` is the
 * machine hostname; `user` carries id / ip / username. Neither has any
 * triage value and both identify the operator.
 */
const STRIPPED_ENVELOPE_KEYS: readonly string[] = ['server_name', 'user'];

/**
 * Home-directory prefixes, most specific first. Each matches the home
 * root plus the single user segment that follows it, and is replaced by
 * `HOME_PLACEHOLDER`. The trailing path (project dirs, file names) is
 * preserved so a stack trace stays useful, only the operator-identifying
 * prefix is removed.
 *
 *   /home/alice/projects/x.ts      -> <HOME>/projects/x.ts
 *   /Users/alice/projects/x.ts     -> <HOME>/projects/x.ts
 *   C:\Users\alice\projects\x.ts   -> <HOME>\projects\x.ts
 *   C:/Users/alice/projects/x.ts   -> <HOME>/projects/x.ts
 *   /root/x.ts                     -> <HOME>/x.ts
 */
const HOME_PATTERNS: readonly RegExp[] = [
  // Windows: drive + Users + one user segment (back- or forward-slash).
  /[A-Za-z]:[\\/]Users[\\/][^\\/\s:*?"<>|]+/g,
  // POSIX user homes: /home/<user> or macOS /Users/<user>.
  /\/(?:home|Users)\/[^/\s:]+/g,
  // Root account home.
  /\/root(?=\/|\b)/g,
];

/**
 * Redact caller-supplied roots and home-directory prefixes out of a
 * single string. Returns the input unchanged when it carries neither.
 * Pure.
 *
 * `extraRoots` are matched literally (no regex compilation, so a path
 * with regex metacharacters needs no escaping) and longest-first, so a
 * nested root cannot be shadowed by its own parent. They run BEFORE the
 * home patterns on purpose: a project under `/home/alice/work/acme`
 * should collapse to `<PROJECT>`, hiding the project name, rather than
 * to `<HOME>/work/acme`, which preserves it.
 */
export function scrubString(value: string, extraRoots: readonly string[] = []): string {
  let out = value;
  for (const root of [...extraRoots].filter((r) => r.length > 0).sort((a, b) => b.length - a.length)) {
    out = out.split(root).join(PROJECT_PLACEHOLDER);
  }
  for (const pattern of HOME_PATTERNS) {
    out = out.replace(pattern, HOME_PLACEHOLDER);
  }
  return out;
}

/**
 * Deep-copy `event` and apply `scrubString` to every string value at any
 * depth, then delete the host-identifying envelope keys at the root.
 * Non-string primitives pass through untouched; unknown nested shapes are
 * walked so a leaked path cannot hide in a field this code did not model.
 *
 * The generic return type preserves the caller's event type (the SDK's
 * `beforeSend` expects the same event shape back).
 */
export function scrubEvent<T>(event: T, extraRoots: readonly string[] = []): T {
  const walked = walk(event, extraRoots) as T;
  if (walked !== null && typeof walked === 'object' && !Array.isArray(walked)) {
    const record = walked as Record<string, unknown>;
    for (const key of STRIPPED_ENVELOPE_KEYS) {
      if (key in record) delete record[key];
    }
  }
  return walked;
}

/**
 * Recursive clone-and-scrub. Strings are redacted, arrays and plain
 * objects are rebuilt with scrubbed members, everything else (number,
 * boolean, null, undefined) is returned as-is.
 */
function walk(value: unknown, extraRoots: readonly string[]): unknown {
  if (typeof value === 'string') return scrubString(value, extraRoots);
  if (Array.isArray(value)) return value.map((item) => walk(item, extraRoots));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = walk(child, extraRoots);
    }
    return out;
  }
  return value;
}
