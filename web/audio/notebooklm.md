# Skill-map, NotebookLM source

> Source document for a NotebookLM episode: a pain-first narrative about skill-map. The mess of AI-agent Markdown, the headline feature (watching your agents run in real time, in the same tool), the deliberately ignorant kernel underneath, and the part that now carries the project: an agent that reads your files for meaning, raises the problems a parser never could, and fixes them on disk under your control. English, conversational, ready to become a podcast.

---

## It always starts tidy

Every collection of AI-agent files starts tidy. A handful of skills, a couple of agents, a few commands, some notes. You know them by heart. Then the project grows. You add a skill that calls another skill, an agent that references three commands, a note that quietly became the source of truth for half the team. Six months in you have dozens, sometimes hundreds, of Markdown files invoking each other, and nobody, not even the person who wrote them, can tell you what references what.

That is the quiet failure mode. Nothing breaks loudly; it just gets slower and foggier. Two skills start competing for the same trigger and you only find out when the wrong one wins. A file goes orphaned and lingers for months because deleting it feels risky. Your token budget creeps up and you cannot point at where it is going. The system still works, but you have lost the map of it. And it is not one vendor's problem: Claude Code, Codex, Antigravity, Copilot, OpenCode, they all lean on the same pile of Markdown, so the mess is the same shape everywhere.

## The map is the product

Skill-map's bet is simple: give that mess a shape you can see. Point it at your project and it reads every skill, agent, command, hook, and note, then draws the whole thing as an interactive graph in your browser. Nodes are colored by type so your eyes do the sorting. The edges tell you the relationship: this one invokes that one, this references that by name, this points at a file by path. A layout engine arranges it, you pan and zoom, and in seconds you understand a structure that used to take an afternoon of opening folders blind.

And it answers the questions the tangle was hiding. Which skills collide on the same trigger? What is orphaned and safe to delete? Where is the token weight concentrated, invisible until you measure it, expensive at scale? Which new skill replaced an old one that is somehow still live? You get a list view, a graph view, and a per-node inspector over the same data, all of it offline, all of it deterministic, none of it requiring a language model to run.

The one-line version: from a chaotic ecosystem to predictable agents.

## Watching it run, live

This is the headline feature, the thing that turns a static diagram into something you cannot look away from. Leave the map open and it does not just stay in step as you edit files, it lights up each node the exact moment your runtime invokes it. The skill it just loaded, the agent it delegated to, the Markdown it read, they glow in real time, literally as it happens, on your own machine, loopback only, never telemetry. You stop reading logs about what your agents did after the fact and start watching them do it.

And it goes past single nodes. When one agent spawns another, you see the arrow get drawn between them, with a counter of how many exchanges went back and forth. Then you can open that edge and read the actual conversation, the prompt the parent sent, the report the child sent back, the whole delegation chain nested however deep it went. All of it in the same tool, on the same graph, without tailing a terminal or grepping a transcript. It works across Claude Code, Codex, Antigravity, and OpenCode, each wired in with one command, and how much lights up depends on how much each runtime's own hook system is willing to expose. Seeing a multi-agent system actually talk to itself, on a live map, is the moment most people realize this is a different kind of tool.

And underneath all that live motion, the foundation stays deterministic and offline, no language model in the loop, so what you are watching is exactly what happened, nothing inferred and nothing left your machine.

## A kernel that knows nothing

Here is the part that makes it last. The skill-map kernel is deliberately ignorant. It does not know what a Claude skill is, how a command gets invoked, or which checks to run. All of that knowledge lives outside the core, in extensions you drop into a folder and the kernel discovers on its own. There are exactly six kinds, no more:

- A **Provider** recognizes a platform. It knows where Claude Code keeps its skills and agents, how Codex lays out its TOML sub-agents, where the vendor-neutral agent-skills layout lives (the same open `.agents/skills/` standard Antigravity adopted). It classifies each file into a node type, deterministically, no guessing.
- An **Extractor** reads a single file and pulls out the links that become the graph: the slash-command mentions, the at-directives, the external URLs that leave your repo.
- An **Analyzer** reasons across the whole graph and raises issues: the trigger collisions, the broken references, the supersession that is still in conflict.
- An **Action** is the only kind that touches disk, renaming a trigger, fixing a frontmatter field, moving a file. It is what turns skill-map from a viewer into something that manages.
- A **Formatter** serializes the graph back out, to ASCII in the terminal today, to Mermaid, DOT, and JSON alongside it.
- A **Hook** reacts to the kernel's own lifecycle, so a finished scan can post to Slack or write an audit trail.

Because the contract behind those six kinds is a public spec, JSON Schemas plus a conformance suite, kept separate from this implementation since day zero, nothing here is welded to one vendor. Six kinds, a folder, and the kernel learns a brand-new platform without changing a line of its core. Someone could write an alternative UI, or a whole implementation in another language, against the spec alone.

## Now: an agent that reads for meaning

