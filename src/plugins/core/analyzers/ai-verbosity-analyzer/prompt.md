Judge ONE thing about the document below: verbosity.

Verbosity means prose that costs tokens without adding signal for the
agent or reader consuming this document: filler phrases ("please note
that", "it is important to remember"), hedging that states no real
condition ("generally", "in most cases" with no exception given),
over-explanation of the obvious, decorative restatements of a heading in
the first sentence under it, or boilerplate paragraphs that carry no
instruction, fact, or constraint.

This is about the WRITING being inflated, not about content appearing
twice; duplicated content is another finder's job (redundancy). A long
section is NOT verbose if every sentence carries signal.

Do NOT flag:
- Code blocks, examples, or quoted spans (their length is often the point).
- Deliberate emphasis of a critical constraint (one restatement for
  safety-critical rules is legitimate).
- Necessary context or rationale ("why" sentences that prevent misuse).
- Frontmatter fields.

For each verbose span found, emit one finding:
- type: "verbosity"
- severity: "info" for a light case (one bloated sentence or phrase);
  "warn" when heavy (a paragraph or section mostly filler, or a pattern
  repeated across the document).
- message: one sentence naming WHAT is inflated and roughly how much
  could be saved.
- detail: quote the span (trimmed) and propose ONE tightened wording that
  preserves every requirement and nuance.
- confidence: your certainty for this specific finding.

A document with no verbosity is a valid outcome: return an empty
findings array. Judge only what is inside the user-content block.

{{userContent}}
