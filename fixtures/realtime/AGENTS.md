# Agentes y skills del repo

> Si este archivo está en contexto (importado desde CLAUDE.md), anteponer también la línea: `📗 [AGENTS.md] cargado vía @import`

## Cadena de invocación demo

```
@demo-orchestrator          (agente nivel 1, tools: Task, Skill)
   ├─> @demo-worker  turno 1: proceso completo   (agente nivel 2, tools: Skill, Read)
   │      ├─> /demo-skill-one
   │      └─> /demo-skill-two ──> references/valor.md (devuelve VALOR_DEMO)
   │             └─> /demo-skill-one   (encadenada: skill→skill)
   ├─> @demo-worker  turno 2: resumen en una línea (sin skills)
   ├─> @demo-worker  turno 3: cierre de conversación (sin skills)
   ├─> demo-scout    paso sin referencia (spawn puro, sin link previo)
   └─> /demo-skill-report   (formatea el reporte final)
```

La conversación de 3 turnos son tres invocaciones Task separadas de demo-worker,
cada una con su prompt de ida y su respuesta de vuelta: con la captura de
conversaciones habilitada (Settings > Project), los tres intercambios quedan
visibles en la sección Activity del inspector y al clickear la edge de spawn.

El paso demo-scout es deliberadamente HUÉRFANO de referencias: ningún markdown
del fixture lo nombra con arroba ni backticks (los extractores linkearían), así
que el mapa no tiene edge previa hacia él y el spawn en runtime dibuja la
flecha punteada standalone. Contraste: demo-worker SÍ tiene link estático, y
ahí el estado vivo se superpone sobre la edge existente en vez de duplicarla.

## Agentes (`.claude/agents/`)

- **demo-orchestrator** — nivel 1; emite marcador `🔷`, conversa con `@demo-worker` en 3 turnos (proceso completo, resumen, cierre), invoca `/demo-skill-report` para formatear y devuelve el reporte combinado.
- **demo-worker** — nivel 2; emite marcador `🟩`; en modo proceso invoca `/demo-skill-one` y `/demo-skill-two`; en modo conversación responde en una sola línea sin tocar skills.
- **demo-scout** — nivel 2; emite marcador `🟨`; responde una línea fija y nada más. Sin referencias estáticas hacia él (a propósito, ver arriba); se escribe siempre en texto plano.

## Skills (`.claude/skills/`)

- **demo-skill-one** — emite un marcador `✅` fijo.
- **demo-skill-two** — lee su recurso `references/valor.md`, extrae `VALOR_DEMO`, lo devuelve en su marcador `✅` y encadena a `/demo-skill-one` (skill→skill).
- **demo-skill-report** — formatea el reporte final de la cadena; invocada por el orquestador (marcador `📋`).

## Cómo probar

- Cadena completa: `@demo-orchestrator ejecutá la cadena demo`
- Solo agente→skills: lanzar `demo-worker` directamente.
- Una skill suelta: `/demo-skill-one` o `/demo-skill-two`.
- Skill→skill: `/demo-skill-two` sola ilumina las dos skills (y su `valor.md`).
