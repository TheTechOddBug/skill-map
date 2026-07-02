# Realtime playground

Tiny fixture for exercising **live node activity**: every unit here is
trivially invocable from a Claude Code session so the map lights up fast.

Try it end to end:

1. `pnpm fix:realtime` (BFF + UI against this scope).
2. In another terminal, from this folder: `node ../../src/bin/sm.js activity install claude --yes` (or `sm activity install claude` with the CLI built), then run `claude`.
3. Invoke things and watch the map glow:
   - `/ship` (command)
   - "use the deploy-site skill" (skill)
   - "use the researcher subagent" (agent that invokes a skill: the spine lights)

The corpus on purpose stays small and connected:

- Playbook: [docs/playbook.md](docs/playbook.md)
- Ideas backlog: [notes/ideas.md](notes/ideas.md)
- Skills: [deploy-site](.claude/skills/deploy-site/SKILL.md), [write-tests](.claude/skills/write-tests/SKILL.md)
