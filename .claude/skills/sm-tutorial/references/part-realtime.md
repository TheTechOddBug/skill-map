# Part 3: Real time, watch your agent run - step library

The live map's second act: so far the map showed what the files ARE;
this part makes it show what the agent DOES. With the provider's own
hooks wired, every node lights up the moment the runtime actually
invokes it (a skill it loads, an agent it delegates to, a markdown it
reads). Three chapters: wire the hook from Settings (with its consent
dialog), restart the agent session and watch the portfolio glow, and
opt in to conversation capture. `pace: per-step` and `preflight: seed` with the
`harness-connected` snapshot, the same entry recipe as `daily-loop`
(see SKILL.md §Entering a part): entered out of order it fast-forwards
to the connected portfolio, the campaign project, so what lights up is
the tester's own harness (the handbook, the docs, `check-links`,
`content-editor`). Shared conventions (tone, provider detection / substitution,
the `> ` rendering rule, the per-step cycle) live in `_core.md`; do not
restate them here. Substitute `<provider>` in every command block and
prose mention below with `tutorial.provider`, the same global
substitution rule as `<provider_dir>`.

**Lens gate (check BEFORE `pick` and BEFORE seeding anything)**: if
`tutorial.provider` is `agent-skills`, this part cannot run, the pure
open-standard lens has no runtime to hook (`sm activity` supports
claude, codex, antigravity and opencode). Tell the tester in two short
lines that this section needs one of those runtimes (re-running the
tutorial from one of those CLIs unlocks it), then route back to the
menu. Do NOT `pick` the part, do NOT seed, do NOT mark anything; the
part stays available in the menu.

**The session-restart wrinkle (shapes the whole part)**: provider
runtimes load their hook config when a session STARTS, so the hook
wired in chapter `wire` cannot fire in the session that wired it,
including THIS one. Chapter `wire` therefore ends at a hard stop that
has the tester close this agent session, relaunch it from the same
folder, and say "resume the tutorial". The fresh session enters resume
mode (`tutorial-state.json` is on disk), `state.js status` shows
`realtime` in progress with `wire` done, and continue lands on chapter
`live`. On that resume do NOT re-run the part preflight (the fixture
and the DB are already on disk); pick up at `live` directly. Only the
AGENT session restarts: the tester's `sm` in the second terminal stays
up.

**Provider deltas** (the skeleton is identical; only the trigger and
the payoff vary):

| provider | hook config (the consent prompt names it) | what lights up | chapter `live` trigger | chapter `conversations` payoff |
|---|---|---|---|---|
| claude | `.claude/settings.json` | reads, skills, agents (nested too), spawn arrows, execution totals | you (the agent) read the harness files | spawn arrow + conversation dialog (`content-editor`) |
| codex | `.codex/hooks.json` | `$skill` tokens in the tester's prompt, named agents, spawn arrows | the tester sends `$check-links …` in this conversation (file reads do not fire on codex) | spawn arrow + conversation dialog (`content-editor`) |
| antigravity | `.agents/hooks.json` | file reads only; the lit chain goes dark on idle | you (the agent) read the harness files | consent + explanation only |
| opencode | `.opencode/plugin/skill-map-activity.js` | named skills / commands / agents plus reads; dark on idle | you (the agent) read the harness files | consent + explanation only |

## Chapter `wire` - Wire the live-activity hook (~3 min)

The whole chapter runs from the UI; no `sm activity` commands are
shown (the verb family exists, but this part teaches the Settings
path).

> So far the map showed you what your files are. Now it'll show you
> what your agent does: with a small hook wired into <provider>'s own
> config, each node lights up the moment the runtime actually touches
> it. First, in your second terminal, start the server and leave it
> running (if an `sm` from an earlier part is still open, Ctrl+C it
> first):

```bash
sm
```

