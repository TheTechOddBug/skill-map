/**
 * `SmCli`, the Clipanion `Cli` subclass that makes the command surface
 * fully self-describing.
 *
 * --- Why this exists (the Clipanion behaviour it works around) ----------
 *
 * `sm help --format json` is NORMATIVE (`spec/cli-contract.md`
 * §Introspection: "any change to verbs, flags, or exit codes MUST reflect
 * in `--format json` output immediately"). It is built from
 * `Cli#definitions()`, which for each command returns a `Definition`
 * whose `options` array comes from
 * `CommandBuilder#usage({ detailed: true, inlineOptions: false })`. That
 * loop reads (clipanion 4.0.0-rc.4, `sources/core.ts` → shipped
 * `lib/core.mjs`, `CommandBuilder#usage`):
 *
 *     for (const { preferredName, nameSet, arity, hidden, description,
 *                  required } of this.options) {
 *       if (hidden) continue;
 *       …
 *       if (!inlineOptions && description) {
 *         detailedOptionList.push({ preferredName, nameSet, definition,
 *                                   description, required });
 *       } else {
 *         segments.push(required ? `<${definition}>` : `[${definition}]`);
 *       }
 *     }
 *
 * An option that declares NO `description` therefore never reaches
 * `Definition.options`; it is folded into the `Definition.usage` STRING
 * as `[--ttl #0]`. `definitions()` is a help-RENDERING projection (the
 * description is the second column of the help table, so an option
 * without one has nothing to render), not an introspection API. Upstream
 * documents neither the gate nor an alternative; the `--clipanion=definitions`
 * builtin advertises "the full JSON specification for the current cli"
 * while inheriting the same filter.
 *
 * skill-map declares 172 flag-form options and 94 carry a description,
 * so the normative dump silently omitted 78 real flags (`sm jobs submit`
 * published 5 of its 13, every one of them inherited from `SmCommand`),
 * and every consumer of the contract, shell completion, docs generation,
 * the `sm-tutorial` skill, third-party tooling, saw a CLI that does not
 * exist.
 *
 * --- What this class reads instead --------------------------------------
 *
 * `CommandBuilder#options` (`readonly options: Array<OptDefinition>`),
 * the unfiltered list every registered option lands in through
 * `addOption`, i.e. exactly what Clipanion's own PARSER matches argv
 * against. It hangs off the `protected registrations` map, which is why
 * this is a subclass rather than a helper function: `registrations`,
 * `getUsageByRegistration` and `getUsageByIndex` are all `protected`
 * while `builder` is `private`, so subclassing is the sanctioned reach.
 * `Definition` / `CommandClass` are public exports; `OptDefinition` and
 * `CommandBuilder` are NOT re-exported from the package entrypoint and
 * the `exports` map blocks `clipanion/lib/core`, so `IOptDefinition`
 * below re-declares the shape structurally.
 *
 * Hidden options (`hidden: true`, today `sm serve --ui-dist` /
 * `--watcher-debounce-ms`) stay omitted: they are deliberately absent
 * from every user-facing surface, and the JSON dump is a user-facing
 * surface.
 *
 * The class also stamps `exitCodes` onto each definition, read from the
 * command's `static exitCodes` (`cli/util/exit-codes.ts`
 * §DEFAULT_EXIT_CODES for the default). Clipanion has no notion of exit
 * codes, so they cannot be derived, only declared.
 */

import { Cli } from 'clipanion';
import type { BaseContext, CommandClass, Definition } from 'clipanion';

import { DEFAULT_EXIT_CODES, type TExitCode } from './util/exit-codes.js';

/**
 * Structural mirror of Clipanion's `OptDefinition` (`lib/core.d.ts`),
 * the element type of `CommandBuilder#options`. Re-declared because the
 * package's `exports` map exposes only the root entrypoint, which does
 * not re-export it.
 */
interface IOptDefinition {
  preferredName: string;
  nameSet: string[];
  description?: string;
  arity: number;
  hidden: boolean;
  required: boolean;
  allowBinding: boolean;
}

/** One entry of `Definition['options']`, named for readability. */
type TDefinitionOption = Definition['options'][number];

/**
 * A `Definition` carrying the two pieces Clipanion does not provide:
 * the COMPLETE option list (not just the described ones) and the verb's
 * declared exit codes.
 */
export interface ISmDefinition extends Definition {
  exitCodes: readonly TExitCode[];
}

/** Command classes may declare their exit codes as a static. */
interface IExitCodeDeclaration {
  exitCodes?: readonly TExitCode[];
}

export class SmCli<Context extends BaseContext = BaseContext> extends Cli<Context> {
  /**
   * Same contract as `Cli#definition`, with `options` recomputed from
   * the parser's own registry and `exitCodes` stamped on. Returns
   * `null` for a command with no `static usage` (Clipanion's rule:
   * undocumented commands are absent from the catalog), preserved here
   * so `sm intentional-fail` stays invisible.
   */
  override definition(
    commandClass: CommandClass<Context>,
    opts: { colored?: boolean } = {},
  ): ISmDefinition | null {
    const base = super.definition(commandClass, opts);
    if (base === null) return null;
    return {
      ...base,
      options: this.declaredOptionsOf(commandClass),
      exitCodes: exitCodesOf(commandClass),
    };
  }

  /**
   * Cast-only override: the base implementation delegates to
   * `this.definition()` (our override) for every registered command, so
   * the payload already carries the extra fields, only the static type
   * needs widening.
   */
  override definitions(opts: { colored?: boolean } = {}): ISmDefinition[] {
    return super.definitions(opts) as ISmDefinition[];
  }

  /**
   * Every non-hidden option the command actually accepts, in
   * registration order (base-class fields first, then the verb's own),
   * rendered in the same shape Clipanion would have produced.
   */
  private declaredOptionsOf(commandClass: CommandClass<Context>): TDefinitionOption[] {
    const registration = this.registrations.get(commandClass);
    if (registration === undefined) return [];
    const options: readonly IOptDefinition[] = registration.builder.options;
    return options.filter((opt) => !opt.hidden).map(toDefinitionOption);
  }
}

/**
 * Mirror Clipanion's own `definition` string so downstream consumers
 * (including `sm help`'s boolean-vs-string inference) see no difference
 * between an option that carried a description and one that did not:
 * `-q,--quiet` for a boolean, `--ttl #0` for a one-argument string,
 * `--pair #0 #1` for `arity: 2`.
 */
function toDefinitionOption(opt: IOptDefinition): TDefinitionOption {
  const args: string[] = [];
  for (let i = 0; i < opt.arity; i++) args.push(` #${i}`);
  return {
    preferredName: opt.preferredName,
    nameSet: opt.nameSet,
    definition: `${opt.nameSet.join(',')}${args.join('')}`,
    description: opt.description ?? '',
    required: opt.required,
  };
}

/**
 * Read the command's declared exit codes, falling back to the default
 * set for a class that extends Clipanion's `Command` directly (the help
 * verbs) and never declared any.
 *
 * The cast is unavoidable: `exitCodes` is skill-map's own static, absent
 * from Clipanion's `CommandClass` type.
 */
function exitCodesOf(commandClass: object): readonly TExitCode[] {
  return (commandClass as IExitCodeDeclaration).exitCodes ?? DEFAULT_EXIT_CODES;
}
