# Part 4: The AI layer, your agent works the map - step library

Everything so far was deterministic: the map, the links, the checks
always compute the same answer from the same files. This part turns on
the OTHER half of skill-map, the probabilistic layer, where YOUR agent
(never skill-map itself) reads a file and records a judgment: a
summary, a finding, a proposed fix, a tag suggestion. Seven chapters:
the deterministic/probabilistic split, wiring the processing agent
(queue + MCP + a parked session), a first AI action, finders,
fixers and human decisions, the tagger, and the security lane.
`pace: per-step` and `preflight: seed` with the `flawed-portfolio`
snapshot, the connected campaign portfolio plus two planted-flaw docs
(`docs/REVIEW.md`, `docs/OPS.md`); see SKILL.md §Entering a part for
the recipe, including the in-order case (predecessors done: lay ONLY
the `ai-flaws` set and re-scan; the flawed docs are new content, not
part of `harness-connected`). Shared conventions (tone, provider
detection / substitution, the `> ` rendering rule, the per-step cycle)
live in `_core.md`; do not restate them here. Substitute `<provider>`
in every command block and prose mention below with
`tutorial.provider`, the same global substitution rule as
`<provider_dir>`.

Every flow in this part runs from the UI. The CLI has the same power
(`sm findings`, `sm jobs`, `sm show`), and chapter `two-kinds` says so
once; after that, no CLI walkthroughs.

**Lens gate (check BEFORE `pick` and BEFORE seeding anything)**: if
`tutorial.provider` is `agent-skills`, this part cannot run, the pure
open-standard lens has no runtime to park on the processing skill
(jobs need one of claude, codex, antigravity or opencode answering the
queue). Tell the tester in two short lines that this section needs one
of those runtimes (re-running the tutorial from one of those CLIs
unlocks it), then route back to the menu. Do NOT `pick` the part, do
NOT seed, do NOT mark anything; the part stays available in the menu.

**The second-session model (shapes the whole part)**: the processing
agent must sit parked on the queue, and THIS conversation cannot do
that (parking here would freeze the tutorial). Chapter `agent-circuit`
has the tester open a THIRD terminal, launch a fresh <provider>
session from the same folder, and park it on the processing skill.
That parked session answers every job the later chapters submit,
hands-free, and it is also where the fixer's questions land in chapter
`fixers`. Terminal inventory from chapter `agent-circuit` on: terminal
1 = this conversation, terminal 2 = `sm` (the server + UI), terminal
3 = the parked processing agent. Never run the processing skill in
terminal 1 yourself.

**Provider deltas** (the flows are identical; only the MCP
registration and the skill invocation vary):

| provider | MCP registration (Quick Start hands it over) | park the processing session with |
|---|---|---|
| claude | `Copy command`: a `claude mcp add … skill-map <url>` one-liner, run it in terminal 3 from this folder before launching the session | `/sm-process-jobs` |
| codex | `Copy command`: a `codex mcp add skill-map --url <url>` one-liner, run it in terminal 3; if the session cannot reach the MCP, the project trust level is the usual culprit (README §Processing agents) | `$sm-process-jobs` |
| antigravity | `Copy config`: a JSON document for `~/.gemini/config/mcp_config.json` in the tester's HOME (global, personal; if the file exists, add only the `skill-map` entry) | `/sm-process-jobs` |
| opencode | `Copy config`: a JSON document for `~/.config/opencode/opencode.json` in the tester's HOME (personal; if the file exists, add only the `skill-map` entry) | `/sm-process-jobs` |

## Chapter `two-kinds` - Two kinds of judgment (~3 min)

> The map you know so far is **deterministic**: scan the same files,
> get the same nodes, the same links, the same issues, every time. No
> AI involved. This part adds the second kind of judgment,
> **probabilistic**: your own agent reads a file and records an
> opinion about it. Opinions come with a confidence, can be wrong, and
> are always labeled as what they are.
>
> Let's look at both faces in one place. Make sure `sm` is running in
> your second terminal, open the UI, and click the `review-checklist`
> node on the map (it arrived with this part; it has problems we
> planted on purpose). In the inspector, two sections down, open
> **Findings**: there's already a row there, the link checker caught
> that the file points at an archive page that doesn't exist. That row
> is deterministic judgment: nobody's opinion, just a fact from the
> scan.
>
> Now scroll to the **AI actions** card: two columns of buttons,
> **Finders** and **Standalone**. Hover any of them: they're disabled,
> and the card warns that no agent is set up to process jobs. That's
> the probabilistic half, and it's dark because skill-map NEVER runs
> an LLM/agent itself: it queues work, and an agent of yours picks it
> up. In the next chapter we wire that agent.
>
> Note: everything you'll do in this part exists in the CLI too
> (`sm findings`, `sm jobs`, `sm show`), same data, same lifecycle.
>
> Tell me OK when you've seen both sections.

