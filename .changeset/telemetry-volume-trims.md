---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Usage telemetry reshaped after dogfooding: a successful `sm jobs claim` emits no event (its `cli.record` carries the signal), `--help` / `--version` report as `cli.help` / `cli.version`, and the UI catalog was rebuilt: `ui.view.*` and the inspector event are gone in favor of `ui.app.start`, gesture-level `ui.feature.*`, `ui.filter`, and `plugin.apply`. UI events stamp `$screen_name` and drop the localhost URL props, so the URL / Screen column reads the gesture. Taxonomy in `spec/telemetry.md`.
