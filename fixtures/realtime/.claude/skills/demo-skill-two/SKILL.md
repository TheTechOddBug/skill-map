---
name: demo-skill-two
description: Skill de ejemplo número dos; lee su recurso markdown references/valor.md, extrae VALOR_DEMO y lo devuelve en su marcador de ejecución. Demuestra skill→recurso markdown con valor de retorno. Usar cuando demo-worker la invoca, cuando el usuario pide probar la skill demo dos, o vía /demo-skill-two.
---

# Demo Skill Two

Skill de demostración: consume un markdown propio (`references/valor.md`) y devuelve el valor que contiene.

Al ejecutarse:

1. Leer `references/valor.md` (relativo al directorio base de esta skill).
2. Extraer el valor de la línea `VALOR_DEMO:`.
3. Emitir exactamente esta línea, reemplazando `<valor>` por el extraído: `✅ [demo-skill-two] ejecutada — valor leído de references/valor.md: <valor>`
4. Devolver el control al invocador sin realizar ninguna otra acción.