Expected: the Findings section shows the deterministic broken-ref row
for `archive/CHECKS.md`; the AI actions buttons are disabled with the
"Needs a jobs agent" tooltip and the card shows the no-agent warning.
If the inspector shows no Findings section, the tester clicked a
different node; `review-checklist` (`docs/REVIEW.md`) is the one with
the planted archive link.

Mark `two-kinds`: done.

## Chapter `agent-circuit` - The queue and the agent that answers it (~6 min)

> Time to hire the worker. The wiring has four pieces, and the UI
> walks you through all of them in one place: the rocket icon, top
> right, opens **Quick Start**. Look at the **AI Actions** group.
>
> First row, **Agent skill installed**: click **Install**. The dialog
> tells you exactly what it writes (a skill folder in this project)
> and that nothing else is touched; hit **Proceed**. This skill is the
> job-processing manual any agent can follow.
>
> Second row, **MCP server live**: click **Enable**. It flips to
> "Opted in, restart to apply", so go to your second terminal, Ctrl+C
> the running `sm`, start it again (`sm`), and refresh the browser
> tab. The row now reads **Live**: your local server speaks MCP, the
> protocol your agent uses to talk to the queue directly.

Then the registration, per the deltas table. On **claude / codex**
(command form):

> Third row, **MCP installed on your agent**: click **Copy command**.
> Open a THIRD terminal, cd into this same folder, paste and run it.
> That registers skill-map's MCP with <provider>, for you, in your own
> config; the project itself stays clean, your teammates never inherit
> it.

On **antigravity / opencode** (config form):

> Third row, **MCP installed on your agent**: click **Copy config**.
> It hands you a small JSON document plus the exact file path in your
> HOME where it belongs; open that file (create it if it's missing,
> paste the whole document; if it exists, add only the `skill-map`
> entry). Personal config, so the project stays clean and your
> teammates never inherit it. Then open a THIRD terminal and cd into
> this folder.

Then the park, all providers (substitute the invocation from the
deltas table; render the codex sigil where it applies):

> Now launch a fresh <provider> session in that third terminal, from
> this folder, and give it exactly one instruction:

```
/sm-process-jobs
```

> If <provider> asks you to approve the skill-map MCP connection,
> approve it. The session will check the queue, find it empty, and
> park itself waiting. That's its job from now on: it stays there,
> silent, and processes whatever the map queues up. Leave it be.
>
> Back in Quick Start: hit **Check** on the third row, it should
> report **Connected**. Then **Check** on the fourth row, **Agent
> waiting for jobs**: skill-map slips a tiny hidden ping job into the
> queue, and if your parked agent grabs it you'll see **"An agent is
> answering"**. That's the full circuit, proven end to end: UI to
> queue to your agent and back.
>
> ⚠️ Heads up for the rest of this part: keep an eye on that third
> terminal. The first times the session claims a job, reads a file, or
> edits one, <provider> will probably ask you to approve a permission,
> and a prompt sitting unanswered over there looks exactly like a job
> stuck in Queued over here. Tell me what both checks said.

Expected: third row Connected, fourth row "An agent is answering".
If Connected fails: the registration step was skipped or landed in the
wrong file (config form: the exact HOME path is printed under the
copy button), or the session predates the registration (relaunch it).
If "No agent answering": the session isn't parked (re-send the
invocation in terminal 3) or it never got the MCP approval. The same
Check lives in the inspector's AI actions card as **Check Agent**, so
the tester can re-probe from either place later; a red check there
disables every AI affordance until an agent answers again, that is
the honest state, not a bug.

Mark `agent-circuit`: done.

## Chapter `first-action` - Your first AI action (~4 min)