Everything so far is the deterministic floor: fast, free, offline, exact. It sees structure. What it cannot see is meaning, and meaning is where the real mess hides. A parser can tell you two skills share a trigger string; it cannot tell you two skills do the same job in different words. That gap is where skill-map spent its second act, and it is now the center of the tool, not a promise for later.

The shape is a job queue. You point at a node and queue a semantic job; your own AI agent, the one you already use, drains that queue, either through a small install-once skill in the terminal or over an MCP connection, and does the reading a language model is actually good at. Crucially the agent is yours: skill-map hands it the file and the question, the tokens are spent under your account, and nothing runs behind your back. Determinism stays the floor; the intelligence arrives as jobs you choose to queue.

And what it looks for is specific, not a vague "review this file". There is a whole family of semantic analyzers, each hunting one failure a regex never catches:

- **Redundancy**: the same instruction, fact, or section stated more than once, so you can cut it down to one.
- **Trigger misfire**: a description that promises things the file does not do, hides things it does, or will fire on the wrong prompt, the single most expensive bug in an agent stack.
- **Vagueness**: instructions too soft to follow, "handle it properly", a format never specified, a threshold with no number.
- **Contradiction**: two instructions in the same file that cannot both be obeyed.
- **Scope**: a section quietly doing a different job than the file it lives in claims to do.
- **Structure, verbosity, incoherence**: the key rule buried at the bottom, the filler that adds length but not meaning, the term used three ways on one page.
- And a security pair: one that flags problems written in good faith, a credential pasted in plain text, a curl-piped-to-shell install, and one, adversarial, that flags content that looks designed to manipulate the agent reading it, a hidden instruction, an injection attempt in a file that should just be documentation.

It does more than flag. A summarizer will read a skill and hand back a structured brief of what it actually does, so a node stops being an opaque filename. An auto-tagger classifies. And the findings are not a dead report you print and ignore: each one has a life, you can dismiss it, mark it a deliberate human decision, or let a fixer apply the correction as a real Action on disk, rename the colliding trigger, tighten the vague line, cut the redundant section, and the change is versioned in a sidecar so it never contaminates the file the agent reads. Everything a human decided sticks; everything the machine generated is regenerable and cheap.

The MCP side is what makes this feel native. Turn it on and the map is not just something you look at, it is something your agent operates: it can read the graph, drive the queue, and resolve findings straight from the assistant you are already talking to, no shell, no context-switch. Your agent becomes the thing that keeps your other agents in order.

## Not a weekend project

It would be easy to assume something this broad was vibe-coded in a hurry. It was not. This is one senior maintainer, roughly three months of focused work, and over five thousand tests riding along the whole way. That test count is the tell: nobody writes five thousand tests to impress you, you write them because you decided early that the thing has to scale, and every extension has to ship with tests or it does not boot.

The engineering choices all point the same direction. A hexagonal kernel, ports and adapters, so the pure domain logic never touches the filesystem or an LLM directly, everything crosses a port. Persistence in SQLite through a typed query builder. The web layer is a small Hono backend feeding an Angular front end, with the graph itself built on a real flow library rather than hand-rolled canvas code. The spec lives in its own package, versioned independently. Even the bookkeeping is disciplined: skill-map's own metadata, version, stability, supersession, audit trail, findings decisions, lives in a sidecar file next to each Markdown, so it never contaminates the vendor's frontmatter or bloats what the agent reads on every invocation.

None of that is decoration. It is the difference between a demo that looks great on one repo and a tool that survives being pointed at a messy monorepo with hundreds of files and stays fast, deterministic, and CI-safe. The boring parts are exactly where the leverage is.

## Where it is going

Worth being honest about where it sits: skill-map is closing in on its 1.0. The deterministic floor is solid, the scanner, the graph, the live map, the real-time activity, the plugin model, and the semantic layer on top of it is real and in your hands today, per-node: ask one file what it does, fix one finding, tighten one trigger.

The frontier is scale. Per-node semantic analysis is here; the next reach is across the whole graph at once. Find the two skills that are semantic duplicates even though they share no words. Group the triggers that overlap in meaning rather than in spelling. Ask "if I touch this one, what else moves?" and trace the blast radius before you commit. Then let it propose the fix across the set, merge the redundant pair, cut the tokens, and apply it as Actions you approve. The kernel stays deterministic and cheap; the intelligence keeps arriving as jobs you choose to queue, never something running behind your back, never something you cannot audit.

A mess you could not see, turned into a shape you can; a live map of your agents actually running; a kernel that learns new platforms instead of hardcoding them; and an agent that reads your files for meaning, tells you what is wrong, and fixes it under your control. That is where this stops being a viewer and starts being the thing that keeps your agents in order.

---

## Resources

- Site: <https://skill-map.ai>
- Live demo, no install, runs in the browser: <https://skill-map.ai/demo/>
- Source: <https://github.com/crystian/skill-map>
- Install: `npm i -g @skill-map/cli`, then `sm` inside a project opens the browser view.
