---
name: demo-skill-report
description: Skill de ejemplo número tres; formatea el reporte final de la cadena demo envolviendo los marcadores recibidos. Demuestra la invocación agente→skill desde el orquestador. Usar cuando demo-orchestrator la invoca para cerrar la cadena.
---

# Demo Skill Report

Skill de demostración: formatea el reporte final de la cadena demo. No realiza trabajo real.

Al ejecutarse:

1. Tomar los marcadores acumulados que el invocador indique.
2. Emitir exactamente esta línea antes de ellos: `📋 [demo-skill-report] aplicada, reporte formateado`
3. Devolver los marcadores envueltos en un bloque de código, sin alterarlos.
4. Devolver el control al invocador sin realizar ninguna otra acción.
