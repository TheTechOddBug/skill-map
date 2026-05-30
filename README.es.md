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

![Interfaz de skill-map](https://skill-map.ai/img/screenshot-1.png)

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

## Archivos sidecar `.sm` (no te asustes cuando aparezcan)

La primera vez que ejecutes `sm bump` o `sm sidecar annotate`, skill-map escribirá un archivo YAML hermano al lado de cada `.md`: `demo-agent.md` → `demo-agent.sm` en el mismo directorio. Son intencionales, son parte del diseño y **deben vivir en tu repo**.

**Solo aparecen cuando los pides explícitamente.** `sm scan`, `sm watch` y la Web UI **nunca crean archivos `.sm`**, solo leen los que ya existen. Si acabas de instalar skill-map y ejecutaste `sm init` / `sm` / `sm scan`, no hay ningún sidecar todavía; aparecen la primera vez que invocas `sm bump` (o `sm sidecar annotate`) sobre un nodo, y nunca antes.

**¿Por qué un archivo aparte?** Tus `.md` pertenecen al proveedor (Claude Code, Codex, Cursor, …) y a tu propia prosa. Meter la contabilidad de skill-map (versión, estabilidad, supersesión, tags, traza de auditoría) en su frontmatter contaminaría la entrada del proveedor e inflaría lo que el agente lee en cada invocación. El sidecar `.sm` mantiene las dos capas limpiamente separadas: el `.md` es del proveedor y del humano; el `.sm` es de skill-map.

**Súbelos a git.** Los `.sm` son código fuente, llevan la metadata que alimenta `sm check`, la detección de drift y los grafos de supersesión. Trátalos como cualquier otro archivo bajo control de versiones: no los añadas al `.gitignore`, no los elimines al desplegar. El hook opcional de pre-commit (`sm hooks install pre-commit-bump`) los mantiene sincronizados con su `.md` automáticamente.

Spec completo: [`spec/architecture.md` §Annotation system](./spec/architecture.md#annotation-system).

## Tutorial interactivo (recomendado)

Si usas [Claude Code](https://claude.ai/code), la forma más rápida de evaluar skill-map es el tutorial interactivo que viene incluido, aprox. **10 minutos** para la demo, con un opcional de 20–30 min más para profundizar.

```bash
mkdir prueba-skill-map && cd prueba-skill-map
sm tutorial             # deja sm-tutorial.md en el directorio vacío
claude                  # abre Claude Code en ese mismo directorio
# Después, dentro de Claude:
ejecuta @sm-tutorial.md
```

Claude se hace cargo desde ahí: arma una fixture, te guía por `sm init`, abre la Web UI, edita archivos delante tuyo y te muestra al watcher reaccionando en vivo (incluso cómo `.skillmapignore` esconde archivos en tiempo real). Ves el flujo completo antes de apuntarlo a tu proyecto real, sin compromiso, totalmente reversible.

## ¿Querés profundizar? El tutorial maestro

Una vez que tenés las bases, el **tutorial maestro** te lleva al sistema de plugins, settings y view-slots: cómo funcionan los seis tipos de extensión, cómo generar y configurar tu propio plugin, y dónde aterrizan las contribuciones en la UI. Alrededor de **30–35 minutos**, modular (vos elegís qué explorar desde un menú).

```bash
mkdir prueba-skill-map-master && cd prueba-skill-map-master
sm tutorial master      # deja sm-master.md en el directorio vacío
claude                  # abre Claude Code en ese mismo directorio
# Después, dentro de Claude:
ejecuta @sm-master.md
```

Mismo estilo hands-on que el tutorial básico, pero con foco en extensibilidad: leés el modelo, listás el catálogo, inspeccionás extensiones puntuales, después armás un plugin chico de punta a punta y lo ves aparecer en la UI.

## Especificación

El spec es la fuente de verdad y vive en [`spec/`](./spec/), separado de la implementación de referencia desde day zero, para que terceros puedan construir implementaciones alternativas consumiendo solo `spec/`.

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
