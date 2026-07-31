/**
 * Completeness guard for `sm help --format json`.
 *
 * `spec/cli-contract.md` §Introspection makes that document NORMATIVE:
 * "any change to verbs, flags, or exit codes MUST reflect in
 * `--format json` output immediately. Third-party consumers rely on it."
 * For most of the CLI's life it did not: `Cli#definitions()` builds
 * `Definition.options` from `CommandBuilder#usage({ inlineOptions: false })`,
 * which pushes an option into the structured array ONLY when it declares
 * a `description` (clipanion 4.0.0-rc.4, `CommandBuilder#usage`), so 78 of
 * skill-map's 172 flag-form options were invisible, `sm jobs submit`
 * published 5 flags (all inherited from `SmCommand`) and accepted 12.
 * `cli/sm-cli.ts` fixes it by reading `CommandBuilder#options`, the
 * unfiltered registry Clipanion's own parser matches argv against.
 *
 * This file is the reason that fix stays fixed. It derives the expected
 * flag set MECHANICALLY and through a DIFFERENT path than the production
 * code, so it is not a tautology: production reads the CLI-level builder
 * registry, the test instantiates every command class, finds the
 * properties carrying Clipanion's `Command.isOption` marker, and replays
 * each option spec's own `definition(builder, key)` against a recording
 * builder (exactly what `Cli#register` does internally). A flag added to
 * any verb tomorrow is covered with no edit here; a regression in the
 * harvester (a re-introduced description filter, an unhandled
 * `Option.*` kind, a stray `.filter()`) fails this suite.
 *
 * Deliberately NOT flagged as missing: `hidden: true` options
 * (`sm serve --ui-dist`, `--watcher-debounce-ms`), which are absent from
 * every user-facing surface by design.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Command } from 'clipanion';
import type { BaseContext } from 'clipanion';

import { createSmCli, SM_COMMANDS } from '../../command-registry.js';
import { ExitCode, type TExitCode } from '../../util/exit-codes.js';
import { GLOBAL_FLAGS, SmCommand } from '../../util/sm-command.js';

// --- harness --------------------------------------------------------------

interface IHelpFlag {
  name: string;
  aliases: string[];
  type: 'boolean' | 'string';
  description: string;
  required: boolean;
}

interface IHelpVerb {
  name: string;
  category: string;
  flags: IHelpFlag[];
  exitCodes: number[];
}

interface IHelpDocument {
  cliVersion: string;
  specVersion: string;
  globalFlags: Array<{ name: string; type: string; description: string }>;
  verbs: IHelpVerb[];
}

/** Run `sm help --format json` through the real composed CLI and parse it. */
async function helpDocument(): Promise<IHelpDocument> {
  const chunks: string[] = [];
  const context = {
    stdin: process.stdin,
    stdout: { write: (s: string) => { chunks.push(s); return true; } },
    stderr: { write: () => true },
  } as unknown as BaseContext;
  const exit = await createSmCli().run(['help', '--format', 'json'], context);
  assert.equal(exit, ExitCode.Ok, 'help --format json exits 0');
  return JSON.parse(chunks.join('')) as IHelpDocument;
}

/**
 * The subset of Clipanion's `CommandBuilder` that option specs call from
 * their `definition()`. Records what each spec registers instead of
 * building a parser.
 */
interface IRecordedOption {
  names: string[];
  hidden: boolean;
}

class RecordingBuilder {
  readonly recorded: IRecordedOption[] = [];

  addOption({ names, hidden }: { names: string[]; hidden?: boolean }): void {
    this.recorded.push({ names, hidden: hidden === true });
  }

  // Positional-flavoured registrations (`Option.String({})`, `Option.Rest`,
  // `Option.Proxy`) are not flags; recorded as no-ops so the replay never
  // throws on a command that declares them.
  addPositional(): void {}
  addRest(): void {}
  addProxy(): void {}
}

/** A Clipanion option spec: `{ [Command.isOption]: true, definition, transformer }`. */
interface ICommandOptionSpec {
  definition: (builder: RecordingBuilder, key: string) => void;
}

