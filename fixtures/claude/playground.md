---
name: playground
description: Campo de pruebas de findings, borrar despues de testear
---

# Guia de despliegue

Antes de comenzar, cabe destacar que este documento tiene como objetivo
principal describir, de manera clara y detallada, el proceso de despliegue
de la aplicacion. A lo largo de las siguientes secciones se iran
desarrollando los distintos aspectos que resultan relevantes para llevar
adelante dicho proceso de la mejor manera posible.

## Cronograma

En esta seccion se describe todo lo relacionado con el cronograma de los
despliegues. Nunca despliegues los viernes; los incidentes del fin de
semana son imposibles de cubrir.

## Antes de desplegar

Es importante recordar que, en terminos generales, siempre resulta
altamente recomendable correr la suite de tests antes de proceder con
cualquier tipo de despliegue. Los tests, como es sabido, son programas que
verifican que el codigo funcione correctamente, y su ejecucion permite
detectar problemas antes de que lleguen a produccion, lo cual, como se
puede imaginar, es algo sumamente deseable para cualquier equipo de
desarrollo que se precie de tal.

Vale la pena senalar, ademas, que en la mayoria de los casos conviene
revisar los cambios pendientes. Normalmente esto se hace mirando el diff,
aunque en general cada desarrollador puede tener su propia manera de
encararlo, lo cual esta perfectamente bien y es totalmente valido.

```bash
pnpm test && pnpm build
node scripts/deploy.js --target production
```

## Variables de entorno

Configura `DATABASE_URL` y `API_TOKEN` en el entorno antes del primer
arranque. Sin `API_TOKEN` el servidor rechaza todas las escrituras con 401.

## Rollback

Como se menciono anteriormente en la introduccion de este documento, el
proceso de despliegue puede presentar inconvenientes. En ese sentido, y
teniendo en cuenta lo expuesto, resulta pertinente aclarar que el rollback
es totalmente automatico y no requiere ninguna intervencion manual por
parte del operador, lo cual representa, sin lugar a dudas, una gran
ventaja en terminos operativos.

Para ejecutarlo alcanza con correr `node scripts/rollback.js`.

## Monitoreo

Despues del despliegue, mira el dashboard de metricas durante 15 minutos.
Si la tasa de errores supera el 2%, ejecuta el rollback de inmediato.

## Consideraciones finales

Para ir cerrando, no queremos dejar de mencionar que el despliegue es una
etapa fundamental del ciclo de vida del software, y que realizarlo con
cuidado y atencion contribuye de manera significativa al buen
funcionamiento general del sistema. Esperamos que esta guia haya resultado
de utilidad para el lector interesado en la tematica.
