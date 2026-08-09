/**
 * Skill-action catalog discovery (`spec/skill-actions.md`). A skill
 * action is an operator-installed `SKILL.md` agent skill under the
 * private catalog folder `<cwd>/.skill-map/.agents/skills/<name>/`, a
 * PARALLEL catalog next to the extension system: no manifest, no module
 * import, no registry membership, no enable toggle
 * (`spec/architecture.md` §Skill-actions catalog).
 *
 * Discovery runs ONCE, at `sm serve` boot, alongside plugin discovery
 * (same posture, audit M3: never re-walk the filesystem per request);
 * installing or editing a skill requires a server restart, and the
 * catalog, including each skill's body bytes, is cached in memory for
 * the life of the process. The composition root threads the assembled
 * catalog into the route deps (`server/routes/deps.ts`) and the BFF
 * submit path (`prepareSubmitContext`); the CLI never builds one in v1
 * (the `skill:` submit grammar is reserved, `spec/cli-contract.md`
 * §Jobs).
 *
 * The walk is one level deep: each direct child directory of the catalog
 * folder that contains a `SKILL.md` is a candidate, REAL directories
 * only (symlinks are never followed: the `npx skills` installer emits
 * per-agent symlink mirrors beside the canonical store, and following
 * them would surface the same skill twice). A candidate is admitted when
 * ALL of §Discovery's rules hold; otherwise it is SKIPPED with one
 * warning line naming the directory and the defect (a defective skill
 * never blocks the rest of the catalog). A missing catalog folder is an
 * empty catalog, silently (the feature is opt-in by installation).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { kernelSkillActionsDir } from '../../kernel/util/skill-map-paths.js';
import { USER_CONTENT_PLACEHOLDER } from '../../kernel/jobs/index.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { frontmatterYamlParser } from '../../plugins/core/parsers/frontmatter-yaml/index.js';
import { SKILL_ACTIONS_CATALOG_TEXTS as T } from './i18n/catalog.texts.js';

/**
 * The `skill:` id prefix (`spec/skill-actions.md` §Identity and version):
 * a skill action's id is `skill:<dirname>`. It extends the existing
 * `<kind>:` disambiguator namespace of submit target resolution, so an
 * unprefixed submit target NEVER matches a skill action and a `skill:`
 * target never matches a plugin extension.
 */
export const SKILL_ACTION_ID_PREFIX = 'skill:';

/** True when `id` is a `skill:<name>` skill-action submit target. */
export function isSkillActionId(id: string): boolean {
  return id.startsWith(SKILL_ACTION_ID_PREFIX);
}

/** The `skill:<dirname>` id of a catalog subdirectory, verbatim. */
export function skillActionIdFor(dirname: string): string {
  return `${SKILL_ACTION_ID_PREFIX}${dirname}`;
}

/** One admitted catalog skill (`spec/skill-actions.md` §Discovery). */
export interface ISkillActionEntry {
  /** `skill:<dirname>`, the submit target and the frozen job extension id. */
  id: string;
  /** Frontmatter `name` (non-empty by admission; the launcher label). */
  name: string;
  /** Frontmatter `description` (non-empty by admission; launcher tooltip). */
  description: string;
  /**
   * Informational version (§Identity and version): frontmatter `version`
   * when a string, else `metadata.version` when a string, else `0.0.0`.
   * Freezes onto `state_jobs.extension_version`; dedup correctness never
   * depends on it (the body itself hashes into the job content).
   */
  version: string;
  /**
   * The discovery-cached body bytes: content after frontmatter, VERBATIM
   * (admission already rejected empty bodies, delimiter markup, and the
   * placeholder). Inlined into the skill-instructions section at submit.
   */
  body: string;
  /** Absolute catalog subdirectory (diagnostics; never re-read at submit). */
  dir: string;
}

/** The boot-frozen catalog: sorted entries plus the by-id submit index. */
export interface ISkillActionCatalog {
  /** Admitted skills, sorted by `name` for stable output. */
  entries: ISkillActionEntry[];
  /** `skill:<dirname>` -> entry, the submit target lookup. */
  byId: ReadonlyMap<string, ISkillActionEntry>;
}

/** The empty catalog (missing folder, tests, non-serve surfaces). */
export function emptySkillActionCatalog(): ISkillActionCatalog {
  return { entries: [], byId: new Map() };
}