function isOptionSpec(value: unknown): value is ICommandOptionSpec {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[Command.isOption] === true
  );
}

/**
 * Every non-hidden flag name the command class declares, derived by
 * instantiating it and replaying its option specs. Mirrors
 * `Cli#register`'s own `for (const key in command)` walk.
 */
function declaredFlagNames(commandClass: unknown): string[] {
  const instance = new (commandClass as new () => Command)();
  const builder = new RecordingBuilder();
  for (const key in instance) {
    const value = (instance as unknown as Record<string, unknown>)[key];
    if (isOptionSpec(value)) value.definition(builder, key);
  }
  return builder.recorded.filter((opt) => !opt.hidden).flatMap((opt) => opt.names);
}

/** Verb paths a command class claims, as space-joined names (`jobs submit`). */
function verbNamesOf(commandClass: unknown): string[] {
  const paths = (commandClass as { paths?: string[][] }).paths ?? [];
  return paths.map((path) => path.join(' '));
}

function isDocumented(commandClass: unknown): boolean {
  return (commandClass as { usage?: unknown }).usage !== undefined;
}

/** Flag names the JSON document publishes for a verb (preferred names + aliases). */
function publishedFlagNames(verb: IHelpVerb): string[] {
  return verb.flags.flatMap((flag) => [flag.name, ...flag.aliases]);
}

// --- tests ----------------------------------------------------------------

describe('sm help --format json, flag completeness', () => {
  it('publishes every Option.* a verb declares, for every registered verb', async () => {
    const doc = await helpDocument();
    const byName = new Map(doc.verbs.map((verb) => [verb.name, verb]));
    const missing: string[] = [];
    const phantom: string[] = [];
    let checked = 0;

    for (const commandClass of SM_COMMANDS) {
      if (!isDocumented(commandClass)) continue;
      for (const verbName of verbNamesOf(commandClass)) {
        const verb = byName.get(verbName);
        // Bare-flag paths (`--version`) never enter the verb catalog.
        if (verb === undefined) continue;
        checked++;
        const declared = new Set(declaredFlagNames(commandClass));
        const published = new Set(publishedFlagNames(verb));
        for (const name of declared) {
          if (!published.has(name)) missing.push(`${verbName} → ${name}`);
        }
        for (const name of published) {
          if (!declared.has(name)) phantom.push(`${verbName} → ${name}`);
        }
      }
    }

    // Every published verb must trace back to a registered class: a
    // catalog entry nobody claims would slip past the two loops above.
    assert.equal(
      checked,
      doc.verbs.length,
      `every published verb maps to a registered command class (checked ${checked} of ${doc.verbs.length})`,
    );
    assert.deepEqual(missing, [], `flags declared by a verb but absent from the JSON dump:\n${missing.join('\n')}`);
    assert.deepEqual(phantom, [], `flags in the JSON dump that no verb declares:\n${phantom.join('\n')}`);
  });

  it('carries the verb-specific flags, not just the inherited globals', async () => {
    const doc = await helpDocument();
    const submit = doc.verbs.find((verb) => verb.name === 'jobs submit');
    assert.ok(submit, 'jobs submit is in the catalog');
    const names = publishedFlagNames(submit);
    // The regression that motivated the guard: these were all missing.
    for (const flag of ['-n', '--all', '--force', '--ttl', '--priority', '--auto-fix', '--finding']) {
      assert.ok(names.includes(flag), `jobs submit publishes ${flag}, got ${names.join(' ')}`);
    }
  });

  it('types an option taking a value as string and a switch as boolean', async () => {
    const doc = await helpDocument();
    const submit = doc.verbs.find((verb) => verb.name === 'jobs submit');
    assert.equal(submit?.flags.find((flag) => flag.name === '--ttl')?.type, 'string');
    assert.equal(submit?.flags.find((flag) => flag.name === '--all')?.type, 'boolean');
  });

  it('omits hidden options', async () => {
    const doc = await helpDocument();
    const serve = doc.verbs.find((verb) => verb.name === 'serve');
    const names = publishedFlagNames(serve!);
    assert.ok(!names.includes('--ui-dist'), 'hidden --ui-dist stays out of the public dump');
    assert.ok(names.includes('--port'), 'visible serve flags are still published');
  });
});

