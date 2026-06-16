# Skill-map, NotebookLM source

> Source document for a NotebookLM episode: a pain-first narrative about skill-map, its deliberately ignorant kernel, and where it is heading. English, conversational, ready to become a podcast.

---

## It always starts tidy

Every collection of AI-agent files starts tidy. A handful of skills, a couple of agents, a few commands, some notes. You know them by heart. Then the project grows. You add a skill that calls another skill, an agent that references three commands, a note that quietly became the source of truth for half the team. Six months in you have dozens, sometimes hundreds, of Markdown files invoking each other, and nobody, not even the person who wrote them, can tell you what references what.

That is the quiet failure mode. Nothing breaks loudly; it just gets slower and foggier. Two skills start competing for the same trigger and you only find out when the wrong one wins. A file goes orphaned and lingers for months because deleting it feels risky. Your token budget creeps up and you cannot point at where it is going. The system still works, but you have lost the map of it.

## The map is the product

Skill-map's bet is simple: give that mess a shape you can see. Point it at your project and it reads every skill, agent, command, hook, and note, then draws the whole thing as an interactive graph in your browser. Nodes are colored by type so your eyes do the sorting. The edges tell you the relationship: this one invokes that one, this references that by name, this points at a file by path. A layout engine arranges it, you pan and zoom, and in seconds you understand a structure that used to take an afternoon of opening folders blind.

And it answers the questions the tangle was hiding. Which skills collide on the same trigger? What is orphaned and safe to delete? Where is the token weight concentrated? Which new skill replaced an old one that is somehow still live? You get a list view, a graph view, and a per-node inspector over the same data, all of it offline, all of it deterministic, none of it requiring a language model.

The one-line version: from a chaotic ecosystem to predictable agents.

## A kernel that knows nothing

Here is the part that makes it last. The skill-map kernel is deliberately ignorant. It does not know what a Claude skill is, how a command gets invoked, or which checks to run. All of that knowledge lives outside the core, in extensions you drop into a folder and the kernel discovers on its own. There are exactly six kinds, no more:

- A **Provider** recognizes a platform. It knows where Claude Code keeps its skills and agents, how OpenAI Codex lays out its TOML sub-agents, where the vendor-neutral agent-skills layout lives (the same one Google's Antigravity adopted). It classifies each file into a node type, deterministically, no guessing.
- An **Extractor** reads a single file and pulls out the links that become the graph: the slash-command mentions, the at-directives, the external URLs that leave your repo.
- An **Analyzer** reasons across the whole graph and raises issues: the trigger collisions, the broken references, the supersession that is still in conflict.
- An **Action** is the only kind that touches disk, renaming a trigger, fixing a frontmatter field, moving a file. It is what turns skill-map from a viewer into something that manages.
- A **Formatter** serializes the graph back out, to ASCII in the terminal today, to Mermaid and DOT next.
- A **Hook** reacts to the kernel's own lifecycle, so a finished scan can post to Slack or write an audit trail.

Because the contract behind those six kinds is a public spec, separable from this implementation, nothing here is welded to one vendor. Six kinds, a folder, and the kernel learns a brand-new platform without changing a line of its core.

## What you cannot quite see yet

Everything so far is deterministic and offline, the solid floor. The next chapter is the interesting one: an opt-in layer that brings a language model in to do what regular parsing cannot. Ask a skill what it actually does and get a structured brief back. Find the two skills that are semantic duplicates even though they share no words. Group the triggers that overlap in meaning rather than in spelling. Ask "if I touch this one, what else moves?" and trace the blast radius before you commit. Get concrete suggestions for cutting tokens and redundancy. The kernel stays deterministic and cheap; the intelligence arrives as jobs you choose to queue, never something running behind your back.

And the map was never meant to be a snapshot you regenerate by hand. Leave it open while you work, keep editing your files in your own editor, and it stays in step, the graph in front of you closer to a reflection of what you are building than a photograph of what you already built.

A mess you could not see, turned into a shape you can; a kernel that learns new platforms instead of hardcoding them; and a next chapter where the map starts to reason about your agents, and to keep pace with you.

---

## Resources

- Site: <https://skill-map.ai>
- Live demo, no install, runs in the browser: <https://skill-map.ai/demo/>
- Source: <https://github.com/crystian/skill-map>
- Install: `npm i -g @skill-map/cli`, then `sm` inside a project opens the browser view.