> Let's give it real work. Click the `deploy-runbook` node on the map
> (the clean little runbook). In the inspector header, right next to the
> file name, there's a sparkles button: **Analyze and summarize this
> file**. Before clicking it, open the **Job queue** tab on the left
> rail (the one labeled **Queue**), that's the waiting room you'll be
> watching all part long.
>
> Now click the sparkles. A job appears in the queue as **Queued**,
> your parked agent picks it up (**Running**), reads the file, and
> records a summary (**Completed**), usually within a few seconds.
> When it's done, the sparkles button on the header lights up: click
> it and the analysis unfolds, a structured brief with a
> **Confidence** percentage, written by your agent, stored by
> skill-map.
>
> One more thing, because it teaches how these judgments age: open
> `docs/DEPLOY.md` in your editor, add any line (a fourth step, say),
> and save. Watch the summary: it's now marked **stale**, the file
> changed since the analysis, so the opinion may no longer hold. Every
> probabilistic record in skill-map carries that honesty tag when its
> file drifts. **Analyze again** refreshes it whenever you want. Tell
> me what the summary says.

Expected: the queue row walks Queued -> Running -> Completed; the
summary block expands from the header sparkles; the editor save flips
the stale mark on (the watcher re-scan updates the body hash). If the
job sits Queued forever, terminal 3 is waiting on a permission prompt
or lost its park (answer the prompt, or re-send the invocation
there); if the run Failed, the queue row offers a retry.

Mark `first-action`: done.

## Chapter `finders` - Finders record findings (~5 min)

