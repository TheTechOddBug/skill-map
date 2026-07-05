# Agentes y skills del repo (demo OpenCode)

## Cadena de invocación demo

```
demo-orchestrator              (agente nivel 1, spawneado vía tool task)
   ├─> demo-worker  turno 1: proceso completo   (agente nivel 2)
   │      ├─> sigue demo-skill-one
   │      └─> sigue demo-skill-two ──> references/valor.md (VALOR_DEMO)
   │             └─> sigue demo-skill-one   (encadenada: skill→skill)
   ├─> demo-worker  turno 2: resumen en una línea (sin skills)
   ├─> demo-worker  turno 3: cierre de conversación (sin skills)
   ├─> demo-scout   paso sin referencia (spawn puro, sin link previo)
   └─> sigue demo-skill-report (formatea el reporte final)

skill demo-skill-two           (tool skill, NOMBRADA, también en prosa)
/demo-cmd                      (comando NOMBRADO, también en prosa)
notes/demo.md                  (markdown suelto, se ilumina al leerse)
```

La conversación de 3 turnos son tres invocaciones separadas del tool task,
cada una con su prompt de ida y la respuesta del hijo de vuelta (en opencode
la vuelta llega NATIVA en el propio task: su resultado trae el reporte final
completo del hijo). Con la captura de conversaciones habilitada
(Settings > Project), los intercambios quedan visibles en la sección
Activity del inspector y al clickear las edges de spawn.

El paso demo-scout es deliberadamente HUÉRFANO de referencias: ningún
markdown del fixture lo nombra con arroba ni backticks, así que el mapa no
tiene edge previa hacia él y el spawn en runtime dibuja la flecha punteada
standalone. Cada sesión que spawnea (la principal, y la del orquestador)
ancla sus flechas en su propia cápsula de sesión: el tool task nunca nombra
al agente padre, solo su sessionID.

Notas OpenCode: es el proveedor más rico. Skills, comandos y agentes llegan
NOMBRADOS a los hooks (disparan incluso invocados en prosa), las lecturas de
markdown iluminan por path, y `session.idle` apaga todo lo de esa sesión al
instante (fin nativo; el padre BLOQUEA dentro del task, no hay siestas). Los
agentes built-in sin archivo (`build`, `plan`) no tienen nodo, así que no
iluminan. Los totales de ejecución (tokens/duración/tools) quedan vacíos a
propósito: existen por mensaje en el bus pero no se agregan.

## Agentes (`.opencode/agent/`)

- **demo-orchestrator**: nivel 1; emite marcador `🔷`, conversa con
  **demo-worker** en 3 turnos (proceso completo, resumen, cierre), corre el
  paso sin referencia, sigue el skill de reporte y devuelve el combinado.
  Tiene el tool task habilitado en su frontmatter para poder anidar.
- **demo-worker**: nivel 2; emite marcador `🟩`; en modo proceso sigue las
  dos skills demo; en modo conversación responde en una sola línea sin
  tocar skills.
- demo-scout: nivel 2; emite marcador `🟨`; responde una línea fija y nada
  más. Sin referencias estáticas hacia él (a propósito, ver arriba); se
  escribe siempre en texto plano.

## Skills (`.agents/skills/`)

- **demo-skill-one**: emite un marcador `✅` fijo.
- **demo-skill-two**: lee su recurso `references/valor.md`, extrae
  `VALOR_DEMO`, lo devuelve en su marcador `✅` y encadena a
  `demo-skill-one` (skill→skill).
- **demo-skill-report**: formatea el reporte final de la cadena; el
  orquestador la sigue para cerrar (marcador `📋`).

## Comandos (`.opencode/commands/`)

- **demo-cmd**: emite un marcador `🔶` fijo.

## Cómo probar

- Cadena completa con conversación: pedir que spawnee demo-orchestrator con
  el tool task y el encargo "Ejecutá la cadena demo completa según tus
  instrucciones". Cada sesión spawneadora muestra su cápsula; la edge al
  worker acumula 3 conversaciones; la del scout es la punteada sin link.
- Solo agente→skills: spawnear demo-worker directamente.
- Skill suelta: `ejecutá la skill demo-skill-two` (ilumina la skill, su
  recurso y la uno encadenada).
- Comando: `/demo-cmd` (o pedirlo en prosa).
- Lectura suelta: `leé notes/demo.md y decime el NOTA_DEMO`.
