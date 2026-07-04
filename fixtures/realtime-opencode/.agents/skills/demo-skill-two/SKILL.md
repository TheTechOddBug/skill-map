---
name: demo-skill-two
description: Skill de ejemplo número dos; lee su recurso markdown references/valor.md, extrae VALOR_DEMO, lo devuelve en su marcador de ejecución y encadena a demo-skill-one. Usar cuando el usuario pide probar la skill demo dos.
---

# Demo Skill Two

Skill de demostración: consume un markdown propio (`references/valor.md`) y devuelve el valor que contiene.

Al ejecutarse:

1. Leer `references/valor.md` (relativo al directorio base de esta skill).
2. Extraer el valor de la línea `VALOR_DEMO:`.
3. Emitir exactamente esta línea, reemplazando `<valor>` por el extraído: `✅ [demo-skill-two] ejecutada, valor leído de references/valor.md: <valor>`
4. Invocar la skill demo-skill-one y emitir también su marcador (demuestra skill→skill).
5. Devolver el control al invocador sin realizar ninguna otra acción.
