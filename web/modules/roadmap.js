// ============================================================
// Roadmap timeline: phase-based interactive milestones
// ------------------------------------------------------------
// Six segments (Phase 0 / A / B / C / D / E) on a horizontal strip.
// Each segment shows internal progress and opens a detail panel
// with a brief plus a sub-list (highlights for 0, steps for
// A/B/C/D/E). Phase data is colocated EN/ES inline
// because it's content, not UI chrome; the framework strings
// (status labels, section headers, hint) live in i18n.json.
// ============================================================
(() => {
  const mount = document.getElementById('roadmap-mount');
  if (!mount) return;
  const lang = document.documentElement.lang === 'es' ? 'es' : 'en';

  const PHASES = [
    {
      id: '0',
      status: 'done',
      release: { en: '@skill-map/spec', es: '@skill-map/spec' },
      title: { en: 'Definition', es: 'Definición' },
      sub: { en: 'Project shape and the standard.', es: 'Forma del proyecto y el estándar.' },
      brief: {
        en: 'Before a line of impl shipped, skill-map had to decide what it was. The result: a hexagonal architecture with a kernel and pluggable extensions, six plugin kinds, two persistence scopes, a job subsystem designed around an LLM that can be absent, a plugin model with two storage modes, a frontmatter standard, and a strict spec-first discipline. The standard itself (37 JSON Schemas, 9 prose contracts, a conformance suite) is published as @skill-map/spec so anyone can build a second implementation against the same contract.',
        es: 'Antes de una sola línea de implementación, skill-map tuvo que decidir qué era. El resultado: una arquitectura hexagonal con un kernel y extensiones plug-in, seis tipos de plugin, dos scopes de persistencia, un subsistema de jobs diseñado alrededor de un LLM que puede no estar, un modelo de plugins con dos modos de almacenamiento, un estándar de frontmatter, y disciplina spec-first estricta. El estándar mismo (37 JSON Schemas, 9 contratos en prosa, una suite de conformance) está publicado como @skill-map/spec para que cualquiera pueda construir una segunda implementación contra el mismo contrato.',
      },
      list: 'highlights',
      items: [
        { en: 'Hexagonal architecture · kernel + ports + adapters + 6 plugin kinds', es: 'Arquitectura hexagonal · kernel + puertos + adaptadores + 6 tipos de plugin' },
        { en: 'Persistence model · 1 project scope × 3 zones', es: 'Modelo de persistencia · 1 scope de proyecto × 3 zonas' },
        { en: 'Job subsystem · atomic claim, nonce, kernel-enforced preamble', es: 'Subsistema de jobs · claim atómico, nonce, preamble forzado por el kernel' },
        { en: 'Plugin model · 2 storage modes, triple protection', es: 'Modelo de plugins · 2 modos de storage, triple protección' },
        { en: 'Frontmatter standard · universal base · provider-owned kind schemas', es: 'Estándar de frontmatter · base universal · schemas por kind del provider' },
        { en: 'Trigger normalization · 6-step pipeline', es: 'Normalización de triggers · pipeline de 6 pasos' },
        { en: 'Config hierarchy · defaults → project → project-local → override', es: 'Jerarquía de config · defaults → proyecto → project-local → override' },
        { en: 'Versioning policy · changesets, independent semver per package', es: 'Política de versionado · changesets, semver independiente por paquete' },
        { en: 'Spec as a standard · separable from reference impl', es: 'Spec como estándar · separable de la implementación de referencia' },
        { en: '37 schemas + 9 prose contracts + conformance suite', es: '37 schemas + 9 contratos en prosa + suite de conformance' },
        { en: '293 architectural decisions, logged', es: '293 decisiones arquitectónicas, registradas' },
        { en: '@skill-map/spec published on npm', es: '@skill-map/spec publicado en npm' },
      ],
    },
    {
      id: 'A',
      status: 'done',
      release: { en: 'skill-map@0.6', es: 'skill-map@0.6' },
      title: { en: 'Deterministic core', es: 'Núcleo determinista' },
      sub: { en: 'Scan, model, query, visualize. No LLM.', es: 'Escanear, modelar, consultar, visualizar. Sin LLM.' },
      brief: {
        en: 'Bytes hit disk. The spec became a working CLI: feed it any folder of agent files and it returns the full reference graph: collisions flagged, orphans listed, external deps mapped, all in milliseconds. The plugin runtime is real, not theoretical: drop a folder under .skill-map/plugins and the kernel picks it up. The Web UI baseline lands here too: sm serve boots a Hono BFF with WebSocket live updates and serves the Angular SPA from a single port; the same bundle runs offline from a static demo at skill-map.ai/demo/. A complete product, zero LLM calls.',
        es: 'Los bytes tocaron disco. La spec se volvió una CLI funcional: dale cualquier carpeta de archivos de agentes y te devuelve el grafo de referencias completo: colisiones marcadas, huérfanos listados, deps externas mapeadas, todo en milisegundos. El runtime de plugins es real, no teórico: dejas una carpeta bajo .skill-map/plugins y el kernel la levanta. La Web UI baseline también cierra acá: sm serve levanta un BFF Hono con updates en vivo por WebSocket y sirve el SPA Angular desde un solo puerto; el mismo bundle corre offline desde un demo estático en skill-map.ai/demo/. Un producto completo, cero llamadas a LLM.',
      },
      list: 'steps',
      items: [
        { id: '0b', status: 'done',    title: { en: 'Implementation bootstrap',     es: 'Bootstrap de implementación' },         body: { en: 'Workspace, kernel shell, CLI binary, conformance harness, CI green',                                                                       es: 'Workspace, kernel shell, binario CLI, harness de conformance, CI en verde' } },
        { id: '0c', status: 'done',    title: { en: 'UI prototype (Flavor A)',      es: 'Prototipo de UI (Sabor A)' },             body: { en: 'Angular + Foblex Flow + PrimeNG, mock collection, list / graph / inspector views',                                                          es: 'Angular + Foblex Flow + PrimeNG, colección mock, vistas list / graph / inspector' } },
        { id: '1a', status: 'done',    title: { en: 'Storage + migrations',          es: 'Storage + migraciones' },                  body: { en: 'SQLite via node:sqlite, kernel migrations, auto-backup, sm db * verbs',                                                                     es: 'SQLite vía node:sqlite, migraciones de kernel, auto-backup, verbos sm db *' } },
        { id: '1b', status: 'done',    title: { en: 'Registry + plugin loader',      es: 'Registry + cargador de plugins' },        body: { en: 'Six kinds enforced, drop-in plugin discovery, sm plugins list / show / doctor',                                                            es: 'Seis tipos forzados, descubrimiento drop-in de plugins, sm plugins list / show / doctor' } },
        { id: '1c', status: 'done',    title: { en: 'Orchestrator + CLI dispatcher', es: 'Orquestador + dispatcher de CLI' },       body: { en: 'Scan skeleton, full Clipanion verb registration, sm help, autogenerated CLI reference',                                                    es: 'Esqueleto del scan, registro completo de verbos en Clipanion, sm help, referencia CLI autogenerada' } },
        { id: '2',  status: 'done',    title: { en: 'First extensions',              es: 'Primeras extensiones' },                   body: { en: 'claude provider · 3 extractors (frontmatter / slash / at-directive) · 2 rules (collision / broken-ref) · ASCII formatter · validate-all rule', es: 'Provider claude · 3 extractors (frontmatter / slash / at-directive) · 2 reglas (collision / broken-ref) · formatter ASCII · rule validate-all' } },
        { id: '3',  status: 'done',    title: { en: 'UI design refinement',          es: 'Refinamiento de diseño de UI' },           body: { en: 'Node cards, connection styling, inspector layout, dark mode parity, responsive baseline',                                                  es: 'Cards de nodos, estilo de conexiones, layout del inspector, paridad en dark mode, baseline responsive' } },
        { id: '4',  status: 'done',    title: { en: 'Scan end-to-end',               es: 'Scan end-to-end' },                        body: { en: 'sm scan persists to SQLite · per-node tokens · external-url-counter extractor · --changed incremental · sm list / show / check reading the snapshot', es: 'sm scan persiste en SQLite · tokens por nodo · extractor external-url-counter · --changed incremental · sm list / show / check leyendo el snapshot' } },
        { id: '5',  status: 'done',    title: { en: 'History + orphans',             es: 'Historia + huérfanos' },                   body: { en: 'scan_meta · sm history + history stats · auto-rename heuristic (high body / medium frontmatter / ambiguous / orphan) tx-atomic FK migration · sm orphans (list / reconcile / undo-rename) · orphan persistence across scans · canonical-YAML frontmatter hash · conformance fixtures', es: 'scan_meta · sm history + history stats · heurística auto-rename (high body / medium frontmatter / ambiguous / orphan) con migración FK tx-atómica · sm orphans (list / reconcile / undo-rename) · persistencia de orphans entre scans · hash de frontmatter sobre YAML canónico · fixtures de conformance' } },
        { id: '6',  status: 'done',    title: { en: 'Config + onboarding',           es: 'Config + onboarding' },                    body: { en: '.skill-map/settings(.local).json · 6-layer config loader · sm config list/get/set/reset/show · .skillmapignore wired into the scan walker · sm init scaffolding (DB + .gitignore append + first scan) · sm plugins enable/disable over config_plugins (DB > settings.json > default precedence) · frontmatter strict mode (--strict / scan.strict)', es: '.skill-map/settings(.local).json · loader de config en 6 capas · sm config list/get/set/reset/show · .skillmapignore conectado al walker · scaffolding de sm init (DB + append a .gitignore + primer scan) · sm plugins enable/disable sobre config_plugins (precedencia DB > settings.json > default) · modo estricto de frontmatter (--strict / scan.strict)' } },
        { id: '7',  status: 'done',    title: { en: 'Robustness',                    es: 'Robustez' },                                body: { en: 'sm watch incremental scan via chokidar · link-kind-conflict rule on extractor disagreement · sm job prune with retention policy · trigger normalization wired everywhere', es: 'sm watch con scan incremental via chokidar · rule link-kind-conflict sobre desacuerdos entre extractors · sm job prune con política de retención · normalización de triggers en todos lados' } },
        { id: '8',  status: 'done',    title: { en: 'Diff + export',                 es: 'Diff + export' },                          body: { en: 'sm graph activated from stub · sm scan compare-with sub-verb (delta vs prior dump) · sm export with mini query language',                  es: 'sm graph activado desde stub · sub-verbo sm scan compare-with (delta contra dump previo) · sm export con mini lenguaje de queries' } },
        { id: '9',   status: 'done',    title: { en: 'Plugin author UX',              es: 'UX para autores de plugins' },             body: { en: 'Plugin runtime wiring · plugin migrations + triple isolation · plugin author guide',                                                       es: 'Wiring del runtime de plugins · migraciones de plugins + triple aislamiento · guía para autores' } },
        { id: '14a', status: 'done',    title: { en: 'Web UI: BFF + transport',       es: 'UI web: BFF + transporte' },               body: { en: 'sm serve boots a Hono BFF · single-port mandate (Angular SPA + REST + WebSocket on one listener) · /api/* read endpoints with envelope schema · loopback-only by design',                                  es: 'sm serve levanta un BFF Hono · mandato de un solo puerto (SPA Angular + REST + WebSocket en un solo listener) · endpoints /api/* de lectura con schema de envelope · loopback-only por diseño' } },
        { id: '14b', status: 'done',    title: { en: 'Web UI: live mode + demo',      es: 'UI web: modo en vivo + demo' },            body: { en: 'DataSourcePort with REST adapter for live and Static adapter for the offline demo · WebSocket broadcaster wiring chokidar to scan events · Inspector polish (markdown body, linked-nodes panel, per-card refresh) · provider-driven kindRegistry envelope', es: 'DataSourcePort con adaptador REST para vivo y adaptador Static para el demo offline · broadcaster WebSocket conectando chokidar a eventos de scan · pulido de Inspector (body markdown, panel de nodos enlazados, refresh por card) · envelope kindRegistry guiado por provider' } },
        { id: '14c', status: 'done',    title: { en: 'Web UI: polish & budgets',      es: 'UI web: pulido y presupuestos' },          body: { en: 'Initial chunk under 500 kB via lazy Aura preset (provideAppInitializer + dynamic import) · dark-mode tri-state (auto/light/dark following system preference) · Foblex Flow strict types pass · desktop-only ≥ 1024px with sticky red banner below threshold · Playwright demo smoke (boots clean, never fetches /api/*, three views render)', es: 'Chunk inicial bajo 500 kB vía lazy Aura preset (provideAppInitializer + import dinámico) · tri-estado de dark mode (auto/light/dark siguiendo la preferencia del sistema) · pase a tipos estrictos de Foblex Flow · desktop-only ≥ 1024px con banner rojo sticky bajo el umbral · smoke Playwright del demo (boot limpio, nunca pega a /api/*, las tres vistas renderean)' } },
      ],
    },
    {
      id: 'B',
      status: 'done',
      release: { en: 'Beta · skill-map@0.52', es: 'Beta · skill-map@0.52' },
      title: { en: 'Stabilization', es: 'Estabilización' },
      sub: { en: 'The deterministic core, hardened into a real product.', es: 'El núcleo determinista, endurecido hasta volverse un producto real.' },
      brief: {
        en: 'Phase A proved the deterministic core could exist. This phase made it solid. The plugin model settled into six kinds, then a long run of deterministic depth landed on top: a multi-runtime lens (Claude, OpenAI Codex, Agent Skills, Antigravity) you switch in one click, a Signal IR that lets extractors disagree and resolves the conflict, co-located .sm sidecars with drift detection, MCP servers surfaced as nodes, reserved-name and observable-link analysis, an inspector that plugins extend with their own buttons and panels, a fused workspace that puts files, graph and inspector on one screen, and a security plus telemetry pass (loopback-only serve, node caps, reporting that is opt-in and off by default). Still zero LLM calls. This is the Beta.',
        es: 'La Fase A probó que el núcleo determinista podía existir. Esta fase lo volvió sólido. El modelo de plugins se asentó en seis kinds, y encima aterrizó una larga racha de profundidad determinista: una lente multi-runtime (Claude, OpenAI Codex, Agent Skills, Antigravity) que cambias en un clic, un Signal IR que deja que los extractors no coincidan y resuelve el conflicto, sidecars .sm co-locados con detección de drift, servidores MCP como nodos, análisis de nombres reservados y de enlaces observables, un inspector que los plugins extienden con sus propios botones y paneles, un workspace fusionado que pone archivos, grafo e inspector en una sola pantalla, y un pase de seguridad y telemetría (serve loopback-only, topes de nodos, reporte opt-in y apagado por defecto). Sigue sin haber llamadas a LLM. Esto es el Beta.',
      },
      list: 'steps',
      items: [
        { id: '9.5',  status: 'done', title: { en: 'Plugin model settled',            es: 'Modelo de plugins asentado' },           body: { en: 'Six plugin kinds (Provider / Extractor / Analyzer / Action / Formatter / Hook) · Audit absorbed into Analyzer · qualified extension ids · open node kinds · storage port promotion · incremental scan cache', es: 'Seis kinds de plugin (Provider / Extractor / Analyzer / Action / Formatter / Hook) · Audit absorbido en Analyzer · ids de extensión calificados · apertura de Node.kind · promoción del storage port · cache de scan incremental' } },
        { id: 'ALm',  status: 'done', title: { en: 'Active-lens multi-provider',      es: 'Multi-provider con lente activa' },      body: { en: 'Claude / OpenAI Codex / Agent Skills / Antigravity lenses · one-click switch · auto-detect on first scan · lens-gated extractors (Gemini retired)', es: 'Lentes Claude / OpenAI Codex / Agent Skills / Antigravity · cambio en un clic · auto-detección en el primer scan · extractors gateados por lente (Gemini retirado)' } },
        { id: 'IR',   status: 'done', title: { en: 'Signal IR + collision detection', es: 'Signal IR + detección de colisiones' },   body: { en: 'Extractors emit byte-ranged Signals · the resolver ranks candidates and detects cross-extractor overlaps · core/extractor-collision surfaces the losers', es: 'Los extractors emiten Signals con rango de bytes · el resolver rankea candidatos y detecta solapamientos cross-extractor · core/extractor-collision muestra a los perdedores' } },
        { id: 'ann',  status: 'done', title: { en: 'Annotations (.sm sidecars)',      es: 'Annotations (sidecars .sm)' },           body: { en: 'Co-located .sm sidecars · drift detection · git-author tracking · stale / orphan analysis · write-consent model', es: 'Sidecars .sm co-locados · detección de drift · tracking de autor por git · análisis stale / orphan · modelo de consentimiento de escritura' } },
        { id: 'graph',status: 'done', title: { en: 'MCP nodes + observable links',    es: 'Nodos MCP + enlaces observables' },      body: { en: 'core/mcp-tools surfaces mcp:// servers referenced in tools · link-count chips (in / out per kind) · edge opacity by confidence · reserved-name catalog + analyzer', es: 'core/mcp-tools muestra servidores mcp:// referenciados en tools · chips de conteo de enlaces (in / out por kind) · opacidad de aristas por confianza · catálogo de nombres reservados + analyzer' } },
        { id: 'insp', status: 'done', title: { en: 'Extensible inspector',            es: 'Inspector extensible' },                 body: { en: 'Plugins contribute action buttons and per-plugin sections · parametrized actions (set stability / edit tags) · the host owns dispatch + consent', es: 'Los plugins aportan botones de acción y secciones por plugin · acciones parametrizadas (setear estabilidad / editar tags) · el host maneja dispatch + consentimiento' } },
        { id: 'ws',   status: 'done', title: { en: 'Fused workspace',                 es: 'Workspace fusionado' },                  body: { en: 'One / view with files rail + graph + inspector linked by selection · map curation with depth presets · isolate-chain gesture', es: 'Una vista / con riel de archivos + grafo + inspector enlazados por selección · curación del mapa con presets de profundidad · gesto de aislar-cadena' } },
        { id: 'hard', status: 'done', title: { en: 'Hardening + telemetry',           es: 'Hardening + telemetría' },               body: { en: 'Loopback-only serve · node hard-cap (--max-nodes) · prototype-pollution defenses · error + usage reporting that is opt-in and off by default', es: 'Serve loopback-only · tope de nodos (--max-nodes) · defensas de prototype-pollution · reporte de errores + uso opt-in y apagado por defecto' } },
      ],
    },
    {
      id: 'C',
      status: 'done',
      release: { en: 'skill-map@0.87', es: 'skill-map@0.87' },
      title: { en: 'Real-time exploration', es: 'Exploración en tiempo real' },
      sub: { en: 'Watch what happens, as it happens.', es: 'Observa lo que pasa, mientras pasa.' },
      brief: {
        en: 'skill-map stops being just a static map and starts observing execution. Landed after the Beta and before the LLM layer: the map and node spines glow as each invocation fires across all four runtimes (Claude, Codex, Antigravity, OpenCode), MCP servers are discovered from config and light up live when their tools are called, ephemeral per-node counters and spawn edges trace each session, and consent-gated live conversations stream threaded agent dialogs. The persistent execution snapshot (an immutable audit of every run) is deferred and rides the same pipe later.',
        es: 'skill-map deja de ser solo un mapa estático y empieza a observar la ejecución. Aterrizó después del Beta y antes de la capa de LLM: el mapa y las espinas de los nodos se encienden con cada invocación en los cuatro runtimes (Claude, Codex, Antigravity, OpenCode), los servidores MCP se descubren desde la config y se prenden en vivo cuando se llaman sus tools, contadores efímeros por nodo y aristas de spawn trazan cada sesión, y las conversaciones en vivo (con consentimiento) muestran los diálogos de los agentes en hilos. El snapshot persistente de ejecución (auditoría inmutable de cada run) queda diferido y montará sobre el mismo pipe más adelante.',
      },
      list: 'steps',
      items: [
        { id: 'live',  status: 'done',    title: { en: 'Live node activity',      es: 'Actividad de nodos en vivo' },      body: { en: 'Map + spine glow per invocation across four runtimes (claude / codex / antigravity / opencode)',        es: 'Glow del mapa + espina por invocación en cuatro runtimes (claude / codex / antigravity / opencode)' } },
        { id: 'mcp',   status: 'done',    title: { en: 'MCP client',              es: 'Cliente MCP' },                     body: { en: 'Config-side discovery (mcpConfig) + live tool-invocation glow · four runtimes · read-only /mcp server (opt-in)', es: 'Descubrimiento desde config (mcpConfig) + glow de invocación de tools en vivo · cuatro runtimes · servidor /mcp de sólo lectura (opt-in)' } },
        { id: 'stats', status: 'done',    title: { en: 'Execution stats + spawns', es: 'Stats de ejecución + spawns' },     body: { en: 'Ephemeral per-node counters · spawn edges · session capsules · camera follow',                          es: 'Contadores efímeros por nodo · aristas de spawn · cápsulas de sesión · cámara que sigue' } },
        { id: 'conv',  status: 'done',    title: { en: 'Live conversations',      es: 'Conversaciones en vivo' },          body: { en: 'Consent-gated threaded agent dialogs (opt-in, ephemeral)',                                              es: 'Diálogos de agentes en hilos con consentimiento (opt-in, efímeros)' } },
        { id: 'snap',  status: 'planned', title: { en: 'Execution snapshot',      es: 'Snapshot de ejecución' },           body: { en: 'Persistent immutable audit of every run (deferred, rides the same pipe later)',                         es: 'Auditoría inmutable persistente de cada run (diferido, monta sobre el mismo pipe más adelante)' } },
      ],
    },
    {
      id: 'D',
      status: 'done',
      release: { en: 'skill-map@0.89', es: 'skill-map@0.89' },
      title: { en: 'LLM as an optional layer', es: 'El LLM como capa opcional' },
      sub: { en: 'AI summaries, findings and fixes, opt-in.', es: 'Resúmenes, findings y arreglos con AI, opt-in.' },
      brief: {
        en: 'The LLM joined as an opt-in, and shipped. A job queue holds probabilistic work that your own agent claims and processes; skill-map never invokes an LLM itself. On top of it: structured AI summaries per file, and a findings pipeline where AI checks judge your agent files (redundancy, contradictions, incoherence, verbosity, vague or off-scope instructions, security risks and suspicious content) and the paired fixes are applied by your agent, with you deciding finding by finding. The findings workbench in the UI closes the loop: launch checks, watch jobs live, fix, dismiss or resolve each finding. Nothing breaks if no LLM is around; the deterministic product keeps working untouched.',
        es: 'El LLM entró como opt-in, y ya está publicado. Una cola de jobs guarda el trabajo probabilístico que tu propio agente reclama y procesa; skill-map nunca invoca un LLM por sí mismo. Encima: resúmenes AI estructurados por archivo, y un pipeline de findings donde chequeos AI juzgan tus archivos de agentes (redundancia, contradicciones, incoherencia, verbosidad, instrucciones vagas o fuera de alcance, riesgos de seguridad y contenido sospechoso) y los arreglos emparejados los aplica tu agente, decidiendo tú finding a finding. El workbench de findings en la UI cierra el círculo: lanzas chequeos, ves los jobs en vivo, arreglas, descartas o resuelves cada finding. Nada se rompe si no hay LLM; el producto determinista sigue funcionando intacto.',
      },
      list: 'steps',
      items: [
        { id: '10a', status: 'done', title: { en: 'Job queue',                     es: 'Cola de jobs' },                       body: { en: 'Queued probabilistic work · atomic claim · sm jobs submit / list / show / preview / claim / cancel / status · sm record + nonce', es: 'Trabajo probabilístico encolado · claim atómico · sm jobs submit / list / show / preview / claim / cancel / status · sm record + nonce' } },
        { id: '10b', status: 'done', title: { en: 'Pull-only agent processing',   es: 'Procesamiento pull-only por agentes' }, body: { en: 'Your own agent claims each job and reports back; skill-map never invokes an LLM itself · sm-process-jobs skill installed per runtime', es: 'Tu propio agente reclama cada job y reporta el resultado; skill-map nunca invoca un LLM por sí mismo · skill sm-process-jobs instalada por runtime' } },
        { id: '10c', status: 'done', title: { en: 'AI summaries',                 es: 'Resúmenes AI' },                        body: { en: 'Structured semantic summary per file, produced by your agent and cached with model attribution',                     es: 'Resumen semántico estructurado por archivo, producido por tu agente y cacheado con atribución de modelo' } },
        { id: '11',  status: 'done', title: { en: 'AI findings + fixes',          es: 'Findings AI + arreglos' },              body: { en: 'AI checks for redundancy, contradictions, incoherence, verbosity, vagueness, structure, triggers, scope, security and suspicious content · paired fixes applied by your agent · full finding lifecycle (fix / dismiss / resolve)', es: 'Chequeos AI de redundancia, contradicciones, incoherencia, verbosidad, vaguedad, estructura, triggers, alcance, seguridad y contenido sospechoso · arreglos emparejados aplicados por tu agente · ciclo de vida completo del finding (arreglar / descartar / resolver)' } },
        { id: '16',  status: 'done', title: { en: 'UI: findings workbench',       es: 'UI: workbench de findings' },           body: { en: 'Inspector findings card with launchers · per-finding fix / dismiss / resolve · live job status · queue tab',           es: 'Card de findings en el inspector con lanzadores · arreglar / descartar / resolver por finding · estado de jobs en vivo · pestaña de cola' } },
      ],
    },
    {
      id: 'E',
      status: 'current',
      release: { en: 'target: v1.0.0', es: 'objetivo: v1.0.0' },
      title: { en: 'Surface & distribution', es: 'Superficie y distribución' },
      sub: { en: 'Formatters, multi-host, deeper UI flows, single-binary release.', es: 'Formatters, multi-host, flujos de UI más profundos, release de un binario.' },
      brief: {
        en: 'The product reaches 1.0 here. Mermaid and DOT formatters for ops and CI, more providers so skill-map covers the multi-host ecosystem (Copilot, generic) beyond the four runtimes already supported, deeper UI flows on top of the AI layer from Phase D (connected AI agents driving the job queue over MCP, an accessibility pass), and distribution polish: documentation site, release infrastructure, and @skill-map/cli as a single npm package with the UI bundled inside. One process, one port, one command.',
        es: 'Aquí el producto llega a 1.0. Formatters Mermaid y DOT para ops y CI, más providers para cubrir el ecosistema multi-host (Copilot, genérico) además de los cuatro runtimes ya soportados, flujos de UI más profundos sobre la capa AI de la Fase D (agentes AI conectados que manejan la cola de jobs vía MCP, un pase de accesibilidad), y pulido de distribución: sitio de documentación, infraestructura de release, y @skill-map/cli como un único paquete npm con la UI empaquetada adentro. Un proceso, un puerto, un comando.',
      },
      list: 'steps',
      items: [
        { id: '17',  status: 'current', title: { en: 'UI: AI surfaces v2 (deeper)',     es: 'UI: superficies AI v2 (más profundo)' },    body: { en: 'Connected AI agents driving the job queue over MCP (already landed) · settings hierarchy viewer (already landed) · accessibility (WCAG AA) pass',                     es: 'Agentes AI conectados manejando la cola de jobs vía MCP (ya aterrizó) · visor de jerarquía de settings (ya aterrizó) · pase de accesibilidad (WCAG AA)' } },
        { id: '15a', status: 'done',    title: { en: 'Distribution: single package',    es: 'Distribución: paquete único' },             body: { en: '@skill-map/cli with UI bundled · sm + skill-map binary aliases · settings loader + runtime-settings schema · CI wiring of npm run validate (e2e smoke included) · web/demo/ deploy on every release', es: '@skill-map/cli con UI incluida · alias de binarios sm + skill-map · loader de settings + schema runtime-settings · wiring en CI de npm run validate (e2e smoke incluido) · deploy de web/demo/ en cada release' } },
        { id: '15b', status: 'done',    title: { en: 'Documentation surface',           es: 'Superficie de documentación' },             body: { en: 'llms.txt + llms-full.txt for AI ingestion (generated from spec/ on every deploy) · skill-map.ai live', es: 'llms.txt + llms-full.txt para ingesta por LLMs (generados desde spec/ en cada deploy) · skill-map.ai publicado' } },
        { id: '15c', status: 'done',    title: { en: 'Release infrastructure',          es: 'Infraestructura de release' },              body: { en: 'GitHub Actions release + changelog · telemetry opt-in · breaking-changes / deprecation policy · sm doctor install diagnostics', es: 'Release con GitHub Actions + changelog · telemetría opt-in · política de breaking-changes / deprecación · diagnósticos de install de sm doctor' } },
      ],
    },
  ];

  const STATUS_LABEL = {
    done:    { en: 'Released',    es: 'Released' },
    current: { en: 'In progress', es: 'En curso' },
    planned: { en: 'Planned',     es: 'Planeado' },
    pending: { en: 'Pending',     es: 'Pendiente' },
    open:    { en: 'Open',        es: 'Abierto' },
  };

  const SECTION_LABEL = {
    highlights: { en: 'Milestones', es: 'Milestones' },
    steps:      { en: 'Milestones', es: 'Milestones' },
  };

  const tx = (obj) => obj[lang] ?? obj.en;
  const ofWord = lang === 'es' ? 'de' : 'of';
  const phaseWord = lang === 'es' ? 'Fase' : 'Phase';

  // Detail panel is collapsed by default; `selected = -1` means no phase
  // is open. Clicking a segment opens the panel; clicking the same segment
  // again collapses it back.
  let selected = -1;

  // For phases with a `steps` list, count how many steps are done so the
  // segment can show a `done of total` progress bar. Highlights
  // phases return null and the segment shows the release line instead.
  function progressOf(p) {
    if (p.list !== 'steps') return null;
    const total = p.items.length;
    const done = p.items.filter((it) => it.status === 'done').length;
    return { done, total };
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  // --- Build the strip (7 segments) ---
  const strip = document.createElement('div');
  strip.className = 'roadmap__strip';

  const segments = document.createElement('div');
  segments.className = 'roadmap__segments';
  strip.appendChild(segments);

  PHASES.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'roadmap__seg';
    btn.dataset.idx = String(i);
    btn.dataset.status = p.status;
    btn.setAttribute('aria-current', i === selected ? 'true' : 'false');
    btn.setAttribute('aria-label', `${phaseWord} ${p.id}: ${tx(p.title)}`);

    const prog = progressOf(p);
    const barHtml = prog
      ? `<div class="roadmap__seg-bar"><span style="width:${(prog.done / prog.total) * 100}%"></span></div>
         <div class="roadmap__seg-prog">${prog.done} ${ofWord} ${prog.total}</div>`
      : `<div class="roadmap__seg-bar roadmap__seg-bar--empty"></div>
         <div class="roadmap__seg-prog">${escapeHtml(tx(p.release))}</div>`;

    btn.innerHTML = `
      <div class="roadmap__seg-id">${p.id}</div>
      <div class="roadmap__seg-title">${escapeHtml(tx(p.title))}</div>
      ${barHtml}
      <div class="roadmap__seg-status">${escapeHtml(tx(STATUS_LABEL[p.status]))}</div>
    `;
    segments.appendChild(btn);
  });

  mount.appendChild(strip);

  // --- Build the detail panel (hidden until a segment is clicked) ---
  const detail = document.createElement('div');
  detail.className = 'roadmap__detail roadmap__detail--hidden';
  detail.innerHTML = `
    <aside class="roadmap__detail-meta">
      <div class="roadmap__detail-id"></div>
      <div class="roadmap__detail-release"></div>
      <div class="roadmap__detail-status"></div>
    </aside>
    <div class="roadmap__detail-body">
      <h3 class="roadmap__detail-title"></h3>
      <div class="roadmap__detail-sub"></div>
      <p class="roadmap__detail-brief"></p>
      <div class="roadmap__detail-list-h"></div>
      <ul class="roadmap__detail-list"></ul>
    </div>
  `;
  mount.appendChild(detail);

  const hint = document.createElement('div');
  hint.className = 'roadmap__hint';
  hint.textContent = lang === 'es'
    ? 'Haz clic en cualquier fase para ver el brief.'
    : 'Click any phase to read the brief.';
  mount.appendChild(hint);

  // Accordion mode: on tablet & phone the detail panel docks right under
  // the clicked segment so the user doesn't have to scroll past the strip
  // to read the brief. On desktop the panel stays after the strip (its
  // original position) so the segment grid keeps the horizontal rhythm.
  const accordionMQ = window.matchMedia('(max-width: 1023px)');

  // Lookup by data-idx, NOT by `segments.children[i]`. Once the detail
  // panel is parented inside `.roadmap__segments`, it counts as a child
  // and shifts the index → segments.children[1] could resolve to the
  // detail itself instead of seg-1, leaving the panel stuck above the
  // newly-clicked segment ("opens upward" symptom).
  const segByIdx = (i) => segments.querySelector(`.roadmap__seg[data-idx="${i}"]`);
  const allSegs = () => segments.querySelectorAll('.roadmap__seg');

  function placeDetail() {
    if (selected < 0) return;
    if (accordionMQ.matches) {
      const seg = segByIdx(selected);
      if (seg && detail.previousElementSibling !== seg) {
        seg.after(detail);
      }
    } else {
      // Desktop home: between the strip and the hint, as a child of mount.
      if (detail.parentNode !== mount || detail.previousElementSibling !== strip) {
        mount.insertBefore(detail, hint);
      }
    }
  }

  accordionMQ.addEventListener('change', () => placeDetail());

  function setSelected(i) {
    if (i < 0 || i >= PHASES.length) return;
    // Clicking the currently-open segment collapses the detail panel.
    if (i === selected) {
      selected = -1;
      detail.classList.add('roadmap__detail--hidden');
      for (const btn of allSegs()) {
        btn.setAttribute('aria-current', 'false');
      }
      return;
    }
    selected = i;
    for (const btn of allSegs()) {
      btn.setAttribute('aria-current', String(+btn.dataset.idx === i));
    }
    detail.classList.remove('roadmap__detail--hidden');
    placeDetail();
    renderDetail();
  }

  function renderDetail() {
    const p = PHASES[selected];
    detail.dataset.status = p.status;
    detail.querySelector('.roadmap__detail-id').textContent = `${phaseWord} ${p.id}`;
    detail.querySelector('.roadmap__detail-release').textContent = tx(p.release);
    detail.querySelector('.roadmap__detail-status').textContent = tx(STATUS_LABEL[p.status]);
    detail.querySelector('.roadmap__detail-title').textContent = tx(p.title);
    detail.querySelector('.roadmap__detail-sub').textContent = tx(p.sub);
    detail.querySelector('.roadmap__detail-brief').textContent = tx(p.brief);
    detail.querySelector('.roadmap__detail-list-h').textContent = tx(SECTION_LABEL[p.list]);

    const ul = detail.querySelector('.roadmap__detail-list');
    ul.className = `roadmap__detail-list roadmap__detail-list--${p.list}`;
    ul.innerHTML = '';
    for (const item of p.items) {
      const li = document.createElement('li');
      li.dataset.status = item.status ?? p.status;
      const titleObj = item.title ?? item;
      li.innerHTML = `
        <span class="roadmap__step-mark" aria-hidden="true"></span>
        <span class="roadmap__step-text">
          <strong>${escapeHtml(tx(titleObj))}</strong>
        </span>`;
      ul.appendChild(li);
    }
  }

  // Click delegation on segments.
  segments.addEventListener('click', (e) => {
    const btn = e.target.closest('.roadmap__seg');
    if (!btn) return;
    setSelected(+btn.dataset.idx);
  });

  // Keyboard nav: arrow left/right on focused segment.
  segments.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const focused = document.activeElement;
    if (!focused?.classList.contains('roadmap__seg')) return;
    const i = +focused.dataset.idx;
    const next = e.key === 'ArrowLeft' ? Math.max(0, i - 1) : Math.min(PHASES.length - 1, i + 1);
    segByIdx(next)?.focus();
    setSelected(next);
    e.preventDefault();
  });
})();
