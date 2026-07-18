Judge ONE thing about the document below: internal contradictions.

A contradiction is two directives or statements within this single
document that clash. They clash in one of two ways:
- Mutual exclusion: they cannot BOTH be followed or be true at once; a
  reader cannot act without choosing one over the other.
- Harmful combination: each is valid on its own, but following BOTH is
  risky or counterproductive (the drug-interaction shape: "always
  parallelize writes" plus "the store supports a single writer";
  "delete logs on shutdown" plus "audit using the logs").

Do NOT flag:
- Statements distinguished by explicit conditions ("in dev use X, in
  prod use Y" is a distinction, not a contradiction).
- Explicit evolution ("we used to do X, now we do Y").
- Directive pairs that CAN both be followed with no added risk.
- Risks the document itself already acknowledges and mitigates.

For each contradiction found, emit one finding:
- type: "contradiction"
- severity: "error" when the two are flatly mutually exclusive, or when
  the combination is destructive and the document carries no warning;
  "warn" when a precedence between them is inferable though ambiguous,
  or when the combination is merely risky.
- message: one sentence naming the two clashing directives.
- detail: quote both spans (trimmed) and either propose which one
  survives (or the condition that separates them), or name the concrete
  scenario where following both goes wrong.
- confidence: your certainty for this specific finding.

A document with no contradictions is a valid outcome: return an empty
findings array. Judge only what is inside the user-content block.

{{userContent}}