> Open the URL it prints in your browser. Top right, the sliders icon
> opens **Settings**; go to the **Project** tab. The selector at the
> top shows the active lens, the runtime skill-map is reading your
> project through (it should say <provider>), and right below it
> there's the **Live-activity hook** row. Its button reads
> **Install <provider> activity hook**: click it.
>
> Before touching anything it asks for your permission: the dialog
> names the exact file it will edit (a config that belongs to
> <provider>, not to skill-map) and tells you your existing hooks are
> preserved. Read it and hit **Proceed**.
>
> The button flips to **Uninstall <provider> activity hook**: that's
> how you know it's wired, and also how you undo it later (same row,
> same kind of confirmation). Tell me OK when you see it.

Expected: the dialog names the config file from the deltas table for
the active lens; after Proceed the row's hint reads "Activity hook
installed into <config path>" and the button flips to Uninstall. The
row targets the ACTIVE lens, which the part preflight aligned with
`tutorial.provider`; if the selector shows a different lens, sort that
out first (switch it back) before installing. If the tester cancelled
the dialog, nothing was written: have them click Install again and
Proceed.

Mark `wire`: done. Then close the message with the restart bridge
below, this is the one chapter boundary that crosses an agent session:

> Wired. Now the one-time trick: <provider> only reads its hook config
> when a session **starts**, so the hook can't fire in this
> conversation. Leave the server and the browser exactly as they are,
> close this session, and start me again the way you started this one,
> from this same folder. In the fresh session just say
> **"resume the tutorial"** and I'll pick up right where we left off.

## Chapter `live` - Restart and watch nodes light up (~3 min)

This chapter begins on the RESUMED session (see the part header). If
`state.js status` shows `wire` done but the tester says they never
restarted, walk them through the restart bridge again first; the hook
cannot fire in the session that wired it.

> Quick look at the top bar of the UI before anything else: the pulse
> icon (the little heartbeat line) is the **Real Time** toggle. It's
> on by default, and now that
> the server is running and the hook is wired it's active (when it's
> blocked, its tooltip tells you why). Next to the zoom controls
> there's also a camera icon, **Follow the Activity**: turn it on if
> you want the camera to chase whatever runs; any manual pan or zoom
> gives you the camera back.

The trigger, per the deltas table. On **claude / antigravity /
opencode**:

> Keep the map visible and say OK: I'm going to touch a few of the
> demo files myself, and you watch the map while I do.

On the OK, silently `Read` three harness files one after the other,
pausing a beat between them so the glow reads as a sequence:
`AGENTS.md` (the handbook), `docs/STYLE.md`, and the `check-links`
skill's `SKILL.md` (under `<provider_dir>/skills/check-links/`). Your
OWN tool calls fire the provider's hooks; that is the demo. Do NOT
recap which files you touched (`_core.md` §Silence: the reads are
backstage, and the map already showed them); your next message is
ONLY this:

> Watch the map: three nodes should have lit up with their kind's
> color the moment I read them. That's the hook at work. What did
> you see?

On **codex** (reads do not fire there):

> Keep the map visible and send me exactly this as your next message,
> the `$` token in your own prompt is what the hook sees:

```
$check-links do a quick pass over the handbook links
```

Run the skill briefly and answer in one short line; then, with no
recap of what you just did, ask the same watch-the-map question as
above (singular: the `check-links` node).

