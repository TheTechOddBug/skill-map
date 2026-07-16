[![lang: EN](https://img.shields.io/badge/lang-English-lightgrey)](./README.md)
[![lang: ES](https://img.shields.io/badge/lang-Espa%C3%B1ol-7C3AED)](./README.es.md)

# skill-map

> Del caos multiagente a agentes y skills predecibles, el mapa que le faltaba a tu harness de IA generativa.

[![CI](https://img.shields.io/github/actions/workflow/status/crystian/skill-map/ci.yml?branch=main&logo=github&label=CI)](https://github.com/crystian/skill-map/actions/workflows/ci.yml)
[![npm: @skill-map/cli](https://img.shields.io/npm/v/@skill-map/cli?color=7C3AED&logo=npm&label=%40skill-map%2Fcli)](https://www.npmjs.com/package/@skill-map/cli)
[![npm: @skill-map/spec](https://img.shields.io/npm/v/@skill-map/spec?color=7C3AED&logo=npm&label=%40skill-map%2Fspec)](https://www.npmjs.com/package/@skill-map/spec)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

## En una frase

Del caos multiagente a agentes y skills predecibles, el mapa que le faltaba a tu harness de IA generativa basado en Markdown (Claude Code, Codex, Antigravity, Copilot y otros). Detecta colisiones, huérfanos, duplicados semánticos y skills obesas sobre un mismo grafo, con análisis determinístico y semántico (LLM) opcional.

![skill-map encendiéndose en vivo mientras editas tus .md](https://github.com/user-attachments/assets/3d4f7b22-0787-4fb1-9369-f5649607e18e)

## El problema que resuelve

Los desarrolladores que trabajan con agentes de IA acumulan decenas de skills, agents, commands y documentos sueltos. No hay visibilidad sobre:

- Cuántos tokens cuesta cada archivo Markdown, invisible si no lo mides, caro a escala.
- Qué existe y dónde vive.
- Quién invoca a quién (dependencias, referencias cruzadas).
- Qué triggers se solapan o pisan entre sí.
- Qué está vivo vs obsoleto.
- Qué se puede borrar sin romper nada.
- Cuándo fue la última vez que se optimizó o validó cada skill.

Ninguna herramienta oficial (Anthropic, Cursor, GitHub, skills.sh) cubre esto. `skill-map` llena ese hueco.

## Para quién

- **Equipos y arquitectos de plataforma**, múltiples proyectos, múltiples agentes, copias divergentes del mismo skill. Un solo scan pone toda la colmena en el mismo grafo.
- **Autores**, quienes crean skills, agents o commands y quieren detectar duplicados, redundancias y oportunidades de optimización antes de publicar.
- **Quienes depuran agentes**, cuando el agente eligió la invocación equivocada, rastrea el camino desde la frase trigger hasta el skill que ganó el match, en tiempo real.
- **Constructores de herramientas**, cualquiera que arme CLI, salida JSON o plugins encima del grafo.

## Cómo funciona (alto nivel)

1. **Scanner determinista** recorre archivos, parsea frontmatter, detecta referencias y produce datos estructurados del grafo (nodos, links, issues).
2. **Capa LLM opcional** consume esos datos y agrega inteligencia semántica: valida referencias ambiguas, clusteriza triggers equivalentes, compara nodos, responde preguntas.
3. **CLI `sm`** es la superficie primaria, todas las operaciones se hacen desde la línea de comandos. `sm` solo (sin args) abre la Web UI directo.
4. **Web UI**, incluida en el CLI, se lanza con un solo comando. El grafo se actualiza en vivo mientras editas cualquier `.md`. Una [demo](https://skill-map.ai/demo/) standalone corre en el navegador sin instalar nada.
5. **Sistema de plugins** (drop-in, kernel + extensiones) permite que terceros agreguen Providers, Extractors, Rules, Actions, Formatters o Hooks sin tocar el kernel.

## Dos modos de ejecución

Cada extensión analítica declara uno de dos modos: **`deterministic`** (código puro, rápido, gratis, corre dentro de `sm scan` / `sm check`, apto para CI) o **`probabilistic`** (invoca un LLM a través del kernel, corre como job en cola, nunca durante el scan). Mismo modelo de plugins, dos perfiles de costo. El determinista corre en pre-commit; el probabilístico se pone al día on-demand o de noche.

Contrato completo: [`spec/architecture.md`](./spec/architecture.md) §Execution modes.

## Filosofía

- **Diseño hecho visible**: un arnés es algo que diseñas, no algo que solo se acumula. skill-map no lo diseña por ti; hace tu diseño visible y verificable, para que lo mantengas honesto a medida que crece.
- **CLI-first**: todo lo que hace la UI se puede hacer en línea de comandos.
- **Determinista por default**: el LLM es opcional, nunca requerido. El producto funciona offline.
- **Estándar público**: el spec (JSON Schemas + conformance suite + contratos) vive en `spec/`. Cualquiera puede construir una UI alternativa, una implementación en otro lenguaje o tooling complementario consumiendo solo el spec.
- **Agnóstico de plataforma**: el primer adapter es Claude Code, pero la arquitectura soporta cualquier ecosistema de Markdown.

Detalles de arquitectura (kernel hexagonal, ports & adapters) en [`spec/architecture.md`](./spec/architecture.md).

## Inicio rápido

```bash
npm i -g @skill-map/cli
cd tu/proyecto
sm init
sm
```

Ese último `sm` abre la Web UI en `http://127.0.0.1:4242` con el watcher corriendo. Editas cualquier `.md` del proyecto y el grafo se actualiza en vivo en el navegador.

¿Quieres probarlo sin instalar nada? Abre la [demo en vivo](https://skill-map.ai/demo/).

## Tutorial interactivo (recomendado)

Si usas [Claude Code](https://claude.ai/code), la forma más rápida de evaluar skill-map es el tutorial interactivo que viene incluido. Es un único "libro" guiado: quien lo prueba por primera vez recorre el prólogo con la UI en vivo (aprox. **10 minutos**) y después elige más partes desde un menú dentro de la skill, extender skill-map con plugins, settings y view-slots, y la CLI a fondo.

```bash
mkdir prueba-skill-map && cd prueba-skill-map
sm tutorial             # instala la skill sm-tutorial
claude                  # abre Claude Code en ese mismo directorio
# Después, dentro de Claude:
ejecuta el tutorial
```

Claude se hace cargo desde ahí: arma una fixture, te guía por `sm init`, abre la Web UI, edita archivos delante tuyo y te muestra al watcher reaccionando en vivo (incluso cómo `.skillmapignore` esconde archivos en tiempo real). Ves el flujo completo antes de apuntarlo a tu proyecto real, sin compromiso, totalmente reversible. Cuando termina el prólogo te ofrece un menú de partes más profundas (plugins, settings, view-slots, la CLI); eliges la que quieras, o lo dejas ahí.

## Actividad en real time (mira a tu asistente ejecutarse)

Con `sm serve` abierto, el mapa puede iluminar cada nodo **en el momento exacto en que tu runtime de IA lo invoca**: la skill que acaba de cargar, el agente en que delegó, el markdown que leyó. Se cablea una vez por proveedor:

```bash
sm activity install claude   # o: codex, antigravity, opencode
```

(o desde la UI: Settings → Project, debajo del selector de lente; ambos caminos piden confirmación antes de tocar la configuración del proveedor). La instalación mezcla entradas de hooks en la configuración **local al proyecto** del proveedor y deja un pequeño bridge bajo `.skill-map/activity/`; los hooks del propio runtime reenvían los eventos a tu servidor local, que los resuelve contra el mapa escaneado y empuja el brillo al navegador. Todo queda en tu máquina (solo loopback, nunca telemetría); `sm activity uninstall <proveedor>` revierte exactamente lo instalado. Los toggles viven en Settings → General.

Qué se ilumina depende de lo que el sistema de hooks de cada runtime expone:

| Proveedor | Se ilumina | Gaps conocidos (y por qué) |
|---|---|---|
| `claude` (Claude Code) | Comandos slash, skills (tipeadas o invocadas por el modelo), agentes incluyendo cadenas de delegación anidadas, lecturas de archivos markdown, y llamadas a tools MCP en vivo (un `mcp__<server>__<tool>` prende el nodo `mcp://<server>`; la cadena completa agente → skill → MCP se ilumina, skill incluida) | El contexto auto-cargado (`CLAUDE.md` al inicio de sesión) no dispara ningún hook, así que queda invisible |
| `codex` (Codex CLI) | Invocaciones `$skill` desde tu prompt, agentes con nombre de `.codex/agents/` (cadenas anidadas también, si subes `agents.max_depth`), y llamadas a tools MCP en vivo (un `mcp__<server>__<tool>` prende el nodo `mcp://<server>`, incluso desde un agente o skill) | Las lecturas de markdown quedan a oscuras (los hooks de Codex aún no disparan para su herramienta `read_file`, [openai/codex#18491](https://github.com/openai/codex/issues/18491)); una skill que sigue un agente también queda a oscuras porque Codex expone una skill solo por un token `$name` en el prompt, así que en una cadena agente → skill → MCP se prenden el agente (spawn) y el nodo `mcp://` pero la skill del medio no; los spawns del tipo genérico `worker` no corresponden a ningún nodo |
| `antigravity` (Antigravity CLI) | Todo lo que se LEE: archivos markdown, el `SKILL.md` de una skill y sus recursos cuando el agente los mira, workflows seguidos en prosa; la cadena completa se apaga en el momento en que el agente queda inactivo (`Stop` nativo) | Invocar una skill con `/slash` no ilumina (el runtime inyecta el contenido sin evento de hook, pídela en prosa en su lugar); los subagentes no tienen definición en disco, así que no hay nodo que iluminar |
| `opencode` (OpenCode) | La superficie más rica: skills, comandos y agentes llegan NOMBRADOS (disparan incluso invocados en prosa), las lecturas de markdown iluminan por path, y la cadena completa de cada sesión se apaga en el momento en que queda inactiva (`session.idle` nativo) | Los agentes built-in sin archivo en disco (`build`, `plan`) no tienen nodo que iluminar |
| `markdown` | Sin runtime que hookear; nada se ilumina | |

Contrato completo (invariantes del bridge, postura de privacidad, notas de señales por proveedor): [`spec/provider-activity.md`](./spec/provider-activity.md).

## Consulta el mapa desde Claude Code (MCP)

`sm serve` puede exponer tu mapa como un servidor [MCP](https://modelcontextprotocol.io) de solo lectura en `/mcp`, para que Claude Code (o cualquier host MCP) consulte el grafo como tools y lo lea como resources, con actualizaciones en vivo a medida que el mapa cambia. Está **apagado por defecto** y es estrictamente de solo lectura: responde preguntas sobre el mapa, nunca ejecuta tus skills ni agentes.

Actívalo con `sm serve --mcp` (o el toggle en Ajustes → Proyecto) y luego apunta Claude Code a él en el `.mcp.json` de tu proyecto:

```json
{
  "mcpServers": {
    "skillmap": { "type": "http", "url": "http://127.0.0.1:4242/mcp" }
  }
}
```

El puerto es el que `sm serve` imprime al arrancar (por defecto `4242`, también en `.skill-map/serve.json`). Contrato completo: [`spec/mcp-server.md`](./spec/mcp-server.md).

## Archivos sidecar `.sm` (no te asustes cuando aparezcan)

La primera vez que ejecutes `sm bump` o `sm sidecars annotate`, skill-map escribirá un archivo YAML hermano al lado de cada `.md`: `demo-agent.md` → `demo-agent.sm` en el mismo directorio. Son intencionales, son parte del diseño y **deben vivir en tu repo**.

**Solo aparecen cuando los pides explícitamente.** `sm scan`, `sm watch` y la Web UI **nunca crean archivos `.sm`**, solo leen los que ya existen. Si acabas de instalar skill-map y ejecutaste `sm init` / `sm` / `sm scan`, no hay ningún sidecar todavía; aparecen la primera vez que invocas `sm bump` (o `sm sidecars annotate`) sobre un nodo, y nunca antes.

**¿Por qué un archivo aparte?** Tus `.md` pertenecen al proveedor (Claude Code, Codex, Cursor, …) y a tu propia prosa. Meter la contabilidad de skill-map (versión, estabilidad, supersesión, tags, traza de auditoría) en su frontmatter contaminaría la entrada del proveedor e inflaría lo que el agente lee en cada invocación. El sidecar `.sm` mantiene las dos capas limpiamente separadas: el `.md` es del proveedor y del humano; el `.sm` es de skill-map.

**Súbelos a git.** Los `.sm` son código fuente, llevan la metadata que alimenta `sm check`, la detección de drift y los grafos de supersesión. Trátalos como cualquier otro archivo bajo control de versiones: no los añadas al `.gitignore`, no los elimines al desplegar. El hook opcional de pre-commit (`sm hooks install pre-commit-bump`) los mantiene sincronizados con su `.md` automáticamente.

Spec completo: [`spec/architecture.md` §Annotation system](./spec/architecture.md#annotation-system).

## Especificación

El spec es la fuente de verdad y vive en [`spec/`](./spec/README.md), separado de la implementación de referencia desde day zero, para que terceros puedan construir implementaciones alternativas consumiendo solo `spec/`.

- URL canónica: **[skill-map.ai](https://skill-map.ai)** (schemas en `https://skill-map.ai/spec/v0/<path>.schema.json`).
- Paquete npm: [`@skill-map/spec`](https://www.npmjs.com/package/@skill-map/spec).
- Contenido: JSON Schemas (draft 2020-12) + contratos prose + conformance suite. Inventario completo en [`spec/README.md`](./spec/README.md).

## Estructura del repo

```
skill-map/                     raíz de pnpm workspaces (privada)
├── spec/                      spec, publicado como @skill-map/spec
├── src/                       implementación de referencia, publicada como @skill-map/cli (binarios: sm, skill-map)
├── ui/                        SPA Angular (grafo, lista, inspector), incluido en @skill-map/cli
├── web/                       sitio público (skill-map.ai), aloja la demo bundle
├── scripts/                   scripts de build y validación (spec index, CLI reference, demo dataset, …)
├── ...
├── AGENTS.md                  manual operativo para agentes
└── ROADMAP.md                 narrativa de diseño (decisiones, fases, diferidos)
```

## Enlaces

- Sitio web: [skill-map.ai/es/](https://skill-map.ai/es/)
- Diseño completo y roadmap: [ROADMAP.md](./ROADMAP.md)
- Guía de contribución: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Overview del spec: [spec/README.md](./spec/README.md)
- Arquitectura (ports & adapters): [spec/architecture.md](./spec/architecture.md)
- Contrato CLI: [spec/cli-contract.md](./spec/cli-contract.md)
- Referencia CLI: ejecutá `sm help` (agregá `--format md` para markdown)
- Implementación de referencia: [src/README.md](./src/README.md)
- Versión en inglés de este README: [README.md](./README.md)
- Licencia: [MIT](./LICENSE)

## Agradecimientos

La vista de grafo que le da identidad a skill-map está construida sobre [**Foblex Flow**](https://flow.foblex.com), una excelente librería Angular que se encarga de nodos, conectores, pan y zoom. Gracias enormes al equipo de Foblex.

También sobre los hombros de [Angular](https://angular.dev), [PrimeNG](https://primeng.org), [Hono](https://hono.dev) y [Kysely](https://kysely.dev).

## Historial de stars

[![Star History Chart](https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline&legend=top-left)](https://www.star-history.com/?repos=crystian%2Fskill-map&type=timeline&legend=top-left)

---

Hecho con ❤️&nbsp; por [Crystian](https://github.com/crystian/) · [LinkedIn](https://www.linkedin.com/in/crystian/)
