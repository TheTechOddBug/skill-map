/**
 * Pure telemetry scrubber for the browser UI. No Sentry import, no DOM
 * access, no network. A dependency-free TypeScript port of the CLI
 * scrubber (`src/core/telemetry/scrub.ts`); the logic is mirrored 1:1
 * because the two workspaces do not share a module (the `src/core` one
 * cannot be imported across the workspace boundary).
 *
 * The scrubber is the client-side, deny-by-default privacy gate
 * described in `spec/telemetry.md` §Scrubbing rules: it runs inside the
 * SDK `beforeSend` hook before any event leaves the browser.
 *
 * Two responsibilities, both pure:
 *
 *   1. `scrubString` redacts an operator's home directory / username out
 *      of any string. It is pattern-based rather than environment-based
 *      so it redacts paths that did not originate from the current home
 *      (symlink targets, paths quoted mid-message, Windows layouts).
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
 * Query parameters whose VALUES are masked wherever a URL or query string
 * appears in an event (`spec/telemetry.md` §Scrubbing rules): they carry
 * node paths (`path`, the selection sync) or operator-typed text
 * (`search`, the filter box). Closed-enum parameters (`kinds`,
 * `linkKinds`, `severities`, `favoritesOnly`) pass through. The
 * SDK-attached `$current_url` is the main carrier; navigation breadcrumbs
 * and any nested field are covered by the same walk. Any future parameter
 * carrying a path, a file name, or free text joins this list.
 */
export const MASKED_QUERY_PARAMS: readonly string[] = ['path', 'search'];

/** Literal that replaces a masked query-parameter value. */
export const QUERY_VALUE_PLACEHOLDER = '<masked>';

/**
 * One pattern per masked parameter: the value runs from `<param>=` to the
 * next `&`, `#`, whitespace, or end, so percent-encoded payloads
 * (`path=.claude%2Fskills%2F...`) are swallowed whole. The leading `?` / `&`
 * anchor keeps `depath=` untouched.
 */
const MASKED_QUERY_PATTERNS: readonly RegExp[] = MASKED_QUERY_PARAMS.map(
  (param) => new RegExp(`([?&]${param}=)[^&#\\s]*`, 'gi'),
);

/**
 * Redact home-directory prefixes out of a single string. Returns the
 * input unchanged when it carries no recognizable home path. Pure.
 */
export function scrubString(value: string): string {
  let out = value;
  for (const pattern of HOME_PATTERNS) {
    out = out.replace(pattern, HOME_PLACEHOLDER);
  }
  for (const pattern of MASKED_QUERY_PATTERNS) {
    out = out.replace(pattern, `$1${QUERY_VALUE_PLACEHOLDER}`);
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
export function scrubEvent<T>(event: T): T {
  const walked = walk(event) as T;
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
function walk(value: unknown): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((item) => walk(item));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = walk(child);
    }
    return out;
  }
  return value;
}
