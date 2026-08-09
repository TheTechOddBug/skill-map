---
"@skill-map/cli": patch
---

Confirmation dialogs now share one global width band (512-1024px, viewport-capped): every PrimeNG confirm gate plus the sidecar-consent, crash-report, and action-prompt dialogs. The consent dialogs' former `:host ::ng-deep` sizing never reached their body-portaled dialog root, so they stretched as wide as their copy, while the follow-symlinks gate sat below the new floor.

## User-facing

Confirmation dialogs (like the companion-file write consent) no longer stretch across the whole window: they now stay between 512 and 1024 pixels wide, sizing to their content within that range.
