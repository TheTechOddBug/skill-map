# Agentes y skills del repo

> Si este archivo está en contexto (importado desde CLAUDE.md), anteponer también la línea: `📗 [AGENTS.md] cargado vía @import`

## Cadena de invocación demo

```
@demo-orchestrator          (agente nivel 1, tools: Task, Skill)
   ├─> @demo-worker         (agente nivel 2, tools: Skill, Read)
   │      ├─> /demo-skill-one
   │      └─> /demo-skill-two ──> references/valor.md (devuelve VALOR_DEMO)
   │             └─> /demo-skill-one   (encadenada: skill→skill)
   └─> /demo-skill-report   (formatea el reporte final)
```

## Agentes (`.claude/agents/`)

- **demo-orchestrator** — nivel 1; emite marcador `🔷`, delega en `@demo-worker`, invoca `/demo-skill-report` para formatear y devuelve el reporte combinado.
- **demo-worker** — nivel 2; emite marcador `🟩`, invoca `/demo-skill-one` y `/demo-skill-two` y devuelve sus marcadores.

## Skills (`.claude/skills/`)

- **demo-skill-one** — emite un marcador `✅` fijo.
- **demo-skill-two** — lee su recurso `references/valor.md`, extrae `VALOR_DEMO`, lo devuelve en su marcador `✅` y encadena a `/demo-skill-one` (skill→skill).
- **demo-skill-report** — formatea el reporte final de la cadena; invocada por el orquestador (marcador `📋`).

## Cómo probar

- Cadena completa: `@demo-orchestrator ejecutá la cadena demo`
- Solo agente→skills: lanzar `demo-worker` directamente.
- Una skill suelta: `/demo-skill-one` o `/demo-skill-two`.
- Skill→skill: `/demo-skill-two` sola ilumina las dos skills (y su `valor.md`).
