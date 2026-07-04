# Agentes y skills del repo (demo OpenCode)

## Cadena de invocación demo

```
demo-worker                    (agente .opencode/agent/, spawneado vía tool task)
   ├─> sigue demo-skill-one
   └─> sigue demo-skill-two ──> references/valor.md (VALOR_DEMO)

skill demo-skill-two           (tool skill, NOMBRADA, también en prosa)
   └─> encadena a demo-skill-one
/demo-cmd                      (comando NOMBRADO, también en prosa)
notes/demo.md                  (markdown suelto, se ilumina al leerse)
```

Notas OpenCode: es el proveedor más rico. Skills, comandos y agentes
llegan NOMBRADOS a los hooks (disparan incluso invocados en prosa), las
lecturas de markdown iluminan por path, y `session.idle` apaga todo lo
de esa sesión al instante (fin nativo). Los agentes built-in sin archivo
(`build`, `plan`) no tienen nodo, así que no iluminan.

El comando existe en `.opencode/command/` y `.opencode/commands/`
(cubre ambas variantes de descubrimiento del runtime; skill-map
clasifica la plural).

## Agentes (`.opencode/agent/`)

- **demo-worker**: subagente; emite marcador `🟩`, sigue las dos skills
  demo y devuelve sus marcadores.

## Skills (`.agents/skills/`)

- **demo-skill-one**: emite un marcador `✅` fijo.
- **demo-skill-two**: lee su recurso `references/valor.md`, extrae
  `VALOR_DEMO`, lo devuelve en su marcador `✅` y encadena a
  `demo-skill-one` (skill→skill).

## Comandos (`.opencode/commands/`)

- **demo-cmd**: emite un marcador `🔶` fijo.

## Cómo probar

- Skill: `ejecutá la skill demo-skill-two` (ilumina la skill, su
  recurso y la uno encadenada).
- Comando: `/demo-cmd` (o pedirlo en prosa).
- Agente: `lanzá el subagente demo-worker y devolvé su reporte`
  (ilumina el agente con su sessionID propio; al terminar, su
  `session.idle` apaga toda su cadena).
- Lectura suelta: `leé notes/demo.md y decime el NOTA_DEMO`.