describe('sm help --format json, global flags', () => {
  it('publishes the spec §Global flags table', async () => {
    const doc = await helpDocument();
    const names = doc.globalFlags.map((flag) => flag.name).sort();
    assert.deepEqual(names, ['--db', '--help', '--json', '--no-color', '--quiet', '--verbose']);
    for (const flag of doc.globalFlags) {
      assert.ok(flag.description.length > 0, `${flag.name} carries a description`);
    }
    assert.equal(doc.globalFlags.find((flag) => flag.name === '--db')?.type, 'string');
  });

  it('describes each global flag identically per verb and in the catalog', async () => {
    const doc = await helpDocument();
    const scan = doc.verbs.find((verb) => verb.name === 'scan');
    for (const global of GLOBAL_FLAGS) {
      const perVerb = scan?.flags.find((flag) => flag.name === global.name);
      assert.ok(perVerb, `scan publishes the global ${global.name}`);
      assert.equal(perVerb.description, global.description, `${global.name} description matches`);
    }
  });
});

describe('sm help --format json, exit codes', () => {
  const VALID = new Set<number>(Object.values(ExitCode) as TExitCode[]);

  it('declares a sane, ascending, spec-valid set for every verb', async () => {
    const doc = await helpDocument();
    for (const verb of doc.verbs) {
      assert.ok(Array.isArray(verb.exitCodes), `${verb.name} carries exitCodes`);
      assert.ok(verb.exitCodes.length > 0, `${verb.name} declares at least one exit code`);
      assert.ok(verb.exitCodes.includes(ExitCode.Ok), `${verb.name} can succeed`);
      for (const code of verb.exitCodes) {
        assert.ok(VALID.has(code), `${verb.name} exit code ${code} is in spec §Exit codes`);
      }
      const sorted = [...verb.exitCodes].sort((a, b) => a - b);
      assert.deepEqual(verb.exitCodes, sorted, `${verb.name} exit codes are ascending`);
      assert.equal(new Set(verb.exitCodes).size, verb.exitCodes.length, `${verb.name} exit codes are unique`);
    }
  });

  it('includes the universal error code on every SmCommand verb', async () => {
    // `SmCommand.execute()` funnels anything escaping `run()` into
    // ExitCode.Error, so exit 2 is reachable from every verb built on it.
    const doc = await helpDocument();
    const byName = new Map(doc.verbs.map((verb) => [verb.name, verb]));
    for (const commandClass of SM_COMMANDS) {
      if (!(commandClass.prototype instanceof SmCommand)) continue;
      for (const verbName of verbNamesOf(commandClass)) {
        const verb = byName.get(verbName);
        if (verb === undefined) continue;
        assert.ok(
          verb.exitCodes.includes(ExitCode.Error),
          `${verbName} must publish exit 2 (SmCommand error boundary)`,
        );
      }
    }
  });

  it('pins the verbs whose exit codes the spec spells out', async () => {
    const doc = await helpDocument();
    const codesOf = (name: string): number[] =>
      doc.verbs.find((verb) => verb.name === name)?.exitCodes ?? [];
    // spec/cli-contract.md §Scan, §Jobs, §Record, §Introspection.
    assert.deepEqual(codesOf('scan'), [0, 1, 2]);
    assert.deepEqual(codesOf('check'), [0, 1, 2, 5]);
    assert.deepEqual(codesOf('init'), [0, 1, 2]);
    assert.deepEqual(codesOf('jobs submit'), [0, 2, 3, 5]);
    assert.deepEqual(codesOf('jobs claim'), [0, 1, 2, 5]);
    assert.deepEqual(codesOf('record'), [0, 2, 4, 5]);
    assert.deepEqual(codesOf('conformance run'), [0, 1, 2]);
    assert.deepEqual(codesOf('version'), [0, 2]);
  });
});