/**
 * Walk EXACTLY `kernelSkillActionsDir(cwd)`, one level deep, and
 * assemble the boot-frozen catalog. Each rejected candidate emits ONE
 * `warn` line naming the directory and the defect and the walk
 * continues; a missing catalog folder returns the empty catalog
 * silently. Directory names from the filesystem are sanitised before
 * they reach the warn sink (terminal-bound text).
 */
export function assembleSkillActionCatalog(
  cwd: string,
  warn: (msg: string) => void,
): ISkillActionCatalog {
  const catalogDir = kernelSkillActionsDir(cwd);
  let dirents;
  try {
    dirents = readdirSync(catalogDir, { withFileTypes: true });
  } catch {
    // Missing (or unreadable) catalog folder: the feature is opt-in by
    // installation, so an absent store is the ordinary empty state.
    return emptySkillActionCatalog();
  }

  const entries: ISkillActionEntry[] = [];
  for (const dirent of dirents) {
    // REAL directories only: `withFileTypes` reports a symlink as a
    // symlink (never a directory), so the per-agent symlink mirrors the
    // installer emits are skipped here without an extra lstat.
    if (!dirent.isDirectory()) continue;
    const dir = join(catalogDir, dirent.name);
    const entry = readCandidate(dir, dirent.name, warn);
    if (entry !== null) entries.push(entry);
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { entries, byId: new Map(entries.map((e) => [e.id, e])) };
}

/**
 * Read + admit one candidate directory, or `null` when it is skipped:
 * silently when it carries no `SKILL.md` at all (not a candidate per
 * §Discovery), with one warn line for every admission-rule defect.
 */
function readCandidate(
  dir: string,
  dirname: string,
  warn: (msg: string) => void,
): ISkillActionEntry | null {
  let raw: string;
  try {
    raw = readFileSync(join(dir, 'SKILL.md'), 'utf8');
  } catch (err) {
    // No `SKILL.md` = not a candidate (silent); any other read failure
    // on a present file is a defect worth naming.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    warnSkip(warn, dir, tx(T.defectUnreadable, { detail: formatErrorMessage(err) }));
    return null;
  }
  // The standard frontmatter pipeline (§Discovery): YAML safe-load with
  // prototype-pollution stripping, the same parser the scan uses.
  const parsed = frontmatterYamlParser.parse(raw, join(dir, 'SKILL.md'));
  const defect = admissionDefect(parsed.frontmatter, parsed.body);
  if (defect !== null) {
    warnSkip(warn, dir, defect);
    return null;
  }
  return {
    id: skillActionIdFor(dirname),
    name: parsed.frontmatter['name'] as string,
    description: parsed.frontmatter['description'] as string,
    version: resolveVersion(parsed.frontmatter),
    body: parsed.body,
    dir,
  };
}

/**
 * The admission rules of `spec/skill-actions.md` §Discovery, in order;
 * the FIRST violated rule names the defect (one warn line per candidate).
 * Rules 4-5 guard the containment story: the body renders OUTSIDE the
 * `<user-content>` delimiter, so a body shipping its own delimiter
 * markup (matched case-insensitively) or the literal placeholder is
 * refused at discovery, never patched at render.
 */
function admissionDefect(frontmatter: Record<string, unknown>, body: string): string | null {
  if (!isNonEmptyString(frontmatter['name'])) return T.defectNameMissing;
  if (!isNonEmptyString(frontmatter['description'])) return T.defectDescriptionMissing;
  if (body.trim().length === 0) return T.defectBodyEmpty;
  if (/<user-content/i.test(body)) return T.defectBodyDelimiter;
  if (body.includes(USER_CONTENT_PLACEHOLDER)) return T.defectBodyPlaceholder;
  return null;
}

/**
 * §Identity and version: frontmatter `version` when a string, else
 * `metadata.version` when a string, else `0.0.0`. Purely informational;
 * empty strings fall through to the next source like any non-string.
 */
function resolveVersion(frontmatter: Record<string, unknown>): string {
  if (isNonEmptyString(frontmatter['version'])) return frontmatter['version'];
  const metadata = frontmatter['metadata'];
  if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)) {
    const nested = (metadata as Record<string, unknown>)['version'];
    if (isNonEmptyString(nested)) return nested;
  }
  return '0.0.0';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** One warn line per rejected candidate (directory + defect). */
function warnSkip(warn: (msg: string) => void, dir: string, defect: string): void {
  warn(tx(T.skillSkipped, { dir: sanitizeForTerminal(dir), defect }));
}
