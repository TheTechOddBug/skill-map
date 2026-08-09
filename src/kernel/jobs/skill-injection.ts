/**
 * Skill-instructions section of a SKILL-ACTION job's rendered content
 * (`spec/skill-actions.md` §The skill-instructions section). A skill
 * action is an operator-installed `SKILL.md` skill from the private
 * `.skill-map/.agents/skills/` catalog, submitted under a `skill:<name>`
 * id; its body is third-party TEXT that becomes part of the rendered
 * prompt, so the kernel frames it as task description only.
 *
 * One pure building block, mirroring `findings-injection.ts` /
 * `current-tags-injection.ts`:
 *   - `buildSkillSection`, the RENDER: the `## Skill instructions`
 *     heading, the kernel-authored framing paragraph (naming the skill
 *     and its resolved version, and pinning that the body defines the
 *     job's task ONLY, never overriding the safety rules, the Report
 *     contract, or which files may be edited), then the discovery-cached
 *     skill body VERBATIM (discovery already rejected bodies carrying
 *     delimiter markup or the `{{userContent}}` placeholder, see
 *     `core/skill-actions/catalog.ts`).
 *
 * The section is kernel-authored prelude: it renders OUTSIDE the
 * `<user-content>` block (rendering it inside would order the model to
 * ignore the skill's instructions, neutralising its purpose), FIRST at
 * the `{{userContent}}` seam (`spec/job-lifecycle.md` §Submit step 9),
 * and folds into `promptTemplateHash` (`content-hash.ts`) exactly like
 * the findings and current-tags sections, so editing a single byte of an
 * installed `SKILL.md` re-keys `contentHash` and the duplicate check
 * correctly treats the next submit as new work.
 */

import { JOB_TEXTS } from '../i18n/jobs.texts.js';
import { tx } from '../util/tx.js';

/**
 * The catalog values the section interpolates
 * (`spec/skill-actions.md` §Identity and version): `name` and `version`
 * are the discovery-resolved frontmatter values, `body` the cached
 * content after frontmatter, verbatim. `ISkillActionEntry`
 * (`core/skill-actions/catalog.ts`) satisfies it structurally.
 */
export interface ISkillSectionInput {
  name: string;
  version: string;
  body: string;
}

/**
 * Render the `## Skill instructions` section: the heading, the framing
 * paragraph with the skill's backtick-quoted name and resolved version
 * interpolated (line breaks per the spec's normative shape), then the
 * skill body verbatim. No trailing newline of its own (the render seam
 * joins sections with a blank line, same posture as
 * `buildFindingsSection`); whatever trailing whitespace the body carries
 * rides through untouched, the body is normative bytes.
 */
export function buildSkillSection(input: ISkillSectionInput): string {
  return (
    `${JOB_TEXTS.skillInstructionsHeading}\n\n` +
    `${tx(JOB_TEXTS.skillInstructionsFraming, { name: input.name, version: input.version })}\n\n` +
    input.body
  );
}
