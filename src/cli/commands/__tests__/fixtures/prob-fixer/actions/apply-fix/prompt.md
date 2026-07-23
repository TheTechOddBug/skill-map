Resolve the findings listed in the `## Findings to resolve` section by
editing the node file below. skill-map never writes the body; you perform
the edit in your own session.

{{userContent}}

Return a JSON report with a `resolved` array (one entry per finding you
acted on, keyed by its `id`) and an `editsSummary` string, plus the
top-level `safety` and `confidence` fields the preamble requires.
