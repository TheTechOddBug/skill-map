---
"@skill-map/spec": minor
---

`spec/telemetry.md` widens the `cli.<verb>` usage event's `extensions` property beyond the scan: the verbs that execute or queue extensions (`enrich`, the `jobs` submit / claim lifecycle, `record`) now carry the involved built-in extension ids (presence only, third-party collapsed). §Scrubbing rules gains a masked-query-parameter rule: values of path- or text-bearing URL parameters (`path`, `search`) are replaced with `<masked>` wherever a URL appears in an event.
