---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Opt-in usage telemetry now attaches the job's extension id as PostHog's `$screen_name` on the queue-lifecycle events (`cli.jobs` submit / claim, `cli.record`), so the events report names the involved finder / fixer in the URL / Screen column at a glance. Third-party ids still collapse to `external_plugin`, and the value duplicates what `extensions` already carried, so nothing new leaves the machine. Taxonomy documented in `spec/telemetry.md` §Usage event taxonomy.
