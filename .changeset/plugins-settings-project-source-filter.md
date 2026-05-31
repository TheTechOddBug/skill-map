---
"@skill-map/cli": patch
---

Settings → Plugins gains a single filter bar: a shared **All** reset, a source axis (Built-in / Project), and the existing kind axis on one line. The two axes compose independently (picking a source does not clear a kind), so an operator can isolate the project's own drop-in plugins and extensions from the built-ins. A dedicated empty state points at `sm plugins create` when there are none yet; choices persist per browser.

## User-facing

Settings → Plugins now has a unified filter bar (All, then Built-in / Project, then the kinds), so you can quickly isolate your project's own plugins and extensions from the built-ins.
