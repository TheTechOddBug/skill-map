# Agentes y skills del repo (demo Antigravity)

## Cadena de invocación demo

```
demo-flow                      (workflow .agent/workflows/, seguido en prosa)
   ├─> sigue demo-skill-one
   ├─> sigue demo-skill-two ──> references/valor.md (VALOR_DEMO)
   │      └─> sigue demo-skill-one   (encadenada: skill→skill)
   ├─> lee notes/demo.md             (markdown suelto)
   └─> sigue demo-skill-report       (formatea el reporte final)
```

Notas Antigravity: TODO se ilumina por LECTURA (`view_file`): el workflow
al ser seguido, las skills cuando algo lee su SKILL.md, los recursos y los
markdowns. La invocación `/skill` directa inyecta el contenido sin señal
(no ilumina), y los subagentes no tienen archivo en disco (no hay nodo
agente). Pedí el workflow EN PROSA, no con `/`.

## Workflows (`.agent/workflows/`)

- **demo-flow**: recorre la cadena completa; emite marcador `🌀`, sigue
  las tres skills, lee la nota suelta y devuelve el reporte formateado.

## Skills (`.agents/skills/`)

- **demo-skill-one**: emite un marcador `✅` fijo.
- **demo-skill-two**: lee su recurso `references/valor.md`, extrae
  `VALOR_DEMO`, lo devuelve en su marcador `✅` y encadena a
  `demo-skill-one` (skill→skill).
- **demo-skill-report**: formatea el reporte final de la cadena; la sigue
  el workflow (marcador `📋`).

## Cómo probar

- Cadena completa (en prosa): `seguí el workflow demo-flow y ejecutá sus
  pasos`
- Una lectura suelta: `leé notes/demo.md y decime el NOTA_DEMO` (ilumina
  el markdown).
- Una skill por lectura: `leé la skill demo-skill-two y seguí sus
  instrucciones` (ilumina la skill, su recurso y la uno encadenada).
