---
"@skill-map/cli": patch
---

Hardened the local server and opt-in telemetry. The BFF Content-Security-Policy now carries `object-src 'none'`, a zero-breakage backstop that blocks plugin-content (`<object>` / `<embed>`) script execution if the markdown sanitizer ever regresses. Separately, the opt-in UI error-telemetry SDK no longer auto-records console, fetch, xhr, or DOM breadcrumbs, which could otherwise carry project paths or request URLs into a report; navigation breadcrumbs stay and are still home-scrubbed.
