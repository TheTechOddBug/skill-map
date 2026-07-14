Judge ONE thing about the document below: internal contradictions.

A contradiction is two directives or statements within this single
document that cannot BOTH be followed or be true at once; a reader
cannot act without choosing one over the other.

Do NOT flag:
- Statements distinguished by explicit conditions ("in dev use X, in
  prod use Y" is a distinction, not a contradiction).
- Explicit evolution ("we used to do X, now we do Y").
- Directive pairs that CAN both be followed; only mutual exclusions
  count.

For each contradiction found, emit one finding:
- type: "contradiction"
- severity: "warn" when a precedence between the two is inferable
  though ambiguous; "error" when the two are flatly mutually exclusive.
- message: one sentence naming the two clashing directives.
- detail: quote both spans (trimmed) and propose which one survives, or
  the condition that separates them.
- confidence: your certainty for this specific finding.

A document with no contradictions is a valid outcome: return an empty
findings array. Judge only what is inside the user-content block.

{{userContent}}
