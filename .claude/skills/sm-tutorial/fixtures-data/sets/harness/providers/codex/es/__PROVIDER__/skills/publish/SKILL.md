---
name: publish
description: |
  Publica el portfolio: corre el chequeo de enlaces, le pasa al
  content editor los últimos arreglos, y luego sigue el runbook de
  despliegue.
---

# publish

La única skill que corres cuando el sitio está listo para salir.

## Pasos
1. Corre /check-links sobre las páginas en public/. Si reporta enlaces rotos, frena y arréglalos primero.
2. Si una página necesita un arreglo de contenido, dale el cambio a @content-editor.
3. Sigue el [runbook de despliegue](../../../docs/DEPLOY.md): regenera las páginas, corre el chequeo de enlaces, inicia el servidor.
