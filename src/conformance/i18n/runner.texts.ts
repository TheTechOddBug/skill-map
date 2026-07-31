/**
 * Strings emitted by the conformance runner (`conformance/index.ts`).
 * Same `tx(template, vars)` convention as every other `*.texts.ts` peer.
 *
 * Reasons surface in `TAssertionResult.reason`, visible to anyone
 * reading the runner output (CI logs, `sm conformance run --json`).
 * Keeping them in the catalog unblocks a future Transloco migration and
 * keeps the wording in one place.
 */

export const CONFORMANCE_RUNNER_TEXTS = {
  priorScanFailed:
    'setup.priorScans step `{{fixture}}` failed with exit {{exit}}: {{stderr}}',

  priorInvokeFailed:
    'setup.priorInvokes step `{{argv}}` expected exit {{expected}}, got {{exit}}: {{stderr}}',

  unboundPlaceholder:
    'placeholder "{{name}}" is not bound by any earlier setup.priorInvokes capture',

  captureStdoutNotJson:
    'setup.priorInvokes step `{{argv}}` declares capture but its stdout is not JSON: {{message}}',

  captureNoMatch:
    'setup.priorInvokes step `{{argv}}` capture "{{name}}" ({{path}}) matched nothing',

  captureNotScalar:
    'setup.priorInvokes step `{{argv}}` capture "{{name}}" ({{path}}) resolved to {{type}}, expected a string or number',

  pathMustBeRelative:
    'conformance: {{label}} path "{{path}}" must be relative to its anchor ({{anchor}})',

  pathEscapesAnchor:
    'conformance: {{label}} path "{{path}}" escapes its anchor ({{anchor}})',

  expectedExitCode:
    'expected exit {{expected}}, got {{actual}}',

  fileNotFound:
    'file not found: {{path}}',

  targetNotFound:
    'target not found: {{path}}',

  targetMissingFixture:
    'target does not contain fixture {{fixture}} verbatim',

  stdoutMissingFixture:
    'stdout does not contain fixture {{fixture}} verbatim',

  stderrDidNotMatch:
    'stderr did not match /{{pattern}}/',

  stdoutNotJson:
    'stdout is not valid JSON: {{message}}',

  unsupportedJsonPath:
    'unsupported jsonpath: {{path}}',

  expectedArrayAtPath:
    'expected array at {{path}}',

  cannotTraverseSegment:
    "cannot traverse {{type}} at segment '{{segment}}'",

  jsonPathEqualsMismatch:
    '{{path}} = {{actual}}, expected {{expected}}',

  jsonPathNotGreaterThan:
    '{{path}} not > {{value}}',

  jsonPathNotLessThan:
    '{{path}} not < {{value}}',

  jsonPathDidNotMatch:
    '{{path}} did not match /{{pattern}}/',

  jsonPathNoComparator:
    'no comparator on json-path assertion',

  serveExitedBeforeReady:
    'setup.serve: the server exited with {{exit}} before publishing {{file}}: {{stderr}}',

  serveNotReady:
    'setup.serve: the server did not publish a valid {{file}} within {{timeout}}ms: {{stderr}}',

  httpWithoutServe:
    'http-matches-schema: {{method}} {{path}} declared without setup.serve: true, a case authoring error (no server was started, so no request was attempted)',

  httpRequestFailed:
    'http-matches-schema: {{method}} {{path}} failed: {{message}}',

  httpStatusMismatch:
    'http-matches-schema: {{method}} {{path}} returned status {{actual}}, expected {{expected}}',

  ndjsonLineNotJson:
    'ndjson-line: stdout line {{line}} is not parseable JSON: {{message}}',

  ndjsonNoLineMatched:
    'ndjson-line: no stdout line deep-equals {{match}} on its top-level keys',

  specRootMissingIndex:
    'spec root missing index.json at {{specRoot}}',
} as const;
