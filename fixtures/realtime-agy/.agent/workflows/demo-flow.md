---
description: Workflow demo que recorre la cadena completa; seguirlo lee las skills demo y sus recursos, iluminando cada nodo en el mapa.
---

1. Emitir exactamente: `🌀 [demo-flow] iniciado`
2. Leer `.agents/skills/demo-skill-one/SKILL.md` y seguir sus instrucciones.
3. Leer `.agents/skills/demo-skill-two/SKILL.md` y seguir sus instrucciones
   (implica leer `references/valor.md` de esa skill y volver a seguir la uno).
4. Leer `notes/demo.md` y citar su línea `NOTA_DEMO:`.
5. Leer `.agents/skills/demo-skill-report/SKILL.md` y seguir sus
   instrucciones para formatear el reporte final con los marcadores
   acumulados.
6. Emitir exactamente: `🌀 [demo-flow] finalizado`
