# Agentes y skills del repo

> Si este archivo está en contexto (importado desde CLAUDE.md), anteponer también la línea: `📗 [AGENTS.md] cargado vía @import`

## Cadena de invocación demo

```
@demo-orchestrator          (agente nivel 1, tools: Task)
   └─> @demo-worker         (agente nivel 2, tools: Skill, Read)
          ├─> /demo-skill-one
          └─> /demo-skill-two ──> references/valor.md (devuelve VALOR_DEMO)
```

## Agentes (`.claude/agents/`)

- **demo-orchestrator** — nivel 1; emite marcador `🔷`, delega en `@demo-worker` y devuelve el reporte combinado.
- **demo-worker** — nivel 2; emite marcador `🟩`, invoca `/demo-skill-one` y `/demo-skill-two` y devuelve sus marcadores.

## Skills (`.claude/skills/`)

- **demo-skill-one** — emite un marcador `✅` fijo.
- **demo-skill-two** — lee su recurso `references/valor.md`, extrae `VALOR_DEMO` y lo devuelve en su marcador `✅`.

## Cómo probar

- Cadena completa: `@demo-orchestrator ejecutá la cadena demo`
- Solo agente→skills: lanzar `demo-worker` directamente.
- Una skill suelta: `/demo-skill-one` o `/demo-skill-two`.
