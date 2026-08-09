[![lang: EN](https://img.shields.io/badge/lang-English-lightgrey)](./README.md)
[![lang: ES](https://img.shields.io/badge/lang-Espa%C3%B1ol-7C3AED)](./README.es.md)

# skill-map

> Del caos multiagente a agentes y skills predecibles, el mapa que le faltaba a tu harness de IA generativa.

[![CI](https://img.shields.io/github/actions/workflow/status/crystian/skill-map/ci.yml?branch=main&logo=github&label=CI)](https://github.com/crystian/skill-map/actions/workflows/ci.yml)
[![npm: @skill-map/cli](https://img.shields.io/npm/v/@skill-map/cli?color=7C3AED&logo=npm&label=%40skill-map%2Fcli)](https://www.npmjs.com/package/@skill-map/cli)
[![npm: @skill-map/spec](https://img.shields.io/npm/v/@skill-map/spec?color=7C3AED&logo=npm&label=%40skill-map%2Fspec)](https://www.npmjs.com/package/@skill-map/spec)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

![skill-map encendiéndose en vivo mientras editas tus .md](https://github.com/user-attachments/assets/3d4f7b22-0787-4fb1-9369-f5649607e18e)

## Qué es

Un harness de IA (Claude Code, Codex, Antigravity, Copilot y otros) crece por acumulación: decenas de skills, agents, commands y Markdown suelto que nadie ve completo. skill-map escanea el proyecto y lo pone todo en un grafo vivo: qué existe, cuántos tokens cuesta cada archivo, quién invoca a quién, qué triggers colisionan, qué está obsoleto y qué se puede borrar sin romper nada.

El escáner es determinístico (código puro, offline, apto para CI). Una capa LLM opcional agrega juicio semántico (duplicados, skills obesas, contradicciones) a través de TU agente; skill-map nunca incluye ni exige una API key.

<p align="center">
  <a href="https://www.youtube.com/watch?v=ROC0B1HAbEA"><img src="https://img.youtube.com/vi/ROC0B1HAbEA/maxresdefault.jpg" alt="Qué es skill-map, en 6 minutos" width="480"></a>
  <br>
  <strong><a href="https://www.youtube.com/watch?v=ROC0B1HAbEA">Míralo en 6 minutos</a></strong>: el problema, el harness y qué hace skill-map al respecto (español e inglés).
</p>

## Inicio rápido

```bash
npm i -g @skill-map/cli
cd tu/proyecto
sm
```

`sm` a secas ofrece inicializar un proyecto que aún no está preparado y abre la Web UI en `http://127.0.0.1:4242` con el watcher corriendo: edita cualquier `.md` y el grafo se actualiza en vivo. Todo lo que hace la UI es también un verbo del CLI (`sm help`). ¿Sin instalar? Prueba la [demo en vivo](https://skill-map.ai/demo/).

> ¿Algo no anda? La letra chica por sistema operativo y por runtime vive en [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).

### Tutorial guiado (recomendado)

Con tu agente (Claude Code, Codex, Antigravity, OpenCode), la forma más rápida de evaluar skill-map es el tutorial interactivo incluido: un prólogo de ~10 minutos sobre la UI en vivo y luego un menú de partes más profundas (tiempo real, la capa de IA, plugins, el CLI). Corre en una carpeta vacía:

```bash
mkdir prueba-skill-map && cd prueba-skill-map
sm tutorial
claude        # o el CLI de tu runtime; y en el prompt: run the tutorial
```

### Masterclass completa (40 min)

<p align="center">
  <a href="https://www.youtube.com/watch?v=EoeOS1evKf8"><img src="https://img.youtube.com/vi/EoeOS1evKf8/maxresdefault.jpg" alt="Masterclass de skill-map" width="480"></a>
</p>

Instalación, tutorial guiado, todos los settings, lentes, plugins, inspector y AI actions, de punta a punta (español e inglés). Elige el tutorial si quieres ensuciarte las manos, la masterclass si prefieres el recorrido completo primero.

## Cómo funciona

1. Un **escáner determinístico** recorre los archivos, parsea frontmatter, resuelve referencias y emite el grafo (nodos, links, issues).
2. Una **capa probabilística** opcional encola jobs LLM (resúmenes, finders, fixers, tagging) que ejecuta tu propio agente.
3. El **CLI `sm`** es la superficie principal; la **Web UI** incluida (`sm` a secas) renderiza el grafo en vivo.
4. Un **sistema de plugins** (Providers, Extractors, Analyzers, Actions, Formatters, Hooks) extiende todo sin tocar el kernel.

Cada extensión analítica se declara `deterministic` (corre dentro de `sm scan`, apta para CI) o `probabilistic` (job encolado, nunca durante el scan): mismo modelo de plugin, dos perfiles de costo.

## Filosofía

- **Diseño visible**: un harness se diseña, no se acumula; skill-map hace tu diseño verificable a medida que crece.
- **CLI-first**: todo lo que hace la UI es alcanzable desde la línea de comandos.
- **Determinístico por defecto**: el LLM es opcional; el producto funciona offline.
- **Un estándar público**: la spec en [`spec/`](./spec/README.md) alcanza para construir una implementación alternativa.
- **Agnóstico de plataforma**: hay adaptadores para Claude Code, Codex, Antigravity y OpenCode; la arquitectura acepta cualquier ecosistema Markdown.

## El panel Quick Start

> [!TIP]
> Todo lo que las próximas secciones hacen con comandos también se hace desde la UI: el botón cohete abre **Quick Start**, que activa, instala y verifica cada capacidad con un click por fila.

## Mira a tus agentes correr

Con el servidor abierto, el mapa enciende cada nodo en el momento en que tu runtime lo toca (el skill que cargó, el agente al que delegó, el archivo que leyó), y las delegaciones dibujan flechas de spawn en vivo entre agentes. Se cablea una vez por provider:

```bash
sm activity install claude    # o: codex, antigravity, opencode
```

Los hooks son locales al proyecto, todo queda en loopback, y `sm activity uninstall` revierte exactamente lo que el install agregó. Qué puede mostrar cada runtime y qué no: [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).

## Manéjalo desde tu agente (MCP)

`sm` puede exponer el proyecto como servidor [MCP](https://modelcontextprotocol.io) en `/mcp` (apagado por defecto): el mapa como tools tipadas de solo lectura y resources en vivo, más operaciones de cola y findings bajo el mismo contrato que el CLI, así un host MCP puede SER el agente procesador.

```bash
sm --mcp
```

## Procesar la cola de jobs

skill-map nunca ejecuta un LLM por sí mismo: el trabajo probabilístico se encola y TU agente lo reclama, ejecuta y registra a través del skill `sm-process-jobs` (`sm agent install`). Todos los agentes soportados hablan el mismo protocolo.

## Skill actions

Cualquier skill de agente basado en `SKILL.md` (por ejemplo, de [skills.sh](https://skills.sh)) puede ejecutarse sobre nodos individuales: instálalo en el catálogo privado del proyecto (`cd .skill-map && npx skills add <repo> --skill <name>`) y aparecerá como un grupo Skills en el panel de AI actions del inspector. Las instrucciones del skill se insertan en un job encolado que tu propio agente procesa, y el reporte queda en el historial de ejecuciones del nodo. Contrato: [`spec/skill-actions.md`](./spec/skill-actions.md).

## Archivos sidecar `.sm`

La curación humana (versión, estabilidad, tags, rastro de auditoría) vive en un YAML hermano (`demo-agent.md` → `demo-agent.sm`), nunca dentro del `.md`: el agente y tú son dueños del `.md`, skill-map es dueño del `.sm`. Aparecen solo cuando optas por ellos (`sm bump`, `sm sidecars annotate`; los scans nunca los escriben) y son código fuente: van al repo. Diseño completo: [`spec/architecture.md` §Annotation system](./spec/architecture.md#annotation-system).

## Especificación

La spec es la fuente de verdad, separada de la implementación desde el día cero: JSON Schemas (draft 2020-12), contratos en prosa y una suite de conformance, publicada como [`@skill-map/spec`](https://www.npmjs.com/package/@skill-map/spec) y servida en [skill-map.ai](https://skill-map.ai). Cualquiera puede construir una implementación alternativa consumiendo solo `spec/`. Inventario: [`spec/README.md`](./spec/README.md).

## Compatibilidad

Qué funciona dónde, de un vistazo (✓ completo, ~ parcial, ✗ no disponible):

| | Claude Code | Codex | Antigravity | OpenCode |
|---|---|---|---|---|
| Actividad de nodos en vivo | ✓ | ~ (las lecturas de archivos no encienden) | ~ (solo lecturas) | ✓ |
| Flechas de spawn entre agentes | ✓ | ✓ | ✗ | ✓ (un salto) |
| MCP (mapa + cola) | ✓ | ✓ | ✓ | ✓ |
| Agente procesador residente, costo cero en idle | ✓ | ✓ (park MCP) | ~ (pasada por pasada) | ✓ (park MCP) |

La lista completa, con el porqué de cada limitación: [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).

## Links

- Sitio: [skill-map.ai](https://skill-map.ai/)
- Qué es skill-map, en 6 minutos: [YouTube](https://www.youtube.com/watch?v=ROC0B1HAbEA)
- Masterclass completa (40 min): [YouTube](https://www.youtube.com/watch?v=EoeOS1evKf8)
- Diseño completo y roadmap: [ROADMAP.md](./ROADMAP.md)
- Guía de contribución: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Troubleshooting (letra chica por SO y por runtime): [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- Vista general de la spec: [spec/README.md](./spec/README.md)
- Arquitectura (ports & adapters): [spec/architecture.md](./spec/architecture.md)
- Contrato del CLI: [spec/cli-contract.md](./spec/cli-contract.md)
- Contrato del servidor MCP: [spec/mcp-server.md](./spec/mcp-server.md)
- Referencia del CLI: ejecuta `sm help` (con `--format md` para markdown)
- Implementación de referencia: [src/README.md](./src/README.md)
- Versión en inglés de este README: [README.md](./README.md)
- Licencia: [MIT](./LICENSE)

## Agradecimientos

La vista de grafo que le da identidad a skill-map está construida sobre [**Foblex Flow**](https://flow.foblex.com), una excelente librería de flujos para Angular que resuelve nodos, conectores, pan y zoom. Enorme gracias al equipo de Foblex.

También sobre los hombros de [Angular](https://angular.dev), [PrimeNG](https://primeng.org), [Hono](https://hono.dev) y [Kysely](https://kysely.dev).

## Star History

<a href="https://www.star-history.com/?repos=crystian%2Fskill-map&type=timeline&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline&theme=dark&legend=top-left&sealed_token=JtsEAnZCNzvD5vqADlaPvZ1GRu6kcb7LGAq55Vwz90KhdHuvfVotQnfQ9LDA8wzxt7bNvTX1S3zewen--lnL9r6Z-SS05JVk4gu5Kuq2ogcn28wY_XerVg" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline&legend=top-left&sealed_token=JtsEAnZCNzvD5vqADlaPvZ1GRu6kcb7LGAq55Vwz90KhdHuvfVotQnfQ9LDA8wzxt7bNvTX1S3zewen--lnL9r6Z-SS05JVk4gu5Kuq2ogcn28wY_XerVg" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline&legend=top-left&sealed_token=JtsEAnZCNzvD5vqADlaPvZ1GRu6kcb7LGAq55Vwz90KhdHuvfVotQnfQ9LDA8wzxt7bNvTX1S3zewen--lnL9r6Z-SS05JVk4gu5Kuq2ogcn28wY_XerVg" />
 </picture>
</a>

## Estadísticas para nerds

Lo que realmente costó construir esta herramienta (medido en `1.0.0`)

**Líneas de texto**

| Tipo | Líneas | Archivos | Proporción |
|---|---:|---:|---:|
| Código | 221.963 | 1.144 | 54% |
| Tests | 147.200 | 843 | 36% |
| Documentación | 39.595 | 292 | 10% |
| **Total** | **408.758** | **2.307** | |

Ratio tests/código: **0,66**.

**Tests**

| | |
|---|---:|
| Unitarios e integración | 5.723 |
| Casos de conformance | 49 |
| **Total** | **5.772** |

**Superficie del producto**

| | |
|---|---:|
| Verbos CLI | 79 |
| Flags | 499 |
| Endpoints BFF | 63 |
| Schemas JSON | 38 |

**Extensiones built-in**

| Tipo | Cantidad |
|---|---:|
| Analyzers | 26 |
| Actions | 18 |
| Extractors | 13 |
| Providers | 6 |
| Formatters | 4 |
| Hooks | 1 |
| **Total** | **68** en 7 plugins |

**Esfuerzo**

| | |
|---|---:|
| Commits | 1.763 |
| Sesiones de trabajo | 247 |
| Horas estimadas | ~480 |
| Equivalente a jornada completa | 12 a 14 semanas |
| Días de calendario | 104 |
| Días con actividad | 100 |

Las horas son el único dato estimado: commits agrupados en sesiones con un corte de 90 minutos, que no ve el tiempo de leer, diseñar y debuggear que nunca llegó a un commit.

**Ritmo**

| | |
|---|---:|
| Commits por día activo | 15,9 |
| Día más cargado | 71 commits |
| Commits entre 22:00 y 06:00 | 38% |
| Commits en fin de semana | 33% |
| Hora pico | 01:00 |
| Día más activo | sábado |

---

Hecho con ❤️&nbsp; por [Crystian](https://github.com/crystian/) · [LinkedIn](https://www.linkedin.com/in/crystian/)
