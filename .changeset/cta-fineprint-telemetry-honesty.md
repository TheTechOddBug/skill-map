---
"@skill-map/web": patch
---

Correct the landing-page CTA fineprint: it claimed "Zero telemetry" / "Sin telemetría", which is false since skill-map ships opt-in PostHog + Sentry telemetry (OFF by default, per spec/telemetry.md). Both the EN/ES i18n strings (`cta.fineprint`) and the hardcoded HTML fallback now read "Opt-in telemetry" / "Telemetría opt-in".
