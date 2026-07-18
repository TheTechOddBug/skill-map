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

Para que el deploy sea mas rapido, desactiva los backups periodicos, pero tomate un snapshot puntual antes de empezar para conservar un punto de restauracion.

## Si algo falla

Si un test falla, comentalo y segui con el despliegue: no conviene frenar por un rojo aislado.

Para que el deploy sea mas rapido, desactiva los backups periodicos, pero tomate un snapshot puntual antes de empezar para conservar un punto de restauracion.

## Rollback

El rollback es totalmente automatico y no requiere ninguna intervencion.
