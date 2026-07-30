/**
 * Typed errors raised by the Mode A KV store wrapper
 * (`kernel/adapters/plugin-store.ts`). The class names are normative:
 * `spec/plugin-kv-api.md` § Errors declares the exact four an
 * implementation MUST expose, so plugin code can branch on
 * `err instanceof KvKeyInvalidError` instead of string-matching a
 * message.
 *
 * They are plain `Error` subclasses (same shape as
 * `kernel/jobs/errors.ts`) so a caller that does not care about the
 * taxonomy still gets a readable message. Backend detail never reaches
 * the message text: a SQL string / file path only rides in
 * `KvOperationFailedError.cause`, per the spec's "errors MUST NOT leak
 * backend-specific details" analyzer.
 *
 * Naming note: these are runtime classes, not TS-only shapes, so the
 * `I*` / `T*` prefixes from `context/kernel.md` § Type naming do not
 * apply; the spec fixes the names verbatim.
 */

/** Key is empty, not a string, or above the 256-byte ceiling. */
export class KvKeyInvalidError extends Error {
  readonly key: unknown;

  constructor(message: string, key: unknown) {
    super(message);
    this.name = 'KvKeyInvalidError';
    this.key = key;
  }
}

/**
 * The `nodePath` scope selector is unusable: an empty string (reserved
 * as the internal global sentinel, see `KV_GLOBAL_NODE_ID`) or a
 * non-string value.
 *
 * ADDITIVE to the four classes named in `spec/plugin-kv-api.md`
 * § Errors. The spec's Stability section explicitly allows this
 * ("adding a new error class is a minor bump"), and the alternative,
 * overloading `KvKeyInvalidError`, would tell a plugin author to fix
 * their KEY when the problem is their SCOPE. The spec table should
 * gain a row for it; flagged rather than silently diverged.
 */
export class KvNodePathInvalidError extends Error {
  readonly nodePath: unknown;

  constructor(message: string, nodePath: unknown) {
    super(message);
    this.name = 'KvNodePathInvalidError';
    this.nodePath = nodePath;
  }
}

/**
 * Value cannot be JSON-encoded: cyclic, `undefined`, a function, a
 * `bigint`, or a nested member of any of those. Raised BEFORE the
 * value reaches persistence, so a rejected write leaves no row behind.
 */
export class KvValueNotSerializableError extends Error {
  readonly key: string;

  constructor(message: string, key: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'KvValueNotSerializableError';
    this.key = key;
  }
}

/** Encoded value exceeds the reference implementation's 1 MiB ceiling. */
export class KvValueTooLargeError extends Error {
  readonly key: string;
  readonly bytes: number;

  constructor(message: string, key: string, bytes: number) {
    super(message);
    this.name = 'KvValueTooLargeError';
    this.key = key;
    this.bytes = bytes;
  }
}

/**
 * Unexpected backend failure (DB full, IO error, corrupt stored JSON).
 * The underlying error rides in `cause`; the message stays
 * backend-agnostic.
 */
export class KvOperationFailedError extends Error {
  readonly operation: string;

  constructor(message: string, operation: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'KvOperationFailedError';
    this.operation = operation;
  }
}
