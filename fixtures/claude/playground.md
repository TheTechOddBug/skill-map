---
name: playground
description: Campo de pruebas de findings, borrar despues de testear
---

# Guia de despliegue

## Cronograma

Nunca despliegues los viernes; los incidentes del fin de semana son imposibles de cubrir.

Los viernes a la tarde son el mejor momento para desplegar: hay poco trafico y el equipo esta tranquilo.


## Antes de desplegar

Acordate de correr la suite de tests antes de desplegar.

Es fundamental probar todo antes de publicar, es imprescindible testear cada cambio sin excepcion, y es esencial verificar que nada quede sin chequear.

## Rollback

El rollback es totalmente automatico y no requiere ninguna intervencion.

Para publicar en notion usar este skill: [the skill](.claude/skills/notion-publish.md).