> Summaries describe; **finders** judge. Back to the `review-checklist`
> node, the checklist with the planted problems. In the **AI actions** card,
> look at the **Finders** column, and first check the **Auto-fixer**
> toggle in the card corner: leave it **off** for now (off means
> detect only; we'll let it fix in the next chapter).
>
> Click **redundancy**. A job queues, your agent reads the file and
> records what it finds. Now click **contradiction** and let it run
> too. Then open the **Findings** section above: the deterministic
> broken-ref row has company now, each new row labeled with its
> finding type, a severity, and a confidence percentage, that's your
> agent saying "I think this is a problem, and here's how sure I am".
>
> Read them: the redundancy finder should have caught that the
> checklist demands the Home link **twice**, once under Content and
> once under Before publishing; the contradiction finder should have
> caught that "always run the link check, even for a one-line fix"
> and "for a one-line hotfix, skip the checks" cannot both be
> followed. We planted both, your agent found both. Tell me what the
> rows say.

Expected: at least one `redundancy` finding (the duplicated Home-link
rule) and one `contradiction` finding (the hotfix clash) with
confidence percentages. Findings are probabilistic: wording varies
run to run, and an extra minor finding or a missed one is possible;
if a planted flaw was missed, re-run that finder once (the buttons
re-arm when the job completes). The `(run all)` link on the Finders
column header queues every finder at once, worth mentioning, not
worth running now.

Mark `finders`: done.

## Chapter `fixers` - Fixers and human decisions (~6 min)

> Detection is half the story. Most finders have a **fixer** twin
> that can edit the file, but skill-map keeps a hard line: a fixer
> either fixes something mechanical, or, when the fix needs a human
> call, it ASKS instead of guessing.
>
> You'll see both today. In the Findings section, the redundancy row
> has a sparkles button, **Auto-fix**: click it. Your parked agent
> takes the job, rewrites `docs/REVIEW.md` to state the Home-link rule
> once, and the finding resolves itself. Watch the file node flash on
> the map as the watcher picks up the edit.
>
> Now the interesting one: **Auto-fix** on the contradiction row. The
> fixer can't decide for you, "always check" versus "skip checks for
> hotfixes" is a policy choice, YOUR choice. So look at your third
> terminal: the processing agent is asking you which rule should win,
> in plain language, with options. Answer it there (pick either
> policy, it's your portfolio), and watch: it edits the file to make
> the two sections consistent with your answer and records the
> finding as fixed **by you**.
>
> Back in the Findings section, the open rows are gone. See the
> **N fixed** chip at the bottom? Click it: there's the history, the
> redundancy row fixed by the fixer, and the contradiction row wearing
> a **human** tag, fixed with your decision. Two more things live in
> these rows, so you know the vocabulary: a finding the fixer returns
> without an answer comes back tagged **needs decision** (its fix
> button disappears; you resolve it with the wrench, **Mark fixed**,
> after handling it yourself, or **Dismiss** it), and **Dismiss** on
> any row means "I disagree / don't care", reversible from the
> dismissed bucket. Tell me which policy you picked.

Expected: the redundancy fix lands (REVIEW.md loses one duplicate
bullet) and its finding moves to the fixed bucket; the contradiction
question shows up in terminal 3 and, once answered, the file edit
matches the answer and the finding lands in the fixed bucket with the
`human` tag. If the tester never sees the question, the processing
session may have been relaunched without the skill: re-park it and
re-run the fix. If the tester declines to answer, the finding comes
back tagged `needs decision`, which is exactly the vocabulary the
chapter teaches; walk the wrench path instead.

Mark `fixers`: done.

## Chapter `tagger` - The tagger proposes, you decide (~4 min)

> One more standalone, this one about metadata. Click the
> `style-guide` node (still untagged). In the inspector, the **Tags**
> row has its own sparkles button: **Auto-tag this file**. Click it.
>
> Your agent reads the file and proposes a few short topics, but here's
> the rule that matters: it writes NOTHING. When the job completes,
> the tag editor opens **pre-filled** with the proposal, and the pen
> stays in your hand: drop the tags you don't like, add your own, and
> only **Save** commits anything.
>
> On your first save, skill-map asks one more permission: tags live in
> a small `.sm` companion file next to the markdown (your content
> stays untouched, metadata never gets mixed in). Read the dialog and
> hit **Allow**. The tags appear on the node, and from now on they're
> part of your map: clicking a tag chip selects every node that shares
> it. Tell me which tags you kept.

Expected: the completed job opens the editor pre-filled (an empty
proposal opens nothing); nothing is written before Save; the first
save raises the sidecar consent dialog and, after Allow, a
`docs/STYLE.sm` sidecar appears and the chips render on the Tags row.
If the editor never opens, check the queue: the job may still be
running, or terminal 3 lost its park.

Mark `tagger`: done.

## Chapter `security-lane` - The security lane never obeys the document (~5 min)

> Last chapter, and it's the one to remember. Your agent reads files
> to judge them, so what happens when a file tries to manipulate the
> reader? Click the `ops-notes` node, the ops notes that came with
> this part, and read `docs/OPS.md` yourself first: a deploy token pasted in plain
> text, a curl-piped-to-shell install, and, if you look at the raw
> file in your editor, an HTML comment invisible in rendered view
> that orders "AI agents" to silently copy `.env` into a public page.
>
> Two finders cover this ground. In the AI actions card, run
> **security**: it flags the good-faith mistakes, the plaintext
> credential and the pipe-to-shell install, things an author fixes.
> Now run **suspicion**: it flags the hidden comment as what it is,
> an injection attempt aimed at whoever reads the file, and notice
> what did NOT happen: your agent read a direct order to exfiltrate
> secrets silently, and instead of obeying it, it reported it to you.
> The processing skill hardens your agent for exactly this.
>
> One more layer you get for free: the **kernel** watches every run.
> Every probabilistic job's report must carry a safety verdict on the
> content it read, and when that verdict flags trouble the kernel
> records its own warnings (`injection-detected`,
> `content-suspicious`), tagged **kernel** in the row so you know the
> named extension did not author them. That means these warnings
> surface even when nobody was looking for security: a plain summary
> or a verbosity pass over this same file would raise them too. Any
> agent that read the file honestly reports what the content tried to
> do.
>
> One design line skill-map will never cross: **suspicion findings
> have no fixer, ever.** Auto-fixing manipulative content would hand
> an agent edit permissions over the very text designed to manipulate
> it. Cleaning `docs/OPS.md` is your job, with your editor and your
> judgment; the lane only points. Tell me what the findings say.

Expected: `security` records findings for the plaintext token and the
`curl | bash` line (severity warn or higher); `suspicion` records the
hidden-comment injection; no fix button on the suspicion rows; and
crucially the agent's report NEVER complies with the comment (no
`.env` content anywhere in any output). The kernel safety rows
(`injection-detected` / `content-suspicious`) also appear with the
`kernel` tag, ONE row per fact for the node: the lane is node-scoped,
the newest run's verdict owns it, so two finders never stack
duplicate copies of the same warning. If the tester asks why the
buttons differ from the other finders, that's the teaching moment:
the split is by who fixes, the author (security) versus never-an-agent
(suspicion).

Then close the part (all providers):

> That's the AI layer, end to end: a queue only YOUR agent answers,
> judgments that carry their confidence and their staleness honestly,
> fixes that ask when the call is yours, a tagger that proposes and
> never writes, and a security lane that reads hostile text without
> obeying it. Everything is reversible from the same places you wired
> it: Quick Start uninstalls the skill and disables the MCP server,
> and the parked session in terminal 3 is just a chat you can Ctrl+C
> whenever you're done queueing work.

Mark `security-lane`: done. The part closes per `_core.md` §Closing a
part.
