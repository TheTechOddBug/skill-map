---
"@skill-map/cli": patch
---

The UI's AI submit gate now fails closed at boot (superseding the 2026-07-26 fail-open call): an unknown skill reading disables every submitting affordance with a 'Checking your agent setup...' tooltip until the automatic probe confirms the setup, while a green check verdict or an observed answer still opens it; the inspector's AI actions also re-fetch their launcher catalog when Settings closes, so plugin and skill-action toggles apply to the open node immediately.

## User-facing

**AI actions wait for your agent check.** The AI action buttons now start disabled with a 'Checking your agent setup' hint until skill-map confirms your agent is ready, and the panel refreshes as soon as you close Settings, so toggles you flip there apply right away.
