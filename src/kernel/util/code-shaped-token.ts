/**
 * Prose-side sibling of the code-region resolution gate
 * (`kernel/orchestrator/prune-unresolved-code-triggers.ts`). That gate
 * disambiguates trigger-shaped tokens inside author-marked literal
 * regions (backticks, fences) by resolution: an unresolved code-region
 * trigger is dropped because the base rate there is code payload, not
 * authored intent. Prose has no such marker, so an unresolved `@token`
 * in running text is judged by SHAPE instead:
 *
 *   - **Identifier shape** (no slash, contains an uppercase letter):
 *     decorators and class names (`@ApiSecurity`, `@Injectable`).
 *     Safe signal because `deriveNodeIdentifiers` lowercases every
 *     graph identifier and trigger matching runs on the lowercased
 *     `normalizedTrigger`, so an uppercase token that RESOLVED never
 *     reaches the broken path; one that did not resolve is likelier
 *     prose about code than a typoed reference.
 *   - **npm scope shape** (exactly one slash, all lowercase, no file
 *     extension at the tail): scoped package names (`@nestjs/swagger`,
 *     `@changesets/cli`). Extension-bearing tails (`@scope/file.md`)
 *     stay out, those are file references owned by the at-file
 *     grammar; multi-segment tokens (`@a/b/c`) stay out, those read
 *     as paths and a dangling path is likelier a real authoring bug.
 *
 * Consumers do not DROP a code-shaped token (unlike the code-region
 * gate): `core/reference-broken` keeps the issue and its confidence
 * penalty but downgrades severity `error` -> `warn`, so the signal
 * stays visible without tripping exit codes over prose about code.
 */

/** `@scope/name`: single slash, lowercase npm-style segments. */
const NPM_SCOPE_RE = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/;

/** File-extension tail (`.md`, `.json`, ...): the at-file grammar's turf. */
const FILE_EXT_TAIL_RE = /\.[a-z0-9]+$/i;

/**
 * True when a verbatim `@`-trigger token (sigil included, original case
 * preserved, i.e. `link.target` / `trigger.originalTrigger`, NEVER the
 * lowercased `normalizedTrigger`) looks like code payload rather than
 * an authored reference, per the two shape rules above.
 */
export function isCodeShapedAtToken(rawToken: string): boolean {
  if (!rawToken.startsWith('@')) return false;
  const bare = rawToken.slice(1);
  if (bare.length === 0) return false;
  if (!bare.includes('/')) return /[A-Z]/.test(bare);
  if (FILE_EXT_TAIL_RE.test(rawToken)) return false;
  return NPM_SCOPE_RE.test(rawToken);
}
