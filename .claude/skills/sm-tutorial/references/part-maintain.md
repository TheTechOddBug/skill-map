# Part 4: Maintain the site (step library, `maintain`)

This is the upkeep part. The harness from Part 2 is wired and clean; real projects drift, links break, drafts pile up, names collide. Here the tester breaks something on purpose and fixes it, meets the analyzer catalogue that catches those problems, finds an orphan nobody links to, clears a reserved-name warning, and learns the `.sm` companion files that carry the tool's bookkeeping. `pace: auto-advance` (walk straight into the next chapter once one is marked done), `preflight: reuse` (it builds on the portfolio harness from Parts 1 and 2, no fresh fixture of its own). Shared conventions (tone, provider detection / substitution, the `> ` rendering rule, the per-step cycle) live in `_core.md`; do not restate them here.

## Chapter `broken-ref` - A link breaks (~3 min)

**Context**: the most common kind of decay in a real project is a link that points at a file someone renamed or moved. Here the tester renames `docs/DEPLOY.md`, which breaks the `/publish -> docs/DEPLOY.md` reference from Part 2, and `sm check` surfaces it as `core/reference-broken`. Then they fix it by updating the link. Same watcher / live-UI loop they already know, plus the CLI verb that catalogues the issue.

This chapter is the tester's hands the whole way (renaming and editing their own files, Inviolable rule #2). Tell the tester to start the server again first if it is not running:

```bash
sm
```

> Open the URL `sm` prints, same as before. Now break something on
> purpose. Rename your deploy runbook from `docs/DEPLOY.md` to
> `docs/DEPLOYMENT.md` (just change the filename, leave the contents
> alone). On most systems that is one command in the terminal:
>
> ```bash
> mv docs/DEPLOY.md docs/DEPLOYMENT.md
> ```
>
> Watch the **Map**: the `publish -> docs/DEPLOY.md` arrow can no
> longer find its target, because nothing called `docs/DEPLOY.md`
> exists anymore. The link is now dangling.

After they confirm the rename, have them ask skill-map about it:

```bash
sm scan
sm check
```

> `sm scan` refreshes what skill-map knows from disk, then `sm check`
> reports the problem: an issue from the `core/reference-broken`
> analyzer (a rule that flags links pointing at files that do not
> exist), naming the link `../../docs/DEPLOY.md` inside your `/publish`
> command. That is the broken reference you just created.
>
> Now fix it. Open `.claude/commands/publish.md` in your editor and
> change the deploy-runbook link so it points at the new filename:
> `[deploy runbook](../../docs/DEPLOYMENT.md)`. Save, then re-check:
>
> ```bash
> sm scan
> sm check
> ```
>
> `sm check` should print `✓ No issues` and the arrow comes back on
> the **Map**. (If you would rather not keep the new name, renaming
> the file back to `docs/DEPLOY.md` clears it just as well, but the
> link edit is the more realistic fix.)
>
> Did the issue surface and then clear?

Wait for confirmation. You MAY use `Read` on `.claude/commands/publish.md` to verify the link edit landed. Leave the server running, the next chapters reuse it. Mark `broken-ref`: done.

## Chapter `analyzers` - The analyzer catalogue (~3 min)

**Context**: `reference-broken` was just one rule. `sm check` runs a catalogue of around 16 deterministic analyzers, each catching a different family of problem. This chapter names a few and shows how to focus on one with `--analyzers`. No fixture changes, the tester just runs the verb against the clean harness.

No file edits in this chapter.

Tell the tester:

