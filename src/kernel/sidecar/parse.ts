/**
 * Sidecar reader (Step 9.6.2).
 *
 * Parses a co-located `.sm` YAML sidecar next to a `.md` node and
 * validates it against `spec/schemas/sidecar.schema.json` and
 * `spec/schemas/annotations.schema.json`. Returns a typed
 * `IParsedSidecar` (or `null` if no sidecar accompanies the node) plus
 * a list of validation issues for the caller to fold into the scan
 * result.
 *
 * Design notes:
 *
 *   - YAML parsing via `js-yaml` (already on the dependency tree, used
 *     by the orchestrator's canonical-frontmatter helper).
 *   - AJV validators are compiled once and cached in module scope (the
 *     sidecar shape is static). The cache mirrors
 *     `loadSchemaValidators` for the existing kernel schemas.
 *   - Malformed YAML or schema-invalid sidecars do NOT crash the scan
 *     — the caller emits an `invalid-sidecar` issue and proceeds with
 *     no overlay (the node still scans with the new columns set to
 *     `sidecarPresent = 1` / `sidecarStatus = null`).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import yaml from 'js-yaml';

import { stripPrototypePollution } from '../util/strip-prototype-pollution.js';

import { applyAjvFormats } from '../util/ajv-interop.js';

export interface IParsedSidecar {
  /** Path to the `.sm` file on disk (absolute). */
  filePath: string;
  /** `identity.bodyHash` — sha256 of the body at the last bump. */
  identityBodyHash: string;
  /** `identity.frontmatterHash` — sha256 of the canonical frontmatter at the last bump. */
  identityFrontmatterHash: string;
  /** `identity.path` — relative path to the `.md` node. */
  identityPath: string;
  /** Parsed `annotations:` block. `null` if absent or empty. */
  annotations: Record<string, unknown> | null;
  /** Full parsed root object (for plugin namespace access). */
  raw: Record<string, unknown>;
}

export interface ISidecarParseIssue {
  /** Human-readable reason. The orchestrator wraps this in the
   *  `invalid-sidecar` rule message before it surfaces to the user. */
  message: string;
}

export interface ISidecarReadResult {
  parsed: IParsedSidecar | null;
  /**
   * `true` when a `.sm` file existed at the resolved path (regardless of
   * parse success). Drives `scan_nodes.sidecar_present` so the row keeps
   * tracking the file's existence even when its contents are unusable.
   */
  present: boolean;
  issues: ISidecarParseIssue[];
}

/**
 * Resolve `<mdAbsolutePath>.replace(.md, .sm)` and read + validate
 * the sidecar at that location. The `.sm` file is optional — when
 * absent the result is `{ parsed: null, present: false, issues: [] }`.
 */
// Linear pipeline with one branch per failure mode (file-missing,
// read-error, YAML-parse-error, root-not-mapping, schema-invalid,
// happy-path). Each branch returns directly; cyclomatic count
// counts them all but there's no actual nested logic.
// eslint-disable-next-line complexity
export function readSidecarFor(mdAbsolutePath: string): ISidecarReadResult {
  const sidecarPath = sidecarPathFor(mdAbsolutePath);
  if (!existsSync(sidecarPath)) {
    return { parsed: null, present: false, issues: [] };
  }

  let raw: string;
  try {
    raw = readFileSync(sidecarPath, 'utf8');
  } catch (err) {
    return {
      parsed: null,
      present: true,
      issues: [{ message: `cannot read ${sidecarPath}: ${(err as Error).message}` }],
    };
  }

  let parsedYaml: unknown;
  try {
    parsedYaml = yaml.load(raw);
  } catch (err) {
    return {
      parsed: null,
      present: true,
      issues: [{ message: `malformed YAML in ${sidecarPath}: ${(err as Error).message}` }],
    };
  }

  // Trust boundary: strip prototype-pollution keys at every depth before
  // AJV ever sees the document, so a tainted `.sm` cannot survive the
  // round-trip through `IParsedSidecar.raw` into plugin Action contexts.
  parsedYaml = stripPrototypePollution(parsedYaml);

  if (!isPlainObject(parsedYaml)) {
    return {
      parsed: null,
      present: true,
      issues: [{ message: `sidecar root must be a YAML mapping at ${sidecarPath}` }],
    };
  }

  const sidecarValidator = getSidecarValidator();
  if (!sidecarValidator(parsedYaml)) {
    const errors = (sidecarValidator.errors ?? [])
      .map((e) => `${e.instancePath || '(root)'} ${e.message ?? e.keyword}`)
      .join('; ');
    return {
      parsed: null,
      present: true,
      issues: [{ message: `sidecar schema validation failed at ${sidecarPath}: ${errors}` }],
    };
  }

  const root = parsedYaml as Record<string, unknown>;
  const identityBlock = root['identity'] as Record<string, unknown>;
  const annotationsRaw = root['annotations'];
  const annotations = isPlainObject(annotationsRaw)
    ? Object.keys(annotationsRaw).length === 0
      ? null
      : (annotationsRaw as Record<string, unknown>)
    : null;

  return {
    parsed: {
      filePath: sidecarPath,
      identityBodyHash: String(identityBlock['bodyHash']),
      identityFrontmatterHash: String(identityBlock['frontmatterHash']),
      identityPath: String(identityBlock['path']),
      annotations,
      raw: root,
    },
    present: true,
    issues: [],
  };
}

/**
 * Compute the sidecar path for a given `.md` file. Co-located: same
 * directory, same basename, extension swapped to `.sm`. Files that do
 * not end in `.md` (Provider future-proofing) get the `.sm` suffix
 * appended.
 */
export function sidecarPathFor(mdAbsolutePath: string): string {
  if (mdAbsolutePath.endsWith('.md')) {
    return `${mdAbsolutePath.slice(0, -'.md'.length)}.sm`;
  }
  return `${mdAbsolutePath}.sm`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

let cachedSidecarValidator: ValidateFunction | null = null;

function getSidecarValidator(): ValidateFunction {
  if (cachedSidecarValidator) return cachedSidecarValidator;
  const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
  applyAjvFormats(ajv);

  const specRoot = resolveSpecRoot();
  const annotationsSchema = JSON.parse(
    readFileSync(resolve(specRoot, 'schemas/annotations.schema.json'), 'utf8'),
  );
  const sidecarSchema = JSON.parse(
    readFileSync(resolve(specRoot, 'schemas/sidecar.schema.json'), 'utf8'),
  );
  ajv.addSchema(annotationsSchema);
  cachedSidecarValidator = ajv.compile(sidecarSchema);
  return cachedSidecarValidator;
}

/**
 * Test-only escape hatch — drop the cached validator so a test can
 * rebuild it after monkey-patching the spec package.
 */
export function _resetSidecarValidatorCacheForTests(): void {
  cachedSidecarValidator = null;
}

function resolveSpecRoot(): string {
  const require = createRequire(import.meta.url);
  try {
    const indexPath = require.resolve('@skill-map/spec/index.json');
    return dirname(indexPath);
  } catch {
    throw new Error(
      '@skill-map/spec not resolvable: sidecar reader cannot load schemas.',
    );
  }
}
