# MCP (parked appendix, `mcp-*` ids)

> Parked: this part is `status: planned` in `_manifest.yml` (hidden from
> the menu) while MCP is reworked as its own iteration. The body below is
> kept intact; re-enable by flipping the status back to `active`.

This is a chapter apart, a standalone appendix that comes last in the
book. Pace `auto-advance`, preflight `seed` (`harness-connected`, so it
fast-forwards onto the connected portfolio harness whether the campaign
was just run in this directory or you jumped straight here). One chapter
only. Shared conventions live in `_core.md`.

## Chapter `mcp-node` - The agent reaches for an MCP tool (~3 min)

**Context**: until now every node on the map has been a file you can
open. This chapter introduces a node that is NOT a file: an MCP
server the `content-editor` agent calls. MCP (Model Context
Protocol) is the standard way an agent reaches an external tool, and
Claude names those tools `mcp__<server>__<tool>` in an agent's
frontmatter. When the agent declares it uses `mcp__images__search`
(an image-search tool, so it can find art for the pages), skill-map's
`core/mcp-tools` extractor reads that declaration and draws a
virtual `mcp://images` node plus a `references` link from
content-editor to it. The link confidence is around 0.85 (high, but
not the 1.00 of a markdown link to a real file, because the target is
an external service, not a file on disk). If several harness members
named the same server, skill-map would draw a single shared
`mcp://images` node, not one per caller.

**Preparation**: `Edit` `<provider_dir>/agents/content-editor.md`
(substitute `<provider_dir>` per `_core.md`; on `agent-skills` /
Antigravity the editor is a `skill` instead, edit that file's
frontmatter the same way). Do NOT rewrite the file. Change only the
`tools:` line in the frontmatter so the MCP tool joins the existing
two:

```yaml
tools: [Read, Write, mcp__images__search]
```

The rest of the file stays exactly as it was.

```bash
# Nothing for you to run here. Watch the Map.
```

Tell the tester:

> Your `content-editor` agent just learned a new trick. I added an
> external tool to its toolbelt: an image search it can call to find
> art for the pages. In an agent's settings, Claude writes that kind
> of tool as `mcp__images__search`. MCP (Model Context Protocol) is
> just the agreed-on way an agent reaches a tool that lives outside
> your files.
>
> Watch the Map. A brand-new node appears, but this one is not a
> file you can open: `mcp://images`, with its own icon and colour
> (kind `mcp`). A `references` connector runs from `content-editor`
> to it, the agent declaring "I use this tool".
>
> Look at that connector's transparency. Earlier you saw a link to a
> real file sit fully solid at 1.00. This one is a touch more
> translucent (around 0.85): skill-map is confident the agent uses
> the tool, but the tool is an outside service, not a file it can
> verify on disk, so it holds back a little certainty. The opacity
> tells that story, same as before.
>
> One honest note: skill-map learned about this tool from your
> agent's own settings, what your harness says it CONSUMES. It did
> not go read a server config to confirm the tool exists. Mapping the
> server side (reading an `.mcp.json`) is a separate thing that may
> come later; today the map shows MCP usage from the caller's point
> of view.
>
> See the new `mcp://images` node and the connector into it?

Wait for confirmation. If the node did not appear, have the tester
save the file again (the watcher reacts on save) or refresh the
browser, then re-check; the `tools:` line must be valid YAML on one
line. Mark `mcp-node`: done. Last chapter of the part: apply §Closing
a part (the close names the part by its title and routes back to the
menu; the full publish finale is next on the spine).
