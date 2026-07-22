---
name: playground
description: Campo de pruebas de findings, borrar despues de testear
---

# Guia de despliegue

Guia para desplegar la aplicacion.

## Ejemplos

```bash
node scripts/deploy.js --target staging
node scripts/deploy.js --target production --confirm
```

Estos comandos muestran los dos despliegues tipicos; el flag `--confirm`
es obligatorio en produccion.

## Proceso

Para desplegar primero corre la suite de tests con pnpm test y despues el
build con pnpm build y una vez que ambos terminan sin errores ejecuta las
migraciones con node scripts/migrate.js teniendo en cuenta que la base de
datos tiene que estar respaldada antes con node scripts/backup.js y que el
`API_TOKEN` tiene que estar configurado en el entorno porque sin el token
el servidor rechaza todas las escrituras con 401 y despues de las
migraciones publicas con node scripts/deploy.js y al final avisas en el
canal del equipo que el despliegue termino y si algo fallo en cualquier
paso ejecutas node scripts/rollback.js para volver al estado anterior y
revisas los logs para entender que paso. Las migraciones nunca deben
ejecutarse dos veces sobre la misma base: la segunda corrida corrompe las
tablas de forma irreversible.

## Monitoreo

Despues del despliegue, mira el dashboard de Grafana
(`https://grafana.interno/deploys`) durante 15 minutos. Si la tasa de
errores supera el 2%, ejecuta el rollback de inmediato.

#### Alertas criticas

Si llega una alerta de PagerDuty durante la ventana de monitoreo, el
rollback es obligatorio aunque las metricas se vean bien.

## Checklist rapida

- Tests y build verdes.
- Backup hecho.
- `API_TOKEN` configurado.
- Migraciones una sola vez.
- 15 minutos de dashboard tras publicar.

## Historia

Este proyecto desplegaba a mano hasta 2024, cuando el equipo armo los
scripts actuales. Desde entonces los incidentes de despliegue bajaron
notablemente y el proceso dejo de depender de una sola persona.
