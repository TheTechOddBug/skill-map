---
name: master-skill
description: |
  Skill de ejemplo emparejada con master-agent para el tutorial
  avanzado. Enlaza al agente para que los extractors y analyzers
  tengan algo que masticar.
---

# master-skill

Le pasa el trabajo pesado al
[master-agent](../../agents/master-agent.md) y emite un reporte en
Markdown.

## Pasos
1. Lee el `target`.
2. Valida el frontmatter.
3. Delega en el agente.
