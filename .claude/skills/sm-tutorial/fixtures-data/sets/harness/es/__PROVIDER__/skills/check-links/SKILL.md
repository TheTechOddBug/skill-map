---
name: check-links
description: |
  Valida los enlaces internos del portfolio antes de publicar.
  Recorre cada página generada y reporta cualquier enlace cuyo
  destino falte.
---

# check-links

La última barrera antes de que el sitio salga.

## Pasos
1. Lista cada archivo HTML en `public/`.
2. Para cada página, junta sus enlaces internos (cada `href` a `/` o a un archivo `.html`).
3. Verifica que el destino exista en `public/` (trata `/` como `public/index.html`).
4. Reporta cualquier enlace cuyo destino falte; si no hay ninguno, reporta "0 broken links".
