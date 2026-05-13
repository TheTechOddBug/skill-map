---
"@skill-map/spec": minor
---

Restrict `node.kind` to `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$` in `spec/schemas/node.schema.json`.

Reason (audit `app-hacker`, finding H1): the UI uses the kind name as a fragment of CSS custom-property identifiers (`--sm-kind-<name>`) injected into a global `<style>` tag. The previous `minLength: 1` floor let a Provider declare a kind containing `;`, `{`, `}`, or whitespace, which would close the declaration context and inject arbitrary CSS rules (defacement, redress, and CSS-based exfiltration via `url()`). The new pattern is a security boundary at the kernel and matches every kind declared by the built-in Claude / Gemini Providers; external Providers that already use ASCII letter / digit / `_` / `-` names are unaffected.

Breaking (minor pre-1.0): any external Provider emitting a kind name with characters outside this pattern is now rejected by AJV validation. Affected plugins must rename the kind to a conforming identifier.