Expected (from the tester's reply): the touched nodes
glow with their kind's accent color. On claude / codex the glow decays
by itself after a few seconds; on antigravity / opencode the lit chain
goes dark the moment the runtime goes idle instead. If nothing lit up:
(1) confirm the agent session was actually restarted after `wire` (the
hook loads at session start), (2) confirm `sm` is running FROM this
folder (the bridge finds the server through `.skill-map/serve.json`; a
server started in another directory receives nothing), (3) re-open
Settings > Project and confirm the Live-activity hook row offers
Uninstall (that means installed; if it offers Install, install it
again), and (4) check the topbar Real Time toggle (the pulse icon) is
on.

Mark `live`: done.

## Chapter `conversations` - Capture agent conversations (opt-in) (~3 min)

> One more permission, this one about content. When agents spawn other
> agents, skill-map can keep each spawn's prompt and response so you
> can read them from the map. That's your conversation data, so it's
> **off by default**, behind its own switch.
>
> In the UI, open Settings (the sliders icon, top right), go to the
> **Project** tab and find **Capture agent conversations**. Flip it on
> and read the dialog before accepting, what it says is the whole
> contract: conversations stay **in memory** only while the server
> runs (at most the 200 most recent spawns), nothing is ever written
> to disk, and flipping the switch off (or stopping the server) clears
> them immediately.
>
> Accept it and tell me OK.

Then the payoff, per the deltas table. On **claude / codex**, first
set the scene (the spawn visuals are EPHEMERAL, they live exactly as
long as the run, so the tester must be watching BEFORE you spawn):

> Now the demo. When you say OK I'll delegate a small task to
> `content-editor`, and while it runs the map will show two things
> that only exist while something executes: a dashed capsule named
> "Session 1" (that's us: this conversation isn't a file on disk, so
> the map draws a temporary anchor for whatever the session spawns)
> and a dashed arrow from that capsule to `content-editor`. Both fade
> when the run ends, they're live traces, not part of your project.
> Eyes on the map, and say OK.

On the OK, silently spawn the harness agent (claude: the
`content-editor` subagent via your agent-spawning tool; codex:
`spawn_agent` with `content-editor`) with a prompt that takes a few
seconds, e.g. "Read docs/STYLE.md and reply with one improvement
suggestion, in one line.", so the capsule and the arrow stay visible
long enough to be seen. When it returns, with no recap of the spawn
itself:

> Did you catch the capsule and the arrow? They're gone now, and
> that's by design: they live exactly as long as the run. The
> conversation itself was kept, though, that's the permission you
> just granted. Click the `content-editor` node: in the inspector's
> **Activity** section you'll find **Agent spawns** with a
> "session -> content-editor" row; hit **View conversation** and
> there it is, my prompt on one side, the agent's reply on the other.

If the tester says they missed the live visuals, offer to re-run the
spawn once (same thread, the exchange counter goes up by one) while
they watch.

(If a codex tester asks why the dialog shows no duration / token
totals: the codex runtime does not report execution totals, so they
stay honestly absent. Claude shows them.)

On **antigravity / opencode**, no spawn demo:

> On this runtime, subagent spawns don't carry enough identity for the
> map to draw those arrows yet, so there's nothing more to see here
> today. The switch you just flipped governs this project though:
> whenever a lens that reports spawns is active (claude or codex),
> their agent-to-agent conversations become readable right from the
> map.

Before closing, give the tester the honest per-provider map of what
will NOT light up, mirrored from README §Real-time node activity
(§Known gaps column). Render ONLY the active provider's block:

On **claude**:

> One honest note on what will NOT light up here: the context Claude
> loads automatically at session start (`CLAUDE.md`) fires no hook, so
> it stays invisible on the map.

On **codex**:

> One honest note on what will NOT light up here: markdown reads and
> the skills a subagent follows stay dark (Codex hooks don't fire for
> its `read_file` tool yet), spawns of the generic `worker` type match
> no node on the map, and execution totals (duration / tokens) stay
> empty, the runtime doesn't report them.

On **antigravity**:

> One honest note on what will NOT light up here: `/skill` invocations
> stay dark (the runtime injects the skill's content with no hook
> event, ask for the skill in prose instead), and subagents have no
> on-disk definition, so there's no node to light and no spawn arrow
> to draw.

On **opencode**:

> One honest note on what will NOT light up here: built-in agents
> without an on-disk file (`build`, `plan`) have no node to light.

Then close the part (all providers):

> That's the whole feature. Everything you wired is reversible: the
> same Live-activity hook row in Settings uninstalls it (one click,
> same confirmation), and the capture switch clears itself the moment
> you flip it off. Leave it wired if you like the live map, it only
> ever talks to your own local server.

Mark `conversations`: done. The part closes per `_core.md` §Closing a
part.
