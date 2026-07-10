# Agentes y skills del repo (demo Codex)

## Cadena de invocación demo

```
demo-orchestrator              (agente nivel 1, spawnea sub-agentes)
   ├─> demo-worker             (agente nivel 2)
   │      ├─> sigue demo-skill-one
   │      └─> sigue demo-skill-two ──> references/valor.md (VALOR_DEMO)
   │             └─> sigue demo-skill-one   (encadenada: skill→skill)
   └─> sigue demo-skill-report (formatea el reporte final)

demo-notion-writer             (agente -> skill -> MCP)
   └─> sigue demo-skill-notion ──> mcp://notion   (se prende al llamar el tool)

$demo-skill-one / $demo-skill-two / $demo-skill-report   (con $ en el prompt)
$demo-skill-mcp    ──> mcp://deepwiki   (invocacion MCP en vivo, deepwiki es publico)
$demo-skill-notion ──> mcp://notion     (requiere tu propia auth de Notion)
```

Notas Codex: las skills se iluminan en el mapa solo cuando el USUARIO las
invoca con `$` (evento `UserPromptSubmit`); las lecturas de archivos del
worker no disparan hooks (Codex aún no intercepta `read_file`). El
anidamiento nivel 1→2 lo habilita `agents.max_depth = 2` en
`.codex/config.toml` (requiere confiar el proyecto).

Los spawns dibujan edges efímeras y conversaciones igual que en Claude: el
par `spawn_agent` Pre/PostToolUse lleva la ida (message) y el id del hijo,
y la vuelta llega con el `last_assistant_message` del stop. Con la captura
habilitada (Settings > Project) el hilo se abre desde la edge o el
inspector. Codex no reporta totales de ejecución (tokens/tools/duración),
así que esos campos quedan vacíos a propósito.

## Agentes (`.codex/agents/`)

- **demo-orchestrator**: nivel 1; emite marcador `🔷`, spawnea
  `demo-worker`, sigue `$demo-skill-report` para formatear y devuelve el
  reporte combinado.
- **demo-worker**: nivel 2; emite marcador `🟩`, sigue las instrucciones
  de las dos skills demo (lee sus SKILL.md y `references/valor.md`) y
  devuelve sus marcadores.
- **demo-notion-writer**: agente que demuestra la cadena agente -> skill ->
  MCP; emite marcador `🟦`, sigue `demo-skill-notion` (que crea una pagina
  llamando al tool `mcp__notion__notion-create-pages`) y devuelve el link.
  Al llamar el tool se prende `mcp://notion` en vivo. Requiere tu auth de
  Notion configurada en tu cliente MCP.

## Skills (`.agents/skills/`)

- **demo-skill-one**: emite un marcador `✅` fijo.
- **demo-skill-two**: lee su recurso `references/valor.md`, extrae
  `VALOR_DEMO`, lo devuelve en su marcador `✅` y encadena a
  `demo-skill-one` (skill→skill; la arista se ve en el grafo, pero en
  runtime solo ilumina si la invocás con `$` en el prompt).
- **demo-skill-report**: formatea el reporte final de la cadena; la sigue
  el orquestador (marcador `📋`).
- **demo-skill-mcp**: llama al tool `mcp__deepwiki__ask_question`; el hook
  `PreToolUse` prende `mcp://deepwiki` en vivo. deepwiki es publico (sin
  auth).
- **demo-skill-notion**: crea una pagina en Notion via
  `mcp__notion__notion-create-pages`; prende `mcp://notion` en vivo.
  Requiere tu propia auth de Notion.

## Cómo probar

- Cadena completa: `corré $demo-skill-one y $demo-skill-two, y lanzá el
  sub-agente demo-orchestrator para el reporte combinado`
- Solo agentes: pedir que lance `demo-orchestrator` (delegará en
  `demo-worker`).
- Una skill suelta: `$demo-skill-one` o `$demo-skill-two` en el prompt.
- Skill→skill en el mapa: `$demo-skill-two $demo-skill-one` en un mismo
  prompt ilumina ambas (los dos tokens disparan señales).
- MCP en vivo (directo): `$demo-skill-mcp` llama deepwiki y prende
  `mcp://deepwiki`.
- Cadena agente → skill → MCP: pedir que lance el sub-agente
  `demo-notion-writer` (seguirá `demo-skill-notion`, que crea la pagina en
  Notion via MCP y prende `mcp://notion`). Necesitás tu auth de Notion.
