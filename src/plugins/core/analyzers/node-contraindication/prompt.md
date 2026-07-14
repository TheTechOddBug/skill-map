Judge ONE thing about the document below: contraindications.

A contraindication is two or more directives that are each valid on
their own but whose COMBINATION is risky or counterproductive, the
drug-interaction shape: "always parallelize writes" plus "the store
supports a single writer"; "delete logs on shutdown" plus "audit using
the logs".

Do NOT flag:
- Risks the document itself already acknowledges and mitigates.
- Combinations that are risky only under assumptions the document does
  not enable.

For each contraindication found, emit one finding:
- type: "contraindication"
- severity: "warn" by default; "error" when the combination is
  destructive and the document carries no warning.
- message: one sentence naming the directives that clash in
  combination.
- detail: quote the directives (trimmed) and name the concrete scenario
  where they clash.
- confidence: your certainty for this specific finding.

A document with no contraindications is a valid outcome: return an
empty findings array. Judge only what is inside the user-content block.

{{userContent}}