> The broken-ref you just saw is one rule out of a catalogue. `sm
> check` runs roughly 16 deterministic analyzers (each one a small
> rule that scans your harness for a specific kind of problem). A few
> of the families:
>
> - `core/reference-broken`: a link points at a file that does not
>   exist (the one you just triggered).
> - `core/name-reserved`: a file is named after a built-in the vendor
>   runtime owns, so that runtime would ignore it (you will see this
>   one live in a couple of chapters).
> - `core/link-self-loop`: a node links to itself.
> - `core/reference-redundant`: the same body points at the same
>   target twice.
> - `core/signal-collision`: two analyzers disagreed about the same
>   slice of a file, and the warning explains who won and why.
>
> When you only care about one, focus on it:
>
> ```bash
> sm check
> sm check --analyzers reference-broken
> ```
>
> The first runs the whole catalogue; the second narrows the report to
> just the reference-broken rule. Your harness is clean right now, so
> both print `✓ No issues`, but the same `--analyzers <id>` pattern
> works for every rule in the catalogue.
>
> Paste me the output (or just an OK).

Wait for confirmation. Mark `analyzers`: done.

## Chapter `orphans` - A page nobody links to (~3 min)

**Context**: a different kind of loose end. A node can be perfectly valid and still be an orphan: nothing in the harness links to it. We create a draft page that no one references, and `sm orphans` finds it. The point is to separate three ideas the tester now has names for: orphan (nothing points at it) vs broken-ref (a link with no target) vs issue (a rule violation).

`Write` `docs/draft.md` (markdown kind), a half-finished page nobody has wired up yet:

```markdown
---
name: draft
description: |
  Half-finished page nobody links to yet. Here to show what an
  orphan looks like: a valid node with no incoming connectors.
tags: [docs, portfolio, draft]
---

# Draft page

Notes for a page that is not ready to link from anywhere yet.
```

Confirm the new `docs/draft` node appears on the **Map** as a floating dot with no arrows in or out.

Tell the tester:

> I dropped a new note into your project, `docs/draft.md`, a
> half-finished page. Look at the **Map**: it shows up as a floating
> dot with no arrows touching it. Nothing in your harness links to it,
> which makes it an **orphan**.
>
> ```bash
> sm orphans
> ```
>
> `sm orphans` lists exactly that: nodes nothing points at. It is
> worth keeping three ideas apart, because they are easy to confuse:
>
> - **orphan**: a real, valid node that simply has no incoming link
>   (your `docs/draft`). Not an error, just unreferenced.
> - **broken-ref**: a link whose target file does not exist (the one
>   you triggered by renaming the runbook). That is a real issue.
> - **issue**: any rule violation `sm check` reports (broken-ref is
>   one family; name-reserved, self-loop and the rest are others).
>
> An orphan is not automatically a problem (a draft you have not wired
> up yet is fine), it is just skill-map pointing out the page is not
> reachable from anywhere. When you link to it later, it stops being
> an orphan.
>
> Did `sm orphans` list `docs/draft`?

Wait for confirmation. Mark `orphans`: done.

## Chapter `reserved` - A reserved name collides (~3 min)

**Context**: vendor runtimes own certain names (`/init`, `/help`, `/clear`, and friends). If the tester names a command after one of those, the runtime ignores their file and skill-map raises a `core/name-reserved` warning to say so. We create the collision, see the warning, then rename to clear it.

`Write` `.claude/commands/init.md` (substitute `<provider_dir>` per `_core.md`; on `agent-skills` / Antigravity there is no `command` kind, so skip this whole chapter), deliberately named after the built-in `/init`:

```markdown
---
name: init
description: |
  Bootstraps a fresh portfolio scaffold. Named init on purpose, to
  collide with the runtime built-in and trigger name-reserved.
args:
  - name: target
    type: path
    description: Folder to scaffold into.
    required: true
---

# /init

Sets up the empty folders a new portfolio needs.
```

Confirm the new `init` command node appears on the **Map**.

Tell the tester:

> I added a command called `/init` to your harness. There is a catch:
> `/init` is a name the vendor runtime already owns for its own
> built-in, so the runtime would quietly ignore your file and never
> run it. Skill-map flags exactly that:
>
> ```bash
> sm scan
> sm check
> ```
>
> You will see a `core/name-reserved` warning naming the `init`
> command. It is not skill-map being fussy, it is telling you "the
> runtime will never invoke this file, pick another name". On the
> **Map**, any link into a shadowed node is drawn faint for the same
> reason.
>
> The fix is just to rename it. Rename `.claude/commands/init.md` to
> something that is not reserved, for example
> `.claude/commands/scaffold.md` (and update the `name:` in its
> frontmatter to `scaffold`). On most systems:
>
> ```bash
> mv .claude/commands/init.md .claude/commands/scaffold.md
> ```
>
> Then re-check:
>
> ```bash
> sm scan
> sm check
> ```
>
> The warning should be gone. A reserved name is one of the rare
> mistakes skill-map can catch before the runtime ever bites you.
>
> Did the warning appear and then clear after the rename?

