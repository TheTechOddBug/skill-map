---
name: playground
description: Guia paso a paso para desplegar la aplicacion; usar cuando alguien pregunte como desplegar o revertir un despliegue.
---

# Guia de despliegue

Guia para desplegar la aplicacion.

## Proceso

Pasos, en orden:

1. Corre los tests: `pnpm test`.
2. Corre el build: `pnpm build`. No sigas hasta que ambos terminen sin errores.
3. Respalda la base: `node scripts/backup.js`.
4. Verifica que `API_TOKEN` este configurado en el entorno; sin el token el servidor rechaza todas las escrituras con 401.
5. Ejecuta las migraciones: `node scripts/migrate.js`. Nunca dos veces sobre la misma base: la segunda corrida corrompe las tablas.
6. Publica: `node scripts/deploy.js`.
7. Avisa en el canal del equipo que el despliegue termino.

Si algo falla en cualquier paso, ejecuta `node scripts/rollback.js` y revisa los logs.

## Monitoreo

Despues del despliegue, mira el dashboard de Grafana
(`https://grafana.interno/deploys`) durante 15 minutos. Si la tasa de
errores supera el 2%, ejecuta el rollback de inmediato. Para configurar
los paneles de Grafana, ver `docs/grafana.md`.

## Estilo de mensajes de commit

Los mensajes de commit siguen conventional commits: `feat:`, `fix:`,
`chore:`, con el scope entre parentesis y la descripcion en minuscula.
El subject no supera los 70 caracteres y el body explica el porque del
cambio, no el como. Los breaking changes llevan `BREAKING CHANGE:` en el
footer. Nunca uses "WIP" como subject: describi el diff objetivamente.

## Configuracion del editor

El equipo usa VSCode con format-on-save activado y la extension de
ESLint. El archivo `.vscode/settings.json` del repo ya trae la
configuracion; no lo pises con settings personales. Para los que usan
otros editores, el `.editorconfig` cubre indentacion y line endings.

## Historia

Este proyecto desplegaba a mano hasta 2024, cuando el equipo armo los
scripts actuales. Desde entonces los incidentes de despliegue bajaron
notablemente y el proceso dejo de depender de una sola persona.