Wait for confirmation. You MAY use `Read` to verify the rename landed. Mark `reserved`: done.

## Chapter `sidecar` - The .sm companion file and its consent prompt (~3 min)

**Context**: every `.md` skill-map tracks can get a sibling **companion file** with extension `.sm` that carries all of the tool's metadata about that markdown (version, history, tags, annotations), so the `.md` stays clean and only holds the content you write. The `.md` is yours; the `.sm` is bookkeeping the tool writes. The first time skill-map wants to create one in a project it asks for consent, and the choice is remembered in `settings.local.json`. We demonstrate on the handbook.

This is a CLI beat, the tester runs everything. **Reset any prior consent first** so the `[Y/n]` prompt actually appears (an earlier session may have flipped the flag, in which case the verb would skip straight past it and the lesson would not land):

```bash
rm -f AGENTS.sm .skill-map/settings.local.json
sm sidecar annotate AGENTS.md
```

> `sm sidecar annotate` creates a fresh `.sm` companion file next to a
> markdown file. Because this is the first time skill-map wants to
> write one here, it shows a short explanation and then a `[Y/n]`
> prompt (capital Y is the default, so you can just press Enter to
> accept). skill-map never writes a `.sm` to your project without your
> OK.
>
> After you accept, two things happen: a new `AGENTS.sm` file appears
> next to `AGENTS.md` (carrying an `identity:` block and an empty
> `annotations: {}` block), and your project remembers the choice in
> `.skill-map/settings.local.json` so it never asks again. Take a look:
>
> ```bash
> cat AGENTS.sm
> cat .skill-map/settings.local.json
> ```
>
> You will see `AGENTS.sm` holds the tool's bookkeeping for the
> handbook, and `settings.local.json` now contains
> `{ "allowEditSmFiles": true }`. That flag lives in the local config
> layer (gitignored), so each contributor consents on their own
> checkout and the choice never travels through git.
>
> Did the prompt appear, and does `AGENTS.sm` exist now?

Wait for confirmation. You MAY use `Read` on `AGENTS.sm` to verify it landed. Mark `sidecar`: done.

## Chapter `versions` - Bump a version, read its history (~3 min)

**Context**: now that the consent is granted, the day-to-day versioning verbs go through silently. `sm bump` increments a node's frontmatter version and appends a record to its `.sm` companion; `sm history` reads that trail back. We bump the content editor and read its history. Same consent gate as the previous chapter, already satisfied.

This is a CLI beat, the tester runs everything (substitute `<provider_dir>` in the path per `_core.md`):

```bash
sm bump content-editor
sm history content-editor
```

> `sm bump <node>` is the everyday versioning verb: it nudges the
> `version` field in the node's frontmatter up by one and appends an
> entry to that node's `.sm` companion file, recording that the bump
> happened. Because you already granted consent in the last chapter,
> it runs without prompting (the `.sm` write is pre-authorized for
> this checkout).
>
> `sm history <node>` reads that trail back: it prints the version
> entries skill-map has recorded for the content editor, so you can
> see how it has changed over time. Right after one bump you will see
> the single entry the bump just wrote.
>
> The two verbs are a pair: `sm bump` writes a version checkpoint into
> the companion file, `sm history` reads the checkpoints back out.
> Your `.md` body never gets cluttered with this, it all lives in the
> `.sm` alongside it.
>
> Does `sm history` show the bump you just made?

Wait for confirmation. Mark `versions`: done. Last chapter of the part: apply §Closing a part (the close names the part by its title and routes back to the menu).
